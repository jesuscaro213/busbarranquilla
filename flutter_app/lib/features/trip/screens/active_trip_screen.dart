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
  final MapController _mapController = MapController();
  bool _suspiciousDialogShown = false;
  bool _reportsExpanded = false;
  LatLng? _lastCenter;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(tripNotifierProvider.notifier).setReportResolvedCallback((msg) {
        if (mounted) AppSnackbar.show(context, msg, SnackbarType.info);
      });
    });
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  // Follow the user's GPS as it updates.
  void _followUser(LatLng position) {
    if (_lastCenter == position) return;
    _lastCenter = position;
    try {
      _mapController.move(position, _mapController.camera.zoom);
    } catch (_) {
      // Map not ready yet — ignore.
    }
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

  String _dropoffMessage(DropoffAlert alert) => switch (alert) {
        DropoffAlert.prepare => AppStrings.prepareToAlight,
        DropoffAlert.alight => AppStrings.alightNow,
        DropoffAlert.missed => AppStrings.missedStop,
      };

  @override
  Widget build(BuildContext context) {
    ref.listen<TripState>(tripNotifierProvider, (previous, next) {
      if (next is TripEnded) return;
      if (next is! TripActive) return;
      final prev = previous is TripActive ? previous : null;

      // Follow GPS updates.
      final lat = next.trip.currentLatitude;
      final lng = next.trip.currentLongitude;
      if (lat != null && lng != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _followUser(LatLng(lat, lng)));
      }

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
      if (!next.showSuspiciousModal) _suspiciousDialogShown = false;

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

    // ── Trip ended ───────────────────────────────────────────────────────────
    if (state is TripEnded) {
      final h = state.tripDuration.inHours.toString().padLeft(2, '0');
      final m = (state.tripDuration.inMinutes % 60).toString().padLeft(2, '0');
      return Scaffold(
        appBar: AppBar(title: const Text(AppStrings.tripSummaryTitle)),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: TripSummarySheet(
              routeName: state.routeName,
              durationText: '$h:$m',
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

    // ── Active trip — full-screen map layout ─────────────────────────────────
    final active = state as TripActive;

    final destinationStop = active.trip.destinationStopId != null
        ? active.stops.where((s) => s.id == active.trip.destinationStopId).firstOrNull
        : null;

    final userLat = active.trip.currentLatitude;
    final userLng = active.trip.currentLongitude;
    final center = userLat != null && userLng != null
        ? LatLng(userLat, userLng)
        : (active.route.geometry.isNotEmpty
            ? active.route.geometry.first
            : const LatLng(10.9685, -74.7813));

    final topPadding = MediaQuery.of(context).padding.top;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          // ── Full-screen map ───────────────────────────────────────────────
          FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: center,
              initialZoom: 17,
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: AppStrings.tripTileUrl,
                subdomains: AppStrings.osmTileSubdomains,
                userAgentPackageName: AppStrings.osmUserAgent,
              ),
              if (active.route.geometry.isNotEmpty)
                RoutePolylineLayer(
                  points: active.route.geometry,
                  color: AppColors.primary.withValues(alpha: 0.7),
                  strokeWidth: 5,
                ),
              if (destinationStop != null)
                MarkerLayer(
                  markers: <Marker>[
                    Marker(
                      point: LatLng(destinationStop.latitude, destinationStop.longitude),
                      width: 36,
                      height: 36,
                      child: const Icon(Icons.flag, color: AppColors.success, size: 32),
                    ),
                  ],
                ),
              if (userLat != null && userLng != null)
                MarkerLayer(
                  markers: <Marker>[
                    Marker(
                      point: LatLng(userLat, userLng),
                      width: 44,
                      height: 44,
                      child: Container(
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: <BoxShadow>[
                            BoxShadow(
                              color: AppColors.primary.withValues(alpha: 0.4),
                              blurRadius: 10,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                        child: const Icon(Icons.directions_bus, color: Colors.white, size: 22),
                      ),
                    ),
                  ],
                ),
            ],
          ),

          // ── Top card: route name + report button ─────────────────────────
          Positioned(
            top: topPadding + 8,
            left: 12,
            right: 12,
            child: Material(
              borderRadius: BorderRadius.circular(14),
              elevation: 4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.primaryDark,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.directions_bus, color: Colors.white, size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        active.route.name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _TripDurationText(startedAt: active.trip.startedAt),
                    const SizedBox(width: 12),
                    Text(
                      '${active.trip.creditsEarned} cr',
                      style: const TextStyle(
                        color: Colors.amber,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(width: 8),
                    GestureDetector(
                      onTap: () {
                        AppBottomSheet.show<void>(
                          context,
                          child: RouteUpdateSheet(routeId: active.route.id),
                        );
                      },
                      child: const Icon(Icons.warning_amber_outlined, color: Colors.white70, size: 20),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // ── GPS lost banner ───────────────────────────────────────────────
          if (active.gpsLost)
            Positioned(
              top: topPadding + 64,
              left: 12,
              right: 12,
              child: Material(
                borderRadius: BorderRadius.circular(10),
                color: Colors.orange.shade700,
                elevation: 3,
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Text(
                    AppStrings.gpsLostBanner,
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),

          // ── Dropoff alert banner ──────────────────────────────────────────
          if (active.dropoffAlert != null)
            Positioned(
              top: active.gpsLost ? topPadding + 112 : topPadding + 64,
              left: 12,
              right: 12,
              child: Material(
                borderRadius: BorderRadius.circular(10),
                color: active.dropoffAlert == DropoffAlert.alight
                    ? AppColors.error
                    : AppColors.warning,
                elevation: 3,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Text(
                    _dropoffMessage(active.dropoffAlert!),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),

          // ── Occupancy badge ───────────────────────────────────────────────
          if (active.occupancyState != null)
            Positioned(
              top: topPadding + 64,
              right: 12,
              child: _OccupancyBadge(state: active.occupancyState!),
            ),

          // ── Re-center button ──────────────────────────────────────────────
          Positioned(
            right: 12,
            bottom: 160,
            child: FloatingActionButton.small(
              heroTag: 'recenter',
              backgroundColor: Colors.white,
              onPressed: () => _mapController.move(center, 17),
              child: const Icon(Icons.my_location, color: AppColors.primary),
            ),
          ),

          // ── Bottom panel: reports (collapsible) + action buttons ──────────
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // Reports collapsible
                if (active.reports.isNotEmpty || _reportsExpanded)
                  GestureDetector(
                    onTap: () => setState(() => _reportsExpanded = !_reportsExpanded),
                    child: Container(
                      color: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: <Widget>[
                          Text(
                            '${AppStrings.tripReportsTitle} (${active.reports.length})',
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                          ),
                          Icon(
                            _reportsExpanded ? Icons.expand_more : Icons.expand_less,
                            size: 20,
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_reportsExpanded)
                  Container(
                    color: Colors.white,
                    constraints: const BoxConstraints(maxHeight: 200),
                    child: RouteReportsList(
                      reports: active.reports,
                      onConfirm: (reportId) =>
                          ref.read(tripNotifierProvider.notifier).confirmReport(reportId),
                    ),
                  ),

                // Action bar
                Container(
                  padding: EdgeInsets.only(
                    left: 16,
                    right: 16,
                    top: 12,
                    bottom: MediaQuery.of(context).padding.bottom + 12,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    boxShadow: <BoxShadow>[
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.1),
                        blurRadius: 12,
                        offset: const Offset(0, -3),
                      ),
                    ],
                  ),
                  child: Row(
                    children: <Widget>[
                      // Report FAB
                      Expanded(
                        child: OutlinedButton.icon(
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
                          icon: const Icon(Icons.report_outlined, size: 18),
                          label: const Text(AppStrings.tripReportFab),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Me bajé
                      Expanded(
                        flex: 2,
                        child: AppButton.destructive(
                          label: AppStrings.tripEndButton,
                          onPressed: () => ref.read(tripNotifierProvider.notifier).endTrip(),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Isolated timer widget ─────────────────────────────────────────────────────
class _TripDurationText extends StatefulWidget {
  final DateTime? startedAt;

  const _TripDurationText({this.startedAt});

  @override
  State<_TripDurationText> createState() => _TripDurationTextState();
}

class _TripDurationTextState extends State<_TripDurationText> {
  Timer? _ticker;

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

  @override
  Widget build(BuildContext context) {
    final duration = widget.startedAt != null
        ? DateTime.now().difference(widget.startedAt!)
        : Duration.zero;
    final h = duration.inHours.toString().padLeft(2, '0');
    final m = (duration.inMinutes % 60).toString().padLeft(2, '0');
    final s = (duration.inSeconds % 60).toString().padLeft(2, '0');
    return Text(
      '$h:$m:$s',
      style: const TextStyle(color: Colors.white70, fontSize: 13),
    );
  }
}

// ── Occupancy badge ───────────────────────────────────────────────────────────
class _OccupancyBadge extends StatelessWidget {
  final String state;

  const _OccupancyBadge({required this.state});

  @override
  Widget build(BuildContext context) {
    final isLleno = state == 'lleno';
    return Material(
      borderRadius: BorderRadius.circular(20),
      color: isLleno ? Colors.red.shade600 : Colors.green.shade600,
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(
              isLleno ? Icons.circle : Icons.circle_outlined,
              size: 8,
              color: Colors.white,
            ),
            const SizedBox(width: 5),
            Text(
              isLleno ? AppStrings.occupancyLleno : AppStrings.occupancyDisponible,
              style: const TextStyle(
                fontSize: 12,
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
