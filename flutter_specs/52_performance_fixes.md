# Spec 52 — Performance fixes (login, planner, reports)

## Goal
Reduce perceived lag on:
- Login → map load
- Trip planner open and origin/destination selection
- Report submission actions

## Diagnosis Summary
Current delays are driven by:
- `getCurrentPosition()` blocking UI paths (can take 10–15s)
- Nominatim requests with long timeouts
- Full-screen rebuilds caused by broad Riverpod `watch`
- Report creation blocking on fresh GPS fix

---

## File 1 — `lib/core/location/location_service.dart`

Add a best-effort GPS helper that returns quickly using OS cache first, with a short fallback timeout.

Add:
```dart
  static Future<Position?> getBestEffortPosition({
    Duration timeLimit = const Duration(seconds: 5),
  }) async {
    final cached = await Geolocator.getLastKnownPosition();
    if (cached != null) return cached;

    try {
      return await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: timeLimit,
      );
    } catch (_) {
      return null;
    }
  }
```

---

## File 2 — `lib/features/map/providers/map_provider.dart`

In `_loadAll()`:
- Replace `LocationService.getCurrentPosition()` with `LocationService.getBestEffortPosition()`.
- Keep the same error handling: if null, `MapError(AppStrings.locationRequired)`.

---

## File 3 — `lib/features/planner/screens/planner_screen.dart`

In `_setCurrentLocationAsOrigin()`:
- Replace `LocationService.getCurrentPosition()` with `LocationService.getBestEffortPosition()`.

---

## File 4 — `lib/features/planner/providers/planner_notifier.dart`

In `_restartNearbyRefreshTimer()`:
- Replace `LocationService.getCurrentPosition()` with `LocationService.getBestEffortPosition()`.

Optional but recommended:
- In `nominatimDioProvider`, reduce timeouts from 10s → 5s.

---

## File 5 — `lib/features/trip/providers/trip_notifier.dart`

In `createReport()`:
- Replace `LocationService.getCurrentPosition()` with `LocationService.getBestEffortPosition()`.
- If null, return (existing behavior).

---

## File 6 — Rebuild optimizations (high impact)

Replace broad `ref.watch(tripNotifierProvider)` in large screens with `select` to avoid full
screen rebuilds on every trip state change. Only watch the fields you actually use.

Target files:
- `lib/features/map/screens/map_screen.dart`
- `lib/features/trip/screens/active_trip_screen.dart`
- `lib/features/trip/screens/boarding_confirm_screen.dart`
- `lib/features/trip/screens/stop_select_screen.dart`
- `lib/features/map/screens/map_pick_screen.dart`

Example:
```dart
final isOnTrip = ref.watch(tripNotifierProvider.select((s) => s is TripActive));
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.
