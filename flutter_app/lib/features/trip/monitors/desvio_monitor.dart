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

  /// Optional OSRM nearest-road resolver. When provided, readings in the
  /// 20–100 m gray zone are confirmed by snapping the GPS to the road network
  /// and re-measuring against the registered polyline.
  final Future<LatLng?> Function(double lat, double lng)? osrmNearest;

  /// Called every 10 min when the user has already confirmed 'ruta_real' and
  /// the GPS is still off-route. No push notification is sent — only in-app UI.
  final VoidCallback? onConfirmDeviating;

  static const Duration _confirmInterval = Duration(minutes: 10);
  DateTime? _lastConfirmAt;

  static const Duration _repeatDelay  = Duration(minutes: 5);
  static const Duration escalateAfter = Duration(minutes: 30);

  Timer? _timer;
  Timer? _ignoreTimer;

  DateTime? _offRouteAt;     // when bus first crossed the on-route threshold
  DateTime? _episodeStartAt; // set once when episode is confirmed (30s sustained)
  DateTime? _lastAlertAt;    // when we last fired onDesvio

  bool    _ignored           = false;
  bool    _userConfirmed     = false; // user picked trancon or ruta_real
  String? _confirmedResponse;         // 'trancon' | 'ruta_real' | null
  bool    _escalated         = false;
  bool _reverseInFlight = false;

  // distance constants
  static const double _kOnRouteMax  = 20.0;  // clearly on route
  static const double _kGrayZoneMax = 100.0; // upper bound of gray zone
  static const double _kSnapOnRoute = 20.0;  // snapped point ≤ 20 m → correct street

  DesvioMonitor({
    required this.geometry,
    required this.stops,
    required this.onDesvio,
    required this.onEscalate,
    this.onReturnToRoute,
    this.osrmNearest,
    this.onConfirmDeviating,
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
    _lastConfirmAt     = null;
    _userConfirmed     = false;
    _confirmedResponse = null;
    _escalated         = false;
  }

  /// Call when user taps "Sí, sigo en ruta diferente" in the confirmation sheet.
  /// Resets the 10-min interval without clearing the episode.
  void acknowledgeConfirmation() {
    _lastConfirmAt = DateTime.now();
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

  double _minDistToGeometry(double pLat, double pLng) {
    if (geometry.length >= 2) {
      double best = double.infinity;
      for (int i = 0; i < geometry.length - 1; i++) {
        final d = _distToSegmentMeters(
          pLat, pLng,
          geometry[i].latitude, geometry[i].longitude,
          geometry[i + 1].latitude, geometry[i + 1].longitude,
        );
        if (d < best) best = d;
      }
      return best;
    }
    return stops.fold<double>(double.infinity, (b, s) {
      final d = LocationService.distanceMeters(pLat, pLng, s.latitude, s.longitude);
      return d < b ? d : b;
    });
  }

  Future<void> _check() async {
    if (_ignored) return;

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final rawDist = _minDistToGeometry(pos.latitude, pos.longitude);

    // ── 1. Clearly on route ──────────────────────────────────────────────────
    if (rawDist <= _kOnRouteMax) {
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
      return;
    }

    // ── 2. Determine if genuinely off-route ──────────────────────────────────
    bool isOffRoute;

    if (rawDist <= _kGrayZoneMax && osrmNearest != null) {
      // Gray zone (20–100 m): snap GPS to road network and re-measure.
      // Skip if a previous snap is still in flight.
      if (_reverseInFlight) return;
      _reverseInFlight = true;
      try {
        final snapped = await osrmNearest!(pos.latitude, pos.longitude);
        if (snapped == null) {
          // Network error — assume off-route to avoid suppressing real deviations.
          isOffRoute = true;
        } else {
          final snapDist = _minDistToGeometry(snapped.latitude, snapped.longitude);
          // If the road-snapped point is close to the registered polyline, the
          // GPS is on the correct street (just offset by GPS error). Not a deviation.
          isOffRoute = snapDist > _kSnapOnRoute;
        }
      } finally {
        _reverseInFlight = false;
      }
    } else {
      // rawDist > 100 m → clearly off route; no OSRM call needed.
      // Also the fallback when osrmNearest is not provided.
      isOffRoute = true;
    }

    // ── 3. On-route confirmed by OSRM snap ───────────────────────────────────
    if (!isOffRoute) {
      if (_episodeStartAt != null && _confirmedResponse != 'ruta_real') {
        onReturnToRoute?.call();
      }
      resetEpisode();
      return;
    }

    // ── 4. Off-route: start / continue episode ───────────────────────────────
    _offRouteAt ??= DateTime.now();
    final offSeconds = DateTime.now().difference(_offRouteAt!).inSeconds;
    if (offSeconds < 15) return; // not sustained yet

    // Episode confirmed — mark start time once.
    _episodeStartAt ??= DateTime.now();

    // ── Escalation check (30 min continuously off-route) ──
    if (!_escalated &&
        DateTime.now().difference(_episodeStartAt!) >= escalateAfter) {
      _escalated = true;
      if (_confirmedResponse != 'ruta_real') {
        onEscalate(_confirmedResponse);
      }
      return;
    }
    if (_escalated) return;

    // ── After ruta_real confirmation: periodic check instead of re-alert ──
    if (_confirmedResponse == 'ruta_real') {
      final shouldConfirm = _lastConfirmAt == null ||
          DateTime.now().difference(_lastConfirmAt!) >= _confirmInterval;
      if (shouldConfirm) {
        _lastConfirmAt = DateTime.now();
        onConfirmDeviating?.call();
      }
      return;
    }

    // ── Re-alert only if user hasn't responded yet (trancon or no response) ──
    if (_userConfirmed) return;

    final isRepeat = _lastAlertAt != null;
    final shouldAlert = _lastAlertAt == null ||
        DateTime.now().difference(_lastAlertAt!) >= _repeatDelay;

    if (shouldAlert) {
      _lastAlertAt = DateTime.now();
      onDesvio(isRepeat);
    }
  }

  void dispose() {
    _timer?.cancel();
    _ignoreTimer?.cancel();
  }
}
