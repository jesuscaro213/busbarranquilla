# Spec 33 — Active Bus Positions on Map When Selecting a Planner Route

## Problem
The web's PlanTripMode renders amber 🚌 markers on the map for all active users on the selected
route (`routeActivityPositions` from `getActivity`). Flutter's planner never passes
`activePositions` from `RouteActivity` to the map. Users cannot see live bus positions when
planning a trip.

## Goal
When the user selects a plan result (or a nearby route) in `PlannerScreen`, fetch the route
activity and pass its `activePositions` to the `MapScreen` so amber markers appear on the map.

---

## Architecture note
`PlannerScreen` is a tab inside the main scaffold. The map is displayed in `MapScreen` (the "Mapa"
tab). Passing data between tabs should go through a shared Riverpod provider.

---

## Files to modify

### 1. Create `flutter_app/lib/features/map/providers/map_active_positions_provider.dart`

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

/// Active bus positions to overlay on the map — set when user selects a plan result.
final mapActivePositionsProvider =
    StateProvider<List<LatLng>>((ref) => const <LatLng>[]);
```

### 2. `flutter_app/lib/features/planner/screens/planner_screen.dart`

#### 2a. Import the new provider

```dart
import '../../map/providers/map_active_positions_provider.dart';
```

#### 2b. Import `RouteActivity` and the routes repository

```dart
import '../../../core/domain/models/route_activity.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/error/result.dart';
```

#### 2c. Add helper method `_updateActivePositions`

```dart
Future<void> _updateActivePositions(int routeId) async {
  final result =
      await ref.read(routesRepositoryProvider).getActivity(routeId);
  if (!mounted) return;
  final positions = result is Success<RouteActivity>
      ? result.data.activePositions
      : const <LatLng>[];
  ref.read(mapActivePositionsProvider.notifier).state = positions;
}
```

#### 2d. Call `_updateActivePositions` when a nearby route is selected

Inside the `setState` that sets `_selectedNearbyRouteId` (from spec 31), also call:

```dart
if (_selectedNearbyRouteId == route.id) {
  unawaited(_updateActivePositions(route.id));
}
```

If spec 31 is not implemented, call it directly in the existing `onTap`:

```dart
onTap: () {
  unawaited(_updateActivePositions(route.id));
  context.push('/trip/confirm?routeId=${route.id}');
},
```

#### 2e. Call `_updateActivePositions` when a plan result is tapped

In `PlanResultCard.onSelect` the navigation is done via `context.push`. Since `PlanResultCard` is a
separate widget, expose the callback and wire it in `PlannerScreen`'s `ListView.builder`:

```dart
itemBuilder: (context, index) {
  final result = results[index];
  return PlanResultCard(
    result: result,
    onSelect: () {
      unawaited(_updateActivePositions(result.id));
      context.push(
        '/trip/confirm?routeId=${result.id}'
        '&destLat=${result.nearestStop.latitude}'
        '&destLng=${result.nearestStop.longitude}',
      );
    },
  );
},
```

#### 2f. Clear active positions when planner is reset / unmounted

Override `dispose` (or add to existing `dispose` if present):

```dart
@override
void dispose() {
  // Clear active positions when leaving the planner
  ref.read(mapActivePositionsProvider.notifier).state = const <LatLng>[];
  super.dispose();
}
```

> **Note:** `ConsumerStatefulWidget` state's `dispose` has access to `ref`.

### 3. `flutter_app/lib/features/map/screens/map_screen.dart`

#### 3a. Import the provider

```dart
import '../providers/map_active_positions_provider.dart';
```

#### 3b. Watch the provider and render amber markers

Inside the `FlutterMap` children list (or wherever the map layers are), add:

```dart
Consumer(
  builder: (context, ref, _) {
    final activePositions = ref.watch(mapActivePositionsProvider);
    if (activePositions.isEmpty) return const SizedBox.shrink();
    return MarkerLayer(
      markers: activePositions.map((pos) => Marker(
        point: pos,
        width: 32,
        height: 32,
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.amber,
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.directions_bus, color: Colors.white, size: 18),
        ),
      )).toList(),
    );
  },
),
```

---

## Acceptance criteria
- Selecting a plan result or a nearby route sets `mapActivePositionsProvider` with the route's
  `activePositions`.
- The map renders amber 🚌 markers at those positions.
- When the planner is unmounted (tab switch away), active positions are cleared.
- If `activePositions` is empty, no markers appear.
- `flutter analyze` reports 0 new issues.
