import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/socket/socket_service.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../shared/widgets/error_view.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../providers/map_provider.dart';
import '../providers/map_state.dart';
import '../widgets/active_feed_bar.dart';
import '../widgets/bus_marker_layer.dart';
import '../widgets/report_marker_layer.dart';

class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen> {
  @override
  void initState() {
    super.initState();
    Future<void>(() async {
      final token = await ref.read(secureStorageProvider).readToken();
      if (token != null && token.isNotEmpty) {
        ref.read(socketServiceProvider).connect(token);
      }

      await ref.read(mapNotifierProvider.notifier).initialize();
    });
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
    final center = ready.userPosition ?? const LatLng(10.9685, -74.7813);

    return Scaffold(
      body: Stack(
        children: <Widget>[
          FlutterMap(
            options: MapOptions(
              initialCenter: center,
              initialZoom: 13,
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: AppStrings.osmTileUrl,
                userAgentPackageName: AppStrings.osmUserAgent,
              ),
              if (selectedRoute != null && selectedRoute.geometry.isNotEmpty)
                RoutePolylineLayer(points: selectedRoute.geometry),
              ReportMarkerLayer(
                reports: ready.reports,
                activeTripRouteId: ready.activeTripRouteId,
                onConfirm: (reportId) => ref.read(mapNotifierProvider.notifier).confirmReport(reportId),
              ),
              BusMarkerLayer(buses: ready.buses),
            ],
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.go('/trip/boarding'),
        label: const Text(AppStrings.boardedButton),
        icon: const Icon(Icons.directions_bus),
      ),
    );
  }
}
