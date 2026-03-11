# Spec 24 — Trip Recovery After App Restart

## Problem
When the user force-closes the app and reopens it, `map_provider.dart` calls `getCurrent()` and
stores `activeTripRouteId` in `MapReady`, but `TripNotifier` remains in `TripIdle`. The user
navigates to the `/trip` screen and sees "Inicia un viaje primero" — all monitors are dead, no GPS
broadcast is running, and credits stop accumulating.

The web recovers the full trip on component mount by calling `tripsApi.getCurrent()` and calling
`startActiveIntervals()` + showing the `active` view.

## Goal
On `TripNotifier.build()` (i.e., on Riverpod provider initialization), call `getCurrent()`. If a
trip is in progress, restore the full `TripActive` state: load route + stops + reports, start
location broadcast, and start all 4 monitors — exactly as `startTrip()` does after `trip.start`.

---

## Files to modify

### 1. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 1a. Replace the `build()` method

```dart
@override
TripState build() {
  ref.onDispose(_disposeMonitorsAndTimers);
  // Fire-and-forget; errors are swallowed so the app still shows normally
  Future<void>.microtask(_recoverActiveTrip);
  return const TripIdle();
}
```

#### 1b. Add `_recoverActiveTrip` method

```dart
Future<void> _recoverActiveTrip() async {
  final result = await ref.read(tripsRepositoryProvider).getCurrent();
  if (result is! Success<ActiveTrip?>) return;
  final trip = result.data;
  if (trip == null || trip.routeId == null) return;

  // Already active (shouldn't happen on fresh build, but guard anyway)
  if (state is TripActive) return;

  final routeId = trip.routeId!;

  final routeResult = await ref.read(routesRepositoryProvider).getById(routeId);
  if (routeResult is! Success<BusRoute>) return;
  final route = routeResult.data;

  final stopsResult = await ref.read(stopsRepositoryProvider).listByRoute(routeId);
  final stops = stopsResult is Success<List<Stop>> ? stopsResult.data : const <Stop>[];

  final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(routeId);
  final reports = reportsResult is Success<List<Report>> ? reportsResult.data : const <Report>[];

  final activeState = TripActive(
    trip: trip,
    route: route,
    stops: stops,
    reports: reports,
  );

  _occupancyCooldownEnd = null;
  _occupancyCredited.clear();

  state = activeState;

  ref.read(socketServiceProvider).joinRoute(routeId);
  _bindSocketRouteListeners(routeId);
  _startLocationBroadcast();
  _startMonitors(activeState, trip.destinationStopId);
}
```

#### 1c. Verify `ActiveTrip` model has `destinationStopId`

Check `flutter_app/lib/core/domain/models/active_trip.dart`. If `destinationStopId` is not a field,
add it:

```dart
final int? destinationStopId;

// In constructor:
this.destinationStopId,

// In fromJson:
destinationStopId: asIntOrNull(json['destination_stop_id']),
```

---

## Acceptance criteria
- On a fresh app start when the user has an active trip in the backend:
  - `TripNotifier` transitions from `TripIdle` to `TripActive` within 1–2 seconds.
  - The `/trip` screen shows the active trip (map, reports, end button).
  - All 4 monitors start.
  - GPS broadcast starts (location sent every 30 s).
- On a fresh app start with no active trip: state stays `TripIdle` (no change).
- `flutter analyze` reports 0 new issues.
