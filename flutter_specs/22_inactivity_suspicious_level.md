# Spec 22 — Inactivity Monitor: Suspicious Level & Second Offense

## Problem
`InactivityMonitor` only has one level: ask the user after 10 min of inactivity. The web has two
additional behaviors:

1. **Second offense**: If the user answers "Sí, sigo en el bus" but still doesn't move, the second
   10-min trigger escalates directly to "suspicious" mode without asking again.
2. **30-min hard limit**: If the user has been inactive for 30 continuous minutes (even without a
   first response), the trip is auto-closed as suspicious.

Both cases call `tripsApi.end({ suspicious_minutes: 30 })` on web. Flutter should call `endTrip()`
normally (the backend anti-fraud runs server-side; the `suspicious_minutes` parameter is
informational only and not currently used by the Flutter trips repository).

---

## Files to modify

### 1. `flutter_app/lib/features/trip/monitors/inactivity_monitor.dart`

Replace entirely:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/location/location_service.dart';

class InactivityMonitor {
  final VoidCallback onAsk;         // first offense: show "¿Sigues en el bus?"
  final VoidCallback onSuspicious;  // second offense or 30 min: auto-close
  final VoidCallback onAutoEnd;     // auto-close after 2 min without answering

  Timer? _timer;
  Timer? _autoEndTimer;
  Position? _lastPosition;
  DateTime _lastMoveAt = DateTime.now();
  bool _asked = false;
  bool _hasBeenWarned = false;  // true after user answered "Sí" once

  InactivityMonitor({
    required this.onAsk,
    required this.onSuspicious,
    required this.onAutoEnd,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _check());
  }

  /// Call when user taps "Sí, sigo en el bus" — resets inactivity clock.
  void markResponded() {
    _asked = false;
    _hasBeenWarned = true;    // next offense → suspicious
    _autoEndTimer?.cancel();
    _lastMoveAt = DateTime.now();
  }

  Future<void> _check() async {
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    if (_lastPosition != null) {
      final movedMeters = LocationService.distanceMeters(
        _lastPosition!.latitude,
        _lastPosition!.longitude,
        pos.latitude,
        pos.longitude,
      );
      if (movedMeters > 50) {
        _lastMoveAt = DateTime.now();
        _asked = false;
        _autoEndTimer?.cancel();
      }
    } else {
      _lastMoveAt = DateTime.now();
    }

    _lastPosition = pos;

    final inactiveSeconds = DateTime.now().difference(_lastMoveAt).inSeconds;

    if (inactiveSeconds >= 1800) {
      // 30 min without movement → suspicious auto-close
      if (!_asked) {
        _asked = true;
        onSuspicious();
      }
    } else if (inactiveSeconds >= 600) {
      if (_hasBeenWarned) {
        // Second offense: user already answered once but still not moving → suspicious
        if (!_asked) {
          _asked = true;
          onSuspicious();
        }
      } else if (!_asked) {
        // First offense: ask the user
        _asked = true;
        onAsk();
        _autoEndTimer?.cancel();
        _autoEndTimer = Timer(const Duration(seconds: 120), onAutoEnd);
      }
    }
  }

  void dispose() {
    _timer?.cancel();
    _autoEndTimer?.cancel();
  }
}
```

### 2. `flutter_app/lib/features/trip/providers/trip_state.dart`

Add `showSuspiciousModal` to `TripActive`:

```dart
final class TripActive extends TripState {
  // ... existing fields ...
  final bool showSuspiciousModal;   // ADD

  const TripActive({
    // ... existing ...
    this.showSuspiciousModal = false,   // ADD
  });

  TripActive copyWith({
    // ... existing ...
    bool? showSuspiciousModal,   // ADD
  }) {
    return TripActive(
      // ... existing ...
      showSuspiciousModal: showSuspiciousModal ?? this.showSuspiciousModal,
    );
  }
}
```

### 3. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 3a. Update `_startMonitors` — replace InactivityMonitor construction

```dart
_inactivityMonitor = InactivityMonitor(
  onAsk: () {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(showInactivityModal: true);
    }
  },
  onSuspicious: () {
    // Show suspicious modal then auto-close
    if (state is TripActive) {
      state = (state as TripActive)
          .copyWith(showInactivityModal: false, showSuspiciousModal: true);
    }
    Future<void>.delayed(const Duration(seconds: 5), () => endTrip());
  },
  onAutoEnd: () {
    unawaited(endTrip());
  },
)..start();
```

#### 3b. Add `dismissSuspiciousModal` method

```dart
void dismissSuspiciousModal() {
  if (state is TripActive) {
    state = (state as TripActive).copyWith(showSuspiciousModal: false);
  }
}
```

### 4. `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

Add handling for `showSuspiciousModal` alongside the existing `showInactivityModal` logic.

In the build/listener section where `_showInactivityDialog` is triggered, also handle the suspicious
case:

```dart
// Where you check showInactivityModal:
if (activeState.showInactivityModal && !_inactivityDialogShown) {
  _inactivityDialogShown = true;
  WidgetsBinding.instance.addPostFrameCallback((_) => _showInactivityDialog());
}

if (activeState.showSuspiciousModal && !_suspiciousDialogShown) {
  _suspiciousDialogShown = true;
  WidgetsBinding.instance.addPostFrameCallback((_) => _showSuspiciousDialog());
}
```

Add `bool _suspiciousDialogShown = false;` field (reset to false on new `TripActive`).

Add the dialog method:

```dart
void _showSuspiciousDialog() {
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      title: const Text(AppStrings.suspiciousTitle),
      content: const Text(AppStrings.suspiciousBody),
      actions: <Widget>[
        FilledButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            ref.read(tripNotifierProvider.notifier).dismissSuspiciousModal();
          },
          child: const Text(AppStrings.ok),
        ),
      ],
    ),
  );
}
```

### 5. `flutter_app/lib/core/l10n/strings.dart`

Add string constants:

```dart
static const String suspiciousTitle = 'Viaje cerrado por inactividad';
static const String suspiciousBody =
    'No detectamos movimiento por mucho tiempo. El viaje fue cerrado automáticamente.';
```

---

## Acceptance criteria
- After 10 min without movement: shows "¿Sigues en el bus?" dialog (existing behavior).
- After user confirms and still doesn't move for another 10 min: auto-closes with suspicious dialog.
- After 30 min total without movement (regardless of responses): auto-closes with suspicious dialog.
- Auto-end timer (2 min with no response to first ask) still works.
- `flutter analyze` reports 0 new issues.
