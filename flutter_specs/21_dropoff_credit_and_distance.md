# Spec 21 — Dropoff Monitor: Credit Check & Route-Based Distance

## Problem
The Flutter `DropoffMonitor` has three gaps vs the web:

1. **No credit check**: Dropoff alerts activate for ALL users for free. Web charges free users
   5 credits and shows a prompt; premium/admin get it automatically.
2. **Straight-line distance**: Flutter computes direct Haversine to destination. Web uses cumulative
   distance along stops (boarding stop → nearest stop to user → … → destination stop), which is
   more accurate on curved routes.
3. **Wrong "missed" threshold**: Flutter triggers missed when `_alerted && meters > 300`. Web fires
   when `prevDist ≤ 200 && currentDist > 200` — the bus passed the stop.

---

## Files to modify

### 1. `flutter_app/lib/features/trip/monitors/dropoff_monitor.dart`

Replace entirely:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DropoffMonitor {
  final Stop destination;
  final List<Stop> allStops;   // full route stops for route-based distance
  final VoidCallback onPrepare;
  final VoidCallback onAlight;
  final VoidCallback onMissed;

  Timer? _timer;
  bool _prepared = false;
  bool _alerted = false;
  bool _missed = false;
  double? _prevDistMeters;

  DropoffMonitor({
    required this.destination,
    required this.allStops,
    required this.onPrepare,
    required this.onAlight,
    required this.onMissed,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
  }

  Future<void> _check() async {
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final dist = _routeDistanceMeters(pos.latitude, pos.longitude);

    if (!_prepared && dist <= 400) {
      _prepared = true;
      onPrepare();
    }

    if (!_alerted && dist <= 200) {
      _alerted = true;
      onAlight();
    }

    // Missed: was ≤200 m last tick, now >200 m → bus passed the stop
    if (_alerted && !_missed && (_prevDistMeters ?? dist) <= 200 && dist > 200) {
      _missed = true;
      onMissed();
    }

    _prevDistMeters = dist;
  }

  /// Route-based cumulative distance: user position → nearest stop up to destIdx → destination.
  /// Falls back to straight-line if stops list is too short or dest not found.
  double _routeDistanceMeters(double userLat, double userLng) {
    if (allStops.length < 2) {
      return LocationService.distanceMeters(
        userLat, userLng, destination.latitude, destination.longitude,
      );
    }

    // Find destination index
    int destIdx = -1;
    double bestDestDist = double.infinity;
    for (int i = 0; i < allStops.length; i++) {
      final d = LocationService.distanceMeters(
        allStops[i].latitude, allStops[i].longitude,
        destination.latitude, destination.longitude,
      );
      if (d < bestDestDist) {
        bestDestDist = d;
        destIdx = i;
      }
    }
    if (destIdx == -1 || bestDestDist > 300) {
      // Destination stop not matched — straight-line fallback
      return LocationService.distanceMeters(
        userLat, userLng, destination.latitude, destination.longitude,
      );
    }

    // Find nearest stop to user among stops up to destIdx
    int nearestIdx = 0;
    double nearestDist = double.infinity;
    for (int i = 0; i <= destIdx; i++) {
      final d = LocationService.distanceMeters(
        userLat, userLng,
        allStops[i].latitude, allStops[i].longitude,
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    if (nearestIdx >= destIdx) {
      // Already at or past destination stop
      return nearestDist;
    }

    // Cumulative: user → nearest stop + sum of segment lengths to dest
    double total = nearestDist;
    for (int i = nearestIdx; i < destIdx; i++) {
      total += LocationService.distanceMeters(
        allStops[i].latitude, allStops[i].longitude,
        allStops[i + 1].latitude, allStops[i + 1].longitude,
      );
    }
    return total;
  }

  void dispose() {
    _timer?.cancel();
  }
}
```

### 2. `flutter_app/lib/features/trip/providers/trip_state.dart`

Add `dropoffPrompt` field to `TripActive` — shown to free users before paying 5 credits:

```dart
final class TripActive extends TripState {
  // ... existing fields ...
  final bool dropoffPrompt;      // ADD: free user sees "activate alerts for 5 cr?"

  const TripActive({
    // ... existing ...
    this.dropoffPrompt = false,
  });

  TripActive copyWith({
    // ... existing ...
    bool? dropoffPrompt,
    bool clearDropoffAlert = false,   // ADD helper to null out dropoffAlert
  }) {
    return TripActive(
      // ... existing ...
      dropoffAlert: clearDropoffAlert ? null : (dropoffAlert ?? this.dropoffAlert),
      dropoffPrompt: dropoffPrompt ?? this.dropoffPrompt,
    );
  }
}
```

> **Note**: `copyWith` currently cannot set `dropoffAlert` to `null` (nullable override returns
> `this.dropoffAlert`). Add a `clearDropoffAlert` boolean param so the UI can dismiss the banner.

### 3. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

#### 3a. Add imports
```dart
import '../../auth/providers/auth_notifier.dart';
import '../../../core/data/repositories/credits_repository.dart';
```

#### 3b. New field
```dart
bool _dropoffActivated = false;
```

#### 3c. Update `_startMonitors` — replace dropoff section

```dart
// ── Dropoff monitor ──
if (destinationStopId != null) {
  Stop? destination;
  for (final stop in activeState.stops) {
    if (stop.id == destinationStopId) {
      destination = stop;
      break;
    }
  }
  if (destination != null) {
    _dropoffActivated = false;

    final authState = ref.read(authNotifierProvider);
    final isPremium = authState is Authenticated &&
        (authState.user.hasActivePremium || authState.user.role == 'admin');

    if (isPremium) {
      // Premium/admin: activate immediately, no cost
      _dropoffActivated = true;
      _startDropoffMonitor(destination, activeState.stops);
    } else {
      // Free user: show prompt
      state = (state as TripActive).copyWith(dropoffPrompt: true);
      // Monitor not started yet — starts in activateDropoffAlerts()
      // Store destination for later use
      _pendingDropoffDestination = destination;
    }
  }
}
```

#### 3d. New fields and method in TripNotifier

```dart
Stop? _pendingDropoffDestination;

/// Called when free user accepts to pay 5 credits for dropoff alerts.
/// Spends 5 credits via the credits endpoint, then starts the monitor.
Future<void> activateDropoffAlerts() async {
  if (state is! TripActive) return;

  final creditResult = await ref.read(creditsRepositoryProvider).spend(5, 'Alertas de bajada');
  if (creditResult is Failure) {
    // Not enough credits — show error via state
    state = (state as TripActive).copyWith(dropoffPrompt: false);
    // Optionally surface an error — for now just dismiss the prompt silently
    return;
  }

  state = (state as TripActive).copyWith(dropoffPrompt: false);

  if (_pendingDropoffDestination != null && state is TripActive) {
    _dropoffActivated = true;
    final active = state as TripActive;
    _startDropoffMonitor(_pendingDropoffDestination!, active.stops);
    _pendingDropoffDestination = null;
  }
}

/// Dismiss the dropoff prompt without paying.
void dismissDropoffPrompt() {
  if (state is TripActive) {
    state = (state as TripActive).copyWith(dropoffPrompt: false);
  }
  _pendingDropoffDestination = null;
}

void _startDropoffMonitor(Stop destination, List<Stop> allStops) {
  _dropoffMonitor?.dispose();
  _dropoffMonitor = DropoffMonitor(
    destination: destination,
    allStops: allStops,
    onPrepare: () {
      if (state is! TripActive) return;
      state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.prepare);
    },
    onAlight: () {
      if (state is! TripActive) return;
      state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.alight);
      HapticFeedback.vibrate();
    },
    onMissed: () {
      if (state is! TripActive) return;
      state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.missed);
    },
  )..start();
}
```

#### 3e. Clear `_pendingDropoffDestination` and `_dropoffActivated` on `_disposeMonitorsOnly`

```dart
void _disposeMonitorsOnly() {
  _dropoffMonitor?.dispose();
  _dropoffMonitor = null;
  _pendingDropoffDestination = null;
  _dropoffActivated = false;
  // ... rest unchanged
}
```

### 4. `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

In the `build` method, listen for `dropoffPrompt == true` in `TripActive` and show a dialog:

```dart
// Inside _ActiveTripScreenState.build, where other state is read:
if (activeState.dropoffPrompt) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    _showDropoffPrompt();
  });
}
```

Add the dialog method:

```dart
void _showDropoffPrompt() {
  final notifier = ref.read(tripNotifierProvider.notifier);
  showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      title: const Text(AppStrings.dropoffPromptTitle),
      content: const Text(AppStrings.dropoffPromptBody),
      actions: <Widget>[
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            notifier.dismissDropoffPrompt();
          },
          child: const Text(AppStrings.dropoffPromptDecline),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            notifier.activateDropoffAlerts();
          },
          child: const Text(AppStrings.dropoffPromptAccept),
        ),
      ],
    ),
  );
}
```

### 5. `flutter_app/lib/core/l10n/strings.dart`

Add string constants:

```dart
static const String dropoffPromptTitle = 'Activar alertas de bajada';
static const String dropoffPromptBody =
    'Te avisaremos cuando estés cerca de tu parada. Cuesta 5 créditos por viaje.';
static const String dropoffPromptDecline = 'No, gracias';
static const String dropoffPromptAccept = 'Activar (5 créditos)';
```

### 6. `flutter_app/lib/core/data/repositories/credits_repository.dart`

Verify that a `spend(int amount, String description)` method exists. If not, add it:

```dart
Future<Result<void>> spend(int amount, String description) async {
  final result = await _apiClient.post('/credits/spend', <String, dynamic>{
    'amount': amount,
    'description': description,
  });
  return result.fold(
    onSuccess: (_) => const Success(null),
    onFailure: (e) => Failure(e),
  );
}
```

---

## Acceptance criteria
- Premium/admin users: dropoff monitor starts immediately on trip start, no prompt, no cost.
- Free users: `dropoffPrompt = true` triggers a dialog. Accepting spends 5 credits and starts the
  monitor. Declining dismisses the prompt and no monitor starts.
- Distance to destination uses cumulative stops-based route distance, not straight-line.
- "Missed" fires when previous distance was ≤ 200 m and current distance is > 200 m.
- `flutter analyze` reports 0 new issues.
