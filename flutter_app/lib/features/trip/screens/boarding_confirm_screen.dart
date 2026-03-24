import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_tile_caching/flutter_map_tile_caching.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/analytics/analytics_service.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_activity_badge.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../../map/providers/map_provider.dart';
import '../../map/providers/map_state.dart';
import '../../planner/models/nominatim_result.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';
import '../widgets/route_reports_list.dart';

class BoardingConfirmScreen extends ConsumerStatefulWidget {
  final int routeId;
  final double? destLat;
  final double? destLng;

  const BoardingConfirmScreen({
    required this.routeId,
    this.destLat,
    this.destLng,
    super.key,
  });

  @override
  ConsumerState<BoardingConfirmScreen> createState() => _BoardingConfirmScreenState();
}

class _BoardingConfirmScreenState extends ConsumerState<BoardingConfirmScreen> {
  final MapController _mapController = MapController();

  bool _loading = true;
  String? _error;
  BusRoute? _route;
  List<Stop> _stops = const <Stop>[];
  int? _selectedStopId;
  List<Report> _reports = const <Report>[];
  LatLng? _userPosition;
  int? _boardingDistanceWarning;
  bool _distanceDialogPending = false;
  bool _reportsExpanded = false;

  LatLng? get _finalDest =>
      widget.destLat != null && widget.destLng != null
          ? LatLng(widget.destLat!, widget.destLng!)
          : null;

  @override
  void initState() {
    super.initState();
    unawaited(AnalyticsService.routeSelected(widget.routeId, ''));
    Future<void>(() => _load());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(socketServiceProvider).joinRoute(widget.routeId);
      ref.read(socketServiceProvider).on('route:report_resolved', _onRouteReportResolved);
      ref.read(socketServiceProvider).on('route:new_report', (_) => _reloadReports());
      ref.read(socketServiceProvider).on('route:report_confirmed', (_) => _reloadReports());
    });
  }

  @override
  void dispose() {
    _mapController.dispose();
    ref.read(socketServiceProvider).leaveRoute(widget.routeId);
    ref.read(socketServiceProvider).off('route:report_resolved');
    ref.read(socketServiceProvider).off('route:new_report');
    ref.read(socketServiceProvider).off('route:report_confirmed');
    super.dispose();
  }

  void _onRouteReportResolved(dynamic data) {
    if (data is! Map || !mounted) return;
    final type = data['type'] as String? ?? '';
    if (type != 'trancon') return;
    final mins = (data['duration_minutes'] as num?)?.toInt() ?? 0;
    final msg = mins > 0
        ? '${AppStrings.tranconResolvedWithDuration}$mins${AppStrings.tranconResolvedMinutes}'
        : AppStrings.tranconResolvedWaiting;
    AppSnackbar.show(context, msg, SnackbarType.info);
  }

  Future<void> _reloadReports() async {
    if (!mounted) return;
    final result = await ref.read(reportsRepositoryProvider).getRouteReports(widget.routeId);
    if (!mounted) return;
    if (result is Success<List<Report>>) {
      setState(() => _reports = result.data);
    }
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });

    final results = await Future.wait<dynamic>(<Future<dynamic>>[
      ref.read(routesRepositoryProvider).getById(widget.routeId),
      ref.read(stopsRepositoryProvider).listByRoute(widget.routeId),
      ref.read(reportsRepositoryProvider).getRouteReports(widget.routeId),
    ]);

    final routeResult = results[0] as Result<BusRoute>;
    final stopsResult = results[1] as Result<List<Stop>>;
    final reportsResult = results[2] as Result<List<Report>>;

    if (routeResult is Failure<BusRoute>) {
      setState(() { _error = routeResult.error.message; _loading = false; });
      return;
    }

    final route = (routeResult as Success<BusRoute>).data;
    final stops = stopsResult is Success<List<Stop>> ? stopsResult.data : const <Stop>[];

    // Auto-select nearest stop to the typed destination (not the boarding stop).
    int? autoSelected;
    if (widget.destLat != null && widget.destLng != null && stops.isNotEmpty) {
      Stop? nearest;
      double bestDist = double.infinity;
      for (final stop in stops) {
        final d = LocationService.distanceMeters(
          stop.latitude, stop.longitude,
          widget.destLat!, widget.destLng!,
        );
        if (d < bestDist) { bestDist = d; nearest = stop; }
      }
      autoSelected = nearest?.id;
    }

    setState(() {
      _route = route;
      _stops = stops;
      _selectedStopId = autoSelected;
      _reports = switch (reportsResult) {
        Success<List<Report>>(data: final d) => d,
        _ => const <Report>[],
      };
      _loading = false;
    });

    // Read GPS from map state (refreshed every 30s).
    final mapState = ref.read(mapNotifierProvider);
    if (mapState is MapReady && mapState.userPosition != null && mounted) {
      setState(() => _userPosition = mapState.userPosition);
    }

    // After both setStates are processed, re-fit the camera to show the
    // selected stop + user position together (initialCameraFit only runs
    // on first render and may zoom out to fit the entire route geometry).
    if (autoSelected != null) {
      final stop = stops.firstWhere(
        (s) => s.id == autoSelected,
        orElse: () => stops.first,
      );
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fitCameraToStop(stop);
      });
    }
  }

  Stop? get _selectedStop {
    if (_selectedStopId == null) return null;
    for (final s in _stops) {
      if (s.id == _selectedStopId) return s;
    }
    return null;
  }

  Future<void> _showGpsRequiredDialog() async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.gpsRequiredTitle),
        content: const Text(AppStrings.gpsRequiredBody),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () { Navigator.of(ctx).pop(); Geolocator.openLocationSettings(); },
            child: const Text(AppStrings.gpsRequiredOpenSettings),
          ),
        ],
      ),
    );
  }

  Future<void> _confirm({bool force = false}) async {
    final gpsEnabled = await Geolocator.isLocationServiceEnabled();
    if (!gpsEnabled) { await _showGpsRequiredDialog(); return; }

    if (!force && _userPosition != null && _route != null) {
      final dist = _minDistToGeometry(
        _userPosition!.latitude, _userPosition!.longitude, _route!.geometry,
      );
      if (dist != null && dist > 800) {
        setState(() => _boardingDistanceWarning = dist.round());
        return;
      }
    }

    setState(() => _boardingDistanceWarning = null);
    await ref.read(tripNotifierProvider.notifier).startTrip(
      widget.routeId,
      destinationStopId: _selectedStopId,
    );
    if (!mounted) return;
    final tripState = ref.read(tripNotifierProvider);
    if (tripState is TripActive) {
      context.go('/trip');
    } else if (tripState is TripError) {
      AppSnackbar.show(context, tripState.message, SnackbarType.error);
    }
  }

  void _showDistanceWarning() {
    final dist = _boardingDistanceWarning;
    if (dist == null) return;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.boardingDistanceTitle),
        content: Text('${AppStrings.boardingDistanceBody} $dist m.'),
        actions: <Widget>[
          TextButton(
            onPressed: () { Navigator.of(ctx).pop(); setState(() => _boardingDistanceWarning = null); },
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () { Navigator.of(ctx).pop(); setState(() => _boardingDistanceWarning = null); _confirm(force: true); },
            child: const Text(AppStrings.boardingDistanceConfirm),
          ),
        ],
      ),
    );
  }

  // ── Map helpers ──────────────────────────────────────────────────────────────

  /// Moves the camera to show the selected stop + user position after
  /// the stop changes post-initial-render (initialCameraFit runs only once).
  void _fitCameraToStop(Stop stop) {
    final stopPos = LatLng(stop.latitude, stop.longitude);
    final points = <LatLng>[
      stopPos,
      if (_userPosition != null) _userPosition!,
    ];
    if (points.length == 1) {
      _mapController.move(stopPos, 16);
      return;
    }
    _mapController.fitCamera(
      CameraFit.bounds(
        bounds: LatLngBounds.fromPoints(points),
        padding: const EdgeInsets.fromLTRB(60, 80, 60, 280),
      ),
    );
  }

  MapOptions _buildMapOptions() {
    final List<LatLng> points = <LatLng>[
      if (_userPosition != null) _userPosition!,
      if (_finalDest != null) _finalDest!,
      if (_selectedStop != null) LatLng(_selectedStop!.latitude, _selectedStop!.longitude),
      if (_route?.geometry.isNotEmpty ?? false) ...<LatLng>[
        _route!.geometry.first,
        _route!.geometry[_route!.geometry.length ~/ 2],
        _route!.geometry.last,
      ],
    ];

    if (points.length >= 2) {
      return MapOptions(
        initialCameraFit: CameraFit.bounds(
          bounds: LatLngBounds.fromPoints(points),
          padding: const EdgeInsets.fromLTRB(40, 100, 40, 220),
        ),
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      );
    }
    return MapOptions(
      initialCenter: _userPosition ?? const LatLng(10.9685, -74.7813),
      initialZoom: 15,
      interactionOptions: const InteractionOptions(
        flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
      ),
    );
  }

  static double? _minDistToGeometry(double userLat, double userLng, List<LatLng> geometry) {
    if (geometry.length < 2) return null;
    double minDist = double.infinity;
    for (int i = 0; i < geometry.length - 1; i++) {
      final d = _distToSegmentMeters(
        userLat, userLng,
        geometry[i].latitude, geometry[i].longitude,
        geometry[i + 1].latitude, geometry[i + 1].longitude,
      );
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  static double _distToSegmentMeters(
    double pLat, double pLng,
    double aLat, double aLng,
    double bLat, double bLng,
  ) {
    final dx = bLat - aLat;
    final dy = bLng - aLng;
    final lenSq = dx * dx + dy * dy;
    if (lenSq == 0) return LocationService.distanceMeters(pLat, pLng, aLat, aLng);
    final t = math.max(0.0, math.min(1.0, ((pLat - aLat) * dx + (pLng - aLng) * dy) / lenSq));
    return LocationService.distanceMeters(pLat, pLng, aLat + t * dx, aLng + t * dy);
  }

  // ── Build ────────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final isLoadingTrip = ref.watch(
      tripNotifierProvider.select((s) => s is TripLoading),
    );

    if (_loading) return const Scaffold(body: LoadingIndicator());

    if (_error != null || _route == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(_error ?? AppStrings.errorUnknown)),
      );
    }

    if (_boardingDistanceWarning != null && !_distanceDialogPending) {
      _distanceDialogPending = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _distanceDialogPending = false;
        _showDistanceWarning();
      });
    }

    final route = _route!;
    final company = route.companyName ?? route.company ?? '';
    final selectedStop = _selectedStop;
    final finalDest = _finalDest;
    final topPadding = MediaQuery.of(context).padding.top;
    const extraBottomSpacing = 16.0;
    final bottomPadding = MediaQuery.of(context).padding.bottom + extraBottomSpacing;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          // ── Full-screen map ─────────────────────────────────────────────────
          FlutterMap(
            mapController: _mapController,
            options: _buildMapOptions(),
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
              if (route.geometry.isNotEmpty)
                RoutePolylineLayer(
                  points: route.geometry,
                  color: AppColors.primary.withValues(alpha: 0.7),
                  strokeWidth: 5,
                ),
              MarkerLayer(
                markers: <Marker>[
                  // 🟢 Tu posición (donde abordas)
                  if (_userPosition != null)
                    Marker(
                      point: _userPosition!,
                      width: 40,
                      height: 40,
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppColors.success,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 2.5),
                          boxShadow: const <BoxShadow>[
                            BoxShadow(color: Colors.black26, blurRadius: 6),
                          ],
                        ),
                        child: const Icon(Icons.my_location, color: Colors.white, size: 20),
                      ),
                    ),
                  // 🔴 Parada de bajada (donde el bus te deja)
                  if (selectedStop != null)
                    Marker(
                      point: LatLng(selectedStop.latitude, selectedStop.longitude),
                      width: 42,
                      height: 42,
                      child: const Icon(
                        Icons.directions_bus,
                        color: AppColors.error,
                        size: 36,
                        shadows: <Shadow>[Shadow(color: Colors.black38, blurRadius: 6)],
                      ),
                    ),
                  // 🟣 Tu destino original (lo que escribiste)
                  if (finalDest != null)
                    Marker(
                      point: finalDest,
                      width: 42,
                      height: 42,
                      child: const Icon(
                        Icons.flag,
                        color: Colors.deepPurple,
                        size: 36,
                        shadows: <Shadow>[Shadow(color: Colors.black38, blurRadius: 6)],
                      ),
                    ),
                ],
              ),
            ],
          ),

          // ── Top: back button + route card ───────────────────────────────────
          Positioned(
            top: topPadding + 8,
            left: 12,
            right: 12,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Material(
                  borderRadius: BorderRadius.circular(14),
                  elevation: 4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.primaryDark,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: <Widget>[
                        GestureDetector(
                          onTap: () => context.pop(),
                          child: const Icon(Icons.arrow_back, color: Colors.white, size: 20),
                        ),
                        const SizedBox(width: 10),
                        RouteCodeBadge(code: route.code),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text(
                                route.name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 14,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                              if (company.isNotEmpty)
                                Text(
                                  company,
                                  style: const TextStyle(color: Colors.white70, fontSize: 11),
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                        ),
                        if (route.frequencyMinutes != null) ...<Widget>[
                          const SizedBox(width: 6),
                          Text(
                            '${AppStrings.frequencyLabel}: ${route.frequencyMinutes} ${AppStrings.timeUnitMinutes}',
                            style: const TextStyle(color: Colors.white70, fontSize: 11),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                RouteActivityBadge(routeId: widget.routeId),
              ],
            ),
          ),

          // ── Legend card ─────────────────────────────────────────────────────
          if (_userPosition != null || selectedStop != null || finalDest != null)
            Positioned(
              left: 12,
              bottom: bottomPadding + 180,
              child: Material(
                borderRadius: BorderRadius.circular(10),
                elevation: 3,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.95),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      if (_userPosition != null)
                        const _LegendItem(color: AppColors.success, label: AppStrings.boardingOriginLabel),
                      if (selectedStop != null)
                        const _LegendItem(color: AppColors.error, label: AppStrings.tripDropoffStop),
                      if (finalDest != null)
                        const _LegendItem(color: Colors.deepPurple, label: AppStrings.destLabel),
                    ],
                  ),
                ),
              ),
            ),

          // ── Reports collapsible ─────────────────────────────────────────────
          if (_reports.isNotEmpty)
            Positioned(
              left: 0,
              right: 0,
              bottom: bottomPadding + 155,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  GestureDetector(
                    onTap: () => setState(() => _reportsExpanded = !_reportsExpanded),
                    child: Container(
                      color: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Text(
                            '${AppStrings.boardingReportsTitle} (${_reports.length})',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                          ),
                          Icon(
                            _reportsExpanded ? Icons.expand_less : Icons.expand_more,
                            size: 20,
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_reportsExpanded)
                    Container(
                      color: Colors.white,
                      constraints: const BoxConstraints(maxHeight: 180),
                      child: RouteReportsList(
                        reports: _reports,
                        onConfirm: (reportId) async {
                          final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
                          if (result is Success<void>) await _reloadReports();
                        },
                      ),
                    ),
                ],
              ),
            ),

          // ── Bottom panel: dropoff + confirm ─────────────────────────────────
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: EdgeInsets.only(
                left: 16, right: 16, top: 14,
                bottom: bottomPadding + 14,
              ),
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: <BoxShadow>[
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.12),
                    blurRadius: 12,
                    offset: const Offset(0, -3),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  // Dropoff row
                  _DropoffRow(
                    selectedStop: selectedStop,
                    onPickFromMap: () async {
                      final stop = selectedStop;
                      final String query;
                      if (stop != null) {
                        query = '?lat=${stop.latitude}&lng=${stop.longitude}';
                      } else if (_userPosition != null) {
                        query = '?lat=${_userPosition!.latitude}&lng=${_userPosition!.longitude}';
                      } else {
                        query = '';
                      }
                      final result = await context.push<NominatimResult>('/map-pick$query');
                      if (result == null || !mounted || _stops.isEmpty) return;
                      Stop? nearest;
                      double bestDist = double.infinity;
                      for (final s in _stops) {
                        final d = LocationService.distanceMeters(
                          s.latitude, s.longitude, result.lat, result.lng,
                        );
                        if (d < bestDist) { bestDist = d; nearest = s; }
                      }
                      if (nearest != null) {
                        final found = nearest;
                        setState(() => _selectedStopId = found.id);
                        _fitCameraToStop(found);
                      }
                    },
                  ),
                  const SizedBox(height: 12),
                  AppButton.primary(
                    label: AppStrings.boardedButton,
                    isLoading: isLoadingTrip,
                    onPressed: isLoadingTrip ? null : _confirm,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Legend item ───────────────────────────────────────────────────────────────

class _LegendItem extends StatelessWidget {
  final Color color;
  final String label;

  const _LegendItem({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

// ── Dropoff row ───────────────────────────────────────────────────────────────

class _DropoffRow extends StatelessWidget {
  final Stop? selectedStop;
  final VoidCallback? onPickFromMap;

  const _DropoffRow({
    required this.selectedStop,
    this.onPickFromMap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final hasStop = selectedStop != null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: hasStop
            ? colorScheme.primaryContainer.withValues(alpha: 0.35)
            : Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: hasStop ? colorScheme.primary.withValues(alpha: 0.4) : Theme.of(context).dividerColor,
        ),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            hasStop ? Icons.pin_drop : Icons.pin_drop_outlined,
            size: 20,
            color: hasStop ? colorScheme.primary : null,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  AppStrings.tripDropoffStop,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).textTheme.bodySmall?.color,
                      ),
                ),
                Text(
                  hasStop ? selectedStop!.name : AppStrings.tripNoDropoff,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: hasStop ? FontWeight.w600 : null,
                      ),
                ),
              ],
            ),
          ),
          if (onPickFromMap != null)
            IconButton(
              icon: const Icon(Icons.map_outlined, size: 20),
              tooltip: AppStrings.boardingPickOnMap,
              onPressed: onPickFromMap,
              style: IconButton.styleFrom(
                padding: const EdgeInsets.all(4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          if (onPickFromMap != null)
            TextButton(
              onPressed: onPickFromMap,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text(AppStrings.tripChangeStop),
            ),
        ],
      ),
    );
  }
}
