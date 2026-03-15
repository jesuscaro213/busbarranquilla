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
          context.push('/trip/confirm?routeId=${route.id}');
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
        child: Column(
          children: <Widget>[
            if (_nearbyRoutes.isNotEmpty) ...<Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                child: Text(
                  AppStrings.nearbyTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                height: 110,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
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
              const SizedBox(height: 4),
            ],
            Padding(
              padding: const EdgeInsets.all(12),
              child: AppTextField(
                label: AppStrings.tripSearchRouteHint,
                controller: _searchController,
                onChanged: (value) => setState(() => _search = value.trim()),
              ),
            ),
            Expanded(
              child: ListView.separated(
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final route = filtered[index];

                  return ListTile(
                    onTap: () => _showRoutePreview(filtered[index]),
                    title: Text(route.name),
                    subtitle: Text(route.companyName ?? route.company ?? ''),
                    leading: RouteCodeBadge(code: route.code),
                    trailing: const Icon(Icons.chevron_right),
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

  const _NearbyRouteCard({
    required this.route,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 200,
        margin: const EdgeInsets.only(right: 10),
        padding: const EdgeInsets.all(12),
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
            RouteCodeBadge(code: route.code),
            const SizedBox(height: 6),
            Text(
              route.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            if ((route.companyName ?? route.company ?? '').isNotEmpty)
              Text(
                route.companyName ?? route.company ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
    );
  }
}
