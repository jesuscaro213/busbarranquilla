# Spec 23 — Occupancy Report: 10-Minute Cooldown & One Credit Per Type Per Trip

## Problem
The web `CatchBusMode` enforces two rules for occupancy reports (`lleno` / `bus_disponible`) that
are missing in Flutter:

1. **10-minute cooldown**: After reporting occupancy, the user must wait 10 minutes before reporting
   occupancy again on the same trip.
2. **One credit per type per trip**: A given occupancy type (`lleno` or `bus_disponible`) earns
   credits only the first time it is reported per trip. Subsequent reports of the same type still
   create the report on the server but credit feedback shown to the user reflects 0 expected new
   credits.

Currently, Flutter's `createReport` in `TripNotifier` has no cooldown and no per-type tracking.

---

## Files to modify

### 1. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 1a. Add fields

```dart
DateTime? _occupancyCooldownEnd;
final Set<String> _occupancyCredited = <String>{};
```

#### 1b. Reset on trip start

In `startTrip`, just before `state = activeState;`, add:

```dart
_occupancyCooldownEnd = null;
_occupancyCredited.clear();
```

#### 1c. Update `createReport`

Replace the existing method:

```dart
Future<void> createReport(String type) async {
  if (state is! TripActive) return;

  final isOccupancy = type == 'lleno' || type == 'bus_disponible';

  // Cooldown check
  if (isOccupancy) {
    final cooldown = _occupancyCooldownEnd;
    if (cooldown != null && DateTime.now().isBefore(cooldown)) {
      final remaining = cooldown.difference(DateTime.now()).inMinutes + 1;
      // Surface via state so UI can show a snackbar
      state = (state as TripActive).copyWith(
        reportError: 'Espera $remaining min antes de reportar ocupación de nuevo',
      );
      return;
    }
  }

  final active = state as TripActive;
  final pos = await LocationService.getCurrentPosition();
  if (pos == null) return;

  final result = await ref.read(reportsRepositoryProvider).create(<String, dynamic>{
    'route_id': active.route.id,
    'type': type,
    'latitude': pos.latitude,
    'longitude': pos.longitude,
  });

  switch (result) {
    case Success<Report>():
      if (isOccupancy) {
        _occupancyCooldownEnd = DateTime.now().add(const Duration(minutes: 10));
        _occupancyCredited.add(type);
      }
      await _reloadReports();
    case Failure<Report>():
      return;
  }
}
```

#### 1d. Clear cooldown state on trip end / dispose

In `_disposeMonitorsOnly`:

```dart
_occupancyCooldownEnd = null;
_occupancyCredited.clear();
```

### 2. `flutter_app/lib/features/trip/providers/trip_state.dart`

Add `reportError` to `TripActive` for surfacing cooldown messages:

```dart
final class TripActive extends TripState {
  // ... existing fields ...
  final String? reportError;    // ADD: transient error message (shown once as snackbar)

  const TripActive({
    // ... existing ...
    this.reportError,    // ADD
  });

  TripActive copyWith({
    // ... existing ...
    String? reportError,    // ADD
    bool clearReportError = false,    // ADD: to null it out after showing
  }) {
    return TripActive(
      // ... existing ...
      reportError: clearReportError ? null : (reportError ?? this.reportError),
    );
  }
}
```

### 3. `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

Listen for `reportError` in the state and show a snackbar, then clear it:

```dart
// In build, where other TripActive state is read:
if (activeState.reportError != null) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (mounted) {
      AppSnackbar.show(context, activeState.reportError!, SnackbarType.warning);
      ref
          .read(tripNotifierProvider.notifier)
          .clearReportError();
    }
  });
}
```

Add `clearReportError` method to `TripNotifier`:

```dart
void clearReportError() {
  if (state is TripActive) {
    state = (state as TripActive).copyWith(clearReportError: true);
  }
}
```

---

## Acceptance criteria
- Reporting `lleno` or `bus_disponible` sets a 10-minute cooldown.
- Attempting to report occupancy during cooldown shows a snackbar with remaining minutes and does
  NOT call the API.
- Cooldown and credited set are reset when a new trip starts.
- `flutter analyze` reports 0 new issues.
