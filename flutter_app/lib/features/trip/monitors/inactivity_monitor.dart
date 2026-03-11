import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/location/location_service.dart';

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

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _check());
  }

  void markResponded() {
    _asked = false;
    _hasBeenWarned = true;
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
