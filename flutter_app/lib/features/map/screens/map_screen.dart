import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../providers/map_active_positions_provider.dart';
import '../providers/map_provider.dart';
import '../providers/map_state.dart';
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
      if (mounted) _startPositionStream();
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
    _positionSubscription?.cancel();
    _mapController.dispose();
    super.dispose();
  }

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
              // Feed route (when no active trip)
              if (!isOnTrip && selectedRoute != null && selectedRoute.geometry.isNotEmpty)
                RoutePolylineLayer(points: selectedRoute.geometry),
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
              if (selectedRoute != null)
                ActiveRouteBusLayer(routeId: selectedRoute.id),
              if (userMarkerPosition != null)
                UserMarkerLayer(position: userMarkerPosition, isOnTrip: isOnTrip),
              Consumer(
                builder: (context, ref, _) {
                  final activePositions = ref.watch(mapActivePositionsProvider);
                  if (activePositions.isEmpty) return const SizedBox.shrink();
                  return MarkerLayer(
                    markers: activePositions.map((pos) => Marker(
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
      floatingActionButton: isOnTrip
          ? null
          : FloatingActionButton.extended(
              onPressed: () => context.go('/trip/boarding'),
              label: const Text(AppStrings.boardedButton),
              icon: const Icon(Icons.directions_bus),
            ),
    );
  }
}
