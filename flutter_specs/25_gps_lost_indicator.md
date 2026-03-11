# Spec 25 — GPS Lost Indicator During Active Trip

## Problem
The web shows a visible "GPS perdido" banner when GPS hasn't updated for more than 60 seconds.
Flutter has no such indicator — the user gets no feedback that location tracking is stalled.

## Goal
During an active trip, track the last GPS update timestamp. If more than 60 s pass without a new
position, show a warning banner at the top of `ActiveTripScreen`. When GPS resumes, hide the banner.

---

## Files to modify

### 1. `flutter_app/lib/features/trip/providers/trip_state.dart`

Add `gpsLost` field to `TripActive`:

```dart
final class TripActive extends TripState {
  // ... existing fields ...
  final bool gpsLost;    // ADD

  const TripActive({
    // ... existing ...
    this.gpsLost = false,    // ADD
  });

  TripActive copyWith({
    // ... existing ...
    bool? gpsLost,    // ADD
  }) {
    return TripActive(
      // ... existing ...
      gpsLost: gpsLost ?? this.gpsLost,
    );
  }
}
```

### 2. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 2a. Add fields

```dart
Timer? _gpsCheckTimer;
DateTime _lastGpsAt = DateTime.now();
```

#### 2b. Call `_startGpsCheck()` inside `_startLocationBroadcast()`

At the end of `_startLocationBroadcast`, after starting `_locationTimer`:

```dart
_startGpsCheck();
```

#### 2c. Add `_startGpsCheck` method

```dart
void _startGpsCheck() {
  _gpsCheckTimer?.cancel();
  _gpsCheckTimer = Timer.periodic(const Duration(seconds: 5), (_) {
    if (state is! TripActive) return;
    final lost = DateTime.now().difference(_lastGpsAt).inSeconds > 60;
    final current = state as TripActive;
    if (current.gpsLost != lost) {
      state = current.copyWith(gpsLost: lost);
    }
  });
}
```

#### 2d. Update `_startLocationBroadcast` — record GPS timestamp

Inside the interval callback, when `pos` is obtained successfully, update `_lastGpsAt`:

```dart
_locationTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
  if (state is! TripActive) return;

  final active = state as TripActive;
  final pos = await LocationService.getCurrentPosition();
  if (pos == null) return;

  _lastGpsAt = DateTime.now();    // ADD THIS LINE

  final updateResult = await ref.read(tripsRepositoryProvider).updateLocation(/* ... */);
  // ... rest unchanged
});
```

#### 2e. Cancel `_gpsCheckTimer` in `_disposeMonitorsAndTimers`

```dart
void _disposeMonitorsAndTimers() {
  _locationTimer?.cancel();
  _locationTimer = null;
  _gpsCheckTimer?.cancel();    // ADD
  _gpsCheckTimer = null;       // ADD
  _disposeMonitorsOnly();
}
```

Also reset `_lastGpsAt` at the top of `startTrip` (before `state = activeState`):

```dart
_lastGpsAt = DateTime.now();
```

### 3. `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

In the `build` method, inside the `TripActive` branch, show a banner when `gpsLost == true`.
Add it at the very top of the body column, before the dropoff alert:

```dart
if (active.gpsLost) ...<Widget>[
  Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    color: Colors.orange.shade700,
    child: const Text(
      AppStrings.gpsLostBanner,
      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
      textAlign: TextAlign.center,
    ),
  ),
],
```

### 4. `flutter_app/lib/core/l10n/strings.dart`

Add:

```dart
static const String gpsLostBanner = 'GPS perdido — verifica tu señal';
```

---

## Acceptance criteria
- When GPS hasn't updated in >60 s during an active trip, an orange banner appears at the top of
  `ActiveTripScreen` with the text "GPS perdido — verifica tu señal".
- When GPS resumes (within the next 5 s check), the banner disappears.
- No banner appears if there is no active trip.
- `flutter analyze` reports 0 new issues.
