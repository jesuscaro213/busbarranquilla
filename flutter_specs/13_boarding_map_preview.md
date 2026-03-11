# Spec 13 — BoardingConfirmScreen: mapa con origen/destino + selección de destino en mapa

## Contexto

`BoardingConfirmScreen` (`lib/features/trip/screens/boarding_confirm_screen.dart`) actualmente es
solo texto y una lista de paradas. Le faltan dos cosas:

1. **Mini-mapa** que muestre la geometría de la ruta, la posición del usuario (origen) y la
   parada de bajada seleccionada (destino).
2. **Botón "Seleccionar en mapa"** en el selector de parada de bajada, que abre `MapPickScreen`
   (ya existe en `/map-pick`) y auto-selecciona la parada más cercana a las coordenadas elegidas.

---

## Estado actual del archivo

- `BoardingConfirmScreen` recibe: `routeId`, `destLat?`, `destLng?`
- En `_load()` ya hay lógica para auto-seleccionar la parada más cercana a `destLat`/`destLng`
- `_route` tiene `route.geometry` (`List<LatLng>`) disponible después de cargar
- `_stops` tiene la lista de paradas con `latitude`/`longitude`
- `_selectedStopId` es el ID de la parada seleccionada actualmente
- `_DropoffRow` es el widget que muestra la parada seleccionada y el botón Cambiar

---

## Step 1 — Strings nuevos

**Archivo:** `lib/core/l10n/strings.dart`

Agregar al final de la clase `AppStrings`:

```dart
static const boardingPickOnMap = 'Seleccionar en mapa';
static const boardingOriginLabel = 'Tu posición';
static const boardingDestLabel = 'Bajada';
```

---

## Step 2 — Mini-mapa en `BoardingConfirmScreen`

**Archivo:** `lib/features/trip/screens/boarding_confirm_screen.dart`

### 2a — Imports nuevos

Agregar al bloque de imports existente:

```dart
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../../../core/location/location_service.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
```

### 2b — Estado nuevo en `_BoardingConfirmScreenState`

Agregar junto a los demás campos de estado:

```dart
LatLng? _userPosition;
```

### 2c — Cargar posición del usuario en `_load()`

Al final de `_load()`, después del `setState(...)` que setea `_loading = false`, agregar:

```dart
// Fetch user position for map display (non-blocking, best-effort)
LocationService.getCurrentPosition().then((pos) {
  if (pos != null && mounted) {
    setState(() => _userPosition = LatLng(pos.latitude, pos.longitude));
  }
});
```

### 2d — Widget `_BoardingMapPreview` (privado, al final del archivo)

Agregar al final del archivo (después de `_DropoffRow`):

```dart
class _BoardingMapPreview extends StatelessWidget {
  final List<LatLng> geometry;
  final LatLng? userPosition;
  final Stop? destinationStop;

  const _BoardingMapPreview({
    required this.geometry,
    this.userPosition,
    this.destinationStop,
  });

  @override
  Widget build(BuildContext context) {
    // Collect all points to fit the camera
    final List<LatLng> points = <LatLng>[
      if (userPosition != null) userPosition!,
      if (destinationStop != null)
        LatLng(destinationStop!.latitude, destinationStop!.longitude),
      ...geometry,
    ];

    // Fallback center: Barranquilla
    final LatLng fallbackCenter = userPosition ??
        (geometry.isNotEmpty ? geometry[geometry.length ~/ 2] : const LatLng(10.9685, -74.7813));

    MapOptions buildOptions() {
      if (points.length >= 2) {
        return MapOptions(
          initialCameraFit: CameraFit.bounds(
            bounds: LatLngBounds.fromPoints(points),
            padding: const EdgeInsets.all(40),
          ),
          interactionOptions: const InteractionOptions(
            flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
          ),
        );
      }
      return MapOptions(
        initialCenter: fallbackCenter,
        initialZoom: 14,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        height: 280,
        child: FlutterMap(
          options: buildOptions(),
          children: <Widget>[
            TileLayer(
              urlTemplate: AppStrings.osmTileUrl,
              subdomains: AppStrings.osmTileSubdomains,
              userAgentPackageName: AppStrings.osmUserAgent,
            ),
            // Route polyline
            if (geometry.isNotEmpty) RoutePolylineLayer(points: geometry),
            // Markers
            MarkerLayer(
              markers: <Marker>[
                // Origin: user position (green)
                if (userPosition != null)
                  Marker(
                    point: userPosition!,
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
                // Destination: selected stop (red pin)
                if (destinationStop != null)
                  Marker(
                    point: LatLng(destinationStop!.latitude, destinationStop!.longitude),
                    width: 36,
                    height: 36,
                    child: const Icon(
                      Icons.location_pin,
                      color: Colors.red,
                      size: 32,
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
    );
  }
}
```

### 2e — Insertar el mini-mapa en el `build()` de `_BoardingConfirmScreenState`

En el método `build()`, después del bloque de `RouteActivityBadge` y antes de los reports,
reemplazar:

```dart
              const SizedBox(height: 8),
              RouteActivityBadge(routeId: widget.routeId),
              if (_reports.isNotEmpty) ...<Widget>[
```

por:

```dart
              const SizedBox(height: 8),
              RouteActivityBadge(routeId: widget.routeId),
              const SizedBox(height: 12),
              _BoardingMapPreview(
                geometry: route.geometry,
                userPosition: _userPosition,
                destinationStop: selectedStop,
              ),
              if (_reports.isNotEmpty) ...<Widget>[
```

---

## Step 3 — Botón "Seleccionar en mapa" en `_DropoffRow`

**Archivo:** `lib/features/trip/screens/boarding_confirm_screen.dart`

### 3a — Agregar parámetro `onPickFromMap` a `_DropoffRow`

Cambiar la clase `_DropoffRow` para agregar el parámetro opcional:

```dart
class _DropoffRow extends StatelessWidget {
  final Stop? selectedStop;
  final VoidCallback onChangeTap;
  final bool showingList;
  final VoidCallback? onPickFromMap;   // ← nuevo

  const _DropoffRow({
    required this.selectedStop,
    required this.onChangeTap,
    required this.showingList,
    this.onPickFromMap,                // ← nuevo
  });
```

### 3b — Agregar botón de mapa en el `build()` de `_DropoffRow`

Dentro de `_DropoffRow.build()`, en el `Row` que contiene el `TextButton` de "Cambiar/Cerrar",
agregar el botón de mapa **antes** del `TextButton` existente:

```dart
          // Botón de mapa (solo si onPickFromMap está definido)
          if (onPickFromMap != null)
            IconButton(
              icon: const Icon(Icons.map_outlined, size: 20),
              tooltip: AppStrings.boardingPickOnMap,
              onPressed: onPickFromMap,
              style: IconButton.styleFrom(
                padding: const EdgeInsets.all(4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          TextButton(
            onPressed: onChangeTap,
            // ... resto igual
```

### 3c — Pasar `onPickFromMap` desde el `build()` de `_BoardingConfirmScreenState`

En el lugar donde se instancia `_DropoffRow`, reemplazar:

```dart
              _DropoffRow(
                selectedStop: selectedStop,
                onChangeTap: () => setState(() => _showStopList = !_showStopList),
                showingList: _showStopList,
              ),
```

por:

```dart
              _DropoffRow(
                selectedStop: selectedStop,
                onChangeTap: () => setState(() => _showStopList = !_showStopList),
                showingList: _showStopList,
                onPickFromMap: () async {
                  // Importar NominatimResult al inicio del archivo
                  final result = await context.push<NominatimResult>('/map-pick');
                  if (result == null || !mounted) return;
                  // Encontrar la parada más cercana al punto elegido
                  if (_stops.isEmpty) return;
                  Stop? nearest;
                  double bestDist = double.infinity;
                  for (final stop in _stops) {
                    final d = LocationService.distanceMeters(
                      stop.latitude,
                      stop.longitude,
                      result.lat,
                      result.lng,
                    );
                    if (d < bestDist) {
                      bestDist = d;
                      nearest = stop;
                    }
                  }
                  if (nearest != null) {
                    setState(() {
                      _selectedStopId = nearest!.id;
                      _showStopList = false;
                    });
                  }
                },
              ),
```

### 3d — Import de `NominatimResult`

Agregar al bloque de imports de `boarding_confirm_screen.dart`:

```dart
import '../../planner/models/nominatim_result.dart';
```

---

## Resultado visual esperado

1. Al abrir `BoardingConfirmScreen`:
   - Se muestra el mapa de 280px justo debajo del badge de actividad
   - Si hay geometría: polyline azul de la ruta
   - Si hay GPS: ícono verde `my_location` en la posición del usuario
   - Si hay parada seleccionada: pin rojo en esa parada
   - El mapa se ajusta automáticamente para mostrar ambos puntos
   - El usuario puede hacer zoom y mover el mapa (pinch + drag)
   - Si no hay destino, el mapa muestra la ruta centrada en el usuario

2. En el selector de bajada (`_DropoffRow`):
   - Aparece un ícono 🗺️ a la izquierda del botón "Cambiar"
   - Al tocarlo se abre `MapPickScreen` (pantalla full-screen existente)
   - El usuario mueve el mapa y confirma
   - La parada más cercana al punto elegido se auto-selecciona
   - El pin rojo del mini-mapa se mueve a esa parada

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar **0 issues**.

Commit: `feat: boarding map preview with origin/destination and map pick`
