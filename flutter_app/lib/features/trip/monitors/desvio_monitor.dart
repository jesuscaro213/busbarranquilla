import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/stop.dart';
import '../../../core/location/location_service.dart';

class DesvioMonitor {
  final List<LatLng> geometry;
  final List<Stop> stops;

  /// Called when bus is detected off-route and the user hasn't confirmed yet.
  /// [isRepeat] = true means a prior alert was sent but ignored (no user action).
  final void Function(bool isRepeat) onDesvio;

  /// Called when bus has been continuously off-route for [escalateAfter].
  /// [confirmedResponse] is the prior user selection ('trancon' | null).
  /// 'ruta_real' suppresses escalation entirely — never called for that case.
  final void Function(String? confirmedResponse) onEscalate;

  /// Called when the bus re-enters the route after a confirmed off-route episode.
  final VoidCallback? onReturnToRoute;

  static const Duration _repeatDelay  = Duration(minutes: 5);
  static const Duration escalateAfter = Duration(minutes: 30);

  Timer? _timer;
  Timer? _ignoreTimer;

  DateTime? _offRouteAt;     // when bus first crossed the 50m threshold
  DateTime? _episodeStartAt; // set once when episode is confirmed (30s sustained)
  DateTime? _lastAlertAt;    // when we last fired onDesvio

  bool    _ignored           = false;
  bool    _userConfirmed     = false; // user picked trancon or ruta_real
  String? _confirmedResponse;         // 'trancon' | 'ruta_real' | null
  bool    _escalated         = false;

  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
  });

  void start() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _check());
  }

  /// Call when user picks "Ignorar 5 min".
  void ignore(Duration duration) {
    _ignored = true;
    _ignoreTimer?.cancel();
    _ignoreTimer = Timer(duration, () => _ignored = false);
  }

  /// Call when user actively responds to the desvio dialog.
  /// [responseType] must be 'trancon' or 'ruta_real'.
  ///
  /// - 'trancon'   → suppresses re-alerts; escalation fires at 30 min with context
  /// - 'ruta_real' → suppresses re-alerts AND escalation entirely
  void confirmResponse(String responseType) {
    _userConfirmed     = true;
    _confirmedResponse = responseType;
    _lastAlertAt       = DateTime.now();
  }

  /// Resets the entire off-route episode (call when bus re-enters route or on
  /// "Sí, sigo en el bus" after escalation).
  void resetEpisode() {
    _offRouteAt        = null;
    _episodeStartAt    = null;
    _lastAlertAt       = null;
    _userConfirmed     = false;
    _confirmedResponse = null;
    _escalated         = false;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

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
    if (_ignored) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    double minDist;

    if (geometry.length >= 2) {
      minDist = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pos.latitude, pos.longitude,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < minDist) minDist = d;
      }
    } else if (stops.isNotEmpty) {
      minDist = stops.fold<double>(double.infinity, (best, stop) {
        final d = LocationService.distanceMeters(
          pos.latitude, pos.longitude, stop.latitude, stop.longitude,
        );
        return d < best ? d : best;
      });
    } else {
      return; // no geometry or stops — can't evaluate
    }

    if (minDist > 50) {
      _offRouteAt ??= DateTime.now();
      final offSeconds = DateTime.now().difference(_offRouteAt!).inSeconds;
      if (offSeconds < 30) return; // not sustained yet

      // Episode confirmed — mark start time once.
      _episodeStartAt ??= DateTime.now();

      // ── Escalation check (30 min continuously off-route) ──
      if (!_escalated &&
          DateTime.now().difference(_episodeStartAt!) >= escalateAfter) {
        _escalated = true;
        // 'ruta_real' users already know and reported — don't escalate.
        if (_confirmedResponse != 'ruta_real') {
          onEscalate(_confirmedResponse); // null or 'trancon'
        }
        return;
      }
      if (_escalated) return;

      // ── Re-alert only if user hasn't responded yet ──
      // Once the user confirms (trancon/ruta_real), we trust their input and
      // stop re-alerting — only the 30-min escalation matters after that.
      if (_userConfirmed) return;

      final isRepeat = _lastAlertAt != null;
      final shouldAlert = _lastAlertAt == null ||
          DateTime.now().difference(_lastAlertAt!) >= _repeatDelay;

      if (shouldAlert) {
        _lastAlertAt = DateTime.now();
        onDesvio(isRepeat);
      }
    } else {
      // Back on route — notify only if there was a confirmed episode.
      // Skip for 'ruta_real': the deviation re-entry timer handles that case
      // and notifying here would cause duplicate snackbars/notifications.
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
    }
  }

  void dispose() {
    _timer?.cancel();
    _ignoreTimer?.cancel();
  }
}
