import 'dart:async';

import 'package:clock/clock.dart';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/location/location_service.dart';

class InactivityMonitor {
  final VoidCallback onAsk;
  final VoidCallback onSuspicious;
  final VoidCallback onAutoEnd;
  final Future<Position?> Function()? positionGetter;

  Timer? _timer;
  Timer? _autoEndTimer;
  Position? _lastPosition;
  DateTime _lastMoveAt = clock.now();
  bool _asked = false;
  bool _hasBeenWarned = false;

  InactivityMonitor({
    required this.onAsk,
    required this.onSuspicious,
    required this.onAutoEnd,
    this.positionGetter,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _check());
  }

  void markResponded() {
    _asked = false;
    _hasBeenWarned = true;
    _autoEndTimer?.cancel();
    _lastMoveAt = clock.now();
  }

  Future<void> _check() async {
    final pos = positionGetter != null
        ? await positionGetter!()
        : await LocationService.getCurrentPosition();
    if (pos == null) return;

    if (_lastPosition != null) {
      final movedMeters = LocationService.distanceMeters(
        _lastPosition!.latitude,
        _lastPosition!.longitude,
        pos.latitude,
        pos.longitude,
      );
      if (movedMeters > 50) {
        _lastMoveAt = clock.now();
        _asked = false;
        _autoEndTimer?.cancel();
      }
    }

    _lastPosition = pos;

    final inactiveSeconds = clock.now().difference(_lastMoveAt).inSeconds;

    if (inactiveSeconds >= 1800) {
      if (!_hasBeenWarned) {
        _asked = false;
      }
      if (!_asked) {
        _asked = true;
        onSuspicious();
      }
    } else if (inactiveSeconds >= 600) {
      if (_hasBeenWarned) {
        if (!_asked) {
          _asked = true;
          onSuspicious();
        }
      } else if (!_asked) {
        _asked = true;
        _autoEndTimer?.cancel();
        _autoEndTimer = Timer(const Duration(seconds: 120), onAutoEnd);
        onAsk();
      }
    }
  }

  void dispose() {
    _timer?.cancel();
    _autoEndTimer?.cancel();
  }
}
