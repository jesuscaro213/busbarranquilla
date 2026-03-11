# Spec 27 — Occupancy State Polling During Active Trip

## Problem
The web polls `GET /api/reports/occupancy/:routeId` every 2 minutes during an active trip to
display the current occupancy state of the bus (🔴 Bus lleno / 🟢 Hay sillas). Flutter creates
occupancy reports but never shows the current state in the active trip screen.

## Goal
During an active trip, poll `getOccupancy(routeId)` every 2 minutes and show the current state
as a small indicator in `ActiveTripScreen`. When the trip ends, clear the state.

---

## Backend endpoint

```
GET /api/reports/occupancy/:routeId
```

Response: `{ "state": "lleno" | "disponible" | null }`

---

## Files to modify

### 1. `flutter_app/lib/core/data/sources/reports_remote_source.dart`

Verify that `getOccupancy(int routeId)` already exists. If not, add:

```dart
Future<Map<String, dynamic>> getOccupancy(int routeId) async {
  final response = await _dio.get('/api/reports/occupancy/$routeId');
  return response.data as Map<String, dynamic>;
}
```

### 2. `flutter_app/lib/core/data/repositories/reports_repository.dart`

Verify `getOccupancy` exists. If not, add:

```dart
/// Returns 'lleno', 'disponible', or null.
Future<Result<String?>> getOccupancy(int routeId) async {
  try {
    final data = await _source.getOccupancy(routeId);
    final state = data['state'] as String?;
    return Success<String?>(state);
  } on DioException catch (e) {
    return Failure<String?>(mappedErrorFromDio(e));
  } catch (_) {
    return const Failure<String?>(UnknownError());
  }
}
```

### 3. `flutter_app/lib/features/trip/providers/trip_state.dart`

Add `occupancyState` to `TripActive`:

```dart
final class TripActive extends TripState {
  // ... existing fields ...
  final String? occupancyState;   // ADD: 'lleno' | 'disponible' | null

  const TripActive({
    // ... existing ...
    this.occupancyState,    // ADD
  });

  TripActive copyWith({
    // ... existing ...
    String? occupancyState,        // ADD
    bool clearOccupancyState = false,   // ADD: to null it out
  }) {
    return TripActive(
      // ... existing ...
      occupancyState: clearOccupancyState ? null : (occupancyState ?? this.occupancyState),
    );
  }
}
```

### 4. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 4a. Add field

```dart
Timer? _occupancyPollTimer;
```

#### 4b. Add `_startOccupancyPolling` method

```dart
void _startOccupancyPolling(int routeId) {
  _occupancyPollTimer?.cancel();

  Future<void> fetch() async {
    final result = await ref.read(reportsRepositoryProvider).getOccupancy(routeId);
    if (result is Success<String?> && state is TripActive) {
      state = (state as TripActive).copyWith(occupancyState: result.data);
    }
  }

  fetch(); // immediate first fetch
  _occupancyPollTimer = Timer.periodic(const Duration(minutes: 2), (_) => fetch());
}
```

#### 4c. Call `_startOccupancyPolling` in `startTrip` and `_recoverActiveTrip`

In `startTrip`, after `state = activeState;`:

```dart
_startOccupancyPolling(routeId);
```

In `_recoverActiveTrip` (from spec 24), after `state = activeState;`:

```dart
_startOccupancyPolling(routeId);
```

#### 4d. Cancel in `_disposeMonitorsAndTimers`

```dart
void _disposeMonitorsAndTimers() {
  _locationTimer?.cancel();
  _locationTimer = null;
  _gpsCheckTimer?.cancel();
  _gpsCheckTimer = null;
  _occupancyPollTimer?.cancel();    // ADD
  _occupancyPollTimer = null;       // ADD
  _disposeMonitorsOnly();
}
```

### 5. `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

In the active trip build, show the occupancy state as a small badge below the route name / duration
row. Add after the timer/credits row:

```dart
if (active.occupancyState != null) ...<Widget>[
  const SizedBox(height: 6),
  _OccupancyBadge(state: active.occupancyState!),
],
```

Add the private widget at the bottom of the file:

```dart
class _OccupancyBadge extends StatelessWidget {
  final String state;

  const _OccupancyBadge({required this.state});

  @override
  Widget build(BuildContext context) {
    final isLleno = state == 'lleno';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(
          isLleno ? Icons.circle : Icons.circle_outlined,
          size: 10,
          color: isLleno ? Colors.red : Colors.green,
        ),
        const SizedBox(width: 6),
        Text(
          isLleno ? AppStrings.occupancyLleno : AppStrings.occupancyDisponible,
          style: TextStyle(
            fontSize: 12,
            color: isLleno ? Colors.red : Colors.green,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
```

### 6. `flutter_app/lib/core/l10n/strings.dart`

Add (only if these constants don't already exist):

```dart
static const String occupancyLleno = '🔴 Bus lleno';
static const String occupancyDisponible = '🟢 Hay sillas';
```

---

## Acceptance criteria
- When an active trip starts, `getOccupancy` is called immediately and then every 2 minutes.
- If the state is `'lleno'`, a red "🔴 Bus lleno" badge appears in `ActiveTripScreen`.
- If the state is `'disponible'`, a green "🟢 Hay sillas" badge appears.
- If the state is `null`, no badge is shown.
- When the trip ends, the occupancy badge disappears.
- `flutter analyze` reports 0 new issues.
