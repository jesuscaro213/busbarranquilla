import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DesvioMonitor {
  final List<LatLng> geometry;
  final List<Stop> stops;
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
      minDistMeters = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pos.latitude, pos.longitude,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < minDistMeters) minDistMeters = d;
      }
      if (minDistMeters > 50) {
        _offRouteAt ??= DateTime.now();
        if (DateTime.now().difference(_offRouteAt!).inSeconds >= 30) {
          _alerted = true;
          onDesvio();
        }
      } else {
        _offRouteAt = null;
      }
    } else if (stops.isNotEmpty) {
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
      if (minDistMeters > 50) {
        _offRouteAt ??= DateTime.now();
        if (DateTime.now().difference(_offRouteAt!).inSeconds >= 30) {
          _alerted = true;
          onDesvio();
        }
      } else {
        _offRouteAt = null;
      }
    }
  }

  void dispose() {
    _timer?.cancel();
    _ignoreTimer?.cancel();
  }
}
