# Spec 30 — Manual Refresh Button for Nearby Routes

## Problem
The web shows an "↻ Actualizar" button next to the "Buses en tu zona" heading so users can
re-fetch nearby routes after moving. Flutter shows the nearby routes section but provides no way
to refresh — the user must close and reopen the planner.

## Goal
Add an `IconButton` (↻) next to the "Buses en tu zona" heading in `PlannerScreen`. Tapping it
calls `_loadNearbyForOrigin` again for the current origin.

---

## Files to modify

### 1. `flutter_app/lib/features/planner/providers/planner_notifier.dart`

Make `_loadNearbyForOrigin` public by renaming it to `loadNearbyForOrigin`:

```dart
Future<void> loadNearbyForOrigin(NominatimResult origin) async {
  final result = await ref.read(routesRepositoryProvider).nearby(
    lat: origin.lat,
    lng: origin.lng,
    radius: 0.3,
  );

  if (result is Success<List<BusRoute>> && state is PlannerIdle) {
    state = (state as PlannerIdle).copyWith(nearbyRoutes: result.data);
  }
}
```

Also update the existing call in `setOrigin` to use the new public name:

```dart
unawaited(loadNearbyForOrigin(origin));
```

### 2. `flutter_app/lib/features/planner/screens/planner_screen.dart`

#### 2a. Add a `_refreshingNearby` state field

```dart
bool _refreshingNearby = false;
```

#### 2b. Add a `_refreshNearby` method

```dart
Future<void> _refreshNearby() async {
  final origin = ref.read(plannerNotifierProvider.notifier).selectedOrigin;
  if (origin == null) return;
  setState(() => _refreshingNearby = true);
  await ref.read(plannerNotifierProvider.notifier).loadNearbyForOrigin(origin);
  if (mounted) setState(() => _refreshingNearby = false);
}
```

#### 2c. Replace the nearby section heading with a Row containing the title + refresh button

Find the block that renders `AppStrings.nearbyRoutesTitle` and replace it:

```dart
Row(
  mainAxisAlignment: MainAxisAlignment.spaceBetween,
  children: <Widget>[
    Text(
      AppStrings.nearbyRoutesTitle,
      style: Theme.of(context).textTheme.titleMedium,
    ),
    IconButton(
      icon: _refreshingNearby
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.refresh, size: 20),
      tooltip: AppStrings.nearbyRefreshTooltip,
      onPressed: _refreshingNearby ? null : _refreshNearby,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(),
    ),
  ],
),
```

### 3. `flutter_app/lib/core/l10n/strings.dart`

Add (only if not already present):

```dart
static const String nearbyRefreshTooltip = 'Actualizar rutas cercanas';
```

---

## Acceptance criteria
- The "Buses en tu zona" heading shows a refresh icon (↻) on the right.
- Tapping the icon re-fetches nearby routes for the current origin.
- While fetching, the icon is replaced with a small `CircularProgressIndicator`.
- After fetching completes, the indicator is replaced by the icon again.
- If no origin is selected, tapping does nothing.
- `flutter analyze` reports 0 new issues.
