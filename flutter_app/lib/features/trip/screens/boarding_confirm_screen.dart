import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
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
  bool _loading = true;
  String? _error;
  BusRoute? _route;
  List<Stop> _stops = const <Stop>[];
  int? _selectedStopId;
  bool _showStopList = false;
  List<Report> _reports = const <Report>[];
  LatLng? _userPosition;
  int? _boardingDistanceWarning;

  @override
  void initState() {
    super.initState();
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
    setState(() {
      _loading = true;
      _error = null;
    });

    final results = await Future.wait<dynamic>(<Future<dynamic>>[
      ref.read(routesRepositoryProvider).getById(widget.routeId),
      ref.read(stopsRepositoryProvider).listByRoute(widget.routeId),
      ref.read(reportsRepositoryProvider).getRouteReports(widget.routeId),
    ]);

    final routeResult = results[0] as Result<BusRoute>;
    final stopsResult = results[1] as Result<List<Stop>>;
    final reportsResult = results[2] as Result<List<Report>>;

    if (routeResult is Failure<BusRoute>) {
      setState(() {
        _error = routeResult.error.message;
        _loading = false;
      });
      return;
    }

    final route = (routeResult as Success<BusRoute>).data;
    final stops = stopsResult is Success<List<Stop>> ? stopsResult.data : const <Stop>[];

    // Auto-select nearest stop when destination coordinates are provided
    int? autoSelected;
    if (widget.destLat != null && widget.destLng != null && stops.isNotEmpty) {
      Stop? nearest;
      double bestDist = double.infinity;
      for (final stop in stops) {
        final d = LocationService.distanceMeters(
          stop.latitude,
          stop.longitude,
          widget.destLat!,
          widget.destLng!,
        );
        if (d < bestDist) {
          bestDist = d;
          nearest = stop;
        }
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

    // Fetch user position for map display (non-blocking, best-effort)
    LocationService.getCurrentPosition().then((pos) {
      if (pos != null && mounted) {
        setState(() => _userPosition = LatLng(pos.latitude, pos.longitude));
      }
    });
  }

  Stop? get _selectedStop {
    if (_selectedStopId == null) return null;
    for (final s in _stops) {
      if (s.id == _selectedStopId) return s;
    }
    return null;
  }

  Future<void> _confirm({bool force = false}) async {
    if (!force && _userPosition != null && _route != null) {
      final dist = _minDistToGeometry(
        _userPosition!.latitude,
        _userPosition!.longitude,
        _route!.geometry,
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
            onPressed: () {
              Navigator.of(ctx).pop();
              setState(() => _boardingDistanceWarning = null);
            },
            child: const Text(AppStrings.cancel),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              setState(() => _boardingDistanceWarning = null);
              _confirm(force: true);
            },
            child: const Text(AppStrings.boardingDistanceConfirm),
          ),
        ],
      ),
    );
  }

  static double? _minDistToGeometry(
    double userLat,
    double userLng,
    List<LatLng> geometry,
  ) {
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

  @override
  Widget build(BuildContext context) {
    final tripState = ref.watch(tripNotifierProvider);
    final isLoadingTrip = tripState is TripLoading;

    if (_loading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (_error != null || _route == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(_error ?? AppStrings.errorUnknown)),
      );
    }

    final route = _route!;
    final company = route.companyName ?? route.company ?? '';
    final selectedStop = _selectedStop;

    if (_boardingDistanceWarning != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _showDistanceWarning());
    }

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.boardingTitle)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // Route header
              Row(
                children: <Widget>[
                  RouteCodeBadge(code: route.code),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          route.name,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        if (company.isNotEmpty)
                          Text(company, style: Theme.of(context).textTheme.bodySmall),
                        if (route.frequencyMinutes != null)
                          Text(
                            '${AppStrings.frequencyLabel}: ${route.frequencyMinutes} ${AppStrings.timeUnitMinutes}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              RouteActivityBadge(routeId: widget.routeId),
              const SizedBox(height: 12),
              _BoardingMapPreview(
                geometry: route.geometry,
                userPosition: _userPosition,
                destinationStop: selectedStop,
              ),
              if (_reports.isNotEmpty) ...<Widget>[
                const SizedBox(height: 16),
                const Divider(),
                const SizedBox(height: 8),
                Text(
                  AppStrings.boardingReportsTitle,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 6),
                RouteReportsList(
                  reports: _reports,
                  onConfirm: (reportId) async {
                    final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
                    if (result is Success<void>) {
                      await _reloadReports();
                    }
                  },
                ),
              ],
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 12),

              // Destination stop — compact chip when auto-selected, optional picker otherwise
              _DropoffRow(
                selectedStop: selectedStop,
                onChangeTap: () => setState(() => _showStopList = !_showStopList),
                showingList: _showStopList,
                onPickFromMap: () async {
                  final result = await context.push<NominatimResult>('/map-pick');
                  if (result == null || !mounted) return;
                  if (_stops.isEmpty) return;
                  Stop? nearest;
                  double bestDist = double.infinity;
                  for (final stop in _stops) {
                    final d = LocationService.distanceMeters(
                      stop.latitude,
                      stop.longitude,
                      result.lat,
                      result.lng,
                    );
                    if (d < bestDist) {
                      bestDist = d;
                      nearest = stop;
                    }
                  }
                  if (nearest != null) {
                    setState(() {
                      _selectedStopId = nearest!.id;
                      _showStopList = false;
                    });
                  }
                },
              ),

              // Stop list — shown only when user taps Cambiar / Seleccionar
              if (_showStopList) ...<Widget>[
                const SizedBox(height: 8),
                Expanded(
                  child: _stops.isEmpty
                      ? Center(
                          child: Text(
                            AppStrings.tripNoStops,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        )
                      : ListView.builder(
                          itemCount: _stops.length,
                          itemBuilder: (context, index) {
                            final stop = _stops[index];
                            final selected = stop.id == _selectedStopId;
                            return ListTile(
                              onTap: () => setState(() {
                                _selectedStopId = selected ? null : stop.id;
                                _showStopList = false;
                              }),
                              leading: Icon(
                                selected
                                    ? Icons.check_circle
                                    : Icons.radio_button_unchecked,
                                color: selected
                                    ? Theme.of(context).colorScheme.primary
                                    : null,
                              ),
                              title: Text(stop.name),
                              contentPadding: EdgeInsets.zero,
                            );
                          },
                        ),
                ),
              ] else
                const Spacer(),

              const SizedBox(height: 12),
              AppButton.primary(
                label: AppStrings.boardedButton,
                isLoading: isLoadingTrip,
                onPressed: isLoadingTrip ? null : _confirm,
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => context.pop(),
                child: const Text(AppStrings.tripClose),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DropoffRow extends StatelessWidget {
  final Stop? selectedStop;
  final VoidCallback onChangeTap;
  final bool showingList;
  final VoidCallback? onPickFromMap;

  const _DropoffRow({
    required this.selectedStop,
    required this.onChangeTap,
    required this.showingList,
    this.onPickFromMap,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final hasStop = selectedStop != null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(color: Theme.of(context).textTheme.bodySmall?.color),
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
          TextButton(
            onPressed: onChangeTap,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              showingList ? AppStrings.tripClose : AppStrings.tripChangeStop,
            ),
          ),
        ],
      ),
    );
  }
}

class _BoardingMapPreview extends StatelessWidget {
  final List<LatLng> geometry;
  final LatLng? userPosition;
  final Stop? destinationStop;

  const _BoardingMapPreview({
    required this.geometry,
    this.userPosition,
    this.destinationStop,
  });

  @override
  Widget build(BuildContext context) {
    final List<LatLng> points = <LatLng>[
      if (userPosition != null) userPosition!,
      if (destinationStop != null)
        LatLng(destinationStop!.latitude, destinationStop!.longitude),
      ...geometry,
    ];

    final LatLng fallbackCenter = userPosition ??
        (geometry.isNotEmpty ? geometry[geometry.length ~/ 2] : const LatLng(10.9685, -74.7813));

    MapOptions buildOptions() {
      if (points.length >= 2) {
        return MapOptions(
          initialCameraFit: CameraFit.bounds(
            bounds: LatLngBounds.fromPoints(points),
            padding: const EdgeInsets.all(40),
          ),
          interactionOptions: const InteractionOptions(
            flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
          ),
        );
      }
      return MapOptions(
        initialCenter: fallbackCenter,
        initialZoom: 14,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.pinchZoom | InteractiveFlag.drag,
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        height: 280,
        child: FlutterMap(
          options: buildOptions(),
          children: <Widget>[
            TileLayer(
              urlTemplate: AppStrings.osmTileUrl,
              subdomains: AppStrings.osmTileSubdomains,
              userAgentPackageName: AppStrings.osmUserAgent,
            ),
            if (geometry.isNotEmpty) RoutePolylineLayer(points: geometry),
            MarkerLayer(
              markers: <Marker>[
                if (userPosition != null)
                  Marker(
                    point: userPosition!,
                    width: 32,
                    height: 32,
                    child: const Icon(
                      Icons.my_location,
                      color: AppColors.success,
                      size: 28,
                      shadows: <Shadow>[
                        Shadow(color: Colors.black26, blurRadius: 4),
                      ],
                    ),
                  ),
                if (destinationStop != null)
                  Marker(
                    point: LatLng(destinationStop!.latitude, destinationStop!.longitude),
                    width: 36,
                    height: 36,
                    child: const Icon(
                      Icons.location_pin,
                      color: AppColors.error,
                      size: 32,
                      shadows: <Shadow>[
                        Shadow(color: Colors.black26, blurRadius: 4),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
