import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:vibration/vibration.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/api/api_client.dart';
import '../../../core/data/repositories/auth_repository.dart';
import '../../../core/data/repositories/credits_repository.dart';
import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/data/repositories/trips_repository.dart';
import '../../auth/providers/auth_notifier.dart';
import '../../auth/providers/auth_state.dart';
import '../../profile/providers/profile_notifier.dart';
import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/trip_end_result.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/analytics/analytics_service.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/notifications/notification_service.dart';
import '../../../core/socket/socket_service.dart';
import '../monitors/auto_resolve_monitor.dart';
import '../monitors/desvio_monitor.dart';
import '../monitors/dropoff_monitor.dart';
import '../monitors/inactivity_monitor.dart';
import 'trip_state.dart';

class TripNotifier extends Notifier<TripState> {
  StreamSubscription<Position>? _locationSubscription;
  DateTime _lastBroadcast = DateTime(0);
  Timer? _gpsCheckTimer;
  Timer? _occupancyPollTimer;
  DateTime _lastGpsAt = DateTime.now();
  DropoffMonitor? _dropoffMonitor;
  bool get hasDropoffMonitor => _dropoffMonitor != null;

  // Cached at trip start — avoids two platform-channel round-trips per alert.
  bool _canVibrate = false;
  bool _hasAmplitudeControl = false;

  /// Initialises vibration capabilities once per trip session.
  static Future<({bool canVibrate, bool hasAmplitude})> _queryVibrationCaps() async {
    // Treat null as "assume yes" — some Android devices return null instead of
    // true even when a vibrator is present. Explicitly false means no vibrator.
    final canVibrate = (await Vibration.hasVibrator()) != false;
    if (!canVibrate) return (canVibrate: false, hasAmplitude: false);
    final hasAmplitude = (await Vibration.hasAmplitudeControl()) == true;
    return (canVibrate: true, hasAmplitude: hasAmplitude);
  }

  /// Vibrates with [pattern] using the device vibration motor.
  /// Falls back to HapticFeedback on devices without a vibrator (e.g. emulators).
  void _vibrate({required List<int> pattern, List<int>? intensities}) {
    if (_canVibrate) {
      if (intensities != null && _hasAmplitudeControl) {
        unawaited(Vibration.vibrate(pattern: pattern, intensities: intensities));
      } else {
        unawaited(Vibration.vibrate(pattern: pattern));
      }
    } else {
      // Emulator / no vibrator: use haptic feedback as best-effort fallback.
      var pulseCount = 0;
      for (var i = 1; i < pattern.length; i += 2) { pulseCount++; }
      unawaited(_hapticPulses(pulseCount));
    }
  }

  /// Fires [count] heavy haptic impacts with 200 ms gaps (emulator fallback).
  Future<void> _hapticPulses(int count) async {
    for (var i = 0; i < count; i++) {
      await HapticFeedback.heavyImpact();
      if (i < count - 1) {
        await Future<void>.delayed(const Duration(milliseconds: 200));
      }
    }
  }

  /// Current dropoff destination coordinates, if a monitor is running.
  /// Used to center the map-pick screen on the already-selected destination.
  LatLng? get dropoffMonitorDestination {
    final dest = _dropoffMonitor?.destination;
    if (dest == null) return null;
    return LatLng(dest.latitude, dest.longitude);
  }

  Future<LatLng?> _osrmNearest(double lat, double lng) async {
    try {
      final dio = ref.read(dioProvider);
      final resp = await dio.get<String>(
        'https://router.project-osrm.org/nearest/v1/driving/$lng,$lat',
        options: Options(
          responseType: ResponseType.plain,
          sendTimeout: const Duration(seconds: 5),
          receiveTimeout: const Duration(seconds: 5),
        ),
      );
      if (resp.statusCode != 200 || resp.data == null) return null;
      final body = jsonDecode(resp.data!) as Map<String, dynamic>;
      final waypoints = body['waypoints'] as List?;
      if (waypoints == null || waypoints.isEmpty) return null;
      final loc = (waypoints.first as Map<String, dynamic>)['location'] as List;
      return LatLng((loc[1] as num).toDouble(), (loc[0] as num).toDouble());
    } catch (_) {
      return null;
    }
  }

  InactivityMonitor? _inactivityMonitor;
  AutoResolveMonitor? _autoResolveMonitor;
  DesvioMonitor? _desvioMonitor;

  Stop? _pendingDropoffDestination;

  DateTime? _occupancyCooldownEnd;
  final Set<String> _occupancyCredited = <String>{};
  int _reportsCreatedThisTrip = 0;

  void Function(String message)? _onReportResolved;
  void Function(String message)? _onDeviationReEntry;
  void Function()? _onReturnToRoute;
  void Function()? _onForceCloseDesvioDialogs;
  Timer? _deviationReEntryTimer;
  Timer? _desvioEscalateTimer;
  Timer? _desvioConfirmTimer;
  Timer? _noDestTimer;
  int? _deviationRouteId;
  int? _desvioReportId; // ID of the active desvio report; resolved on return to route or trip end

  void setReportResolvedCallback(void Function(String message) cb) {
    _onReportResolved = cb;
  }

  void setDeviationReEntryCallback(void Function(String message) cb) {
    _onDeviationReEntry = cb;
  }

  void setReturnToRouteCallback(void Function() cb) {
    _onReturnToRoute = cb;
  }

  void setForceCloseDesvioDialogsCallback(void Function() cb) {
    _onForceCloseDesvioDialogs = cb;
  }

  @override
  TripState build() {
    ref.onDispose(_disposeMonitorsAndTimers);
    Future<void>.microtask(_recoverActiveTrip);
    return const TripIdle();
  }

  Future<void> _recoverActiveTrip() async {
    final result = await ref.read(tripsRepositoryProvider).getCurrent();
    if (result is! Success<ActiveTrip?>) return;
    final trip = result.data;
    if (trip == null || trip.routeId == null) return;

    if (state is TripActive) return;

    final routeId = trip.routeId!;

    final routeResult = await ref.read(routesRepositoryProvider).getById(routeId);
    if (routeResult is! Success<BusRoute>) return;
    final route = routeResult.data;

    final stopsResult = await ref.read(stopsRepositoryProvider).listByRoute(routeId);
    final stops = stopsResult is Success<List<Stop>> ? stopsResult.data : const <Stop>[];

    final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(routeId);
    final reports = reportsResult is Success<List<Report>> ? reportsResult.data : const <Report>[];

    final activeState = TripActive(
      trip: trip,
      route: route,
      stops: stops,
      reports: reports,
    );

    _occupancyCooldownEnd = null;
    _occupancyCredited.clear();

    state = activeState;

    final vibCaps = await _queryVibrationCaps();
    _canVibrate = vibCaps.canVibrate;
    _hasAmplitudeControl = vibCaps.hasAmplitude;

    ref.read(socketServiceProvider).joinRoute(routeId);
    _bindSocketRouteListeners(routeId);
    _startLocationBroadcast();
    _startMonitors(activeState, trip.destinationStopId);

    // Restore map-picked destination if it was persisted (no real stop, but custom lat/lng saved).
    // Must run AFTER _startMonitors because that may have set dropoffPrompt=true for free users
    // (destinationStopId == null). We override it: user already paid credits in the previous session.
    if (trip.destinationStopId == null &&
        trip.destinationLat != null &&
        trip.destinationLng != null) {
      final syntheticStop = Stop(
        id: -1,
        routeId: routeId,
        name: trip.destinationStopName ?? 'Destino',
        latitude: trip.destinationLat!,
        longitude: trip.destinationLng!,
        stopOrder: 0,
      );
      _startDropoffMonitor(syntheticStop, stops);
      if (state is TripActive) {
        state = (state as TripActive).copyWith(dropoffPrompt: false);
      }
    }

    _startOccupancyPolling(routeId);
  }

  bool get isActive => state is TripActive;

  /// Starts a trip auto-selecting the stop nearest to [targetStop] as destination.
  /// Used by the planner flow — no stop selection screen needed.
  Future<void> startTripFromPlan(int routeId, LatLng targetStop) async {
    state = const TripLoading();

    final stopsResult = await ref.read(stopsRepositoryProvider).listByRoute(routeId);
    int? destinationStopId;

    if (stopsResult is Success<List<Stop>>) {
      final stops = stopsResult.data;
      Stop? nearest;
      double bestDist = double.infinity;
      for (final stop in stops) {
        final d = LocationService.distanceMeters(
          stop.latitude,
          stop.longitude,
          targetStop.latitude,
          targetStop.longitude,
        );
        if (d < bestDist) {
          bestDist = d;
          nearest = stop;
        }
      }
      destinationStopId = nearest?.id;
    }

    // Reset to idle so startTrip can set TripLoading again
    state = const TripIdle();
    await startTrip(routeId, destinationStopId: destinationStopId);
  }

  Future<void> startTrip(int routeId, {int? destinationStopId}) async {
    state = const TripLoading();

    final swTrip = Stopwatch()..start();
    debugPrint('[PERF][TRIP] iniciando viaje rutaId=$routeId...');

    // Request "Always allow" so the app can transmit in background.
    // This shows the system dialog with the "Allow all the time" option.
    await LocationService.requestBackgroundPermission();

    final pos = await LocationService.getBestEffortPosition();
    debugPrint('[PERF][TRIP] GPS listo en ${swTrip.elapsedMilliseconds}ms');
    if (pos == null) {
      state = const TripError(AppStrings.locationRequired);
      return;
    }

    final startResult = await ref.read(tripsRepositoryProvider).start(<String, dynamic>{
      'route_id': routeId,
      'destination_stop_id': destinationStopId,
      'latitude': pos.latitude,
      'longitude': pos.longitude,
    });

    late final ActiveTrip trip;
    switch (startResult) {
      case Success<ActiveTrip>(data: final data):
        debugPrint('[PERF][TRIP] viaje creado en backend — ${swTrip.elapsedMilliseconds}ms');
        trip = data;
      case Failure<ActiveTrip>(error: final error):
        debugPrint('[PERF][TRIP] error al crear viaje — ${swTrip.elapsedMilliseconds}ms');
        state = TripError(error.message);
        return;
    }

    final routeResult = await ref.read(routesRepositoryProvider).getById(routeId);
    late final BusRoute route;
    switch (routeResult) {
      case Success<BusRoute>(data: final data):
        route = data;
      case Failure<BusRoute>(error: final error):
        state = TripError(error.message);
        return;
    }

    final stopsResult = await ref.read(stopsRepositoryProvider).listByRoute(routeId);
    final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(routeId);

    late final List<Stop> stops;
    switch (stopsResult) {
      case Success<List<Stop>>(data: final data):
        stops = data;
      case Failure<List<Stop>>(error: final error):
        state = TripError(error.message);
        return;
    }

    late final List<Report> reports;
    switch (reportsResult) {
      case Success<List<Report>>(data: final data):
        reports = data;
      case Failure<List<Report>>(error: final error):
        state = TripError(error.message);
        return;
    }

    final activeState = TripActive(
      trip: trip,
      route: route,
      stops: stops,
      reports: reports,
    );

    _occupancyCooldownEnd = null;
    _occupancyCredited.clear();
    _reportsCreatedThisTrip = 0;
    _lastGpsAt = DateTime.now();

    debugPrint('[PERF][TRIP] estado activo listo — total ${swTrip.elapsedMilliseconds}ms');
    unawaited(AnalyticsService.tripStarted(routeId, route.code));
    state = activeState;

    final vibCaps = await _queryVibrationCaps();
    _canVibrate = vibCaps.canVibrate;
    _hasAmplitudeControl = vibCaps.hasAmplitude;

    ref.read(socketServiceProvider).joinRoute(routeId);
    _bindSocketRouteListeners(routeId);
    _startLocationBroadcast();
    ref.read(socketServiceProvider).onReconnect = () {
      ref.read(socketServiceProvider).joinRoute(routeId);
    };
    _startMonitors(activeState, destinationStopId);
    if (destinationStopId == null) {
      _noDestTimer = Timer(const Duration(minutes: 4), () {
        unawaited(() async {
          if (state is! TripActive) return;
          final active = state as TripActive;
          if (active.trip.destinationStopId != null || hasDropoffMonitor) return;

          // Fetch fresh profile so credits reflect any spending/earning during
          // the 4-minute window (avoids stale cached value).
          final profileResult =
              await ref.read(authRepositoryProvider).getProfile();
          if (profileResult is! Success) return;
          final user = profileResult.data;

          final prefs = user.notificationPrefs;
          if (prefs?.boardingAlerts == false) return;

          final isPremium = user.isPremium || user.role == 'admin';
          final hasCredits = user.credits >= 5;

          if (!isPremium && !hasCredits) {
            unawaited(AnalyticsService.noDestinationNudgeSent('premium_upsell'));
            unawaited(NotificationService.showAlert(
              title: AppStrings.noDestinationPremiumNudgeTitle,
              body: AppStrings.noDestinationPremiumNudgeBody,
              payload: 'no_destination',
            ));
          } else {
            unawaited(AnalyticsService.noDestinationNudgeSent('regular'));
            unawaited(NotificationService.showAlert(
              title: AppStrings.noDestinationNudgeTitle,
              body: AppStrings.noDestinationNudgeBody,
              payload: 'no_destination',
            ));
          }
        }());
      });
    }
    _startOccupancyPolling(routeId);
  }

  Future<void> endTrip({int suspiciousMinutes = 0}) async {
    if (state is! TripActive) {
      state = const TripIdle();
      return;
    }

    final active = state as TripActive;
    final startedAt = active.trip.startedAt;
    final routeName = active.route.name;
    final duration = startedAt != null
        ? DateTime.now().difference(startedAt)
        : Duration.zero;
    final reportsCreated = _reportsCreatedThisTrip;

    // Resolve any open desvio episode report — records its end at current location/time.
    final desvioReportId = _desvioReportId;
    if (desvioReportId != null) {
      unawaited(ref.read(reportsRepositoryProvider).resolve(desvioReportId));
    }

    // Close the GPS deviation segment in route_update_reports so the admin
    // sees a complete [start → got-off] line instead of a single start point.
    final deviationRouteId = _deviationRouteId;
    if (deviationRouteId != null) {
      Position? pos;
      try {
        pos = await Geolocator.getLastKnownPosition();
      } catch (_) {}
      if (pos != null) {
        unawaited(ref.read(routesRepositoryProvider).updateDeviationReEntry(
          deviationRouteId,
          pos.latitude,
          pos.longitude,
        ));
      }
    }

    _disposeMonitorsAndTimers(); // clears _desvioReportId / _deviationRouteId internally
    final socket = ref.read(socketServiceProvider);
    if (active.trip.routeId != null) {
      socket.leaveRoute(active.trip.routeId!);
    }
    socket.off('route:new_report');
    socket.off('route:report_confirmed');
    socket.off('route:report_resolved');

    final endBody = suspiciousMinutes > 0
        ? <String, dynamic>{'suspicious_minutes': suspiciousMinutes}
        : null;

    // Run both requests in parallel for speed.
    final results = await Future.wait<Object?>(<Future<Object?>>[
      ref.read(tripsRepositoryProvider).end(body: endBody),
      ref.read(creditsRepositoryProvider).getReportStreak(),
    ]);

    final endResult = results[0];
    final streakDays = (results[1] as int?) ?? 0;

    switch (endResult) {
      case Success<TripEndResult>(data: final data):
        state = TripEnded(
          routeName: routeName,
          totalCreditsEarned: data.totalCreditsEarned,
          distanceMeters: data.distanceMeters,
          completionBonusEarned: data.completionBonusEarned,
          tripDuration: duration,
          reportsCreated: reportsCreated,
          streakDays: streakDays,
          deviationDetected: data.deviationDetected,
        );
        final durationMinutes = data.trip.startedAt != null
            ? DateTime.now().difference(data.trip.startedAt!).inMinutes
            : 0;
        unawaited(AnalyticsService.tripEnded(
          durationMinutes: durationMinutes,
          creditsEarned: data.totalCreditsEarned,
          distanceMeters: data.distanceMeters.toDouble(),
        ));
      case Failure<TripEndResult>():
        state = const TripIdle();
      default:
        state = const TripIdle();
    }
  }

  void resetToIdle() {
    state = const TripIdle();
  }

  void markInactivityResponded() {
    _inactivityMonitor?.markResponded();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(showInactivityModal: false);
    }
  }

  void dismissSuspiciousModal() {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(showSuspiciousModal: false);
    }
  }

  /// Call when user actively responds to the desvio dialog.
  /// [responseType] must be 'trancon' or 'ruta_real'.
  void dismissDesvio(String responseType) {
    _desvioMonitor?.confirmResponse(responseType);
    if (state is TripActive) {
      state = (state as TripActive).copyWith(desvioDetected: false);
    }
  }

  void requestMapPick() {
    if (state is! TripActive) return;
    final active = state as TripActive;
    if (active.trip.destinationStopId != null || hasDropoffMonitor) return;
    state = active.copyWith(noMapPickRequested: true);
  }

  void clearMapPickRequest() {
    if (state is! TripActive) return;
    state = (state as TripActive).copyWith(noMapPickRequested: false);
  }

  /// User tapped "Sí, sigo en ruta diferente" in the confirmation sheet.
  void acknowledgeDesvioConfirm() {
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
    _desvioMonitor?.acknowledgeConfirmation();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(desvioConfirmPending: false);
    }
  }

  /// User tapped "El bus ya regresó a la ruta" in the confirmation sheet.
  void resetDesvioConfirm() {
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
    _desvioMonitor?.resetEpisode();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(
        desvioConfirmPending: false,
        desvioDetected: false,
      );
    }
  }

  /// Call when user confirms they are still on the bus after the 30-min escalation.
  void dismissDesvioEscalate() {
    _desvioEscalateTimer?.cancel();
    _desvioEscalateTimer = null;
    _desvioMonitor?.resetEpisode();
    if (state is TripActive) {
      state = (state as TripActive).copyWith(
        showDesvioEscalate: false,
        desvioEscalateIsTranscon: false,
      );
    }
  }

  void ignoreDesvio() {
    _desvioMonitor?.ignore(const Duration(minutes: 5));
    if (state is TripActive) {
      state = (state as TripActive).copyWith(desvioDetected: false);
    }
  }

  /// Reports "ruta diferente al mapa" with GPS validation.
  ///
  /// Returns:
  ///   'on_route' — GPS is currently on the registered route (report invalid)
  ///   'ok'       — report accepted, re-entry monitoring started
  ///   'error'    — network or unexpected error
  Future<String> reportRutaReal(int routeId, List<LatLng> geometry) async {
    // Fast path: use last known position; fall back to full GPS fix.
    Position? pos;
    try {
      pos = await Geolocator.getLastKnownPosition();
    } catch (_) {}
    pos ??= await LocationService.getCurrentPosition();
    if (pos == null) return 'error';

    final result = await ref.read(routesRepositoryProvider).reportRouteUpdate(
      routeId,
      'ruta_real',
      lat: pos.latitude,
      lng: pos.longitude,
    );

    if (result.onRoute) return 'on_route';
    if (!result.ok) return 'error';

    // Report accepted — start re-entry monitor.
    _deviationRouteId = routeId;
    _deviationReEntryTimer?.cancel();
    _deviationReEntryTimer = Timer.periodic(const Duration(seconds: 15), (_) async {
      if (state is! TripActive) {
        _deviationReEntryTimer?.cancel();
        _deviationReEntryTimer = null;
        return;
      }
      if (geometry.isEmpty) return;

      Position? current;
      try {
        current = await Geolocator.getLastKnownPosition();
      } catch (_) {}
      if (current == null) return;
      // Re-check state after the async GPS fetch — trip may have ended meanwhile.
      if (state is! TripActive) return;

      final dist = LocationService.minDistToPolyline(
        current.latitude,
        current.longitude,
        geometry,
      );

      if (dist < 80) {
        _deviationReEntryTimer?.cancel();
        _deviationReEntryTimer = null;
        final routeIdToUpdate = _deviationRouteId;
        _deviationRouteId = null;
        if (routeIdToUpdate != null) {
          unawaited(
            ref.read(routesRepositoryProvider).updateDeviationReEntry(
              routeIdToUpdate,
              current.latitude,
              current.longitude,
            ),
          );
        }
        _onDeviationReEntry?.call(AppStrings.desvioRutaRealReEntry);
      }
    });

    return 'ok';
  }

  /// [autoActivated] — true when called automatically because the user already
  /// has boardingAlerts enabled in their notification preferences.
  /// Shows a success info snackbar instead of requiring a dialog confirmation.
  Future<void> activateDropoffAlerts({bool autoActivated = false}) async {
    if (state is! TripActive) return;

    final creditResult = await ref.read(creditsRepositoryProvider).spend(<String, dynamic>{
      'amount': 5,
      'description': 'Alertas de bajada',
    });
    if (creditResult is Failure) {
      state = (state as TripActive).copyWith(
        dropoffPrompt: false,
        reportError: AppStrings.dropoffNoCredits,
      );
      return;
    }

    _refreshBalance();

    state = (state as TripActive).copyWith(
      dropoffPrompt: false,
      infoMessage: autoActivated ? AppStrings.dropoffAutoActivated : null,
    );

    if (_pendingDropoffDestination != null && state is TripActive) {
      final active = state as TripActive;
      _startDropoffMonitor(_pendingDropoffDestination!, active.stops);
      _pendingDropoffDestination = null;
    }
  }

  void dismissDropoffPrompt() {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(dropoffPrompt: false);
    }
    _pendingDropoffDestination = null;
  }

  /// Sets a destination from a map-picked lat/lng and starts dropoff monitoring.
  /// Charges 5 credits for free users (premium/admin free).
  Future<void> setDestinationByLatLng(double lat, double lng, String label) async {
    if (state is! TripActive) return;
    _noDestTimer?.cancel();
    _noDestTimer = null;

    final authState = ref.read(authNotifierProvider);
    final isPremium = authState is Authenticated &&
        (authState.user.hasActivePremium || authState.user.role == 'admin');

    if (!isPremium) {
      final creditResult = await ref.read(creditsRepositoryProvider).spend(<String, dynamic>{
        'amount': 5,
        'description': 'Alertas de bajada',
      });
      if (creditResult is Failure) {
        if (state is TripActive) {
          state = (state as TripActive).copyWith(
            reportError: AppStrings.dropoffNoCredits,
          );
        }
        return;
      }
      _refreshBalance();
    }

    if (state is! TripActive) return;
    final active = state as TripActive;
    final syntheticStop = Stop(
      id: -1,
      routeId: active.route.id,
      name: label,
      latitude: lat,
      longitude: lng,
      stopOrder: 0,
    );
    _startDropoffMonitor(syntheticStop, active.stops);
    state = active.copyWith(dropoffPrompt: false);
    unawaited(ref.read(tripsRepositoryProvider).updateDestination(lat, lng, label));
  }

  /// Updates destination during an active trip without charging credits again.
  void updateDestinationByLatLng(double lat, double lng, String label) {
    if (state is! TripActive) return;
    _noDestTimer?.cancel();
    _noDestTimer = null;
    final active = state as TripActive;
    final syntheticStop = Stop(
      id: -1,
      routeId: active.route.id,
      name: label,
      latitude: lat,
      longitude: lng,
      stopOrder: 0,
    );
    _startDropoffMonitor(syntheticStop, active.stops);
    unawaited(ref.read(tripsRepositoryProvider).updateDestination(lat, lng, label));
  }

  /// Sets a destination on an already-active trip and starts dropoff monitoring.
  /// Charges 5 credits (same cost as activateDropoffAlerts).
  Future<void> setDestinationStop(Stop stop) async {
    if (state is! TripActive) return;
    _noDestTimer?.cancel();
    _noDestTimer = null;

    final creditResult = await ref.read(creditsRepositoryProvider).spend(<String, dynamic>{
      'amount': 5,
      'description': 'Alertas de bajada',
    });
    if (creditResult is Failure) {
      state = (state as TripActive).copyWith(
        reportError: AppStrings.dropoffNoCredits,
      );
      return;
    }

    _refreshBalance();

    if (state is! TripActive) return;
    final active = state as TripActive;
    _startDropoffMonitor(stop, active.stops);
    state = active.copyWith(dropoffPrompt: false);
  }

  void _startDropoffMonitor(Stop destination, List<Stop> allStops) {
    _dropoffMonitor?.dispose();
    _dropoffMonitor = DropoffMonitor(
      destination: destination,
      allStops: allStops,
      onPrepare: () {
        if (state is! TripActive) return;
        state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.prepare);
        // Two medium pulses — noticeable but not panic-inducing.
        _vibrate(
          pattern: [0, 200, 200, 200],
          intensities: [0, 180, 0, 180],
        );
        unawaited(NotificationService.showAlert(
          title: AppStrings.prepareToAlight,
          body: AppStrings.prepareToAlightBody,
          payload: 'boarding_alert_prepare',
        ));
      },
      onAlight: () {
        if (state is! TripActive) return;
        state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.alight);
        // Five heavy pulses — urgent "get off now" feel.
        _vibrate(
          pattern: [0, 400, 150, 400, 150, 400, 150, 400, 150, 400],
          intensities: [0, 255, 0, 255, 0, 255, 0, 255, 0, 255],
        );
        unawaited(NotificationService.showAlert(
          title: AppStrings.alightNow,
          body: AppStrings.alightNowBody,
          payload: 'boarding_alert_now',
        ));
      },
      onMissed: () {
        if (state is! TripActive) return;
        state = (state as TripActive).copyWith(dropoffAlert: DropoffAlert.missed);
      },
    )..start();
  }

  Future<void> confirmReport(int reportId) async {
    if (state is! TripActive) return;

    final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
    switch (result) {
      case Success<void>():
        await _reloadReports();
      case Failure<void>():
        return;
    }
  }

  Future<void> createReport(String type) async {
    if (state is! TripActive) return;

    final isOccupancy = type == 'lleno' || type == 'bus_disponible';

    if (isOccupancy) {
      final cooldown = _occupancyCooldownEnd;
      if (cooldown != null && DateTime.now().isBefore(cooldown)) {
        final remaining = cooldown.difference(DateTime.now()).inMinutes + 1;
        state = (state as TripActive).copyWith(
          reportError: 'Espera $remaining min antes de reportar ocupación de nuevo',
        );
        return;
      }
    }

    final active = state as TripActive;
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final result = await ref.read(reportsRepositoryProvider).create(<String, dynamic>{
      'route_id': active.route.id,
      'type': type,
      'latitude': pos.latitude,
      'longitude': pos.longitude,
    });

    switch (result) {
      case Success<Report>(data: final report):
        _reportsCreatedThisTrip++;
        unawaited(AnalyticsService.reportCreated(type));
        // Track the desvio report so it can be auto-resolved when bus returns to route.
        if (type == 'desvio') {
          _desvioReportId = report.id;
        }
        if (isOccupancy) {
          _occupancyCooldownEnd = DateTime.now().add(const Duration(minutes: 10));
          _occupancyCredited.add(type);
        }
        await _reloadReports();
      case Failure<Report>():
        return;
    }
  }

  void clearReportError() {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(clearReportError: true);
    }
  }

  void clearInfoMessage() {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(clearInfoMessage: true);
    }
  }

  void clearDropoffAutoPickDestination() {
    if (state is TripActive) {
      state = (state as TripActive).copyWith(dropoffAutoPickDestination: false);
    }
  }

  /// Refreshes the credit balance shown in the profile screen.
  /// Called after every successful credit spend so the balance is always current.
  void _refreshBalance() {
    unawaited(ref.read(profileNotifierProvider.notifier).refreshBalance());
  }

  void _bindSocketRouteListeners(int routeId) {
    final socket = ref.read(socketServiceProvider);
    socket.off('route:new_report');
    socket.off('route:report_confirmed');
    socket.off('route:report_resolved');

    socket.on('route:new_report', (_) => unawaited(_reloadReports()));
    socket.on('route:report_confirmed', (_) => unawaited(_reloadReports()));
    socket.on('route:report_resolved', (data) {
      if (data is! Map) return;

      final reportId = (data['reportId'] as num?)?.toInt();
      if (reportId != null && state is TripActive) {
        final active = state as TripActive;
        state = active.copyWith(
          reports: active.reports
              .where((r) => r.id != reportId)
              .toList(growable: false),
        );
      }

      final type = data['type'] as String? ?? '';
      if (type == 'trancon') {
        final mins = (data['duration_minutes'] as num?)?.toInt() ?? 0;
        final msg = mins > 0
            ? '${AppStrings.tranconResolvedWithDuration}$mins${AppStrings.tranconResolvedMinutes}'
            : AppStrings.tranconResolved;
        _onReportResolved?.call(msg);
      }
    });
  }

  void _startLocationBroadcast() {
    _locationSubscription?.cancel();
    _lastBroadcast = DateTime(0);

    // Use backgroundPositionStream: on Android this starts a foreground service
    // notification so the OS never kills location when the app is backgrounded.
    // On iOS this enables background location updates.
    _locationSubscription =
        LocationService.backgroundPositionStream.listen((pos) async {
      if (state is! TripActive) return;

      _lastGpsAt = DateTime.now();

      // Update UI position immediately on every GPS fix for smooth movement.
      // This makes the bus icon move in real-time without waiting for the backend.
      state = (state as TripActive).copyWith(
        trip: (state as TripActive).trip.copyWith(
          currentLatitude: pos.latitude,
          currentLongitude: pos.longitude,
        ),
      );

      // Throttle backend + socket updates to ~30s — the stream fires on every
      // GPS fix (distanceFilter: 10m), but we don't need to hit the server that often.
      final now = DateTime.now();
      if (now.difference(_lastBroadcast).inSeconds < 28) return;
      _lastBroadcast = now;

      final updateResult = await ref.read(tripsRepositoryProvider).updateLocation(<String, dynamic>{
        'latitude': pos.latitude,
        'longitude': pos.longitude,
      });

      if (updateResult is Success<int> && state is TripActive) {
        ref.read(socketServiceProvider).sendLocation(pos.latitude, pos.longitude);
        // Only update credits — lat/lng already set above.
        state = (state as TripActive).copyWith(
          trip: (state as TripActive).trip.copyWith(
            creditsEarned: updateResult.data,
          ),
        );
      }
    });

    _startGpsCheck();
  }

  void _startGpsCheck() {
    _gpsCheckTimer?.cancel();
    _gpsCheckTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (state is! TripActive) return;
      final lost = DateTime.now().difference(_lastGpsAt).inSeconds > 60;
      final current = state as TripActive;
      if (current.gpsLost != lost) {
        state = current.copyWith(gpsLost: lost);
      }
    });
  }

  void _startOccupancyPolling(int routeId) {
    _occupancyPollTimer?.cancel();

    Future<void> fetch() async {
      final result = await ref.read(reportsRepositoryProvider).getOccupancy(routeId);
      if (result is Success<String?> && state is TripActive) {
        state = (state as TripActive).copyWith(occupancyState: result.data);
      }
    }

    fetch();
    _occupancyPollTimer = Timer.periodic(const Duration(minutes: 2), (_) => fetch());
  }

  void _startMonitors(TripActive activeState, int? destinationStopId) {
    _disposeMonitorsOnly();

    final authState = ref.read(authNotifierProvider);
    final isPremium = authState is Authenticated &&
        (authState.user.hasActivePremium || authState.user.role == 'admin');
    final prefs = authState is Authenticated ? authState.user.notificationPrefs : null;
    final boardingAlertsEnabled = prefs?.boardingAlerts == true;

    if (destinationStopId != null) {
      Stop? destination;
      for (final stop in activeState.stops) {
        if (stop.id == destinationStopId) {
          destination = stop;
          break;
        }
      }
      if (destination != null) {
        if (isPremium) {
          _startDropoffMonitor(destination, activeState.stops);
        } else if (boardingAlertsEnabled) {
          // User already agreed to pay in a previous trip — charge and activate
          // automatically without showing the confirmation dialog.
          _pendingDropoffDestination = destination;
          unawaited(activateDropoffAlerts(autoActivated: true));
        } else {
          state = (state as TripActive).copyWith(dropoffPrompt: true);
          _pendingDropoffDestination = destination;
        }
      }
    } else if (!isPremium) {
      // No destination selected — the animated FAB guides the user.
    }

    _inactivityMonitor = InactivityMonitor(
      onAsk: () {
        if (state is TripActive) {
          state = (state as TripActive).copyWith(showInactivityModal: true);
        }
      },
      onSuspicious: () {
        if (state is TripActive) {
          state = (state as TripActive)
              .copyWith(showInactivityModal: false, showSuspiciousModal: true);
        }
        Future<void>.delayed(
          const Duration(seconds: 120),
          () => endTrip(suspiciousMinutes: 30),
        );
      },
      onAutoEnd: () {
        unawaited(endTrip());
      },
    )..start();

    _autoResolveMonitor = AutoResolveMonitor(
      reports: activeState.reports,
      onResolve: (reportId) => _resolveReport(reportId),
    )..start();

    _desvioMonitor = DesvioMonitor(
      geometry: activeState.route.geometry,
      stops: activeState.stops,
      onDesvio: (bool isRepeat) async {
        // 5 strong pulses — urgent deviation alert.
        _vibrate(
          pattern: [0, 300, 150, 300, 150, 300, 150, 300, 150, 300],
          intensities: [0, 255, 0, 255, 0, 255, 0, 255, 0, 255],
        );
        unawaited(NotificationService.showAlert(
          title: isRepeat ? AppStrings.desvioRepeatTitle : AppStrings.desvioTitle,
          body: isRepeat ? AppStrings.desvioRepeatBody : AppStrings.desvioBody,
          payload: 'desvio',
        ));
        if (state is TripActive) {
          state = (state as TripActive).copyWith(
            desvioDetected: true,
            desvioIsRepeat: isRepeat,
          );
        }
      },
      onReturnToRoute: () {
        // Bus is back on route — cancel escalation and clear all desvio UI state.
        _desvioEscalateTimer?.cancel();
        _desvioEscalateTimer = null;
        _desvioConfirmTimer?.cancel();
        _desvioConfirmTimer = null;

        if (state is TripActive) {
          state = (state as TripActive).copyWith(
            desvioDetected: false,
            desvioIsRepeat: false,
            showDesvioEscalate: false,
            desvioEscalateIsTranscon: false,
            desvioConfirmPending: false,
          );
        }

        // Close any open desvio or escalation dialogs still on screen.
        _onForceCloseDesvioDialogs?.call();

        // Auto-resolve the desvio report (records resolved_at = now as "end of episode").
        final reportId = _desvioReportId;
        if (reportId != null) {
          _desvioReportId = null;
          unawaited(_resolveReport(reportId));
        }

        // Notify screen + local notification.
        _onReturnToRoute?.call();
        unawaited(NotificationService.showAlert(
          title: AppStrings.desvioReturnedTitle,
          body: AppStrings.desvioReturnedBody,
          payload: 'desvio_returned',
        ));
      },
      osrmNearest: _osrmNearest,
      onConfirmDeviating: () {
        if (state is! TripActive) return;
        state = (state as TripActive).copyWith(desvioConfirmPending: true);
        // 3 medium pulses — "still on a different route?" reminder.
        _vibrate(
          pattern: [0, 300, 150, 300, 150, 300],
          intensities: [0, 200, 0, 200, 0, 200],
        );
        _desvioConfirmTimer?.cancel();
        _desvioConfirmTimer = Timer(const Duration(seconds: 60), () {
          _desvioMonitor?.acknowledgeConfirmation();
          if (state is TripActive) {
            state = (state as TripActive).copyWith(desvioConfirmPending: false);
          }
        });
      },
      onEscalate: (String? confirmedResponse) async {
        // After 30 min continuously off-route — ask if user is still on bus.
        // 'ruta_real' is suppressed in the monitor itself, so this only fires
        // for 'trancon' (contextual message) or no prior response (generic).
        final isTranscon = confirmedResponse == 'trancon';
        _vibrate(
          pattern: [0, 500, 200, 500, 200, 500],
          intensities: [0, 255, 0, 255, 0, 255],
        );
        unawaited(NotificationService.showAlert(
          title: isTranscon
              ? AppStrings.desvioEscalateTransconTitle
              : AppStrings.desvioEscalateTitle,
          body: isTranscon
              ? AppStrings.desvioEscalateTransconBody
              : AppStrings.desvioEscalateBody,
          payload: 'desvio_escalate',
        ));
        if (state is TripActive) {
          // Clear any pending desvio dialog — escalation supersedes it.
          state = (state as TripActive).copyWith(
            showDesvioEscalate: true,
            desvioEscalateIsTranscon: isTranscon,
            desvioDetected: false,
          );
        }
        // Auto-end after 2 min with no response + report ruta_real for admin review.
        _desvioEscalateTimer?.cancel();
        _desvioEscalateTimer = Timer(const Duration(minutes: 2), () async {
          if (state is! TripActive) return;
          final active = state as TripActive;
          final routeId = active.route.id;

          // Report ruta_real so admin can review the route.
          Position? pos;
          try {
            pos = await Geolocator.getLastKnownPosition();
          } catch (_) {}
          pos ??= await LocationService.getCurrentPosition();
          if (pos != null) {
            unawaited(ref.read(routesRepositoryProvider).reportRouteUpdate(
              routeId,
              'ruta_real',
              lat: pos.latitude,
              lng: pos.longitude,
            ));
          }

          if (state is TripActive) {
            state = (state as TripActive).copyWith(showDesvioEscalate: false);
          }
          unawaited(NotificationService.showAlert(
            title: AppStrings.desvioAutoEndTitle,
            body: AppStrings.desvioAutoEndBody,
            payload: 'desvio_auto_end',
          ));
          unawaited(endTrip());
        });
      },
    )..start();
  }

  Future<void> _resolveReport(int reportId) async {
    if (state is! TripActive) return;
    final result = await ref.read(reportsRepositoryProvider).resolve(reportId);
    if (result is Success<void>) {
      await _reloadReports();
    }
  }

  Future<void> _reloadReports() async {
    if (state is! TripActive) return;
    final routeId = (state as TripActive).route.id;

    final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(routeId);
    if (reportsResult is Success<List<Report>> && state is TripActive) {
      final updatedReports = reportsResult.data;
      state = (state as TripActive).copyWith(reports: updatedReports);
      final monitor = _autoResolveMonitor;
      if (monitor != null) {
        monitor.reports
          ..clear()
          ..addAll(updatedReports);
      }
    }
  }

  void _disposeMonitorsOnly() {
    _dropoffMonitor?.dispose();
    _dropoffMonitor = null;
    _pendingDropoffDestination = null;
    _occupancyCooldownEnd = null;
    _occupancyCredited.clear();

    _inactivityMonitor?.dispose();
    _inactivityMonitor = null;

    _autoResolveMonitor?.dispose();
    _autoResolveMonitor = null;

    _desvioMonitor?.dispose();
    _desvioMonitor = null;
    _desvioReportId = null;
  }

  void _disposeMonitorsAndTimers() {
    _locationSubscription?.cancel();
    _locationSubscription = null;
    _gpsCheckTimer?.cancel();
    _gpsCheckTimer = null;
    _occupancyPollTimer?.cancel();
    _occupancyPollTimer = null;
    _deviationReEntryTimer?.cancel();
    _deviationReEntryTimer = null;
    _deviationRouteId = null;
    _desvioEscalateTimer?.cancel();
    _desvioEscalateTimer = null;
    _desvioConfirmTimer?.cancel();
    _desvioConfirmTimer = null;
    _noDestTimer?.cancel();
    _noDestTimer = null;
    ref.read(socketServiceProvider).onReconnect = null;
    _disposeMonitorsOnly();
  }
}

final tripNotifierProvider = NotifierProvider<TripNotifier, TripState>(TripNotifier.new);
