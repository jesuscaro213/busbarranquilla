import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_activity_badge.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';

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

  @override
  void initState() {
    super.initState();
    Future<void>(() => _load());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(socketServiceProvider).joinRoute(widget.routeId);
      ref.read(socketServiceProvider).on('route:report_resolved', _onRouteReportResolved);
    });
  }

  @override
  void dispose() {
    ref.read(socketServiceProvider).leaveRoute(widget.routeId);
    ref.read(socketServiceProvider).off('route:report_resolved');
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

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final results = await Future.wait<dynamic>(<Future<dynamic>>[
      ref.read(routesRepositoryProvider).getById(widget.routeId),
      ref.read(stopsRepositoryProvider).listByRoute(widget.routeId),
    ]);

    final routeResult = results[0] as Result<BusRoute>;
    final stopsResult = results[1] as Result<List<Stop>>;

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
      _loading = false;
    });
  }

  Stop? get _selectedStop {
    if (_selectedStopId == null) return null;
    for (final s in _stops) {
      if (s.id == _selectedStopId) return s;
    }
    return null;
  }

  Future<void> _confirm() async {
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
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 12),

              // Destination stop — compact chip when auto-selected, optional picker otherwise
              _DropoffRow(
                selectedStop: selectedStop,
                onChangeTap: () => setState(() => _showStopList = !_showStopList),
                showingList: _showStopList,
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

  const _DropoffRow({
    required this.selectedStop,
    required this.onChangeTap,
    required this.showingList,
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
