# Spec 36 — Alertas inteligentes en modo espera

## Contexto

Extiende el `_startGpsMovementMonitor` del Spec 35 con dos casos nuevos que completan
la matriz de detección de movimiento en modo espera. Ambos disparan diálogos — nunca
acciones automáticas — porque la incertidumbre es alta (rutas paralelas, trancones).

Agrega también el widget `QuickBoardSheet` para boarding rápido sin paradas ni previews.

---

## Matriz completa de comportamiento (modo espera activo)

| Velocidad | Posición vs. ruta | Distancia desde inicio | Tiempo | Acción |
|-----------|-------------------|------------------------|--------|--------|
| ≥ 10 km/h | Sobre la ruta (<150m) | ≥ 200m | ≥ 4 min | Auto-board (M2, Spec 35) |
| ≥ 10 km/h | Fuera de ruta (>300m) | ≥ 200m | ≥ 4 min | Auto-cancelar espera (M3, Spec 35) |
| < 10 km/h | Sobre la ruta (<150m) | ≥ 200m | ≥ 8 min | Diálogo "¿Ya te subiste?" (M4, este spec) |
| < 10 km/h | Fuera de ruta (>300m) | ≥ 1000m | ≥ 5 min | Diálogo "¿Sigues esperando?" (M5, este spec) |
| cualquiera | cualquiera | < 200m | — | Nada (usuario quieto en la parada) |

---

## Nuevos casos

### Mecanismo 4 (M4) — Lento sobre la ruta → "¿Ya te subiste?"

El usuario se mueve a velocidad de bus en trancón (<10 km/h) siguiendo la geometría
de la ruta que espera. Pudo haber subido a ESE bus u otro que comparte el corredor.
No se puede saber — se pregunta.

**Condiciones:**
- `distToRoute < 150` (sobre la geometría)
- `speedKmh < 10` (no supera el threshold de M2)
- `distFromOnRouteStart ≥ 200m` (se ha movido desde que entró a la ruta)
- Sostenido ≥ 8 minutos

**Cálculo de velocidad para M4:**
Usar `_userPosAtOnRouteStart` (posición cuando `_onRouteStart` se asignó) en vez de
`_waitingStartPosition`, para medir solo el desplazamiento desde que empezó a moverse
sobre la ruta — no desde que abrió la vista de espera.

```
speedKmh = (distFromOnRouteStart / onRouteElapsed.inSeconds) * 3.6
```

**Diálogo — 3 opciones:**
1. `"Sí, estoy en el [route.code]"` → `_triggerAutoBoarding(route)` + cerrar diálogo
2. `"Cogí otro bus"` → cerrar diálogo + abrir `QuickBoardSheet`
3. `"No, sigo esperando"` → resetear `_onRouteStart` y `_userPosAtOnRouteStart`

---

### Mecanismo 5 (M5) — Lento fuera de ruta + >1km → "¿Sigues esperando?"

El usuario caminó más de 1 km lejos de la ruta. Lo más probable es que desistió del
bus pero no canceló el modo espera.

**Condiciones:**
- `distToRoute > 300` (fuera de la geometría)
- `distFromStart > 1000` (más de 1km desde el punto de espera)
- `speedKmh < 10` (está caminando, no en otro vehículo — eso ya lo cubre M3)
- Sostenido ≥ 5 minutos

**Diálogo — 2 opciones:**
1. `"Sigo esperando"` → resetear `_offRouteStart`, no hacer nada más
2. `"Ya no voy a tomar ese bus"` → `ref.read(selectedWaitingRouteProvider.notifier).state = null`

---

## Archivos a modificar

### 1. `lib/core/l10n/strings.dart`

Agregar:

```dart
// ── Waiting mode smart alerts ──────────────────────────────────────────────
static const waitingSlowOnRouteTitle = '¿Ya te subiste al bus?';
static const waitingSlowOnRouteBody =
    'Llevas varios minutos moviéndote sobre esta ruta a velocidad baja.';
static const waitingSlowOnRouteYes = 'Sí, estoy en el ';   // + route.code
static const waitingSlowOnRouteOther = 'Cogí otro bus';
static const waitingSlowOnRouteNo = 'No, sigo esperando';

static const waitingFarOffRouteTitle = '¿Sigues esperando el bus?';
static const waitingFarOffRouteBody =
    'Te has alejado más de 1 km de la ruta. ¿Todavía quieres tomar este bus?';
static const waitingFarOffRouteContinue = 'Sigo esperando';
static const waitingFarOffRouteCancel = 'Ya no voy a tomarlo';

static const quickBoardTitle = 'Selecciona tu bus';
static const quickBoardSearchHint = 'Buscar ruta...';
```

---

### 2. Nuevo widget `lib/features/map/widgets/quick_board_sheet.dart`

Bottom sheet minimalista para boarding rápido. Sin mapa, sin paradas, sin confirmación.

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../trip/providers/trip_notifier.dart';
import '../../trip/providers/trip_state.dart';
import '../providers/waiting_route_provider.dart';

class QuickBoardSheet extends ConsumerStatefulWidget {
  const QuickBoardSheet({super.key});

  @override
  ConsumerState<QuickBoardSheet> createState() => _QuickBoardSheetState();
}

class _QuickBoardSheetState extends ConsumerState<QuickBoardSheet> {
  List<BusRoute> _routes = <BusRoute>[];
  List<BusRoute> _filtered = <BusRoute>[];
  bool _loading = true;
  final TextEditingController _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadRoutes();
    _search.addListener(_onSearch);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadRoutes() async {
    final result = await ref.read(routesRepositoryProvider).list();
    if (!mounted) return;
    if (result is Success<List<BusRoute>>) {
      setState(() {
        _routes = result.data;
        _filtered = result.data;
        _loading = false;
      });
    } else {
      setState(() => _loading = false);
    }
  }

  void _onSearch() {
    final q = _search.text.toLowerCase();
    setState(() {
      _filtered = q.isEmpty
          ? _routes
          : _routes
              .where((r) =>
                  r.name.toLowerCase().contains(q) ||
                  r.code.toLowerCase().contains(q))
              .toList();
    });
  }

  Future<void> _selectRoute(BusRoute route) async {
    Navigator.of(context).pop(); // close sheet first

    // Clear waiting mode before starting trip
    ref.read(selectedWaitingRouteProvider.notifier).state = null;

    await ref.read(tripNotifierProvider.notifier).startTrip(route.id);

    if (!mounted) return;
    if (ref.read(tripNotifierProvider) is TripActive) {
      context.go('/trip');
    }
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (_, controller) => Column(
        children: <Widget>[
          // Handle
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text(
              AppStrings.quickBoardTitle,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _search,
              autofocus: true,
              decoration: InputDecoration(
                hintText: AppStrings.quickBoardSearchHint,
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    controller: controller,
                    itemCount: _filtered.length,
                    itemBuilder: (_, i) {
                      final route = _filtered[i];
                      return ListTile(
                        leading: RouteCodeBadge(code: route.code),
                        title: Text(route.name),
                        subtitle: route.company != null
                            ? Text(
                                route.company!,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textSecondary,
                                ),
                              )
                            : null,
                        onTap: () => _selectRoute(route),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
```

---

### 3. `lib/features/map/screens/map_screen.dart`

#### 3a. Nuevos campos en `_MapScreenState`

```dart
// Agrega junto a los campos de M2/M3 existentes:
LatLng?   _userPosAtOnRouteStart;    // GPS usuario cuando _onRouteStart se asignó
LatLng?   _userPosAtOffRouteStart;   // GPS usuario cuando _offRouteStart se asignó
bool      _slowAlertShown = false;   // evita mostrar el diálogo M4 repetidamente
bool      _farAlertShown = false;    // evita mostrar el diálogo M5 repetidamente
```

#### 3b. Modificar `_stopWaiting` — limpiar nuevos campos

```dart
// Agregar al bloque de limpieza existente en _stopWaiting:
_userPosAtOnRouteStart = null;
_userPosAtOffRouteStart = null;
_slowAlertShown = false;
_farAlertShown = false;
```

#### 3c. Modificar `_startGpsMovementMonitor` — agregar M4 y M5

Dentro del timer periódico de 30s, después del bloque de M2 y M3 existentes, agregar:

```dart
// ── Bloque M2 existente (≥10 km/h sobre la ruta → auto-board) ──────────
if (distToRoute < 150) {
  _offRouteStart = null;
  _userPosAtOffRouteStart = null;
  _farAlertShown = false;

  if (_onRouteStart == null) {
    _onRouteStart = DateTime.now();
    _userPosAtOnRouteStart = userPos;   // ← nuevo: guardar posición al inicio
    return;
  }

  final onRouteElapsed = DateTime.now().difference(_onRouteStart!);

  // Velocidad medida desde que entró a la ruta (no desde inicio de espera)
  final distFromOnRouteStart = _userPosAtOnRouteStart != null
      ? LocationService.distanceMeters(
          _userPosAtOnRouteStart!.latitude, _userPosAtOnRouteStart!.longitude,
          userPos.latitude, userPos.longitude)
      : distFromStart;

  final elapsedSec = onRouteElapsed.inSeconds.toDouble();
  final speedKmh = elapsedSec > 0
      ? (distFromOnRouteStart / elapsedSec) * 3.6
      : 0.0;

  // M2: rápido → auto-board
  if (speedKmh >= 10 && onRouteElapsed >= const Duration(minutes: 4)) {
    _triggerAutoBoarding(route);
    return;
  }

  // M4: lento sobre la ruta ≥ 8 min → preguntar
  if (speedKmh < 10 &&
      distFromOnRouteStart >= 200 &&
      onRouteElapsed >= const Duration(minutes: 8) &&
      !_slowAlertShown) {
    _slowAlertShown = true;
    _onRouteStart = null;              // resetear para no re-disparar
    _userPosAtOnRouteStart = null;
    if (mounted) _showSlowOnRouteDialog(route);
    return;
  }
}

// ── Bloque M3 existente (≥10 km/h fuera de ruta → auto-cancelar) ───────
if (distToRoute > 300) {
  _onRouteStart = null;
  _userPosAtOnRouteStart = null;
  _slowAlertShown = false;

  if (_offRouteStart == null) {
    _offRouteStart = DateTime.now();
    _userPosAtOffRouteStart = userPos;   // ← nuevo: guardar posición al inicio
    return;
  }

  final offRouteElapsed = DateTime.now().difference(_offRouteStart!);

  final distFromOffRouteStart = _userPosAtOffRouteStart != null
      ? LocationService.distanceMeters(
          _userPosAtOffRouteStart!.latitude, _userPosAtOffRouteStart!.longitude,
          userPos.latitude, userPos.longitude)
      : distFromStart;

  final elapsedSec = offRouteElapsed.inSeconds.toDouble();
  final speedKmh = elapsedSec > 0
      ? (distFromOffRouteStart / elapsedSec) * 3.6
      : 0.0;

  // M3: rápido fuera de ruta → auto-cancelar
  if (speedKmh >= 10 &&
      offRouteElapsed >= const Duration(minutes: 4)) {
    _gpsMovementTimer?.cancel();
    if (mounted) {
      ref.read(selectedWaitingRouteProvider.notifier).state = null;
      AppSnackbar.show(context, AppStrings.waitingAutoCancelled, SnackbarType.info);
    }
    return;
  }

  // M5: lento + >1km fuera de ruta → preguntar
  if (speedKmh < 10 &&
      distFromStart > 1000 &&
      offRouteElapsed >= const Duration(minutes: 5) &&
      !_farAlertShown) {
    _farAlertShown = true;
    _offRouteStart = null;             // resetear para no re-disparar
    _userPosAtOffRouteStart = null;
    if (mounted) _showFarOffRouteDialog();
    return;
  }
}
```

#### 3d. Nuevo método `_showSlowOnRouteDialog`

```dart
void _showSlowOnRouteDialog(BusRoute route) {
  showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(AppStrings.waitingSlowOnRouteTitle),
      content: Text(AppStrings.waitingSlowOnRouteBody),
      actions: <Widget>[
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            // Resetear estado para que pueda volver a detectar
            setState(() => _slowAlertShown = false);
          },
          child: Text(AppStrings.waitingSlowOnRouteNo),
        ),
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              shape: const RoundedRectangleBorder(
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              builder: (_) => const QuickBoardSheet(),
            );
          },
          child: Text(AppStrings.waitingSlowOnRouteOther),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            _triggerAutoBoarding(route);
          },
          child: Text('${AppStrings.waitingSlowOnRouteYes}${route.code}'),
        ),
      ],
    ),
  );
}
```

#### 3e. Nuevo método `_showFarOffRouteDialog`

```dart
void _showFarOffRouteDialog() {
  showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(AppStrings.waitingFarOffRouteTitle),
      content: Text(AppStrings.waitingFarOffRouteBody),
      actions: <Widget>[
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            setState(() => _farAlertShown = false);
          },
          child: Text(AppStrings.waitingFarOffRouteContinue),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            ref.read(selectedWaitingRouteProvider.notifier).state = null;
          },
          child: Text(AppStrings.waitingFarOffRouteCancel),
        ),
      ],
    ),
  );
}
```

#### 3f. Agregar import de `QuickBoardSheet` en `map_screen.dart`

```dart
import '../widgets/quick_board_sheet.dart';
```

---

## Notas de implementación

- `_slowAlertShown` y `_farAlertShown` se resetean a `false` cuando el usuario
  elige "No, sigo esperando" en cada diálogo — así puede volver a disparar si la
  condición se repite más adelante en el mismo modo espera.
- `QuickBoardSheet` llama `routesRepositoryProvider.list()`. Si ya hay rutas en
  caché (Riverpod keepAlive), la carga es instantánea.
- Al iniciar el viaje desde `QuickBoardSheet`, se limpia `selectedWaitingRouteProvider`
  antes de llamar `startTrip` — igual que en el auto-boarding del Spec 35.
- No es necesario pasar `destinationStopId` a `startTrip` desde `QuickBoardSheet`.
  Si `boardingAlerts` está activo en preferencias, el Spec 34 activa las alertas
  automáticamente al inicio del viaje.

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
# debe retornar: No issues found!
```
