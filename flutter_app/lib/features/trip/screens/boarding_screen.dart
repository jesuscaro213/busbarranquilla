import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
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

    final result = await ref.read(routesRepositoryProvider).list();
    switch (result) {
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
                    onTap: () => context.go('/trip/stop-select?routeId=${route.id}'),
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
