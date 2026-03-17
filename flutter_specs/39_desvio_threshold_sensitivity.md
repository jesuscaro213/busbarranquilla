# Spec 39 — Desvío detection: OSRM road-snap + lower threshold

## Problem

The current desvío monitor measures the perpendicular distance from the GPS point to the route
polyline (already OSRM-generated). With a 50 m threshold, a bus on a parallel street ~80 m away
is never detected.

Lowering the threshold to 30 m helps but introduces a new risk: GPS error in urban canyons
(±20–25 m) can push an on-route reading past a tight threshold. The solution is to lower the raw
threshold AND, in the ambiguous "gray zone" (20–100 m), confirm the deviation by snapping the GPS
to the OSRM road network and re-measuring against the registered polyline. If the snapped point
lands on a different street, it's a confirmed deviation — regardless of meters.

---

## Architecture change

`DesvioMonitor` receives a new optional constructor parameter:

```dart
final Future<LatLng?> Function(double lat, double lng)? osrmNearest;
```

`TripNotifier` provides the implementation using the existing Dio client.
The monitor stays a plain Dart class with no framework dependency.

---

## Step 1 — Add `osrmNearest` parameter to `DesvioMonitor`

**File:** `flutter_app/lib/features/trip/monitors/desvio_monitor.dart`

### 1a. Constructor

```dart
// old
  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
  });
```

```dart
// new
  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
    this.osrmNearest,
  });
```

### 1b. New field declarations (add after `bool _escalated = false;`)

```dart
// add
  bool _reverseInFlight = false;

  // distance constants
  static const double _kOnRouteMax  = 20.0;  // clearly on route
  static const double _kGrayZoneMax = 100.0; // upper bound of gray zone
  static const double _kSnapOnRoute = 20.0;  // snapped point ≤ 20 m → correct street
```

### 1c. Field declaration at top of class (add after `this.onReturnToRoute`)

```dart
  /// Optional OSRM nearest-road resolver. When provided, readings in the
  /// 20–100 m gray zone are confirmed by snapping the GPS to the road network
  /// and re-measuring against the registered polyline.
  final Future<LatLng?> Function(double lat, double lng)? osrmNearest;
```

### 1d. Add `_minDistToGeometry` helper (add after `_distToSegmentMeters`)

```dart
  double _minDistToGeometry(double pLat, double pLng) {
    if (geometry.length >= 2) {
      double best = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pLat, pLng,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < best) best = d;
      }
      return best;
    }
    return stops.fold<double>(double.infinity, (b, s) {
      final d = LocationService.distanceMeters(pLat, pLng, s.latitude, s.longitude);
      return d < b ? d : b;
    });
  }
```

### 1e. Replace the entire `_check()` body

```dart
// old
  Future<void> _check() async {
    if (_ignored) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    double minDist;

    if (geometry.length >= 2) {
      minDist = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pos.latitude, pos.longitude,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < minDist) minDist = d;
      }
    } else if (stops.isNotEmpty) {
      minDist = stops.fold<double>(double.infinity, (best, stop) {
        final d = LocationService.distanceMeters(
          pos.latitude, pos.longitude, stop.latitude, stop.longitude,
        );
        return d < best ? d : best;
      });
    } else {
      return; // no geometry or stops — can't evaluate
    }

    if (minDist > 50) {
      _offRouteAt ??= DateTime.now();
      final offSeconds = DateTime.now().difference(_offRouteAt!).inSeconds;
      if (offSeconds < 30) return; // not sustained yet

      // Episode confirmed — mark start time once.
      _episodeStartAt ??= DateTime.now();

      // ── Escalation check (30 min continuously off-route) ──
      if (!_escalated &&
          DateTime.now().difference(_episodeStartAt!) >= escalateAfter) {
        _escalated = true;
        // 'ruta_real' users already know and reported — don't escalate.
        if (_confirmedResponse != 'ruta_real') {
          onEscalate(_confirmedResponse); // null or 'trancon'
        }
        return;
      }
      if (_escalated) return;

      // ── Re-alert only if user hasn't responded yet ──
      // Once the user confirms (trancon/ruta_real), we trust their input and
      // stop re-alerting — only the 30-min escalation matters after that.
      if (_userConfirmed) return;

      final isRepeat = _lastAlertAt != null;
      final shouldAlert = _lastAlertAt == null ||
          DateTime.now().difference(_lastAlertAt!) >= _repeatDelay;

      if (shouldAlert) {
        _lastAlertAt = DateTime.now();
        onDesvio(isRepeat);
      }
    } else {
      // Back on route — notify only if there was a confirmed episode.
      // Skip for 'ruta_real': the deviation re-entry timer handles that case
      // and notifying here would cause duplicate snackbars/notifications.
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
    }
  }
```

```dart
// new
  Future<void> _check() async {
    if (_ignored) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final rawDist = _minDistToGeometry(pos.latitude, pos.longitude);

    // ── 1. Clearly on route ──────────────────────────────────────────────────
    if (rawDist <= _kOnRouteMax) {
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
      return;
    }

    // ── 2. Determine if genuinely off-route ──────────────────────────────────
    bool isOffRoute;

    if (rawDist <= _kGrayZoneMax && osrmNearest != null) {
      // Gray zone (20–100 m): snap GPS to road network and re-measure.
      // Skip if a previous snap is still in flight.
      if (_reverseInFlight) return;
      _reverseInFlight = true;
      try {
        final snapped = await osrmNearest!(pos.latitude, pos.longitude);
        if (snapped == null) {
          // Network error — assume off-route to avoid suppressing real deviations.
          isOffRoute = true;
        } else {
          final snapDist = _minDistToGeometry(snapped.latitude, snapped.longitude);
          // If the road-snapped point is close to the registered polyline, the
          // GPS is on the correct street (just offset by GPS error). Not a deviation.
          isOffRoute = snapDist > _kSnapOnRoute;
        }
      } finally {
        _reverseInFlight = false;
      }
    } else {
      // rawDist > 100 m → clearly off route; no OSRM call needed.
      // Also the fallback when osrmNearest is not provided.
      isOffRoute = true;
    }

    // ── 3. On-route confirmed by OSRM snap ───────────────────────────────────
    if (!isOffRoute) {
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
      return;
    }

    // ── 4. Off-route: start / continue episode ───────────────────────────────
    _offRouteAt ??= DateTime.now();
    final offSeconds = DateTime.now().difference(_offRouteAt!).inSeconds;
    if (offSeconds < 15) return; // not sustained yet

    // Episode confirmed — mark start time once.
    _episodeStartAt ??= DateTime.now();

    // ── Escalation check (30 min continuously off-route) ──
    if (!_escalated &&
        DateTime.now().difference(_episodeStartAt!) >= escalateAfter) {
      _escalated = true;
      if (_confirmedResponse != 'ruta_real') {
        onEscalate(_confirmedResponse);
      }
      return;
    }
    if (_escalated) return;

    // ── Re-alert only if user hasn't responded yet ──
    if (_userConfirmed) return;

    final isRepeat = _lastAlertAt != null;
    final shouldAlert = _lastAlertAt == null ||
        DateTime.now().difference(_lastAlertAt!) >= _repeatDelay;

    if (shouldAlert) {
      _lastAlertAt = DateTime.now();
      onDesvio(isRepeat);
    }
  }
```

### 1f. Update the `_offRouteAt` comment

```dart
// old
  DateTime? _offRouteAt;     // when bus first crossed the 50m threshold
```

```dart
// new
  DateTime? _offRouteAt;     // when bus first crossed the on-route threshold
```

---

## Step 2 — Provide `osrmNearest` from `TripNotifier`

**File:** `flutter_app/lib/features/trip/providers/trip_notifier.dart`

Add a private helper that calls the OSRM public `/nearest` endpoint using Dio:

```dart
// Add after imports (add dart:convert if not already imported)
import 'dart:convert';
```

```dart
// Add as a private method in TripNotifier
Future<LatLng?> _osrmNearest(double lat, double lng) async {
  try {
    final dio = ref.read(apiClientProvider).dio;
    final resp = await dio.get<String>(
      'https://router.project-osrm.org/nearest/v1/driving/$lng,$lat',
      options: Options(
        responseType: ResponseType.plain,
        sendTimeout: const Duration(seconds: 5),
        receiveTimeout: const Duration(seconds: 5),
      ),
    );
    if (resp.statusCode != 200 || resp.data == null) return null;
    final body = jsonDecode(resp.data!) as Map<String, dynamic>;
    final waypoints = body['waypoints'] as List?;
    if (waypoints == null || waypoints.isEmpty) return null;
    final loc = (waypoints.first as Map<String, dynamic>)['location'] as List;
    // OSRM returns [lng, lat]
    return LatLng((loc[1] as num).toDouble(), (loc[0] as num).toDouble());
  } catch (_) {
    return null;
  }
}
```

Pass the helper when constructing `DesvioMonitor`:

```dart
// old (wherever DesvioMonitor is constructed in trip_notifier.dart)
      _desvioMonitor = DesvioMonitor(
        geometry: route.geometry,
        stops: stops,
        onDesvio: _onDesvio,
        onEscalate: _onEscalate,
        onReturnToRoute: _onReturnToRoute,
      );
```

```dart
// new
      _desvioMonitor = DesvioMonitor(
        geometry: route.geometry,
        stops: stops,
        onDesvio: _onDesvio,
        onEscalate: _onEscalate,
        onReturnToRoute: _onReturnToRoute,
        osrmNearest: _osrmNearest,
      );
```

---

## Summary of detection logic

| `rawDist` | OSRM call? | Result |
|---|---|---|
| ≤ 20 m | No | On route — no deviation |
| 20–100 m | Yes (1 call, 5 s timeout) | On route if snapped point ≤ 20 m from polyline |
| 20–100 m, OSRM error | No | Treated as off-route (conservative) |
| > 100 m | No | Off route — no OSRM call needed |

Sustained window: **15 s** (down from 30 s).
Check interval: **15 s** (unchanged).
Time to detect parallel street at 80 m: **15–30 s**.

---

## Step 3 — Periodic confirmation after `ruta_real` (¿Sigues en ruta diferente?)

After the user confirms "ruta diferente al mapa", the monitor goes silent — no more alerts,
no escalation. But there's no follow-up. This step adds a **periodic confirmation** every 10 min:
"¿Sigues en ruta diferente?" — letting the user close the episode when the bus returns to its
normal path, without waiting for the auto-detect re-entry timer.

Push notifications are **not sent** for this confirmation — the user already knows, they just
need the option to close it.

### 3a. New callback + fields in `DesvioMonitor`

**File:** `flutter_app/lib/features/trip/monitors/desvio_monitor.dart`

Add after the `onReturnToRoute` field declaration:

```dart
// add
  /// Called every 10 min when the user has already confirmed 'ruta_real' and
  /// the GPS is still off-route. No push notification is sent — only in-app UI.
  final VoidCallback? onConfirmDeviating;

  static const Duration _confirmInterval = Duration(minutes: 10);
  DateTime? _lastConfirmAt;
```

### 3b. Constructor (extend the one updated in Step 1a)

```dart
// old (Step 1a result)
  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
    this.osrmNearest,
  });
```

```dart
// new
  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
    this.osrmNearest,
    this.onConfirmDeviating,
  });
```

### 3c. Add `acknowledgeConfirmation()` method (add after `resetEpisode()`)

```dart
// add
  /// Call when user taps "Sí, sigo en ruta diferente" in the confirmation sheet.
  /// Resets the 10-min interval without clearing the episode.
  void acknowledgeConfirmation() {
    _lastConfirmAt = DateTime.now();
  }
```

### 3d. Replace `if (_userConfirmed) return;` in `_check()` (Step 1e new body, section 4)

```dart
// old (inside the "── Re-alert only if user hasn't responded yet ──" block)
    // ── Re-alert only if user hasn't responded yet ──
    if (_userConfirmed) return;

    final isRepeat = _lastAlertAt != null;
```

```dart
// new
    // ── After ruta_real confirmation: periodic check instead of re-alert ──
    if (_confirmedResponse == 'ruta_real') {
      final shouldConfirm = _lastConfirmAt == null ||
          DateTime.now().difference(_lastConfirmAt!) >= _confirmInterval;
      if (shouldConfirm) {
        _lastConfirmAt = DateTime.now();
        onConfirmDeviating?.call();
      }
      return;
    }

    // ── Re-alert only if user hasn't responded yet (trancon or no response) ──
    if (_userConfirmed) return;

    final isRepeat = _lastAlertAt != null;
```

### 3e. Clear `_lastConfirmAt` in `resetEpisode()`

```dart
// old
  void resetEpisode() {
    _offRouteAt        = null;
    _episodeStartAt    = null;
    _lastAlertAt       = null;
    _userConfirmed     = false;
    _confirmedResponse = null;
    _escalated         = false;
  }
```

```dart
// new
  void resetEpisode() {
    _offRouteAt        = null;
    _episodeStartAt    = null;
    _lastAlertAt       = null;
    _lastConfirmAt     = null;
    _userConfirmed     = false;
    _confirmedResponse = null;
    _escalated         = false;
  }
```

---

## Step 4 — `desvioConfirmPending` state field

**File:** `flutter_app/lib/features/trip/providers/trip_state.dart`

```dart
// old (in TripActive fields)
  final bool desvioDetected;
  final bool desvioIsRepeat;
  final bool showDesvioEscalate;
```

```dart
// new
  final bool desvioDetected;
  final bool desvioIsRepeat;
  final bool showDesvioEscalate;
  final bool desvioConfirmPending;
```

Add default in constructor:

```dart
// old
    this.desvioDetected = false,
    this.desvioIsRepeat = false,
    this.showDesvioEscalate = false,
```

```dart
// new
    this.desvioDetected = false,
    this.desvioIsRepeat = false,
    this.showDesvioEscalate = false,
    this.desvioConfirmPending = false,
```

Add to `copyWith` parameters and body (follow the same pattern as the other bool fields).

---

## Step 5 — Wire `onConfirmDeviating` in `TripNotifier`

**File:** `flutter_app/lib/features/trip/providers/trip_notifier.dart`

### 5a. Add `_desvioConfirmTimer` field (add near other `Timer?` declarations)

```dart
// add
  Timer? _desvioConfirmTimer;
```

### 5b. Pass `onConfirmDeviating` when constructing `DesvioMonitor`

```dart
// old (Step 2 result)
      _desvioMonitor = DesvioMonitor(
        geometry: route.geometry,
        stops: stops,
        onDesvio: _onDesvio,
        onEscalate: _onEscalate,
        onReturnToRoute: _onReturnToRoute,
        osrmNearest: _osrmNearest,
      );
```

```dart
// new
      _desvioMonitor = DesvioMonitor(
        geometry: route.geometry,
        stops: stops,
        onDesvio: _onDesvio,
        onEscalate: _onEscalate,
        onReturnToRoute: _onReturnToRoute,
        osrmNearest: _osrmNearest,
        onConfirmDeviating: () {
          if (state is! TripActive) return;
          // No push notification — user already knows about the deviation.
          state = (state as TripActive).copyWith(desvioConfirmPending: true);
          // Auto-dismiss after 60 s if user doesn't respond →
          // counts as "yes, still deviating" (conservative: don't reset episode).
          _desvioConfirmTimer?.cancel();
          _desvioConfirmTimer = Timer(const Duration(seconds: 60), () {
            _desvioMonitor?.acknowledgeConfirmation();
            if (state is TripActive) {
              state = (state as TripActive).copyWith(desvioConfirmPending: false);
            }
          });
        },
      );
```

### 5c. Add `acknowledgeDesvioConfirm()` and `resetDesvioConfirm()` methods

```dart
// add after dismissDesvio()

  /// User tapped "Sí, sigo en ruta diferente" in the confirmation sheet.
  void acknowledgeDesvioConfirm() {
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
    _desvioMonitor?.acknowledgeConfirmation();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(desvioConfirmPending: false);
    }
  }

  /// User tapped "El bus ya regresó a la ruta" in the confirmation sheet.
  void resetDesvioConfirm() {
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
    _desvioMonitor?.resetEpisode();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(
        desvioConfirmPending: false,
        desvioDetected: false,
      );
    }
  }
```

### 5d. Cancel `_desvioConfirmTimer` in `_disposeMonitorsAndTimers()`

```dart
// add inside _disposeMonitorsAndTimers()
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
```

Also clear `desvioConfirmPending` when `onReturnToRoute` fires — add to the existing
`onReturnToRoute` callback in the `DesvioMonitor` construction block:

```dart
// old (inside onReturnToRoute callback)
        if (state is TripActive) {
          state = (state as TripActive).copyWith(
            desvioDetected: false,
            desvioIsRepeat: false,
            showDesvioEscalate: false,
            desvioEscalateIsTranscon: false,
          );
        }
```

```dart
// new
        _desvioConfirmTimer?.cancel();
        _desvioConfirmTimer = null;
        if (state is TripActive) {
          state = (state as TripActive).copyWith(
            desvioDetected: false,
            desvioIsRepeat: false,
            showDesvioEscalate: false,
            desvioEscalateIsTranscon: false,
            desvioConfirmPending: false,
          );
        }
```

---

## Step 6 — Confirmation bottom sheet in `ActiveTripScreen`

**File:** `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

Watch `desvioConfirmPending` and show a bottom sheet when it becomes `true`. Add a
`ref.listen` inside `build()`, alongside the existing desvío listeners:

```dart
// add after existing desvio ref.listen blocks
    ref.listen<TripState>(tripNotifierProvider, (prev, next) {
      if (next is! TripActive) return;
      final wasConfirm = prev is TripActive && prev.desvioConfirmPending;
      if (!wasConfirm && next.desvioConfirmPending) {
        _showDesvioConfirmSheet();
      }
    });
```

Add the `_showDesvioConfirmSheet()` method to `_ActiveTripScreenState`:

```dart
void _showDesvioConfirmSheet() {
  AppBottomSheet.show<void>(
    context,
    title: AppStrings.desvioConfirmTitle,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(AppStrings.desvioConfirmBody),
        const SizedBox(height: 16),
        AppButton.primary(
          label: AppStrings.desvioConfirmYes,
          onPressed: () {
            context.pop();
            ref.read(tripNotifierProvider.notifier).acknowledgeDesvioConfirm();
          },
        ),
        const SizedBox(height: 8),
        AppButton.secondary(
          label: AppStrings.desvioConfirmNo,
          onPressed: () {
            context.pop();
            ref.read(tripNotifierProvider.notifier).resetDesvioConfirm();
          },
        ),
      ],
    ),
  );
}
```

---

## Step 7 — Add strings

**File:** `flutter_app/lib/core/l10n/strings.dart`

```dart
// add after existing desvio strings
  static const desvioConfirmTitle   = '¿Sigues en ruta diferente?';
  static const desvioConfirmBody    = 'Reportaste que el bus está tomando una ruta distinta al mapa. ¿Sigue así?';
  static const desvioConfirmYes     = 'Sí, sigue en ruta diferente';
  static const desvioConfirmNo      = 'No, ya regresó a la ruta';
```

---

## Summary of full flow after `ruta_real` confirmation

```
User confirms "ruta diferente"
  → _userConfirmed = true, _confirmedResponse = 'ruta_real'
  → onDesvio suppressed (no more alerts, no push)
  → onEscalate suppressed
  → every 10 min: onConfirmDeviating fires → bottom sheet (no push)
      ↳ "Sí, sigue" → acknowledgeConfirmation() → wait another 10 min
      ↳ "No, regresó" → resetEpisode() → episode closed
      ↳ No response in 60 s → auto-acknowledge → wait another 10 min
  → _deviationReEntryTimer (15 s) still running → if GPS re-enters route → onReturnToRoute → episode auto-closed
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.
