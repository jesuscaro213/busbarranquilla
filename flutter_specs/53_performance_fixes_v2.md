# Spec 53 — Performance fixes v2 (planner + map rebuilds)

**Status:** ✅ Applied

## Goal
Further reduce perceived lag and unnecessary rebuilds after Spec 52:
- Make planner address search feel faster
- Reduce MapScreen rebuild overhead from provider listeners in build

---

## File 1 — `lib/features/planner/providers/planner_notifier.dart`

### Add simple in-memory cache for Nominatim search

At the top of `PlannerNotifier` class, add:
```dart
  final Map<String, List<NominatimResult>> _searchCache = <String, List<NominatimResult>>{};
```

In `searchAddress(String query)`:
- Before the `try { ... }`, check cache:
```dart
    final cached = _searchCache[cleanQuery.toLowerCase()];
    if (cached != null) return cached;
```

- After `results` is computed, store in cache:
```dart
      _searchCache[cleanQuery.toLowerCase()] = results;
```

This prevents repeating the same network query and speeds up typing/selection.

---

## File 2 — `lib/features/map/screens/map_screen.dart`

### Move `ref.listen` out of build to avoid re-registering

Currently, `ref.listen<BusRoute?>(selectedWaitingRouteProvider, ...)` lives inside `build()`. Move it to `initState()` and store the subscription so it can be closed.

Add a field in `_MapScreenState`:
```dart
  late final ProviderSubscription<BusRoute?> _waitingRouteSub;
```

In `initState()`, after existing async setup, add:
```dart
    _waitingRouteSub = ref.listen<BusRoute?>(selectedWaitingRouteProvider, (prev, next) {
      if (next == null) {
        _stopWaiting();
      } else if (next.id != prev?.id) {
        _startWaiting(next);
      }
    });
```

In `dispose()` add:
```dart
    _waitingRouteSub.close();
```

Then remove the `ref.listen<BusRoute?>` block from `build()`.

This avoids registering listeners on every rebuild and reduces overhead while the map is active.

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.
