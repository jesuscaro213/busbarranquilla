# Spec 14 — BoardingScreen: preview de ruta en mapa antes de confirmar abordaje

## Contexto

Flujo actual: "Me subí" → `BoardingScreen` (lista de rutas) → tap ruta → va directo a
`BoardingConfirmScreen`.

Flujo deseado: "Me subí" → `BoardingScreen` → tap ruta → **bottom sheet con mapa de la ruta** →
"Me monté en este bus" → `BoardingConfirmScreen`.

El usuario debe ver el recorrido de la ruta en el mapa **antes** de confirmar el abordaje,
para verificar que eligió la ruta correcta.

---

## Estado actual relevante

- `BoardingScreen` (`lib/features/trip/screens/boarding_screen.dart`) tiene:
  - Lista de todas las rutas (de `routesRepository.list()`)
  - Scroll horizontal de rutas cercanas (`_nearbyRoutes`)
  - `_goToConfirm(routeId)` navega directamente a `/trip/confirm?routeId=$routeId`
- `routesRepository.getById(id)` devuelve un `BusRoute` completo con `geometry`
- `LocationService.getCurrentPosition()` devuelve la posición GPS del usuario
- `flutter_map` y `RoutePolylineLayer` ya existen en el proyecto

---

## Step 1 — Strings nuevos

**Archivo:** `lib/core/l10n/strings.dart`

Agregar:

```dart
static const boardingPreviewTitle = 'Recorrido de la ruta';
static const boardingPreviewConfirm = 'Me monté en este bus';
static const boardingPreviewLoading = 'Cargando recorrido...';
static const boardingPreviewNoGeometry = 'Sin recorrido disponible';
```

---

## Step 2 — Widget `RoutePreviewSheet` (nuevo archivo)

**Archivo:** `lib/features/trip/widgets/route_preview_sheet.dart` (nuevo)

Este widget es un bottom sheet modal que muestra el mapa de la ruta y el botón de confirmación.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../../shared/widgets/route_polyline_layer.dart';

class RoutePreviewSheet extends ConsumerStatefulWidget {
  /// The route to preview. May have empty geometry — will fetch full data.
  final BusRoute route;

  /// Called when the user confirms boarding.
  final VoidCallback onConfirm;

  const RoutePreviewSheet({
    required this.route,
    required this.onConfirm,
    super.key,
  });

  @override
  ConsumerState<RoutePreviewSheet> createState() => _RoutePreviewSheetState();
}

class _RoutePreviewSheetState extends ConsumerState<RoutePreviewSheet> {
  bool _loadingRoute = false;
  List<LatLng> _geometry = const <LatLng>[];
  LatLng? _userPosition;

  @override
  void initState() {
    super.initState();
    Future<void>(() => _load());
  }

  Future<void> _load() async {
    setState(() => _loadingRoute = true);

    // Fetch full route (with geometry) and user position in parallel
    final results = await Future.wait<dynamic>(<Future<dynamic>>[
      ref.read(routesRepositoryProvider).getById(widget.route.id),
      LocationService.getCurrentPosition(),
    ]);

    if (!mounted) return;

    final routeResult = results[0] as Result<BusRoute>;
    final position = results[1];

    setState(() {
      if (routeResult is Success<BusRoute>) {
        _geometry = routeResult.data.geometry;
      } else if (widget.route.geometry.isNotEmpty) {
        // Fallback to geometry already in the route object
        _geometry = widget.route.geometry;
      }
      if (position != null) {
        _userPosition = LatLng(position.latitude, position.longitude);
      }
      _loadingRoute = false;
    });
  }

  MapOptions _buildMapOptions() {
    final List<LatLng> points = <LatLng>[
      ..._geometry,
      if (_userPosition != null) _userPosition!,
    ];

    if (points.length >= 2) {
      return MapOptions(
        initialCameraFit: CameraFit.bounds(
          bounds: LatLngBounds.fromPoints(points),
          padding: const EdgeInsets.all(32),
        ),
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      );
    }

    // Fallback: center on user or Barranquilla
    final LatLng center = _userPosition ?? const LatLng(10.9685, -74.7813);
    return MapOptions(
      initialCenter: center,
      initialZoom: 13,
      interactionOptions: const InteractionOptions(
        flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final company = widget.route.companyName ?? widget.route.company ?? '';

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // Handle bar
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: Theme.of(context).dividerColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Route header
            Row(
              children: <Widget>[
                RouteCodeBadge(code: widget.route.code),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        widget.route.name,
                        style: Theme.of(context).textTheme.titleMedium,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (company.isNotEmpty)
                        Text(company, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Map
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                height: 340,
                child: _loadingRoute
                    ? Container(
                        color: Theme.of(context).colorScheme.surfaceContainerHighest,
                        child: const Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              CircularProgressIndicator(),
                              SizedBox(height: 8),
                              Text(AppStrings.boardingPreviewLoading),
                            ],
                          ),
                        ),
                      )
                    : FlutterMap(
                        options: _buildMapOptions(),
                        children: <Widget>[
                          TileLayer(
                            urlTemplate: AppStrings.osmTileUrl,
                            subdomains: AppStrings.osmTileSubdomains,
                            userAgentPackageName: AppStrings.osmUserAgent,
                          ),
                          if (_geometry.isNotEmpty)
                            RoutePolylineLayer(points: _geometry)
                          else
                            const Center(
                              child: Text(AppStrings.boardingPreviewNoGeometry),
                            ),
                          // User position marker
                          if (_userPosition != null)
                            MarkerLayer(
                              markers: <Marker>[
                                Marker(
                                  point: _userPosition!,
                                  width: 32,
                                  height: 32,
                                  child: const Icon(
                                    Icons.my_location,
                                    color: Colors.green,
                                    size: 28,
                                    shadows: <Shadow>[
                                      Shadow(color: Colors.black26, blurRadius: 4),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 16),

            // Confirm button
            FilledButton.icon(
              onPressed: widget.onConfirm,
              icon: const Icon(Icons.directions_bus),
              label: const Text(AppStrings.boardingPreviewConfirm),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text(AppStrings.tripClose),
            ),
          ],
        ),
      ),
    );
  }
}
```

---

## Step 3 — Modificar `BoardingScreen` para abrir el bottom sheet

**Archivo:** `lib/features/trip/screens/boarding_screen.dart`

### 3a — Import nuevo

Agregar al bloque de imports:

```dart
import '../widgets/route_preview_sheet.dart';
```

### 3b — Reemplazar `_goToConfirm` por `_showRoutePreview`

Reemplazar el método existente:

```dart
  void _goToConfirm(int routeId) {
    context.push('/trip/confirm?routeId=$routeId');
  }
```

por:

```dart
  void _showRoutePreview(BusRoute route) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (BuildContext ctx) => RoutePreviewSheet(
        route: route,
        onConfirm: () {
          Navigator.of(ctx).pop();
          context.push('/trip/confirm?routeId=${route.id}');
        },
      ),
    );
  }
```

### 3c — Actualizar todos los lugares que llaman `_goToConfirm`

En el `build()` de `_BoardingScreenState` hay dos lugares:

**1. Tarjetas de rutas cercanas** — reemplazar:
```dart
                    return _NearbyRouteCard(
                      route: route,
                      onTap: () => _goToConfirm(route.id),
                    );
```
por:
```dart
                    return _NearbyRouteCard(
                      route: route,
                      onTap: () => _showRoutePreview(route),
                    );
```

**2. Lista principal de rutas** — reemplazar:
```dart
                  return ListTile(
                    onTap: () => _goToConfirm(route.id),
```
por:
```dart
                  return ListTile(
                    onTap: () => _showRoutePreview(filtered[index]),
```

---

## Resultado visual esperado

1. Usuario abre "Me subí" → ve lista de rutas (igual que antes)
2. Toca cualquier ruta (cercana o de la lista) → se abre un **bottom sheet desde abajo**
3. El bottom sheet muestra:
   - Handle bar en la parte superior
   - Badge con el código + nombre de la ruta + empresa
   - Mapa de 340px con el trazado completo de la ruta en azul
   - Punto verde en la posición actual del usuario
   - Mientras carga el mapa: spinner + "Cargando recorrido..."
   - Si no hay geometría: fondo gris con "Sin recorrido disponible"
4. Botón **"Me monté en este bus"** → cierra el sheet y va a `BoardingConfirmScreen`
5. Botón **"Cerrar"** → cierra el sheet, vuelve a la lista
6. El mapa es ligeramente interactivo (zoom + pan) para explorar el recorrido

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `feat: route map preview bottom sheet before boarding confirmation`
