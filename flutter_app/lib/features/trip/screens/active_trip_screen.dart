import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';
import '../widgets/report_create_sheet.dart';
import '../widgets/route_reports_list.dart';
import '../widgets/trip_summary_sheet.dart';

class ActiveTripScreen extends ConsumerStatefulWidget {
  const ActiveTripScreen({super.key});

  @override
  ConsumerState<ActiveTripScreen> createState() => _ActiveTripScreenState();
}

class _ActiveTripScreenState extends ConsumerState<ActiveTripScreen> {
  Timer? _ticker;
  Duration _duration = Duration.zero;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  String _durationText(Duration duration) {
    final h = duration.inHours.toString().padLeft(2, '0');
    final m = (duration.inMinutes % 60).toString().padLeft(2, '0');
    final s = (duration.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  String _dropoffMessage(DropoffAlert alert) {
    return switch (alert) {
      DropoffAlert.prepare => AppStrings.prepareToAlight,
      DropoffAlert.alight => AppStrings.alightNow,
      DropoffAlert.missed => AppStrings.missedStop,
    };
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(tripNotifierProvider);

    if (state is TripIdle) {
      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.tabTrip)),
        body: const Center(child: Text(AppStrings.tripStartFirst)),
      );
    }

    if (state is TripLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.tabTrip)),
        body: const LoadingIndicator(),
      );
    }

    if (state is TripError) {
      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.tabTrip)),
        body: Center(child: Text(state.message)),
      );
    }

    final active = state as TripActive;
    final startedAt = active.trip.startedAt;
    _duration = startedAt != null ? DateTime.now().difference(startedAt) : Duration.zero;

    final destinationStop = active.trip.destinationStopId != null
        ? (() {
            for (final stop in active.stops) {
              if (stop.id == active.trip.destinationStopId) return stop;
            }
            return null;
          })()
        : null;

    final center = active.trip.currentLatitude != null && active.trip.currentLongitude != null
        ? LatLng(active.trip.currentLatitude!, active.trip.currentLongitude!)
        : (active.route.geometry.isNotEmpty ? active.route.geometry.first : const LatLng(10.9685, -74.7813));

    return Scaffold(
      appBar: AppBar(title: Text(active.route.name)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (active.dropoffAlert != null) ...<Widget>[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    _dropoffMessage(active.dropoffAlert!),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 10),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text('${AppStrings.tripDurationLabel}: ${_durationText(_duration)}'),
                  Text('${AppStrings.tripCreditsLabel}: ${active.trip.creditsEarned}'),
                ],
              ),
              const SizedBox(height: 10),
              SizedBox(
                height: 260,
                child: FlutterMap(
                  options: MapOptions(initialCenter: center, initialZoom: 13),
                  children: <Widget>[
                    TileLayer(
                      urlTemplate: AppStrings.osmTileUrl,
                      userAgentPackageName: AppStrings.osmUserAgent,
                    ),
                    if (active.route.geometry.isNotEmpty)
                      RoutePolylineLayer(
                        points: active.route.geometry,
                        color: AppColors.success,
                      ),
                    if (destinationStop != null)
                      MarkerLayer(
                        markers: <Marker>[
                          Marker(
                            point: LatLng(destinationStop.latitude, destinationStop.longitude),
                            width: 30,
                            height: 30,
                            child: const Icon(Icons.flag, color: AppColors.success),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(AppStrings.tripReportsTitle, style: Theme.of(context).textTheme.titleMedium),
              RouteReportsList(
                reports: active.reports,
                onConfirm: (reportId) => ref.read(tripNotifierProvider.notifier).confirmReport(reportId),
              ),
              const SizedBox(height: 12),
              AppButton.destructive(
                label: AppStrings.tripEndButton,
                onPressed: () async {
                  final routeName = active.route.name;
                  final credits = active.trip.creditsEarned;
                  final duration = _durationText(_duration);

                  await ref.read(tripNotifierProvider.notifier).endTrip();

                  if (!context.mounted) return;
                  await AppBottomSheet.show<void>(
                    context,
                    title: AppStrings.tripSummaryTitle,
                    child: TripSummarySheet(
                      routeName: routeName,
                      durationText: duration,
                      creditsEarned: credits,
                      onClose: () => context.pop(),
                    ),
                  );

                  if (context.mounted) {
                    context.go('/map');
                  }
                },
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          AppBottomSheet.show<void>(
            context,
            title: AppStrings.tripReportFab,
            child: ReportCreateSheet(
              onSelectType: (type) async {
                context.pop();
                await ref.read(tripNotifierProvider.notifier).createReport(type);
              },
            ),
          );
        },
        label: const Text(AppStrings.tripReportFab),
        icon: const Icon(Icons.report),
      ),
    );
  }
}
