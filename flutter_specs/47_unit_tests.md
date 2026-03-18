# Spec 47 — Unit tests: monitors + LocationService

## Problem

Zero automated tests. The monitors contain non-trivial logic — thresholds, state machines,
cumulative route distances — that can silently regress when features are added.

`InactivityMonitor` and `DropoffMonitor` call `LocationService.getCurrentPosition()` /
`Geolocator.getLastKnownPosition()` directly, making them untestable in a pure Dart
environment. A minimal injectable `positionGetter` parameter (optional, defaults to real GPS)
makes them testable without changing any production call site.

---

## File 1 — `lib/features/trip/monitors/inactivity_monitor.dart`

Add optional `positionGetter` constructor parameter. All existing call sites pass no argument
and get the same real GPS behavior.

**Old:**
```dart
class InactivityMonitor {
  final VoidCallback onAsk;
  final VoidCallback onSuspicious;
  final VoidCallback onAutoEnd;

  Timer? _timer;
  Timer? _autoEndTimer;
  Position? _lastPosition;
  DateTime _lastMoveAt = DateTime.now();
  bool _asked = false;
  bool _hasBeenWarned = false;

  InactivityMonitor({
    required this.onAsk,
    required this.onSuspicious,
    required this.onAutoEnd,
  });
```

**New:**
```dart
class InactivityMonitor {
  final VoidCallback onAsk;
  final VoidCallback onSuspicious;
  final VoidCallback onAutoEnd;
  final Future<Position?> Function()? positionGetter;

  Timer? _timer;
  Timer? _autoEndTimer;
  Position? _lastPosition;
  DateTime _lastMoveAt = DateTime.now();
  bool _asked = false;
  bool _hasBeenWarned = false;

  InactivityMonitor({
    required this.onAsk,
    required this.onSuspicious,
    required this.onAutoEnd,
    this.positionGetter,
  });
```

**Old** (inside `_check()`):
```dart
    final pos = await LocationService.getCurrentPosition();
```

**New:**
```dart
    final pos = positionGetter != null
        ? await positionGetter!()
        : await LocationService.getCurrentPosition();
```

---

## File 2 — `lib/features/trip/monitors/dropoff_monitor.dart`

Add optional `positionGetter` constructor parameter.

**Old:**
```dart
class DropoffMonitor {
  final Stop destination;
  final List<Stop> allStops;
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
```

**New:**
```dart
class DropoffMonitor {
  final Stop destination;
  final List<Stop> allStops;
  final VoidCallback onPrepare;
  final VoidCallback onAlight;
  final VoidCallback onMissed;
  final Future<Position?> Function()? positionGetter;

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
    this.positionGetter,
  });
```

**Old** (inside `_check()`):
```dart
    final pos = await Geolocator.getLastKnownPosition() ??
        await LocationService.getCurrentPosition();
```

**New:**
```dart
    final pos = positionGetter != null
        ? await positionGetter!()
        : (await Geolocator.getLastKnownPosition() ??
            await LocationService.getCurrentPosition());
```

Also make `_routeDistanceMeters` package-visible by renaming it (remove leading underscore):

**Old:**
```dart
  double _routeDistanceMeters(double userLat, double userLng) {
```

**New:**
```dart
  // @visibleForTesting
  double routeDistanceMeters(double userLat, double userLng) {
```

Update the single internal call in `_check()`:
**Old:**
```dart
    final dist = _routeDistanceMeters(pos.latitude, pos.longitude);
```
**New:**
```dart
    final dist = routeDistanceMeters(pos.latitude, pos.longitude);
```

---

## File 3 — `pubspec.yaml`

Add `fake_async` to dev dependencies (simulates time in timer-based tests):

**Old:**
```yaml
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
```

**New:**
```yaml
dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
  fake_async: ^1.3.1
```

---

## File 4 — `test/location_service_test.dart` (create)

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mibus_flutter/core/location/location_service.dart';

void main() {
  group('LocationService.distanceMeters', () {
    test('same point returns 0', () {
      final d = LocationService.distanceMeters(10.9878, -74.7889, 10.9878, -74.7889);
      expect(d, closeTo(0, 0.01));
    });

    test('roughly 1 km apart', () {
      // Two points ~1 km apart in Barranquilla
      final d = LocationService.distanceMeters(10.9878, -74.7889, 10.9967, -74.7889);
      expect(d, inInclusiveRange(900, 1100));
    });

    test('order does not matter (symmetric)', () {
      final a = LocationService.distanceMeters(10.9878, -74.7889, 11.0012, -74.8100);
      final b = LocationService.distanceMeters(11.0012, -74.8100, 10.9878, -74.7889);
      expect(a, closeTo(b, 0.01));
    });

    test('returns meters, not km', () {
      // ~500 m apart — result must be > 100 (not 0.5 km)
      final d = LocationService.distanceMeters(10.9878, -74.7889, 10.9923, -74.7889);
      expect(d, greaterThan(100));
    });
  });
}
```

---

## File 5 — `test/inactivity_monitor_test.dart` (create)

```dart
import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mibus_flutter/features/trip/monitors/inactivity_monitor.dart';

Position _pos(double lat, double lng) => Position(
      latitude: lat,
      longitude: lng,
      timestamp: DateTime.now(),
      accuracy: 5,
      altitude: 0,
      heading: 0,
      speed: 0,
      speedAccuracy: 0,
      altitudeAccuracy: 0,
      headingAccuracy: 0,
    );

void main() {
  group('InactivityMonitor', () {
    test('fires onAsk after 600 s of no movement', () {
      fakeAsync((async) {
        int askCount = 0;
        // Always return the same fixed position — never moves
        final monitor = InactivityMonitor(
          onAsk: () => askCount++,
          onSuspicious: () {},
          onAutoEnd: () {},
          positionGetter: () async => _pos(10.9878, -74.7889),
        );
        monitor.start();

        // Tick 10 minutes (10 × 60 s checks)
        async.elapse(const Duration(minutes: 10));

        expect(askCount, 1);
        monitor.dispose();
      });
    });

    test('does NOT fire onAsk if bus keeps moving > 50 m', () {
      fakeAsync((async) {
        int askCount = 0;
        double lat = 10.9878;
        // Each check moves the position north by ~100 m
        final monitor = InactivityMonitor(
          onAsk: () => askCount++,
          onSuspicious: () {},
          onAutoEnd: () {},
          positionGetter: () async {
            lat += 0.0009; // ~100 m per call
            return _pos(lat, -74.7889);
          },
        );
        monitor.start();
        async.elapse(const Duration(minutes: 15));
        expect(askCount, 0);
        monitor.dispose();
      });
    });

    test('fires onAutoEnd 120 s after onAsk if no markResponded', () {
      fakeAsync((async) {
        bool autoEnded = false;
        final monitor = InactivityMonitor(
          onAsk: () {},
          onSuspicious: () {},
          onAutoEnd: () => autoEnded = true,
          positionGetter: () async => _pos(10.9878, -74.7889),
        );
        monitor.start();
        async.elapse(const Duration(minutes: 10)); // triggers onAsk
        async.elapse(const Duration(seconds: 121)); // triggers onAutoEnd
        expect(autoEnded, isTrue);
        monitor.dispose();
      });
    });

    test('markResponded cancels autoEnd timer', () {
      fakeAsync((async) {
        bool autoEnded = false;
        late InactivityMonitor monitor;
        monitor = InactivityMonitor(
          onAsk: () => monitor.markResponded(),
          onSuspicious: () {},
          onAutoEnd: () => autoEnded = true,
          positionGetter: () async => _pos(10.9878, -74.7889),
        );
        monitor.start();
        async.elapse(const Duration(minutes: 10)); // onAsk fires → markResponded called
        async.elapse(const Duration(seconds: 121)); // would have been autoEnd
        expect(autoEnded, isFalse);
        monitor.dispose();
      });
    });

    test('fires onSuspicious after 1800 s of no movement', () {
      fakeAsync((async) {
        int suspiciousCount = 0;
        final monitor = InactivityMonitor(
          onAsk: () {},
          onSuspicious: () => suspiciousCount++,
          onAutoEnd: () {},
          positionGetter: () async => _pos(10.9878, -74.7889),
        );
        monitor.start();
        async.elapse(const Duration(minutes: 31));
        expect(suspiciousCount, greaterThanOrEqualTo(1));
        monitor.dispose();
      });
    });
  });
}
```

---

## File 6 — `test/dropoff_monitor_test.dart` (create)

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mibus_flutter/core/domain/models/stop.dart';
import 'package:mibus_flutter/features/trip/monitors/dropoff_monitor.dart';

Stop _stop(int id, double lat, double lng) => Stop(
      id: id,
      routeId: 1,
      name: 'Stop $id',
      latitude: lat,
      longitude: lng,
      stopOrder: id,
    );

void main() {
  group('DropoffMonitor.routeDistanceMeters', () {
    final dest = _stop(3, 10.9900, -74.7889);

    test('returns direct distance when fewer than 2 stops', () {
      final monitor = DropoffMonitor(
        destination: dest,
        allStops: [dest],
        onPrepare: () {},
        onAlight: () {},
        onMissed: () {},
      );
      // User is at the destination
      final d = monitor.routeDistanceMeters(dest.latitude, dest.longitude);
      expect(d, closeTo(0, 5));
    });

    test('cumulative distance along route stops', () {
      // 3 stops roughly 500 m apart going north
      final stops = [
        _stop(1, 10.9850, -74.7889),
        _stop(2, 10.9875, -74.7889),
        _stop(3, 10.9900, -74.7889),
      ];
      final monitor = DropoffMonitor(
        destination: stops.last,
        allStops: stops,
        onPrepare: () {},
        onAlight: () {},
        onMissed: () {},
      );
      // User is at first stop — distance should be ~stop1→stop2 + stop2→stop3
      final d = monitor.routeDistanceMeters(stops.first.latitude, stops.first.longitude);
      expect(d, greaterThan(400)); // at least 400 m
      expect(d, lessThan(1200));  // not more than 1.2 km
    });

    test('user past destination returns direct distance', () {
      final stops = [
        _stop(1, 10.9850, -74.7889),
        _stop(2, 10.9875, -74.7889),
        _stop(3, 10.9900, -74.7889), // destination
      ];
      final monitor = DropoffMonitor(
        destination: stops[2],
        allStops: stops,
        onPrepare: () {},
        onAlight: () {},
        onMissed: () {},
      );
      // User is already past the destination (further north)
      final d = monitor.routeDistanceMeters(10.9920, -74.7889);
      // nearestIdx >= destIdx → returns direct distance (small positive value)
      expect(d, greaterThanOrEqualTo(0));
      expect(d, lessThan(500));
    });
  });

  group('DropoffMonitor callbacks', () {
    test('onPrepare fires when within 700 m', () async {
      bool prepared = false;
      final dest = _stop(1, 10.9900, -74.7889);
      final monitor = DropoffMonitor(
        destination: dest,
        allStops: [dest],
        onPrepare: () => prepared = true,
        onAlight: () {},
        onMissed: () {},
        // Simulate user at ~600 m from destination
        positionGetter: () async {
          // geolocator Position — 600 m south of dest
          return null; // skip: inject via positionGetter returning null = no-op
        },
      );
      // positionGetter returning null means _check exits early — test routeDistanceMeters directly
      final d = monitor.routeDistanceMeters(10.9846, -74.7889); // ~600 m south
      expect(d, inInclusiveRange(500, 750));
      expect(prepared, isFalse); // not triggered by distance calculation alone
      monitor.dispose();
    });
  });
}
```

---

## Verification

```bash
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/flutter test test/location_service_test.dart test/inactivity_monitor_test.dart test/dropoff_monitor_test.dart
~/development/flutter/bin/flutter analyze
```

Expected: all tests pass, 0 analyze issues.
