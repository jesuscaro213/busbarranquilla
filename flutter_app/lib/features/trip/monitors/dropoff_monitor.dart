import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DropoffMonitor {
  final Stop destination;
  final VoidCallback onPrepare;
  final VoidCallback onAlight;
  final VoidCallback onMissed;

  Timer? _timer;
  bool _prepared = false;
  bool _alerted = false;
  bool _missed = false;

  DropoffMonitor({
    required this.destination,
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

    final meters = LocationService.distanceMeters(
      pos.latitude,
      pos.longitude,
      destination.latitude,
      destination.longitude,
    );

    if (!_prepared && meters <= 400) {
      _prepared = true;
      onPrepare();
    }

    if (!_alerted && meters <= 200) {
      _alerted = true;
      onAlight();
    }

    if (_alerted && !_missed && meters > 300) {
      _missed = true;
      onMissed();
    }
  }

  void dispose() {
    _timer?.cancel();
  }
}
