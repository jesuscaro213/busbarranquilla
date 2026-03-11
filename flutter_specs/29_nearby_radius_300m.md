# Spec 29 — Nearby Routes Radius: 500 m → 300 m

## Problem
The web's PlanTripMode reduced the nearby routes radius from 500 m to 300 m (Phase 3.6). Flutter's
`PlannerNotifier._loadNearbyForOrigin()` still uses `radius: 0.5` (500 m), showing routes that are
too far to walk to from the user's origin.

## Goal
Change the `radius` parameter in `_loadNearbyForOrigin()` from `0.5` to `0.3`.

---

## Files to modify

### 1. `flutter_app/lib/features/planner/providers/planner_notifier.dart`

In `_loadNearbyForOrigin`, change:

```dart
radius: 0.5,
```

To:

```dart
radius: 0.3,
```

---

## Acceptance criteria
- `_loadNearbyForOrigin` calls `routesRepository.nearby` with `radius: 0.3`.
- `flutter analyze` reports 0 new issues.
