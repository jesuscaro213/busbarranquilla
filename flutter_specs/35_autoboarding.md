# Spec 35 — Auto-boarding inteligente (3 mecanismos)

## Objetivo

Detectar automáticamente que el usuario subió a un bus sin haber presionado "Me subí", usando tres mecanismos complementarios que se ejecutan en paralelo durante el modo espera. Si alguno confirma el boarding, se inicia el viaje con un período de deshacer de 8 segundos. El flujo resultante es idéntico al boarding manual: `tripNotifier.startTrip(route.id)` → `context.go('/trip')`.

Adicionalmente, si el usuario se mueve de forma sostenida por una ruta diferente a la que espera, el modo espera se cancela automáticamente.

---

## Los tres mecanismos de detección

### Mecanismo 1 — Co-movimiento con señal de otro pasajero (socket)

Requiere que haya otro usuario transmitiendo en el mismo bus.

**Condiciones (todas deben cumplirse):**
1. Hay al menos un pasajero transmitiendo en la ruta esperada (`_socketBusPositions` no vacío, tripId > 0)
2. Distancia entre el usuario y el pasajero más cercano es **< 40 m**
3. Esa condición se mantiene **≥ 3 minutos** continuos
4. Tanto el usuario como ese pasajero han desplazado **≥ 100 m** desde T=0
5. El `tripId` ancla sigue activo en `_socketBusPositions`

La condición 4 garantiza co-movimiento real. El tripId ancla se actualiza solo si otro pasajero se acerca más (sin resetear el timer).

**Reset del tracking** cuando:
- La distancia al ancla supera 40 m
- El `tripId` ancla desaparece de `_socketBusPositions` (pasajero se bajó)
- El auto-boarding se dispara

---

### Mecanismo 2 — Movimiento del usuario sobre la geometría de la ruta (GPS propio)

No requiere señal de otro pasajero. Usa el GPS del usuario comparado contra la geometría de la ruta esperada.

**Al activar modo espera:** guardar `_waitingStartPosition = _livePosition`.

**Un timer periódico de 30 s** evalúa en cada tick:
1. Usuario se movió **≥ 200 m** desde `_waitingStartPosition`
2. Posición actual está **a < 150 m** de la geometría de la ruta esperada
3. Velocidad estimada **≥ 10 km/h** (= distancia_recorrida / tiempo_transcurrido — filtra caminata)
4. Condiciones 1–3 se cumplen por **≥ 4 minutos** continuos

Si se cumplen las 4 → disparar auto-boarding.

**Cálculo de velocidad:**
```
velocidad_kmh = (distancia_m / segundos_transcurridos) * 3.6
```
`segundos_transcurridos` = tiempo desde que comenzó la condición de proximidad a la ruta.

**Distancia a geometría** se calcula iterando sobre los puntos de `route.geometry` con `LocationService.distanceMeters` y tomando el mínimo.

---

### Mecanismo 3 — Auto-cancelación del modo espera (ruta incorrecta)

Se ejecuta en el mismo timer de 30 s del Mecanismo 2.

**Condiciones para cancelar el modo espera:**
1. Usuario se movió **≥ 200 m** desde `_waitingStartPosition`
2. Posición actual está **a > 300 m** de la geometría de la ruta esperada
3. Velocidad estimada **≥ 10 km/h**
4. Condición sostenida por **≥ 4 minutos** continuos

Si se cumplen las 4 → `ref.read(selectedWaitingRouteProvider.notifier).state = null` + snackbar informativo.

**Nota:** No disparar auto-boarding si se va a cancelar el modo espera. Las dos condiciones son mutuamente excluyentes (el usuario está cerca O lejos de la ruta).

---

## Archivos a modificar

### 1. `lib/core/l10n/strings.dart`

Agregar:

```dart
static const autoboardDetected = 'Subiste al bus automáticamente';
static const autoboardUndo = 'Deshacer';
static const autoboardCancelled = 'Auto-boarding cancelado';
static const waitingAutoCancelled = 'Modo espera cancelado — parece que tomaste otro bus';
```

---

### 2. `lib/features/map/screens/map_screen.dart`

#### 2a. Nuevos campos en `_MapScreenState`

```dart
// ── Auto-boarding — Mecanismo 1 (señal de otro pasajero) ──────────────────
DateTime? _autoboardProximityStart;   // cuando usuario llegó a <40m del ancla
LatLng?   _autoboardUserPosAtStart;   // GPS usuario en T=0 de proximidad
LatLng?   _autoboardBusPosAtStart;    // GPS ancla en T=0
int?      _autoboardAnchorTripId;     // tripId siendo monitoreado

// ── Auto-boarding — Mecanismo 2 y 3 (GPS propio sobre geometría) ──────────
LatLng?   _waitingStartPosition;      // GPS al activar modo espera
DateTime? _onRouteStart;              // inicio de período "sobre la ruta" (M2)
DateTime? _offRouteStart;             // inicio de período "fuera de ruta" (M3)
Timer?    _gpsMovementTimer;          // tick cada 30s para M2 y M3

// ── Compartido ────────────────────────────────────────────────────────────
bool      _autoboardPending = false;  // bloquea doble disparo
Timer?    _autoboardUndoTimer;        // ventana de 8s para deshacer
```

#### 2b. Helper `_distToRouteGeometry` (estático)

```dart
static double _distToRouteGeometry(LatLng point, List<LatLng> geometry) {
  if (geometry.isEmpty) return double.infinity;
  double minDist = double.infinity;
  for (final geoPoint in geometry) {
    final d = LocationService.distanceMeters(
      point.latitude, point.longitude,
      geoPoint.latitude, geoPoint.longitude,
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
}
```

#### 2c. Método `_checkAutoBoarding` (Mecanismo 1 — socket)

Llamado desde `_updateWaitingState` tras recalcular posiciones.

```dart
void _checkAutoBoarding(BusRoute route) {
  if (_autoboardPending) return;
  if (ref.read(tripNotifierProvider) is! TripIdle) return;

  final userPos = _livePosition;
  if (userPos == null || _socketBusPositions.isEmpty) {
    _resetM1Tracking();
    return;
  }

  // Only socket-sourced positions (tripId > 0) — HTTP snapshots unreliable for co-movement
  int? closestTripId;
  LatLng? closestBusPos;
  double closestDist = double.infinity;
  for (final entry in _socketBusPositions.entries) {
    if (entry.key < 0 || entry.value.isEmpty) continue; // skip HTTP snapshots
    final pos = entry.value.first;
    final d = LocationService.distanceMeters(
        userPos.latitude, userPos.longitude, pos.latitude, pos.longitude);
    if (d < closestDist) {
      closestDist = d;
      closestTripId = entry.key;
      closestBusPos = pos;
    }
  }

  if (closestTripId == null || closestBusPos == null || closestDist >= 40) {
    _resetM1Tracking();
    return;
  }

  // If anchor changed to a closer passenger, reset and re-anchor (don't reset timer
  // if the new anchor is the bus — the user is still on it)
  if (_autoboardAnchorTripId != null && _autoboardAnchorTripId != closestTripId) {
    _resetM1Tracking();
  }

  if (_autoboardProximityStart == null) {
    _autoboardProximityStart = DateTime.now();
    _autoboardUserPosAtStart = userPos;
    _autoboardBusPosAtStart = closestBusPos;
    _autoboardAnchorTripId = closestTripId;
    return;
  }

  if (!_socketBusPositions.containsKey(_autoboardAnchorTripId)) {
    _resetM1Tracking();
    return;
  }

  final elapsed = DateTime.now().difference(_autoboardProximityStart!);
  if (elapsed < const Duration(minutes: 3)) return;

  final userMoved = LocationService.distanceMeters(
    _autoboardUserPosAtStart!.latitude, _autoboardUserPosAtStart!.longitude,
    userPos.latitude, userPos.longitude,
  );
  final busMoved = LocationService.distanceMeters(
    _autoboardBusPosAtStart!.latitude, _autoboardBusPosAtStart!.longitude,
    closestBusPos.latitude, closestBusPos.longitude,
  );

  if (userMoved >= 100 && busMoved >= 100) {
    _triggerAutoBoarding(route);
  }
}
```

#### 2d. Método `_resetM1Tracking`

```dart
void _resetM1Tracking() {
  _autoboardProximityStart = null;
  _autoboardUserPosAtStart = null;
  _autoboardBusPosAtStart = null;
  _autoboardAnchorTripId = null;
}
```

#### 2e. Método `_startGpsMovementMonitor` (Mecanismos 2 y 3)

Llamado al final de `_startWaiting` después de guardar `_waitingStartPosition`.

```dart
void _startGpsMovementMonitor(BusRoute route) {
  _gpsMovementTimer?.cancel();
  _onRouteStart = null;
  _offRouteStart = null;

  _gpsMovementTimer = Timer.periodic(const Duration(seconds: 30), (_) {
    if (_autoboardPending) return;
    if (ref.read(tripNotifierProvider) is! TripIdle) return;

    final userPos = _livePosition;
    final startPos = _waitingStartPosition;
    if (userPos == null || startPos == null) return;

    final distFromStart = LocationService.distanceMeters(
      startPos.latitude, startPos.longitude,
      userPos.latitude, userPos.longitude,
    );

    // Not moved enough — reset both counters and wait
    if (distFromStart < 200) {
      _onRouteStart = null;
      _offRouteStart = null;
      return;
    }

    // Check distance to the waited route's geometry
    final distToRoute = _distToRouteGeometry(userPos, route.geometry);

    // ── Mecanismo 2: on-route movement ──────────────────────────────────
    if (distToRoute < 150) {
      _offRouteStart = null; // not off-route, reset M3

      if (_onRouteStart == null) {
        _onRouteStart = DateTime.now();
        return;
      }

      final onRouteElapsed = DateTime.now().difference(_onRouteStart!);
      if (onRouteElapsed < const Duration(minutes: 4)) return;

      // Velocity check: ≥ 10 km/h over the elapsed time
      final elapsedSec = onRouteElapsed.inSeconds.toDouble();
      final speedKmh = (distFromStart / elapsedSec) * 3.6;
      if (speedKmh < 10) return; // walking pace — not on bus

      _triggerAutoBoarding(route);
      return;
    }

    // ── Mecanismo 3: off-route movement → cancel waiting ─────────────────
    if (distToRoute > 300) {
      _onRouteStart = null; // not on route, reset M2

      if (_offRouteStart == null) {
        _offRouteStart = DateTime.now();
        return;
      }

      final offRouteElapsed = DateTime.now().difference(_offRouteStart!);
      if (offRouteElapsed < const Duration(minutes: 4)) return;

      // Velocity check: ≥ 10 km/h — must be in a vehicle, not just walking away
      final elapsedSec = offRouteElapsed.inSeconds.toDouble();
      final speedKmh = (distFromStart / elapsedSec) * 3.6;
      if (speedKmh < 10) return;

      // Cancel waiting mode — user boarded a different bus
      _gpsMovementTimer?.cancel();
      if (mounted) {
        ref.read(selectedWaitingRouteProvider.notifier).state = null;
        AppSnackbar.show(context, AppStrings.waitingAutoCancelled, SnackbarType.info);
      }
    }
  });
}
```

#### 2f. Método `_triggerAutoBoarding` (compartido por M1 y M2)

```dart
void _triggerAutoBoarding(BusRoute route) {
  if (_autoboardPending) return;
  _autoboardPending = true;
  _resetM1Tracking();
  _gpsMovementTimer?.cancel();
  _autoboardUndoTimer?.cancel();

  if (!mounted) return;

  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text('${AppStrings.autoboardDetected} · ${route.code}'),
      duration: const Duration(seconds: 8),
      action: SnackBarAction(
        label: AppStrings.autoboardUndo,
        onPressed: () {
          _autoboardUndoTimer?.cancel();
          _autoboardPending = false;
          if (mounted) {
            ScaffoldMessenger.of(context).hideCurrentSnackBar();
            AppSnackbar.show(context, AppStrings.autoboardCancelled, SnackbarType.info);
          }
        },
      ),
    ),
  );

  _autoboardUndoTimer = Timer(const Duration(seconds: 8), () async {
    if (!_autoboardPending) return; // user hit undo
    _autoboardPending = false;

    if (!mounted) return;
    if (ref.read(tripNotifierProvider) is! TripIdle) return;

    // Clear waiting mode before starting trip — same order as manual flow
    ref.read(selectedWaitingRouteProvider.notifier).state = null;

    await ref.read(tripNotifierProvider.notifier).startTrip(route.id);

    if (!mounted) return;
    final newState = ref.read(tripNotifierProvider);
    if (newState is TripActive) {
      context.go('/trip');
    } else if (newState is TripError) {
      AppSnackbar.show(context, newState.message, SnackbarType.error);
    }
  });
}
```

#### 2g. Modificar `_updateWaitingState`

Agregar llamada a `_checkAutoBoarding` antes del `setState`:

```dart
// Agregar justo antes del setState final:
_checkAutoBoarding(route);

if (mounted) {
  setState(() { ... });
}
```

#### 2h. Modificar `_startWaiting`

```dart
void _startWaiting(BusRoute route) {
  _waitingPollTimer?.cancel();
  setState(() {
    _waitingPolled = false;
    _waitingEtaMinutes = null;
    _waitingDistanceM = null;
    _waitingBusNearNotified = false;
  });
  _socketBusPositions.clear();

  // — nuevo —
  _resetM1Tracking();
  _autoboardPending = false;
  _autoboardUndoTimer?.cancel();
  _waitingStartPosition = _livePosition;   // guardar punto de partida
  _startGpsMovementMonitor(route);         // arrancar M2 y M3
  // — fin nuevo —

  _pollWaitingRoute(route);
  _waitingPollTimer = Timer.periodic(const Duration(seconds: 60), (_) {
    final current = ref.read(selectedWaitingRouteProvider);
    if (current != null) _pollWaitingRoute(current);
  });
}
```

#### 2i. Modificar `_stopWaiting`

```dart
void _stopWaiting() {
  _waitingPollTimer?.cancel();
  _waitingPollTimer = null;
  ref.read(waitingBusPositionsProvider.notifier).state = const <LatLng>[];
  _socketBusPositions.clear();

  // — nuevo —
  _resetM1Tracking();
  _autoboardPending = false;
  _autoboardUndoTimer?.cancel();
  _gpsMovementTimer?.cancel();
  _waitingStartPosition = null;
  _onRouteStart = null;
  _offRouteStart = null;
  // — fin nuevo —

  if (mounted) {
    setState(() {
      _waitingPolled = false;
      _waitingEtaMinutes = null;
      _waitingDistanceM = null;
    });
  }
}
```

#### 2j. Modificar `dispose`

```dart
@override
void dispose() {
  _waitingPollTimer?.cancel();
  _autoboardUndoTimer?.cancel();
  _gpsMovementTimer?.cancel();       // nuevo
  _positionSubscription?.cancel();
  _mapController.dispose();
  super.dispose();
}
```

---

## Notas de implementación

- **No se necesita backend nuevo.** `startTrip` es el mismo endpoint del boarding manual.
- **Destino:** El auto-boarding no selecciona destino. El usuario puede elegirlo desde la pantalla activa. Si `boardingAlerts` está en preferencias, el Spec 34 lo activa automáticamente.
- **Cooldown de 5 min entre viajes:** El backend devuelve 429. `startTrip` en el notifier lo convierte en `TripError`. `_triggerAutoBoarding` lo muestra como snackbar de error.
- **Prioridad M1 sobre M2:** Si M1 dispara primero (bus transmitiendo), M2 nunca llega a sus 4 minutos. Ambos llaman a `_triggerAutoBoarding` que tiene el guard `if (_autoboardPending) return`.
- **Geometría vacía:** Si `route.geometry.isEmpty`, `_distToRouteGeometry` retorna `double.infinity`. M2 nunca dispara, M3 siempre dispara (distToRoute > 300). Para evitar auto-cancelación falsa en rutas sin geometría, agregar guard en `_startGpsMovementMonitor`: `if (route.geometry.isEmpty) return;`

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
# debe retornar: No issues found!
```
