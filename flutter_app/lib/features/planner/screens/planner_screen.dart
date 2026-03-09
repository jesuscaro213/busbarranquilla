import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/domain/models/plan_result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/empty_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_code_badge.dart';
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
  bool _didInitLocation = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didInitLocation) return;
    _didInitLocation = true;
    Future<void>(_setCurrentLocationAsOrigin);
  }

  Future<void> _setCurrentLocationAsOrigin() async {
    final position = await LocationService.getCurrentPosition();
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

    if (origin == null || dest == null) {
      AppSnackbar.show(context, AppStrings.plannerPickPointsError, SnackbarType.info);
      return;
    }

    await notifier.planRoute(
      originLat: origin.lat,
      originLng: origin.lng,
      destLat: dest.lat,
      destLng: dest.lng,
    );
  }

  @override
  Widget build(BuildContext context) {
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

    final isLoading = state is PlannerLoading;
    final List<PlanResult> results =
        state is PlannerResults ? state.results : const <PlanResult>[];

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.tabRoutes)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
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
                  AsyncError() => const EmptyView(
                      icon: Icons.favorite_border,
                      message: AppStrings.noFavorites,
                    ),
                  AsyncData(value: final favorites) => favorites.isEmpty
                      ? const EmptyView(
                          icon: Icons.favorite_border,
                          message: AppStrings.noFavorites,
                        )
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
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: Theme.of(context).dividerColor),
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
                },
              ),
              const SizedBox(height: 12),
              AddressSearchField(
                label: AppStrings.originLabel,
                initialValue: selectedOrigin?.displayName,
                onSearch: notifier.searchAddress,
                onSelect: notifier.setOrigin,
              ),
              const SizedBox(height: 10),
              AddressSearchField(
                label: AppStrings.destLabel,
                initialValue: selectedDest?.displayName,
                onSearch: notifier.searchAddress,
                onSelect: notifier.setDestination,
              ),
              const SizedBox(height: 12),
              AppButton.primary(
                label: AppStrings.planButton,
                isLoading: isLoading,
                onPressed: isLoading ? null : _onSearch,
              ),
              const SizedBox(height: 12),
              Expanded(
                child: switch (state) {
                  PlannerLoading() => const LoadingIndicator(),
                  PlannerError(message: final message) => Center(child: Text(message)),
                  PlannerResults() => results.isEmpty
                      ? const EmptyView(
                          icon: Icons.alt_route,
                          message: AppStrings.emptyState,
                        )
                      : ListView.builder(
                          itemCount: results.length,
                          itemBuilder: (context, index) {
                            final result = results[index];
                            return PlanResultCard(
                              result: result,
                              onSelect: () {
                                ref.read(selectedPlanRouteProvider.notifier).state = result;
                                context.go('/trip/stop-select?routeId=${result.id}');
                              },
                            );
                          },
                        ),
                  _ => const SizedBox.shrink(),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
