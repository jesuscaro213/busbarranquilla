import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/route_activity.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../providers/map_active_positions_provider.dart';
import '../providers/map_provider.dart';
import '../providers/map_state.dart';
import '../providers/waiting_bus_positions_provider.dart';
import '../providers/waiting_route_provider.dart';
import '../../trip/providers/trip_notifier.dart';
import '../../trip/providers/trip_state.dart';
import '../widgets/active_feed_bar.dart';
import '../widgets/active_route_bus_layer.dart';
import '../widgets/bus_marker_layer.dart';
import '../widgets/plan_markers_layer.dart';
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

  // Waiting mode state
  Timer? _waitingPollTimer;
  bool _waitingPolled = false;
  int? _waitingEtaMinutes; // null = no buses / can't calculate

  @override
  void initState() {
    super.initState();
    Future<void>(() async {
      final token = await ref.read(secureStorageProvider).readToken();
      if (!mounted) return;
      if (token != null && token.isNotEmpty) {
        ref.read(socketServiceProvider).connect(token);
      }

      await ref.read(mapNotifierProvider.notifier).initialize();
      if (!mounted) return;
      _startPositionStream();
      // If waiting mode was already active before MapScreen mounted
      // (e.g. started from PlannerScreen or BoardingScreen), begin polling now.
      // ref.listen only fires on future changes, so we must bootstrap here.
      final pendingWait = ref.read(selectedWaitingRouteProvider);
      if (pendingWait != null) _startWaiting(pendingWait);
    });
  }

  void _startPositionStream() {
    _positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      ),
    ).listen((pos) {
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
    _positionSubscription?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  // ── Waiting mode helpers ────────────────────────────────────────────────────

  void _startWaiting(BusRoute route) {
    _waitingPollTimer?.cancel();
    setState(() {
      _waitingPolled = false;
      _waitingEtaMinutes = null;
    });
    _pollWaitingRoute(route);
    _waitingPollTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      final current = ref.read(selectedWaitingRouteProvider);
      if (current != null) _pollWaitingRoute(current);
    });
  }

  void _stopWaiting() {
    _waitingPollTimer?.cancel();
    _waitingPollTimer = null;
    ref.read(waitingBusPositionsProvider.notifier).state = const <LatLng>[];
    if (mounted) setState(() { _waitingPolled = false; _waitingEtaMinutes = null; });
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

    ref.read(waitingBusPositionsProvider.notifier).state = positions;

    int? eta;
    final userPos = _livePosition;
    if (positions.isNotEmpty && userPos != null && route.geometry.isNotEmpty) {
      final etaMinutes = _calculateEta(positions, userPos, route.geometry);
      eta = etaMinutes?.round();
    }

    if (mounted) {
      setState(() {
        _waitingPolled = true;
        _waitingEtaMinutes = eta;
      });
    }
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

  // Returns ETA in minutes — null if no bus is ahead of user on the route
  static double? _calculateEta(
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
    if (minDist == null) return null;
    const avgSpeedMs = 25000.0 / 3600.0; // 25 km/h in m/s
    return minDist / avgSpeedMs / 60.0;
  }

  // ── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final mapState = ref.watch(mapNotifierProvider);

    // Watch waiting route and react to changes
    ref.listen<BusRoute?>(selectedWaitingRouteProvider, (prev, next) {
      if (next == null) {
        _stopWaiting();
      } else if (next.id != prev?.id) {
        _startWaiting(next);
      }
    });


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
    final tripState = ref.watch(tripNotifierProvider);
    final isOnTrip = tripState is TripActive;
    final activeTrip = isOnTrip ? tripState : null;
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
    if (tripState is TripActive) {
      ownTripId = tripState.trip.id;
      final lat = tripState.trip.currentLatitude;
      final lng = tripState.trip.currentLongitude;
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
              ),
              // Feed route (when no active trip and not in waiting mode)
              if (!isOnTrip && selectedRoute != null && selectedRoute.geometry.isNotEmpty && waitingRoute == null)
                RoutePolylineLayer(points: selectedRoute.geometry),
              // Waiting route polyline
              if (!isOnTrip && waitingRoute != null && waitingRoute.geometry.isNotEmpty)
                RoutePolylineLayer(points: waitingRoute.geometry),
              // Active trip route — always visible during a trip
              if (activeTripGeometry.isNotEmpty)
                RoutePolylineLayer(
                  points: activeTripGeometry,
                  color: AppColors.primary.withValues(alpha: 0.8),
                  strokeWidth: 5,
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
                      child: Image.asset('assets/splash/en_transito.png', width: 40, height: 40),
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

          // Waiting ETA overlay — only the ETA chip; cancel is in the shell bar
          if (!isOnTrip && waitingRoute != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 12,
              child: _WaitingBanner(
                route: waitingRoute,
                polled: _waitingPolled,
                etaMinutes: _waitingEtaMinutes,
              ),
            ),
          // Active feed bar — hidden during waiting and trip
          if (!isOnTrip && waitingRoute == null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 12,
              child: ActiveFeedBar(
                routes: ready.activeFeedRoutes,
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
              onPressed: () => context.go('/trip/boarding'),
              backgroundColor: AppColors.primary,
              label: const Text(AppStrings.boardedButton),
              icon: const Icon(Icons.directions_bus),
            ),
    );
  }
}

// ── Waiting Banner ─────────────────────────────────────────────────────────────

/// ETA overlay shown on the map while waiting. Cancel is in the shell bar.
class _WaitingBanner extends StatelessWidget {
  final BusRoute route;
  final bool polled;
  final int? etaMinutes;

  const _WaitingBanner({
    required this.route,
    required this.polled,
    required this.etaMinutes,
  });

  String get _etaText {
    if (!polled) return AppStrings.waitingEtaSearching;
    if (etaMinutes == null) return AppStrings.waitingEtaNoData;
    if (etaMinutes == 0) return AppStrings.waitingEtaArriving;
    return '~$etaMinutes ${AppStrings.waitingEtaMinutes}';
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Material(
        elevation: 6,
        borderRadius: BorderRadius.circular(16),
        color: AppColors.primaryDark.withValues(alpha: 0.92),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
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
        ),
      ),
    );
  }
}
