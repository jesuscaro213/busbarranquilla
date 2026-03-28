import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_tile_caching/flutter_map_tile_caching.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:vibration/vibration.dart';

import '../../../core/data/repositories/credits_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/notification_prefs.dart';
import '../../../core/domain/models/route_activity.dart';
import '../../../core/analytics/analytics_service.dart';
import '../../../core/error/app_error.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/notifications/notification_service.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_text_styles.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/notification_opt_in_dialog.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../../auth/providers/auth_notifier.dart';
import '../../auth/providers/auth_state.dart';
import '../../profile/providers/profile_notifier.dart';
import '../providers/map_active_positions_provider.dart';
import '../providers/map_provider.dart';
import '../providers/map_state.dart';
import '../providers/waiting_bus_positions_provider.dart';
import '../providers/waiting_route_provider.dart';
import '../../planner/providers/planner_notifier.dart';
import '../../trip/providers/trip_notifier.dart';
import '../../trip/providers/trip_state.dart';
import '../widgets/active_feed_bar.dart';
import '../widgets/active_route_bus_layer.dart';
import '../widgets/bus_marker_layer.dart';
import '../widgets/plan_markers_layer.dart';
import '../widgets/quick_board_sheet.dart';
import '../widgets/report_marker_layer.dart';
import '../widgets/user_marker_layer.dart';

class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  final MapController _mapController = MapController();
  StreamSubscription<Position>? _positionSubscription;
  LatLng? _livePosition;
  bool _followUser = true;
  BusRoute? _waitingRoute;
  int _nearbyBusCount = 0;
  bool _alertActive = false;
  bool _alertLoading = false;
  Timer? _busCountTimer;

  // Waiting mode state
  Timer? _waitingPollTimer;
  bool _waitingPolled = false;
  int? _waitingEtaMinutes;    // null = no buses / can't calculate
  double? _waitingDistanceM;  // distance in meters to closest approaching bus
  bool _waitingBusNearNotified = false; // prevents repeated alerts
  // Socket-based real-time positions for the waited route (routeId → positions)
  final Map<int, List<LatLng>> _socketBusPositions = <int, List<LatLng>>{};

  // ── Auto-boarding — Mecanismo 1 (señal de otro pasajero) ──────────────────
  DateTime? _autoboardProximityStart; // cuando usuario llegó a <40m del ancla
  LatLng? _autoboardUserPosAtStart; // GPS usuario en T=0 de proximidad
  LatLng? _autoboardBusPosAtStart; // GPS ancla en T=0
  int? _autoboardAnchorTripId; // tripId siendo monitoreado

  // ── Auto-boarding — Mecanismo 2 y 3 (GPS propio sobre geometría) ──────────
  LatLng? _waitingStartPosition; // GPS al activar modo espera
  DateTime? _offRouteStart; // inicio de período "fuera de ruta" (M3)
  Timer? _gpsMovementTimer; // tick cada 30s para M2 y M3
  LatLng? _userPosAtOffRouteStart; // GPS usuario cuando _offRouteStart se asignó
  bool _farAlertShown = false; // evita mostrar el diálogo M5 repetidamente
  bool _cogiOtroShown = false; // evita mostrar el diálogo de "¿Cogiste otro bus?" dos veces
  ProviderSubscription<BusRoute?>? _waitingRouteSub;

  // ── Compartido ────────────────────────────────────────────────────────────
  bool _autoboardPending = false; // bloquea doble disparo
  Timer? _autoboardUndoTimer; // ventana de 8s para deshacer

  @override
  void initState() {
    super.initState();
    _waitingRouteSub = ref.listenManual<BusRoute?>(selectedWaitingRouteProvider, (prev, next) {
      if (next == null) {
        _stopWaiting();
      } else if (next.id != prev?.id) {
        _startWaiting(next);
      }
    });
    Future<void>(() async {
      final token = await ref.read(secureStorageProvider).readToken();
      if (!mounted) return;
      if (token != null && token.isNotEmpty) {
        ref.read(socketServiceProvider).connect(token);
      }

      await ref.read(mapNotifierProvider.notifier).initialize();
      if (!mounted) return;
      _startPositionStream();

      // Register waiting-mode socket handlers once. They guard internally
      // (return early when no route is being waited for) so they're safe to
      // leave registered at all times without interfering with map_provider.
      ref.read(socketServiceProvider).on('bus:location', _onSocketBusLocation);
      ref.read(socketServiceProvider).on('bus:left', _onSocketBusLeft);

      // If waiting mode was already active before MapScreen mounted
      // (e.g. started from PlannerScreen or BoardingScreen), begin polling now.
      // ref.listen only fires on future changes, so we must bootstrap here.
      final pendingWait = ref.read(selectedWaitingRouteProvider);
      if (pendingWait != null) _startWaiting(pendingWait);
    });
  }

  void _startPositionStream({bool background = false}) {
    _positionSubscription?.cancel();
    final stream = background
        ? LocationService.backgroundPositionStream
        : Geolocator.getPositionStream(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 10,
            ),
          );
    _positionSubscription = stream.listen((pos) {
      if (!mounted) return;
      final newPos = LatLng(pos.latitude, pos.longitude);
      setState(() => _livePosition = newPos);
      if (_followUser) {
        try {
          _mapController.move(newPos, _mapController.camera.zoom);
        } catch (_) {}
      }
    });
  }

  @override
  void dispose() {
    _waitingPollTimer?.cancel();
    _autoboardUndoTimer?.cancel();
    _gpsMovementTimer?.cancel();
    _busCountTimer?.cancel();
    _waitingRouteSub?.close();
    _positionSubscription?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  // ── Waiting mode helpers ────────────────────────────────────────────────────

  void _startWaiting(BusRoute route) {
    _waitingPollTimer?.cancel();
    _busCountTimer?.cancel();
    _busCountTimer = null;
    setState(() {
      _waitingRoute = route;
      _waitingPolled = false;
      _waitingEtaMinutes = null;
      _waitingDistanceM = null;
      _waitingBusNearNotified = false;
      _nearbyBusCount = 0;
      _alertActive = false;
      _alertLoading = false;
    });
    _socketBusPositions.clear();

    _resetM1Tracking();
    _autoboardPending = false;
    _autoboardUndoTimer?.cancel();
    _waitingStartPosition = _livePosition;
    _userPosAtOffRouteStart = null;
    _cogiOtroShown = false;
    _farAlertShown = false;
    _startGpsMovementMonitor(route);
    // Switch to a background-capable position stream so the GPS movement timers
    // (M1–M5) keep firing even when the user locks the screen while waiting.
    _startPositionStream(background: true);
    _startBusCountPolling(route.id);

    // Initial fetch + fallback poll every 60s (catches socket gaps / reconnects).
    // The socket listener is registered once in initState and guards internally.
    _pollWaitingRoute(route);
    _waitingPollTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      final current = ref.read(selectedWaitingRouteProvider);
      if (current != null) _pollWaitingRoute(current);
    });
  }

  void _stopWaiting() {
    _waitingPollTimer?.cancel();
    _waitingPollTimer = null;
    // Do NOT call off('bus:location') — map_provider.dart also uses that event
    // for live bus markers. _onSocketBusLocation already no-ops when waitingRoute==null.
    ref.read(waitingBusPositionsProvider.notifier).state = const <LatLng>[];
    _socketBusPositions.clear();

    _resetM1Tracking();
    _autoboardPending = false;
    _autoboardUndoTimer?.cancel();
    _gpsMovementTimer?.cancel();
    _waitingStartPosition = null;
    _offRouteStart = null;
    _userPosAtOffRouteStart = null;
    _cogiOtroShown = false;
    _farAlertShown = false;
    _stopBusCountPolling();
    if (_waitingRoute != null) {
      unawaited(ref.read(routesRepositoryProvider)
          .unsubscribeWaitingAlert(_waitingRoute!.id));
    }
    _waitingRoute = null;
    // Revert to the regular foreground stream — no need for background updates
    // once the user is no longer in waiting mode.
    _startPositionStream();

    if (mounted) {
      setState(() {
        _waitingPolled = false;
        _waitingEtaMinutes = null;
        _waitingDistanceM = null;
      });
    }
  }

  void _startBusCountPolling(int routeId) {
    _fetchBusCount(routeId);
    _busCountTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _fetchBusCount(routeId);
    });
  }

  void _stopBusCountPolling() {
    _busCountTimer?.cancel();
    _busCountTimer = null;
    if (mounted) setState(() { _nearbyBusCount = 0; _alertActive = false; });
  }

  Future<void> _fetchBusCount(int routeId) async {
    final mapState = ref.read(mapNotifierProvider);
    if (mapState is! MapReady || mapState.userPosition == null) return;
    final pos = mapState.userPosition!;
    final result = await ref.read(routesRepositoryProvider).getNearbyBusCount(
      routeId: routeId,
      userLat: pos.latitude,
      userLng: pos.longitude,
    );
    if (result is Success<int> && mounted) {
      setState(() => _nearbyBusCount = result.data);
    }
  }

  Future<void> _activateWaitingAlert(int routeId) async {
    final mapState = ref.read(mapNotifierProvider);
    if (mapState is! MapReady || mapState.userPosition == null) return;
    final pos = mapState.userPosition!;
    setState(() => _alertLoading = true);
    final result = await ref.read(routesRepositoryProvider).subscribeWaitingAlert(
      routeId: routeId,
      userLat: pos.latitude,
      userLng: pos.longitude,
    );
    if (!mounted) return;
    if (result is Success<void>) {
      setState(() { _alertActive = true; _alertLoading = false; });
    } else {
      setState(() => _alertLoading = false);
      final err = (result as Failure<void>).error;
      final isInsufficient = err is ServerError && err.statusCode == 402;
      AppSnackbar.show(
        context,
        isInsufficient
            ? AppStrings.waitingAlertInsufficientCredits
            : err.message,
        SnackbarType.error,
      );
    }
  }

  void _resetM1Tracking() {
    _autoboardProximityStart = null;
    _autoboardUserPosAtStart = null;
    _autoboardBusPosAtStart = null;
    _autoboardAnchorTripId = null;
  }

  void _checkAutoBoarding(BusRoute route) {
    if (_autoboardPending) return;
    if (ref.read(tripNotifierProvider) is! TripIdle) return;

    final userPos = _livePosition;
    if (userPos == null || _socketBusPositions.isEmpty) {
      _resetM1Tracking();
      return;
    }

    int? closestTripId;
    LatLng? closestBusPos;
    double closestDist = double.infinity;
    for (final entry in _socketBusPositions.entries) {
      if (entry.key < 0 || entry.value.isEmpty) continue;
      final pos = entry.value.first;
      final d = LocationService.distanceMeters(
        userPos.latitude,
        userPos.longitude,
        pos.latitude,
        pos.longitude,
      );
      if (d < closestDist) {
        closestDist = d;
        closestTripId = entry.key;
        closestBusPos = pos;
      }
    }

    if (closestTripId == null || closestBusPos == null || closestDist >= 40) {
      _resetM1Tracking();
      return;
    }

    if (_autoboardAnchorTripId != null && _autoboardAnchorTripId != closestTripId) {
      _resetM1Tracking();
    }

    if (_autoboardProximityStart == null) {
      _autoboardProximityStart = DateTime.now();
      _autoboardUserPosAtStart = userPos;
      _autoboardBusPosAtStart = closestBusPos;
      _autoboardAnchorTripId = closestTripId;
      return;
    }

    if (!_socketBusPositions.containsKey(_autoboardAnchorTripId)) {
      _resetM1Tracking();
      return;
    }

    final elapsed = DateTime.now().difference(_autoboardProximityStart!);
    if (elapsed < const Duration(minutes: 3)) return;

    final userMoved = LocationService.distanceMeters(
      _autoboardUserPosAtStart!.latitude,
      _autoboardUserPosAtStart!.longitude,
      userPos.latitude,
      userPos.longitude,
    );
    final busMoved = LocationService.distanceMeters(
      _autoboardBusPosAtStart!.latitude,
      _autoboardBusPosAtStart!.longitude,
      closestBusPos.latitude,
      closestBusPos.longitude,
    );

    if (userMoved >= 100 && busMoved >= 100) {
      _triggerAutoBoarding(route);
    }
  }

  void _startGpsMovementMonitor(BusRoute route) {
    _gpsMovementTimer?.cancel();
    _offRouteStart = null;

    if (route.geometry.isEmpty) return;

    _gpsMovementTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (_autoboardPending || _cogiOtroShown) return;
      if (ref.read(tripNotifierProvider) is! TripIdle) return;

      final userPos = _livePosition;
      final startPos = _waitingStartPosition;
      if (userPos == null || startPos == null) return;

      final distFromStart = LocationService.distanceMeters(
        startPos.latitude,
        startPos.longitude,
        userPos.latitude,
        userPos.longitude,
      );

      if (distFromStart >= 100) {
        _cogiOtroShown = true;
        if (mounted) {
          unawaited(_vibrateWaitingAlert());
          _showCogiotroDialog(route, userPos);
        }
        return;
      }

      final distToRoute = _distToRouteGeometry(userPos, route.geometry);

      if (distToRoute > 300) {
        if (_offRouteStart == null) {
          _offRouteStart = DateTime.now();
          _userPosAtOffRouteStart = userPos;
          return;
        }

        final offRouteElapsed = DateTime.now().difference(_offRouteStart!);

        final distFromOffRouteStart = _userPosAtOffRouteStart != null
            ? LocationService.distanceMeters(
                _userPosAtOffRouteStart!.latitude,
                _userPosAtOffRouteStart!.longitude,
                userPos.latitude,
                userPos.longitude,
              )
            : distFromStart;

        final elapsedSec = offRouteElapsed.inSeconds.toDouble();
        final speedKmh =
            elapsedSec > 0 ? (distFromOffRouteStart / elapsedSec) * 3.6 : 0.0;

        if (speedKmh >= 10 && offRouteElapsed >= const Duration(minutes: 4)) {
          _gpsMovementTimer?.cancel();
          if (mounted) {
            ref.read(selectedWaitingRouteProvider.notifier).state = null;
            AppSnackbar.show(context, AppStrings.waitingAutoCancelled, SnackbarType.info);
          }
          return;
        }

        if (speedKmh < 10 &&
            distFromStart > 1000 &&
            offRouteElapsed >= const Duration(minutes: 5) &&
            !_farAlertShown) {
          _farAlertShown = true;
          _offRouteStart = null;
          _userPosAtOffRouteStart = null;
          if (mounted) _showFarOffRouteDialog();
          return;
        }
      } else {
        _offRouteStart = null;
        _userPosAtOffRouteStart = null;
        _farAlertShown = false;
      }
    });
  }

  void _triggerAutoBoarding(BusRoute route) {
    if (_autoboardPending) return;
    _autoboardPending = true;
    _resetM1Tracking();
    _gpsMovementTimer?.cancel();
    _autoboardUndoTimer?.cancel();

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('${AppStrings.autoboardDetected} · ${route.code}'),
        duration: const Duration(seconds: 8),
        action: SnackBarAction(
          label: AppStrings.autoboardUndo,
          onPressed: () {
            _autoboardUndoTimer?.cancel();
            _autoboardPending = false;
            if (mounted) {
              ScaffoldMessenger.of(context).hideCurrentSnackBar();
              AppSnackbar.show(context, AppStrings.autoboardCancelled, SnackbarType.info);
            }
          },
        ),
      ),
    );

    _autoboardUndoTimer = Timer(const Duration(seconds: 8), () async {
      if (!_autoboardPending) return;
      _autoboardPending = false;

      if (!mounted) return;
      if (ref.read(tripNotifierProvider) is! TripIdle) return;

      ref.read(selectedWaitingRouteProvider.notifier).state = null;

      await ref.read(tripNotifierProvider.notifier).startTrip(route.id);

      if (!mounted) return;
      final newState = ref.read(tripNotifierProvider);
      if (newState is TripActive) {
        context.go('/trip');
      } else if (newState is TripError) {
        AppSnackbar.show(context, newState.message, SnackbarType.error);
      }
    });
  }

  void _showFarOffRouteDialog() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.waitingFarOffRouteTitle),
        content: const Text(AppStrings.waitingFarOffRouteBody),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              setState(() => _farAlertShown = false);
            },
            child: const Text(AppStrings.waitingFarOffRouteContinue),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(selectedWaitingRouteProvider.notifier).state = null;
            },
            child: const Text(AppStrings.waitingFarOffRouteCancel),
          ),
        ],
      ),
    );
  }

  void _showCogiotroDialog(BusRoute route, LatLng currentPos) {
    showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.waitingCogiotroTitle),
        content: Text(
          '${AppStrings.waitingCogiotroBody} ${route.code}?',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              if (mounted) {
                setState(() {
                  _waitingStartPosition = currentPos;
                  _cogiOtroShown = false;
                });
              }
            },
            child: const Text(AppStrings.waitingCogiotroNo),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              if (mounted) setState(() => _cogiOtroShown = false);
              ref.read(selectedWaitingRouteProvider.notifier).state = null;
              if (mounted) {
                showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  shape: const RoundedRectangleBorder(
                    borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                  ),
                  builder: (_) => const QuickBoardSheet(),
                );
              }
            },
            child: const Text(AppStrings.waitingCogiotroYes),
          ),
        ],
      ),
    ).then((_) {
      if (mounted && _cogiOtroShown) {
        setState(() {
          _waitingStartPosition = currentPos;
          _cogiOtroShown = false;
        });
      }
    });
  }

  void _onSocketBusLocation(dynamic data) {
    if (!mounted) return;
    final waitingRoute = ref.read(selectedWaitingRouteProvider);
    if (waitingRoute == null) return;

    final map = data as Map<dynamic, dynamic>;
    final routeId = map['routeId'] as int?;
    if (routeId != waitingRoute.id) return; // different route — ignore

    final lat = (map['latitude'] as num?)?.toDouble();
    final lng = (map['longitude'] as num?)?.toDouble();
    if (lat == null || lng == null) return;

    final tripId = (map['tripId'] as int?) ?? 0;
    final newPos = LatLng(lat, lng);

    // Update position for this specific bus (keyed by tripId) and recalculate
    _socketBusPositions[tripId] = <LatLng>[newPos];
    _updateWaitingState(waitingRoute);
  }

  void _onSocketBusLeft(dynamic data) {
    if (!mounted) return;
    final waitingRoute = ref.read(selectedWaitingRouteProvider);
    if (waitingRoute == null) return;

    final map = data as Map<dynamic, dynamic>;
    final routeId = map['routeId'] as int?;
    if (routeId != waitingRoute.id) return;

    final tripId = map['tripId'] as int?;
    if (tripId == null) return;

    // Remove this passenger — they got off. Others on the same route remain.
    if (_socketBusPositions.remove(tripId) != null) {
      _updateWaitingState(waitingRoute);
    }
  }

  Future<void> _pollWaitingRoute(BusRoute route) async {
    final result = await ref.read(routesRepositoryProvider).getActivity(route.id);
    // Guard: widget disposed OR user already cancelled / switched to a different route
    if (!mounted) return;
    if (ref.read(selectedWaitingRouteProvider)?.id != route.id) return;

    final List<LatLng> positions;
    if (result is Success<RouteActivity>) {
      positions = result.data.activePositions;
    } else {
      positions = const <LatLng>[];
    }

    // Seed socket map with positions from HTTP (covers buses that started
    // before we began listening). Negative keys = poll-sourced; positive = socket.
    // Clear old negative keys first to remove departed buses from previous poll.
    _socketBusPositions.removeWhere((key, _) => key < 0);
    for (int i = 0; i < positions.length; i++) {
      _socketBusPositions[-(i + 1)] = <LatLng>[positions[i]];
    }

    _updateWaitingState(route);
  }

  // Central update: recalculates ETA/distance from current positions and
  // fires notification if needed. Called from both socket handler and poll.
  void _updateWaitingState(BusRoute route) {
    final allPositions = _socketBusPositions.values
        .expand((list) => list)
        .toList(growable: false);

    // Cluster nearby passengers into one marker per physical bus.
    // 10 people on the same bus show as 1 icon, not 10.
    final clustered = _clusterPositions(allPositions, 50);
    ref.read(waitingBusPositionsProvider.notifier).state = clustered;

    int? eta;
    double? distM;
    final userPos = _livePosition;
    if (clustered.isNotEmpty && userPos != null && route.geometry.isNotEmpty) {
      final r = _calculateEtaAndDistance(clustered, userPos, route.geometry);
      eta = r.eta?.round();
      distM = r.distanceMeters;
    }

    if (!_waitingBusNearNotified && eta != null && eta <= 2) {
      _waitingBusNearNotified = true;
      final distText = distM != null ? _formatDistance(distM) : '';
      final etaText = eta == 0
          ? AppStrings.waitingEtaArriving
          : '~$eta ${AppStrings.waitingEtaMinutes}';
      // isFirstPoll: true only when this fires before _waitingPolled is set —
      // meaning the bus was already nearby when the user first opened waiting mode.
      unawaited(_handleBusNearbyNotification(
        route,
        '$etaText${distText.isNotEmpty ? ' · $distText' : ''}',
        distanceMeters: distM ?? double.infinity,
        isFirstPoll: !_waitingPolled,
      ));
    }

    _checkAutoBoarding(route);

    if (mounted) {
      setState(() {
        _waitingPolled = true;
        _waitingEtaMinutes = eta;
        _waitingDistanceM = distM;
      });
    }
  }

  Future<void> _handleBusNearbyNotification(
    BusRoute route,
    String etaAndDist, {
    double distanceMeters = double.infinity,
    bool isFirstPoll = false,
  }) async {
    final authState = ref.read(authNotifierProvider);
    if (authState is! Authenticated) return;

    final isPremium = authState.user.hasActivePremium ||
        authState.user.role == 'admin' ||
        (authState.user.trialExpiresAt?.isAfter(DateTime.now()) ?? false);

    // Premium and trial users always receive bus-nearby notifications —
    // no opt-in dialog, no preference check, no credit charge.
    if (!isPremium) {
      final NotificationPrefs? prefs = authState.user.notificationPrefs;

      // ── First time: show opt-in dialog ──────────────────────────────
      if (prefs?.busNearby == null) {
        if (!mounted) return;
        final enabled = await showNotificationOptInDialog(
          context,
          type: NotificationOptInType.busNearby,
        );
        if (!mounted) return;
        final merged = <String, dynamic>{
          ...?prefs?.toJson(),
          'bus_nearby': enabled,
        };
        await ref.read(authNotifierProvider.notifier).updateNotificationPrefs(merged);
        if (!enabled) return;
      }

      // ── Preference explicitly disabled ────────────────────────────
      if (prefs?.busNearby == false) return;
    }

    // ── Charge credits for free users ────────────────────────────────────
    // Reduced price (1 credit) when the bus was already within 1 km the moment
    // the user opened the waiting view (isFirstPoll == true). Full price (3)
    // when the bus approached later — the user benefited from the full waiting
    // session before the alert fired.
    if (!isPremium) {
      final creditAmount = (isFirstPoll && distanceMeters < 1000) ? 1 : 3;
      final result = await ref.read(creditsRepositoryProvider).spend(
        <String, dynamic>{
          'amount': creditAmount,
          'description': AppStrings.notifBusNearbyChargeDescription,
        },
      );
      if (result is Failure) {
        if (mounted) {
          AppSnackbar.show(
            context,
            AppStrings.notifBusNearbyNoCredits,
            SnackbarType.error,
          );
        }
        return;
      }
      // Keep the profile balance in sync after charging.
      unawaited(ref.read(profileNotifierProvider.notifier).refreshBalance());
    }

    // ── Show notification ────────────────────────────────────────────────
    unawaited(NotificationService.showAlert(
      title: '🚌 ${AppStrings.waitingBusNearTitle}',
      body: '${route.code} · ${route.name} — $etaAndDist',
    ));
    unawaited(_vibrateWaitingAlert());
  }

  Future<void> _vibrateWaitingAlert() async {
    final hasVibrator = (await Vibration.hasVibrator()) != false;
    if (hasVibrator) {
      unawaited(Vibration.vibrate(pattern: <int>[0, 400, 200, 400]));
    } else {
      // Emulator fallback.
      await HapticFeedback.heavyImpact();
      await Future<void>.delayed(const Duration(milliseconds: 200));
      await HapticFeedback.heavyImpact();
    }
  }

  static double _distToRouteGeometry(LatLng point, List<LatLng> geometry) {
    if (geometry.isEmpty) return double.infinity;
    double minDist = double.infinity;
    for (final geoPoint in geometry) {
      final d = LocationService.distanceMeters(
        point.latitude,
        point.longitude,
        geoPoint.latitude,
        geoPoint.longitude,
      );
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Groups positions within [thresholdMeters] into one centroid per cluster.
  // Passengers on the same physical bus become a single map marker.
  static List<LatLng> _clusterPositions(List<LatLng> positions, double thresholdMeters) {
    final clusters = <List<LatLng>>[];
    for (final pos in positions) {
      bool merged = false;
      for (final cluster in clusters) {
        final c = _centroid(cluster);
        if (LocationService.distanceMeters(
              pos.latitude, pos.longitude, c.latitude, c.longitude) <=
            thresholdMeters) {
          cluster.add(pos);
          merged = true;
          break;
        }
      }
      if (!merged) clusters.add(<LatLng>[pos]);
    }
    return clusters.map(_centroid).toList(growable: false);
  }

  static LatLng _centroid(List<LatLng> pts) {
    final lat = pts.map((p) => p.latitude).reduce((a, b) => a + b) / pts.length;
    final lng = pts.map((p) => p.longitude).reduce((a, b) => a + b) / pts.length;
    return LatLng(lat, lng);
  }

  // Project point onto polyline → find nearest vertex index
  static int _nearestVertex(LatLng point, List<LatLng> geometry) {
    int best = 0;
    double bestDist = double.infinity;
    for (int i = 0; i < geometry.length; i++) {
      final d = LocationService.distanceMeters(
        point.latitude, point.longitude,
        geometry[i].latitude, geometry[i].longitude,
      );
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Cumulative polyline distance from index [from] to [to]
  static double _polylineDistance(List<LatLng> geometry, int from, int to) {
    double d = 0;
    for (int i = from; i < to && i + 1 < geometry.length; i++) {
      d += LocationService.distanceMeters(
        geometry[i].latitude, geometry[i].longitude,
        geometry[i + 1].latitude, geometry[i + 1].longitude,
      );
    }
    return d;
  }

  // Returns ETA (minutes) + distance (meters) to the closest approaching bus.
  // Returns nulls if no bus is ahead of the user on the route.
  static ({double? eta, double? distanceMeters}) _calculateEtaAndDistance(
    List<LatLng> buses,
    LatLng user,
    List<LatLng> geometry,
  ) {
    final userIdx = _nearestVertex(user, geometry);
    double? minDist;
    for (final bus in buses) {
      final busIdx = _nearestVertex(bus, geometry);
      if (busIdx <= userIdx) {
        // Bus is behind or at the user's position — it will reach the user
        final d = _polylineDistance(geometry, busIdx, userIdx);
        if (minDist == null || d < minDist) minDist = d;
      }
    }
    if (minDist == null) return (eta: null, distanceMeters: null);
    const avgSpeedMs = 25000.0 / 3600.0; // 25 km/h in m/s
    return (eta: minDist / avgSpeedMs / 60.0, distanceMeters: minDist);
  }

  static String _formatDistance(double meters) {
    if (meters >= 1000) {
      final km = meters / 1000;
      return '${km.toStringAsFixed(km < 10 ? 1 : 0)} km';
    }
    return '${meters.round()} m';
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final mapState = ref.watch(mapNotifierProvider);

    if (mapState is MapLoading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (mapState is MapError) {
      return ErrorView(
        message: mapState.message,
        onRetry: () => ref.read(mapNotifierProvider.notifier).retry(),
      );
    }

    final ready = mapState as MapReady;
    final selectedRoute = ref.watch(selectedFeedRouteProvider);
    final waitingRoute = ref.watch(selectedWaitingRouteProvider);
    final TripActive? activeTrip = ref.watch(tripNotifierProvider.select(
      (s) => s is TripActive ? s : null,
    ));
    final isOnTrip = activeTrip != null;
    final activeTripGeometry = activeTrip?.route.geometry ?? const <LatLng>[];
    final destinationStop = activeTrip != null && activeTrip.trip.destinationStopId != null
        ? activeTrip.stops.where((s) => s.id == activeTrip.trip.destinationStopId).firstOrNull
        : null;

    // Live GPS position takes priority; fallback to map state for initial render.
    final center = _livePosition ?? ready.userPosition ?? const LatLng(10.9685, -74.7813);

    // When on a trip, use the trip state position (updated on every GPS fix).
    // Also filter own trip from BusMarkerLayer to avoid duplicate icon.
    int? ownTripId;
    LatLng? tripPosition;
    if (activeTrip != null) {
      ownTripId = activeTrip.trip.id;
      final lat = activeTrip.trip.currentLatitude;
      final lng = activeTrip.trip.currentLongitude;
      if (lat != null && lng != null) {
        tripPosition = LatLng(lat, lng);
      }
    }
    // For the user marker: trip position > live GPS > map state position.
    final userMarkerPosition = tripPosition ?? _livePosition ?? ready.userPosition;
    final otherBuses = ownTripId != null
        ? ready.buses.where((b) => b.id != ownTripId).toList(growable: false)
        : ready.buses;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 15,
              // Detect manual pan — disable auto-follow so the map stops chasing GPS.
              onPositionChanged: (_, hasGesture) {
                if (hasGesture && _followUser) {
                  setState(() => _followUser = false);
                }
              },
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: AppStrings.tripTileUrl,
                subdomains: AppStrings.osmTileSubdomains,
                userAgentPackageName: AppStrings.osmUserAgent,
                keepBuffer: 3,
                panBuffer: 1,
                tileProvider: const FMTCStore('mapTiles').getTileProvider(
                  settings: FMTCTileProviderSettings(
                    cachedValidDuration: const Duration(days: 30),
                  ),
                ),
              ),
              // Feed route (when no active trip and not in waiting mode)
              if (!isOnTrip && selectedRoute != null && selectedRoute.geometry.isNotEmpty && waitingRoute == null)
                RoutePolylineLayer(
                  points: selectedRoute.geometry,
                  turnaroundIdx: selectedRoute.turnaroundIdx,
                ),
              // Waiting route polyline
              if (!isOnTrip && waitingRoute != null && waitingRoute.geometry.isNotEmpty)
                RoutePolylineLayer(
                  points: waitingRoute.geometry,
                  turnaroundIdx: waitingRoute.turnaroundIdx,
                ),
              // Active trip route — always visible during a trip
              if (activeTripGeometry.isNotEmpty)
                RoutePolylineLayer(
                  points: activeTripGeometry,
                  color: AppColors.primary.withValues(alpha: 0.8),
                  strokeWidth: 5,
                  turnaroundIdx: activeTrip?.route.turnaroundIdx,
                  regresoColor: AppColors.routeC.withValues(alpha: 0.8),
                ),
              // Destination stop marker
              if (destinationStop != null)
                MarkerLayer(
                  markers: <Marker>[
                    Marker(
                      point: LatLng(destinationStop.latitude, destinationStop.longitude),
                      width: 36,
                      height: 36,
                      child: const Icon(Icons.flag, color: AppColors.success, size: 32),
                    ),
                  ],
                ),
              const PlanMarkersLayer(),
              ReportMarkerLayer(
                reports: ready.reports,
                activeTripRouteId: ready.activeTripRouteId,
                onConfirm: (reportId) => ref.read(mapNotifierProvider.notifier).confirmReport(reportId),
              ),
              BusMarkerLayer(buses: otherBuses),
              if (selectedRoute != null && waitingRoute == null)
                ActiveRouteBusLayer(routeId: selectedRoute.id),
              if (userMarkerPosition != null)
                UserMarkerLayer(position: userMarkerPosition, isOnTrip: isOnTrip),
              Consumer(
                builder: (context, ref, _) {
                  // Waiting mode → dedicated provider (buses de la ruta esperada)
                  // Planner mode → shared provider (buses de la ruta seleccionada)
                  final isWaiting = ref.watch(selectedWaitingRouteProvider) != null;
                  final positions = isWaiting
                      ? ref.watch(waitingBusPositionsProvider)
                      : ref.watch(mapActivePositionsProvider);
                  if (positions.isEmpty) return const SizedBox.shrink();
                  return MarkerLayer(
                    markers: positions.map((pos) => Marker(
                      point: pos,
                      width: 40,
                      height: 40,
                      child: Container(
                        width: 40,
                        height: 40,
                        decoration: const BoxDecoration(
                          color: AppColors.accent,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.directions_bus_filled, color: Colors.white, size: 24),
                      ),
                    )).toList(),
                  );
                },
              ),
            ],
          ),

          // Re-center button — appears after manual pan, re-enables auto-follow.
          if (!_followUser && _livePosition != null)
            Positioned(
              right: 12,
              bottom: 90,
              child: FloatingActionButton.small(
                heroTag: 'recenter_map',
                backgroundColor: Colors.white,
                onPressed: () {
                  setState(() => _followUser = true);
                  try {
                    _mapController.move(_livePosition!, _mapController.camera.zoom);
                  } catch (_) {}
                },
                child: const Icon(Icons.my_location, color: AppColors.primary),
              ),
            ),

          // Waiting actions (top) — info + cancel only
          if (!isOnTrip && waitingRoute != null)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: _WaitingActionBar(
                    route: waitingRoute,
                    alertActive: _alertActive,
                    onCancel: () {
                      final returnPath = ref.read(waitingReturnPathProvider);
                      ref.read(selectedWaitingRouteProvider.notifier).state = null;
                      ref.read(waitingReturnPathProvider.notifier).state = null;
                      if (returnPath != null) context.go(returnPath);
                    },
                  ),
                ),
              ),
            ),

          // Waiting ETA + boarding FAB — stacked above banner
          if (!isOnTrip && waitingRoute != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 12,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(32, 0, 32, 12),
                    child: SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: FilledButton.icon(
                        onPressed: () {
                          final dest = ref.read(lastSelectedDestProvider);
                          final destParam = dest != null
                              ? '&destLat=${dest.lat}&destLng=${dest.lng}'
                              : '';
                          context.push('/trip/confirm?routeId=${waitingRoute.id}$destParam');
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.success,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                          elevation: 8,
                        ),
                        icon: const Icon(Icons.directions_bus, size: 22),
                        label: const Text(
                          AppStrings.boardedWaitingButton,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ),
                  ),
                  _WaitingBanner(
                    route: waitingRoute,
                    polled: _waitingPolled,
                    etaMinutes: _waitingEtaMinutes,
                    distanceMeters: _waitingDistanceM,
                    nearbyBusCount: _nearbyBusCount,
                    alertActive: _alertActive,
                    alertLoading: _alertLoading,
                    onActivateAlert: _alertLoading
                        ? null
                        : () => _activateWaitingAlert(waitingRoute.id),
                  ),
                ],
              ),
            ),
          // Active feed bar — hidden during waiting and trip
          if (!isOnTrip && waitingRoute == null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 12,
              child: ActiveFeedBar(
                activeFeedRoutes: ready.activeFeedRoutes,
                onSelectRoute: (route) {
                  ref.read(selectedFeedRouteProvider.notifier).state = route;
                },
              ),
            ),
        ],
      ),
      // FAB hidden during active trip or while waiting (waiting bar has its own "¡Ya me subí!" button)
      floatingActionButton: (isOnTrip || waitingRoute != null)
          ? null
          : FloatingActionButton.extended(
              onPressed: () {
                unawaited(AnalyticsService.boardingFlowStarted());
                context.go('/trip/boarding');
              },
              backgroundColor: AppColors.primary,
              label: const Text(AppStrings.mapBoardFab),
              icon: const Icon(Icons.directions_bus),
            ),
    );
  }
}

// ── Waiting Banner ─────────────────────────────────────────────────────────────

/// ETA overlay shown on the map while waiting. Actions are in the top bar.
class _WaitingBanner extends StatelessWidget {
  final BusRoute route;
  final bool polled;
  final int? etaMinutes;
  final double? distanceMeters;
  final int nearbyBusCount;
  final bool alertActive;
  final bool alertLoading;
  final VoidCallback? onActivateAlert;

  const _WaitingBanner({
    required this.route,
    required this.polled,
    required this.etaMinutes,
    required this.distanceMeters,
    required this.nearbyBusCount,
    required this.alertActive,
    required this.alertLoading,
    required this.onActivateAlert,
  });

  String get _etaText {
    if (!polled) return AppStrings.waitingEtaSearching;
    if (etaMinutes == null) return AppStrings.waitingEtaNoData;
    if (etaMinutes == 0) return AppStrings.waitingEtaArriving;
    return '~$etaMinutes ${AppStrings.waitingEtaMinutes}';
  }

  String? get _distanceText {
    if (!polled || distanceMeters == null) return null;
    if (distanceMeters! >= 1000) {
      final km = distanceMeters! / 1000;
      return '${km.toStringAsFixed(km < 10 ? 1 : 0)} km';
    }
    return '${distanceMeters!.round()} m';
  }

  @override
  Widget build(BuildContext context) {
    final distText = _distanceText;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Material(
        elevation: 6,
        borderRadius: BorderRadius.circular(16),
        color: AppColors.primaryDark.withValues(alpha: 0.92),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  RouteCodeBadge(code: route.code),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      route.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Distance chip — shown once data is available
                  if (distText != null) ...<Widget>[
                    const Icon(Icons.straighten, color: Colors.white54, size: 13),
                    const SizedBox(width: 3),
                    Text(
                      distText,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  // ETA
                  if (!polled)
                    const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.amber),
                    )
                  else
                    const Icon(Icons.access_time, color: Colors.amber, size: 15),
                  const SizedBox(width: 4),
                  Text(
                    _etaText,
                    style: const TextStyle(
                      color: Colors.amber,
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: <Widget>[
                  Icon(
                    nearbyBusCount > 0 ? Icons.directions_bus : Icons.directions_bus_outlined,
                    size: 15,
                    color: nearbyBusCount > 0 ? AppColors.success : AppColors.textSecondary,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    nearbyBusCount == 0
                        ? AppStrings.waitingBusCount0
                        : nearbyBusCount == 1
                            ? AppStrings.waitingBusCount1
                            : AppStrings.waitingBusCountN(nearbyBusCount),
                    style: AppTextStyles.caption.copyWith(
                      color: nearbyBusCount > 0 ? AppColors.success : AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: alertActive
                    ? Container(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: <Widget>[
                            const Icon(
                              Icons.notifications_active,
                              size: 15,
                              color: AppColors.success,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              AppStrings.waitingAlertActive,
                              style: AppTextStyles.caption.copyWith(color: Colors.white),
                            ),
                          ],
                        ),
                      )
                    : AppButton.outlined(
                        label: alertLoading
                            ? AppStrings.waitingAlertActivating
                            : '${AppStrings.waitingAlertButton} · ${AppStrings.waitingAlertCost}',
                        onPressed: alertLoading ? null : onActivateAlert,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WaitingActionBar extends StatelessWidget {
  final BusRoute route;
  final bool alertActive;
  final VoidCallback onCancel;

  const _WaitingActionBar({
    required this.route,
    required this.alertActive,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 6,
      borderRadius: BorderRadius.circular(16),
      color: AppColors.primaryDark.withValues(alpha: 0.95),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Row(
          children: <Widget>[
            Icon(
              alertActive ? Icons.check_circle : Icons.notifications_active,
              color: alertActive ? AppColors.success : Colors.amber,
              size: 18,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    AppStrings.waitingActiveBar,
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    '${route.code} · ${route.name}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            FilledButton(
              onPressed: onCancel,
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white24,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                elevation: 0,
              ),
              child: const Text(AppStrings.waitingCancel, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      ),
    );
  }
}
