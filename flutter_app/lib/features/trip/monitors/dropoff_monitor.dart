import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

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
  bool _notificationsEnabled;

  bool get notificationsEnabled => _notificationsEnabled;

  /// Enables push + vibration notifications. Called when the user opts in
  /// (or automatically for premium users). Safe to call multiple times.
  void enableNotifications() => _notificationsEnabled = true;

  DropoffMonitor({
    required this.destination,
    required this.allStops,
    required this.onPrepare,
    required this.onAlight,
    required this.onMissed,
    this.positionGetter,
    bool notificationsEnabled = false,
  }) : _notificationsEnabled = notificationsEnabled;

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
  }

  Future<void> _check() async {
    // Use last known position (instant, no GPS request) since the trip's
    // location stream already keeps the OS GPS cache fresh.
    final pos = positionGetter != null
        ? await positionGetter!()
        : (await Geolocator.getLastKnownPosition() ??
            await LocationService.getCurrentPosition());
    if (pos == null) return;

    final dist = routeDistanceMeters(pos.latitude, pos.longitude);

    if (!_prepared && dist <= 700) {
      _prepared = true;
      onPrepare();
    }

    if (!_alerted && dist <= 200) {
      _alerted = true;
      onAlight();
    }

    if (_alerted && !_missed && (_prevDistMeters ?? dist) <= 200 && dist > 200) {
      _missed = true;
      onMissed();
    }

    _prevDistMeters = dist;
  }

  // @visibleForTesting
  double routeDistanceMeters(double userLat, double userLng) {
    if (allStops.length < 2) {
      return LocationService.distanceMeters(
        userLat, userLng, destination.latitude, destination.longitude,
      );
    }

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
      return LocationService.distanceMeters(
        userLat, userLng, destination.latitude, destination.longitude,
      );
    }

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
      return nearestDist;
    }

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
