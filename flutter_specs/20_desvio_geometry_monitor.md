# Spec 20 — Desvío Monitor: Geometry-Based Detection

## Problem
`DesvioMonitor` currently checks distance to the nearest **stop** (250 m threshold, 30 s interval,
90 s trigger). The web uses the route **geometry polyline** as primary reference (100 m to nearest
segment, 15 s interval, 60 s trigger), falling back to stops only when geometry is unavailable.
This means the Flutter app detects deviations much later and less accurately.

## Goal
Match web Monitor 2 exactly:
- Primary: min distance to any polyline segment ≤ 100 m
- Fallback: min distance to nearest stop ≤ 250 m
- Interval: every 15 s (was 30 s)
- Trigger: after 60 s continuously off-route (was 90 s)

---

## Files to modify

### 1. `flutter_app/lib/features/trip/monitors/desvio_monitor.dart`

Replace entirely:

```dart
import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DesvioMonitor {
  final List<LatLng> geometry;  // route polyline — primary
  final List<Stop> stops;       // fallback when geometry is empty
  final VoidCallback onDesvio;

  Timer? _timer;
  Timer? _ignoreTimer;
  DateTime? _offRouteAt;
  bool _alerted = false;
  bool _ignored = false;

  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
  }

  void ignore(Duration duration) {
    _alerted = false;
    _ignored = true;
    _ignoreTimer?.cancel();
    _ignoreTimer = Timer(duration, () => _ignored = false);
  }

  void resetAlert() {
    _alerted = false;
    _offRouteAt = null;
  }

  /// Perpendicular distance in metres from point P to segment A→B.
  static double _distToSegmentMeters(
    double pLat, double pLng,
    double aLat, double aLng,
    double bLat, double bLng,
  ) {
    final dx = bLat - aLat;
    final dy = bLng - aLng;
    final lenSq = dx * dx + dy * dy;
    if (lenSq == 0) {
      return LocationService.distanceMeters(pLat, pLng, aLat, aLng);
    }
    final t = math.max(
      0.0,
      math.min(1.0, ((pLat - aLat) * dx + (pLng - aLng) * dy) / lenSq),
    );
    return LocationService.distanceMeters(
      pLat, pLng, aLat + t * dx, aLng + t * dy,
    );
  }

  Future<void> _check() async {
    if (_alerted || _ignored) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    double minDistMeters;

    if (geometry.length >= 2) {
      // Primary: distance to nearest polyline segment
      minDistMeters = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pos.latitude, pos.longitude,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < minDistMeters) minDistMeters = d;
      }
      // Off-route if >100 m from polyline
      if (minDistMeters > 100) {
        _offRouteAt ??= DateTime.now();
        if (DateTime.now().difference(_offRouteAt!).inSeconds >= 60) {
          _alerted = true;
          onDesvio();
        }
      } else {
        _offRouteAt = null;
      }
    } else if (stops.isNotEmpty) {
      // Fallback: distance to nearest stop
      minDistMeters = stops.fold<double>(
        double.infinity,
        (min, stop) {
          final d = LocationService.distanceMeters(
            pos.latitude, pos.longitude,
            stop.latitude, stop.longitude,
          );
          return d < min ? d : min;
        },
      );
      if (minDistMeters > 250) {
        _offRouteAt ??= DateTime.now();
        if (DateTime.now().difference(_offRouteAt!).inSeconds >= 60) {
          _alerted = true;
          onDesvio();
        }
      } else {
        _offRouteAt = null;
      }
    }
    // If neither geometry nor stops available, do nothing
  }

  void dispose() {
    _timer?.cancel();
    _ignoreTimer?.cancel();
  }
}
```

### 2. `flutter_app/lib/features/trip/providers/trip_notifier.dart`

In `_startMonitors`, update the DesvioMonitor construction to pass both geometry and stops:

```dart
// BEFORE:
if (activeState.stops.isNotEmpty) {
  _desvioMonitor = DesvioMonitor(
    stops: activeState.stops,
    onDesvio: () { ... },
  )..start();
}

// AFTER:
_desvioMonitor = DesvioMonitor(
  geometry: activeState.route.geometry,
  stops: activeState.stops,
  onDesvio: () {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(desvioDetected: true);
    }
  },
)..start();
```

Remove the `if (activeState.stops.isNotEmpty)` guard — the monitor now handles the empty case
internally and always starts.

---

## Acceptance criteria
- DesvioMonitor interval is 15 s.
- When `geometry.length >= 2`: off-route threshold is 100 m to polyline segment.
- When geometry is empty: falls back to 250 m to nearest stop.
- Alert fires after 60 continuous seconds off-route (not 90 s).
- Ignore (5 min) and resetAlert still work.
- `flutter analyze` reports 0 new issues.
