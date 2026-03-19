import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/analytics/analytics_service.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/plan_result.dart';
import '../../../core/domain/models/route_activity.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_activity_badge.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../map/providers/map_active_positions_provider.dart';
import '../../map/providers/map_provider.dart';
import '../../map/providers/map_state.dart';
import '../../map/providers/waiting_route_provider.dart';
import '../models/nominatim_result.dart';
import '../providers/favorites_provider.dart';
import '../providers/planner_notifier.dart';
import '../providers/planner_state.dart';
import '../widgets/address_search_field.dart';
import '../widgets/plan_result_card.dart';

class PlannerScreen extends ConsumerStatefulWidget {
  const PlannerScreen({super.key});

  @override
  ConsumerState<PlannerScreen> createState() => _PlannerScreenState();
}

class _PlannerScreenState extends ConsumerState<PlannerScreen> {
  // Timestamp of the last GPS origin fetch. Allows re-fetching on tab return
  // (when the user walks and switches back) while avoiding rapid repeated calls.
  DateTime? _lastGpsInit;
  bool _refreshingNearby = false;
  int? _selectedNearbyRouteId;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _maybeRefreshGpsOrigin();
  }

  @override
  void dispose() {
    // Clear active positions when leaving the planner
    ref.read(mapActivePositionsProvider.notifier).state = const <LatLng>[];
    super.dispose();
  }

  /// Schedules a GPS origin refresh when:
  /// - No origin is set yet (first load), OR
  /// - Origin is GPS and ≥60 s have passed since the last fetch (tab return).
  /// Manual address selections are never overridden.
  void _maybeRefreshGpsOrigin() {
    final notifier = ref.read(plannerNotifierProvider.notifier);
    final origin = notifier.selectedOrigin;
    final isGpsOrigin =
        origin == null || origin.displayName == AppStrings.currentLocationLabel;
    if (!isGpsOrigin) return; // user typed an address — don't touch

    final now = DateTime.now();
    if (_lastGpsInit != null &&
        now.difference(_lastGpsInit!) < const Duration(seconds: 60)) {
      return; // too soon
    }
    _lastGpsInit = now;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _setCurrentLocationAsOrigin();
    });
  }

  Future<void> _setCurrentLocationAsOrigin() async {
    // Prefer position already in map state (zero cost).
    final mapState = ref.read(mapNotifierProvider);
    if (mapState is MapReady && mapState.userPosition != null) {
      ref.read(plannerNotifierProvider.notifier).setOrigin(
            NominatimResult(
              displayName: AppStrings.currentLocationLabel,
              lat: mapState.userPosition!.latitude,
              lng: mapState.userPosition!.longitude,
            ),
          );
      return;
    }

    // Fallback: ask GPS (happens only if map hasn't loaded yet).
    final position = await LocationService.getBestEffortPosition();
    if (position == null || !mounted) return;
    ref.read(plannerNotifierProvider.notifier).setOrigin(
          NominatimResult(
            displayName: AppStrings.currentLocationLabel,
            lat: position.latitude,
            lng: position.longitude,
          ),
        );
  }

  Future<void> _onSearch() async {
    final notifier = ref.read(plannerNotifierProvider.notifier);
    final origin = notifier.selectedOrigin;
    final dest = notifier.selectedDest;

    if (dest == null) {
      AppSnackbar.show(context, AppStrings.plannerDestRequired, SnackbarType.info);
      return;
    }

    unawaited(AnalyticsService.plannerSearched());
    await notifier.planRoute(
      originLat: origin?.lat,
      originLng: origin?.lng,
      destLat: dest.lat,
      destLng: dest.lng,
    );
  }

  Future<void> _refreshNearby() async {
    final origin = ref.read(plannerNotifierProvider.notifier).selectedOrigin;
    if (origin == null) return;
    setState(() => _refreshingNearby = true);
    await ref.read(plannerNotifierProvider.notifier).loadNearbyForOrigin(origin);
    if (mounted) setState(() => _refreshingNearby = false);
  }

  void _startWaiting(BusRoute route) {
    ref.read(selectedWaitingRouteProvider.notifier).state = route;
    context.go('/map');
  }

  Future<void> _updateActivePositions(int routeId) async {
    final result =
        await ref.read(routesRepositoryProvider).getActivity(routeId);
    if (!mounted) return;
    final positions = result is Success<RouteActivity>
        ? result.data.activePositions
        : const <LatLng>[];
    ref.read(mapActivePositionsProvider.notifier).state = positions;
  }

  @override
  Widget build(BuildContext context) {
    // Re-check GPS on every render so tab-switch returns also pick up the
    // current position. The 60-second throttle inside prevents rapid re-calls.
    _maybeRefreshGpsOrigin();

    final state = ref.watch(plannerNotifierProvider);
    final favoritesAsync = ref.watch(favoritesProvider);
    final notifier = ref.read(plannerNotifierProvider.notifier);

    final selectedOrigin = switch (state) {
      PlannerIdle(selectedOrigin: final origin) => origin,
      PlannerResults(selectedOrigin: final origin) => origin,
      _ => notifier.selectedOrigin,
    };

    final selectedDest = switch (state) {
      PlannerIdle(selectedDest: final dest) => dest,
      PlannerResults(selectedDest: final dest) => dest,
      _ => notifier.selectedDest,
    };
    final nearbyRoutes = switch (state) {
      PlannerIdle(nearbyRoutes: final routes, selectedDest: null) => routes,
      _ => const <BusRoute>[],
    };

    // If the nearby list no longer contains the selected route, deselect it.
    // Direct assignment (no setState) is safe here because we're in build and
    // the value is only read later in the same frame.
    if (_selectedNearbyRouteId != null &&
        nearbyRoutes.every((r) => r.id != _selectedNearbyRouteId)) {
      _selectedNearbyRouteId = null;
    }

    final isLoading = state is PlannerLoading;
    final List<PlanResult> results =
        state is PlannerResults ? state.results : const <PlanResult>[];

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.tabRoutes)),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  AppStrings.favoritesTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 92,
                child: switch (favoritesAsync) {
                  AsyncLoading() => const LoadingIndicator(),
                  AsyncError() => const _FavoritesEmpty(),
                  AsyncData(value: final favorites) => favorites.isEmpty
                      ? const _FavoritesEmpty()
                      : ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: favorites.length,
                          separatorBuilder: (_, __) => const SizedBox(width: 8),
                          itemBuilder: (context, index) {
                            final route = favorites[index];
                            return Container(
                              width: 210,
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                borderRadius: BorderRadius.circular(10),
                                border: Border(
                                  left: BorderSide(color: AppColors.forRouteCode(route.code), width: 4),
                                ),
                                boxShadow: const <BoxShadow>[
                                  BoxShadow(
                                    color: Color(0x14000000),
                                    blurRadius: 6,
                                    offset: Offset(0, 2),
                                  ),
                                ],
                              ),
                              child: Row(
                                children: <Widget>[
                                  RouteCodeBadge(code: route.code),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      route.name,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  IconButton(
                                    onPressed: () => ref
                                        .read(favoritesProvider.notifier)
                                        .removeFavorite(route.id),
                                    icon: const Icon(Icons.favorite),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                  _ => const SizedBox.shrink(),
                },
              ),
              const SizedBox(height: 12),
              AddressSearchField(
                label: AppStrings.originLabel,
                initialValue: selectedOrigin?.displayName,
                onSearch: notifier.searchAddress,
                onSelect: notifier.setOrigin,
                onPickFromMap: () async {
                  final lat = selectedOrigin?.lat;
                  final lng = selectedOrigin?.lng;
                  final query = lat != null && lng != null ? '?lat=$lat&lng=$lng' : '';
                  final result = await context.push<NominatimResult>('/map-pick$query');
                  if (result != null) {
                    notifier.setOrigin(result);
                  }
                },
              ),
              const SizedBox(height: 10),
              AddressSearchField(
                label: AppStrings.destLabel,
                initialValue: selectedDest?.displayName,
                onSearch: notifier.searchAddress,
                onSelect: notifier.setDestination,
                onPickFromMap: () async {
                  final lat = selectedDest?.lat;
                  final lng = selectedDest?.lng;
                  final query = lat != null && lng != null ? '?lat=$lat&lng=$lng' : '';
                  final result = await context.push<NominatimResult>('/map-pick$query');
                  if (result != null) {
                    notifier.setDestination(result);
                  }
                },
              ),
              if (nearbyRoutes.isNotEmpty && state is! PlannerResults) ...<Widget>[
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text(
                      AppStrings.nearbyRoutesTitle,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    IconButton(
                      icon: _refreshingNearby
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh, size: 20),
                      tooltip: AppStrings.nearbyRefreshTooltip,
                      onPressed: _refreshingNearby ? null : _refreshNearby,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    AppStrings.nearbyRoutesHint,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                const SizedBox(height: 6),
                ...nearbyRoutes.map(
                  (route) => InkWell(
                    onTap: () {
                      setState(() {
                        _selectedNearbyRouteId =
                            _selectedNearbyRouteId == route.id ? null : route.id;
                      });
                      if (_selectedNearbyRouteId == route.id) {
                        unawaited(_updateActivePositions(route.id));
                      }
                    },
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(10),
                        border: Border(
                          left: BorderSide(color: AppColors.forRouteCode(route.code), width: 4),
                        ),
                        boxShadow: const <BoxShadow>[
                          BoxShadow(
                            color: Color(0x14000000),
                            blurRadius: 6,
                            offset: Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              RouteCodeBadge(code: route.code),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text(route.name, style: Theme.of(context).textTheme.bodyMedium),
                                    if ((route.companyName ?? route.company ?? '').isNotEmpty)
                                      Text(
                                        route.companyName ?? route.company ?? '',
                                        style: Theme.of(context).textTheme.bodySmall,
                                      ),
                                    const SizedBox(height: 4),
                                    RouteActivityBadge(routeId: route.id),
                                  ],
                                ),
                              ),
                              if (route.distanceMeters != null) ...<Widget>[
                                const SizedBox(width: 8),
                                Text(
                                  '${route.distanceMeters} m',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: AppColors.forDistance(route.distanceMeters!),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                              const SizedBox(width: 4),
                              const Icon(Icons.chevron_right, size: 18),
                            ],
                          ),
                          if (_selectedNearbyRouteId == route.id) ...<Widget>[
                            const SizedBox(height: 10),
                            const Divider(height: 1),
                            const SizedBox(height: 10),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: <Widget>[
                                OutlinedButton.icon(
                                  onPressed: () => _startWaiting(route),
                                  icon: const Icon(Icons.notifications_active_outlined, size: 16),
                                  label: const Text(AppStrings.waitButton),
                                ),
                                const SizedBox(height: 8),
                                FilledButton.icon(
                                  onPressed: () => context.push('/trip/confirm?routeId=${route.id}'),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: AppColors.success,
                                    foregroundColor: Colors.white,
                                  ),
                                  icon: const Icon(Icons.directions_bus, size: 16),
                                  label: const Text(AppStrings.nearbyBoardButton),
                                ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              switch (state) {
                PlannerLoading() => const Padding(
                    padding: EdgeInsets.only(top: 40),
                    child: LoadingIndicator(),
                  ),
                PlannerError(message: final message) => Padding(
                    padding: const EdgeInsets.only(top: 40),
                    child: Center(child: Text(message)),
                  ),
                PlannerResults() => results.isEmpty
                    ? const EmptyView(
                        icon: Icons.alt_route,
                        message: AppStrings.emptyState,
                      )
                    : ListView.builder(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        itemCount: results.length,
                        itemBuilder: (context, index) {
                          final result = results[index];
                          return PlanResultCard(
                            result: result,
                            onSelect: () {
                              unawaited(_updateActivePositions(result.id));
                              // Pass the user's actual typed destination, not the
                              // boarding stop (nearestStop). BoardingConfirmScreen
                              // uses these coords to pre-select the nearest dropoff
                              // stop and show the final destination pin on the map.
                              final dest = ref
                                  .read(plannerNotifierProvider.notifier)
                                  .selectedDest;
                              final destParam = dest != null
                                  ? '&destLat=${dest.lat}&destLng=${dest.lng}'
                                  : '';
                              context.push(
                                '/trip/confirm?routeId=${result.id}$destParam',
                              );
                            },
                            onWait: () => _startWaiting(
                              BusRoute(
                                id: result.id,
                                name: result.name,
                                code: result.code,
                                company: result.companyName,
                                isActive: true,
                                geometry: result.geometry,
                              ),
                            ),
                          );
                        },
                      ),
                _ => const SizedBox.shrink(),
              },
              const SizedBox(height: 20),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: AppButton.primary(
                label: AppStrings.planButton,
                isLoading: isLoading,
                onPressed: isLoading ? null : _onSearch,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FavoritesEmpty extends StatelessWidget {
  const _FavoritesEmpty();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.favorite_border, size: 28, color: AppColors.textSecondary),
            const SizedBox(height: 6),
            Text(
              AppStrings.noFavorites,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
