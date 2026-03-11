import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../shared/widgets/app_text_field.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_code_badge.dart';

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

    final results = await Future.wait<dynamic>(<Future<dynamic>>[
      ref.read(routesRepositoryProvider).list(),
      LocationService.getCurrentPosition(),
    ]);

    final routesResult = results[0] as Result<List<BusRoute>>;
    final position = results[1] as Position?;

    if (position != null) {
      final nearbyResult = await ref.read(routesRepositoryProvider).nearby(
        lat: position.latitude,
        lng: position.longitude,
        radius: 0.3,
      );
      if (nearbyResult is Success<List<BusRoute>>) {
        setState(() {
          _nearbyRoutes = nearbyResult.data;
        });
      }
    }

    switch (routesResult) {
      case Success<List<BusRoute>>(data: final routes):
        setState(() {
          _routes = routes;
          _loading = false;
        });
      case Failure(error: final error):
        setState(() {
          _error = error.message;
          _loading = false;
        });
    }
  }

  void _goToConfirm(int routeId) {
    context.push('/trip/confirm?routeId=$routeId');
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
      return route.name.toLowerCase().contains(q) || route.code.toLowerCase().contains(q);
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
                      onTap: () => _goToConfirm(route.id),
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
                    onTap: () => _goToConfirm(route.id),
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
          border: Border.all(color: Theme.of(context).dividerColor),
          borderRadius: BorderRadius.circular(10),
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
