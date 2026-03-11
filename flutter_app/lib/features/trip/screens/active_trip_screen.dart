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
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';
import '../widgets/report_create_sheet.dart';
import '../widgets/route_reports_list.dart';
import '../widgets/route_update_sheet.dart';
import '../widgets/trip_summary_sheet.dart';

class ActiveTripScreen extends ConsumerStatefulWidget {
  const ActiveTripScreen({super.key});

  @override
  ConsumerState<ActiveTripScreen> createState() => _ActiveTripScreenState();
}

class _ActiveTripScreenState extends ConsumerState<ActiveTripScreen> {
  Timer? _ticker;
  Duration _duration = Duration.zero;
  bool _suspiciousDialogShown = false;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(tripNotifierProvider.notifier).setReportResolvedCallback((msg) {
        if (mounted) AppSnackbar.show(context, msg, SnackbarType.info);
      });
    });
  }

  void _showInactivityDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.stillOnBus),
        content: const Text(AppStrings.stillOnBusBody),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).markInactivityResponded();
            },
            child: const Text(AppStrings.stillOnBusYes),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).endTrip();
            },
            child: const Text(AppStrings.tripEndButton),
          ),
        ],
      ),
    );
  }

  void _showDropoffPrompt() {
    final notifier = ref.read(tripNotifierProvider.notifier);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.dropoffPromptTitle),
        content: const Text(AppStrings.dropoffPromptBody),
        actions: <Widget>[
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              notifier.dismissDropoffPrompt();
            },
            child: const Text(AppStrings.dropoffPromptDecline),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              notifier.activateDropoffAlerts();
            },
            child: const Text(AppStrings.dropoffPromptAccept),
          ),
        ],
      ),
    );
  }

  void _showSuspiciousDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.suspiciousTitle),
        content: const Text(AppStrings.suspiciousBody),
        actions: <Widget>[
          FilledButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).dismissSuspiciousModal();
            },
            child: const Text(AppStrings.ok),
          ),
        ],
      ),
    );
  }

  void _showDesvioDialog() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.desvioTitle),
        content: const Text(AppStrings.desvioBody),
        actions: <Widget>[
          TextButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).dismissDesvio();
              await ref.read(tripNotifierProvider.notifier).createReport('desvio');
            },
            child: const Text(AppStrings.desvioReport),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).endTrip();
            },
            child: const Text(AppStrings.desvioGetOff),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).ignoreDesvio();
            },
            child: const Text(AppStrings.desvioIgnore),
          ),
        ],
      ),
    );
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
    ref.listen<TripState>(tripNotifierProvider, (previous, next) {
      if (next is TripEnded) return; // handled below

      if (next is! TripActive) return;
      final prev = previous is TripActive ? previous : null;

      if (next.showInactivityModal && prev?.showInactivityModal != true) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _showInactivityDialog());
      }
      if (next.desvioDetected && prev?.desvioDetected != true) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _showDesvioDialog());
      }
      if (next.dropoffPrompt && prev?.dropoffPrompt != true) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _showDropoffPrompt());
      }
      if (next.showSuspiciousModal && prev?.showSuspiciousModal != true) {
        if (!_suspiciousDialogShown) {
          _suspiciousDialogShown = true;
          WidgetsBinding.instance.addPostFrameCallback((_) => _showSuspiciousDialog());
        }
      }
      if (!next.showSuspiciousModal) {
        _suspiciousDialogShown = false;
      }
      if (next.reportError != null && prev?.reportError != next.reportError) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            AppSnackbar.show(context, next.reportError!, SnackbarType.error);
            ref.read(tripNotifierProvider.notifier).clearReportError();
          }
        });
      }
    });

    final state = ref.watch(tripNotifierProvider);

    if (state is TripEnded) {
      final h = state.tripDuration.inHours.toString().padLeft(2, '0');
      final m = (state.tripDuration.inMinutes % 60).toString().padLeft(2, '0');
      final durationText = '$h:$m';

      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.tripSummaryTitle)),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: TripSummarySheet(
              routeName: state.routeName,
              durationText: durationText,
              creditsEarned: state.totalCreditsEarned,
              distanceMeters: state.distanceMeters,
              completionBonusEarned: state.completionBonusEarned,
              onClose: () {
                ref.read(tripNotifierProvider.notifier).resetToIdle();
                if (mounted) context.go('/map');
              },
            ),
          ),
        ),
      );
    }

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

    final userLat = active.trip.currentLatitude;
    final userLng = active.trip.currentLongitude;
    final center = userLat != null && userLng != null
        ? LatLng(userLat, userLng)
        : (active.route.geometry.isNotEmpty
            ? active.route.geometry.first
            : const LatLng(10.9685, -74.7813));

    return Scaffold(
      appBar: AppBar(
        title: Text(active.route.name),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.warning_amber_outlined),
            tooltip: AppStrings.reportRouteTitle,
            onPressed: () {
              AppBottomSheet.show<void>(
                context,
                child: RouteUpdateSheet(routeId: active.route.id),
              );
            },
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (active.gpsLost) ...<Widget>[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  color: Colors.orange.shade700,
                  child: const Text(
                    AppStrings.gpsLostBanner,
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),
              ],
              if (active.dropoffAlert != null) ...<Widget>[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.15),
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
              if (active.occupancyState != null) ...<Widget>[
                const SizedBox(height: 6),
                _OccupancyBadge(state: active.occupancyState!),
              ],
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
                    if (userLat != null && userLng != null)
                      MarkerLayer(
                        markers: <Marker>[
                          Marker(
                            point: LatLng(userLat, userLng),
                            width: 36,
                            height: 36,
                            child: Container(
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Icon(Icons.directions_bus, color: Colors.white, size: 20),
                            ),
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
                onConfirm: (reportId) =>
                    ref.read(tripNotifierProvider.notifier).confirmReport(reportId),
              ),
              const SizedBox(height: 12),
              AppButton.destructive(
                label: AppStrings.tripEndButton,
                onPressed: () => ref.read(tripNotifierProvider.notifier).endTrip(),
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

class _OccupancyBadge extends StatelessWidget {
  final String state;

  const _OccupancyBadge({required this.state});

  @override
  Widget build(BuildContext context) {
    final isLleno = state == 'lleno';
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(
          isLleno ? Icons.circle : Icons.circle_outlined,
          size: 10,
          color: isLleno ? Colors.red : Colors.green,
        ),
        const SizedBox(width: 6),
        Text(
          isLleno ? AppStrings.occupancyLleno : AppStrings.occupancyDisponible,
          style: TextStyle(
            fontSize: 12,
            color: isLleno ? Colors.red : Colors.green,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
