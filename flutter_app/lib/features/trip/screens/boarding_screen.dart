import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';

import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_code_badge.dart';
import '../../map/providers/waiting_route_provider.dart';
import '../../planner/providers/planner_notifier.dart';
import '../widgets/route_preview_sheet.dart';

class BoardingScreen extends ConsumerStatefulWidget {
  const BoardingScreen({super.key});

  @override
  ConsumerState<BoardingScreen> createState() => _BoardingScreenState();
}

class _BoardingScreenState extends ConsumerState<BoardingScreen> {
  final TextEditingController _searchController = TextEditingController();

  bool _loading = true;
  String? _error;
  List<BusRoute> _routes = <BusRoute>[];
  List<BusRoute> _nearbyRoutes = const <BusRoute>[];
  String _search = '';

  @override
  void initState() {
    super.initState();
    Future<void>(() => _loadRoutes());
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadRoutes() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    // Always get a fresh GPS fix so nearby routes match the user's real
    // current location, not a stale position from when the app was opened.
    double? lat;
    double? lng;

    final permitted = await Geolocator.checkPermission();
    if (permitted == LocationPermission.whileInUse ||
        permitted == LocationPermission.always) {
      try {
        final fresh = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 6),
          ),
        );
        lat = fresh.latitude;
        lng = fresh.longitude;
      } catch (_) {
        // Timeout or error — fall back to last known position.
        final cached = await Geolocator.getLastKnownPosition();
        if (cached != null) {
          lat = cached.latitude;
          lng = cached.longitude;
        }
      }
    }

    // Launch routes and nearby in parallel.
    final routesFuture = ref.read(routesRepositoryProvider).list();
    final nearbyFuture = lat != null && lng != null
        ? ref.read(routesRepositoryProvider).nearby(
            lat: lat,
            lng: lng,
            radius: 0.3,
          )
        : null;

    // Show routes as soon as they arrive — don't block on nearby.
    final routesResult = await routesFuture;
    switch (routesResult) {
      case Success<List<BusRoute>>(data: final routes):
        if (mounted) setState(() { _routes = routes; _loading = false; });
      case Failure(error: final error):
        if (mounted) setState(() { _error = error.message; _loading = false; });
    }

    // Nearby resolves whenever ready (may already be done).
    if (nearbyFuture != null) {
      final nearbyResult = await nearbyFuture;
      if (nearbyResult is Success<List<BusRoute>> && mounted) {
        setState(() { _nearbyRoutes = nearbyResult.data; });
      }
    }
  }

  void _showRoutePreview(BusRoute route) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (BuildContext ctx) => RoutePreviewSheet(
        route: route,
        onConfirm: () {
          Navigator.of(ctx).pop();
          final dest = ref.read(lastSelectedDestProvider);
          final destParam = dest != null
              ? '&destLat=${dest.lat}&destLng=${dest.lng}'
              : '';
          context.push('/trip/confirm?routeId=${route.id}$destParam');
        },
        onWait: (geometry) {
          Navigator.of(ctx).pop();
          final routeWithGeometry =
              geometry.isNotEmpty ? route.copyWith(geometry: geometry) : route;
          ref.read(selectedWaitingRouteProvider.notifier).state = routeWithGeometry;
          context.go('/map');
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: LoadingIndicator());
    }

    if (_error != null) {
      return ErrorView(
        message: _error!,
        onRetry: _loadRoutes,
      );
    }

    final filtered = _routes.where((route) {
      final q = _search.toLowerCase();
      final company = (route.companyName ?? route.company ?? '').toLowerCase();
      return route.name.toLowerCase().contains(q) ||
          route.code.toLowerCase().contains(q) ||
          company.contains(q);
    }).toList(growable: false);

    return Scaffold(
      appBar: AppBar(title: const Text(AppStrings.tripSelectRoute)),
      body: SafeArea(
        child: CustomScrollView(
          slivers: <Widget>[
            // ── Cerca de ti ────────────────────────────────────────────────
            if (_nearbyRoutes.isNotEmpty) ...<Widget>[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    AppStrings.nearbyTitle,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 96,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: _nearbyRoutes.length,
                    itemBuilder: (context, index) {
                      final route = _nearbyRoutes[index];
                      return _NearbyRouteCard(
                        route: route,
                        onTap: () => _showRoutePreview(route),
                      );
                    },
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 8)),
            ],

            // ── Buscador ───────────────────────────────────────────────────
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: AppTextField(
                  label: AppStrings.tripSearchRouteHint,
                  controller: _searchController,
                  onChanged: (value) => setState(() => _search = value.trim()),
                ),
              ),
            ),

            // ── Contador ───────────────────────────────────────────────────
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                child: Text(
                  '${filtered.length} rutas',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
            ),

            // ── Lista de rutas ─────────────────────────────────────────────
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              sliver: SliverList.separated(
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final route = filtered[index];
                  return _RouteListCard(
                    route: route,
                    onTap: () => _showRoutePreview(route),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NearbyRouteCard extends StatelessWidget {
  final BusRoute route;
  final VoidCallback onTap;

  const _NearbyRouteCard({required this.route, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final company = route.companyName ?? route.company ?? '';
    final badgeColor = AppColors.forRouteCode(route.code);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 160,
        margin: const EdgeInsets.only(right: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: badgeColor.withValues(alpha: 0.3), width: 1.5),
          boxShadow: const <BoxShadow>[
            BoxShadow(color: Color(0x0F000000), blurRadius: 6, offset: Offset(0, 2)),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      RouteCodeBadge(code: route.code),
                      const Spacer(),
                      Icon(Icons.near_me, size: 13, color: badgeColor),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        route.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      if (company.isNotEmpty)
                        Text(
                          company,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RouteListCard extends StatelessWidget {
  final BusRoute route;
  final VoidCallback onTap;

  const _RouteListCard({required this.route, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final company = route.companyName ?? route.company ?? '';
    final badgeColor = AppColors.forRouteCode(route.code);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border(
              left: BorderSide(color: badgeColor, width: 4),
            ),
            boxShadow: const <BoxShadow>[
              BoxShadow(color: Color(0x0F000000), blurRadius: 6, offset: Offset(0, 2)),
            ],
          ),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: <Widget>[
              RouteCodeBadge(code: route.code),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      route.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                        height: 1.3,
                      ),
                    ),
                    if (company.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 2),
                      Text(
                        company,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right, size: 20, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}
