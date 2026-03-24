import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_tile_caching/flutter_map_tile_caching.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/analytics/analytics_service.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/widgets/app_bottom_sheet.dart';
import '../../../shared/widgets/app_button.dart';
import '../../../shared/widgets/app_snackbar.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/route_polyline_layer.dart';
import '../../map/providers/map_active_positions_provider.dart';
import '../../planner/models/nominatim_result.dart';
import '../../planner/providers/planner_notifier.dart';
import '../providers/trip_notifier.dart';
import '../providers/trip_state.dart';
import '../widgets/report_create_sheet.dart';
import '../widgets/route_reports_list.dart';

class ActiveTripScreen extends ConsumerStatefulWidget {
  const ActiveTripScreen({super.key});

  @override
  ConsumerState<ActiveTripScreen> createState() => _ActiveTripScreenState();
}

class _ActiveTripScreenState extends ConsumerState<ActiveTripScreen>
    with TickerProviderStateMixin {
  final MapController _mapController = MapController();
  bool _suspiciousDialogShown = false;
  bool _desvioEscalateDialogShown = false;
  BuildContext? _activeDesvioDialogCtx;
  BuildContext? _activeDesvioEscalateDialogCtx;
  bool _reportsExpanded = false;
  LatLng? _lastCenter;
  bool _autoFollow = true;

  // Credit gain animation
  late final AnimationController _creditAnimController;
  late final Animation<Offset> _creditSlide;
  late final Animation<double> _creditFade;
  int _creditGain = 0;
  late final AnimationController _destAnimController;
  late final Animation<double> _destPulse;

  ProviderSubscription<TripState>? _tripStateSub;
  ProviderSubscription<TripState>? _desvioConfirmSub;

  @override
  void initState() {
    super.initState();
    _creditAnimController = AnimationController(
      duration: const Duration(milliseconds: 1600),
      vsync: this,
    );
    _creditSlide = Tween<Offset>(
      begin: Offset.zero,
      end: const Offset(0, -3),
    ).animate(CurvedAnimation(
      parent: _creditAnimController,
      curve: Curves.easeOut,
    ));
    _creditFade = Tween<double>(begin: 1, end: 0).animate(
      CurvedAnimation(
        parent: _creditAnimController,
        curve: const Interval(0.45, 1.0, curve: Curves.easeIn),
      ),
    );
    _destAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);
    _destPulse = Tween<double>(begin: 1.0, end: 1.22).animate(
      CurvedAnimation(parent: _destAnimController, curve: Curves.easeInOut),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final notifier = ref.read(tripNotifierProvider.notifier);
      notifier.setReportResolvedCallback((msg) {
        if (mounted) AppSnackbar.show(context, msg, SnackbarType.info);
      });
      notifier.setDeviationReEntryCallback((msg) {
        if (mounted) AppSnackbar.show(context, msg, SnackbarType.success);
      });
      notifier.setReturnToRouteCallback(() {
        if (mounted) {
          AppSnackbar.show(context, AppStrings.desvioReturnedTitle, SnackbarType.success);
        }
      });
      notifier.setForceCloseDesvioDialogsCallback(() {
        final desvioCtx = _activeDesvioDialogCtx;
        if (desvioCtx != null && desvioCtx.mounted) {
          Navigator.of(desvioCtx).pop();
        }
        final escalateCtx = _activeDesvioEscalateDialogCtx;
        if (escalateCtx != null && escalateCtx.mounted) {
          Navigator.of(escalateCtx).pop();
        }
      });
      // The dropoff prompt may already be true when this screen first mounts
      // (state was set before navigation — ref.listen misses that transition).
      // Check it once here to ensure the dialog always appears.
      final s = ref.read(tripNotifierProvider);
      if (s is TripActive && s.dropoffPrompt) {
        _showDropoffPrompt();
      }
      if (s is TripActive && s.dropoffAutoPickDestination) {
        ref.read(tripNotifierProvider.notifier).clearDropoffAutoPickDestination();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
      if (s is TripActive && s.showInactivityModal) {
        _showInactivityDialog();
      }
      if (s is TripActive && s.noMapPickRequested) {
        ref.read(tripNotifierProvider.notifier).clearMapPickRequest();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
    });
    _tripStateSub = ref.listenManual<TripState>(tripNotifierProvider, (previous, next) {
      if (next is TripEnded) return;
      if (next is! TripActive) return;
      final prev = previous is TripActive ? previous : null;

      // Follow GPS updates.
      final lat = next.trip.currentLatitude;
      final lng = next.trip.currentLongitude;
      if (lat != null && lng != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _followUser(LatLng(lat, lng)));
      }

      // Credit gain animation.
      final gained = next.trip.creditsEarned - (prev?.trip.creditsEarned ?? 0);
      if (gained > 0) {
        _creditGain = gained;
        _creditAnimController.forward(from: 0);
      }

      if (next.showInactivityModal && prev?.showInactivityModal != true) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _showInactivityDialog());
      }
      if (next.desvioDetected && prev?.desvioDetected != true) {
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _showDesvioDialog(isRepeat: next.desvioIsRepeat),
        );
      }
      if (next.showDesvioEscalate && prev?.showDesvioEscalate != true) {
        if (!_desvioEscalateDialogShown) {
          _desvioEscalateDialogShown = true;
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => _showDesvioEscalateDialog(isTranscon: next.desvioEscalateIsTranscon),
          );
        }
      }
      if (!next.showDesvioEscalate) _desvioEscalateDialogShown = false;
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

      if (next.infoMessage != null && prev?.infoMessage != next.infoMessage) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            AppSnackbar.show(context, next.infoMessage!, SnackbarType.info);
            ref.read(tripNotifierProvider.notifier).clearInfoMessage();
          }
        });
      }

      if (next.dropoffAutoPickDestination && prev?.dropoffAutoPickDestination != true) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            ref.read(tripNotifierProvider.notifier).clearDropoffAutoPickDestination();
            _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
          }
        });
      }
      if (next.noMapPickRequested && prev?.noMapPickRequested != true) {
        ref.read(tripNotifierProvider.notifier).clearMapPickRequest();
        _pickDestinationOnMap(ref.read(tripNotifierProvider.notifier));
      }
    });
    _desvioConfirmSub = ref.listenManual<TripState>(tripNotifierProvider, (prev, next) {
      if (next is! TripActive) return;
      final wasConfirm = prev is TripActive && prev.desvioConfirmPending;
      if (!wasConfirm && next.desvioConfirmPending) {
        _showDesvioConfirmSheet();
      }
    });
  }

  @override
  void dispose() {
    _tripStateSub?.close();
    _desvioConfirmSub?.close();
    _mapController.dispose();
    _creditAnimController.dispose();
    _destAnimController.dispose();
    super.dispose();
  }

  // Follow the user's GPS as it updates — only when auto-follow is enabled.
  void _followUser(LatLng position) {
    if (!_autoFollow) return;
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
    final tripState = ref.read(tripNotifierProvider);
    final hasDestination =
        tripState is TripActive && tripState.trip.destinationStopId != null;

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
              if (hasDestination) {
                notifier.activateDropoffAlerts();
              } else {
                notifier.dismissDropoffPrompt();
                if (mounted) _pickDestinationOnMap(notifier);
              }
            },
            child: const Text(AppStrings.dropoffPromptAccept),
          ),
        ],
      ),
    );
  }

  Future<void> _pickDestinationOnMap(TripNotifier notifier) async {
    final tripState = ref.read(tripNotifierProvider);
    double? initLat, initLng;
    if (tripState is TripActive) {
      // No destination set yet — center on current GPS.
      initLat = tripState.trip.currentLatitude;
      initLng = tripState.trip.currentLongitude;
    }

    final result = await context.push<NominatimResult>(
      '/map-pick${initLat != null ? '?lat=$initLat&lng=$initLng' : ''}',
    );

    if (!mounted || result == null) return;

    final confirmed = await _showDestinationConfirm(result.displayName);
    if (!mounted || confirmed != true) return;

    await notifier.setDestinationByLatLng(result.lat, result.lng, result.displayName);
    if (mounted) {
      AppSnackbar.show(context, AppStrings.dropoffDestinationSet, SnackbarType.success);
    }
    unawaited(AnalyticsService.destinationSet('map_pick'));
    unawaited(AnalyticsService.dropoffAlertActivated());
  }

  Future<void> _changeDestination() async {
    final notifier = ref.read(tripNotifierProvider.notifier);
    final tripState = ref.read(tripNotifierProvider);
    double? initLat, initLng;
    if (tripState is TripActive) {
      final trip = tripState.trip;
      // Priority 1: active monitor destination — covers both planner trips
      // (real stop) and map-pick trips (synthetic stop). Most accurate.
      final monitorDest = notifier.dropoffMonitorDestination;
      if (monitorDest != null) {
        initLat = monitorDest.latitude;
        initLng = monitorDest.longitude;
      } else {
        // Priority 2: destination stop from the stops list (free user on planner
        // trip whose monitor hasn't started yet because they haven't paid).
        final destStop = trip.destinationStopId != null
            ? tripState.stops
                .where((s) => s.id == trip.destinationStopId)
                .firstOrNull
            : null;
        if (destStop != null) {
          initLat = destStop.latitude;
          initLng = destStop.longitude;
        } else {
          // Priority 3: current GPS fallback.
          initLat = trip.currentLatitude;
          initLng = trip.currentLongitude;
        }
      }
    }

    final result = await context.push<NominatimResult>(
      '/map-pick${initLat != null ? '?lat=$initLat&lng=$initLng' : ''}',
    );

    if (!mounted || result == null) return;

    final confirmed = await _showDestinationConfirm(result.displayName);
    if (!mounted || confirmed != true) return;

    if (notifier.hasDropoffMonitor) {
      notifier.updateDestinationByLatLng(result.lat, result.lng, result.displayName);
      if (mounted) AppSnackbar.show(context, AppStrings.dropoffDestinationSet, SnackbarType.success);
    } else {
      await notifier.setDestinationByLatLng(result.lat, result.lng, result.displayName);
      if (mounted) AppSnackbar.show(context, AppStrings.dropoffDestinationSet, SnackbarType.success);
    }
    unawaited(AnalyticsService.destinationSet('stop_list'));
    unawaited(AnalyticsService.dropoffAlertActivated());
  }

  Future<bool?> _showDestinationConfirm(String locationName) {
    return showModalBottomSheet<bool>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Icon(Icons.flag, color: AppColors.accent, size: 32),
            const SizedBox(height: 12),
            Text(
              AppStrings.tripChangeDestination,
              style: Theme.of(ctx).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              locationName,
              style: Theme.of(ctx).textTheme.bodyMedium,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 24),
            AppButton.primary(
              label: AppStrings.dropoffConfirmButton,
              onPressed: () => Navigator.of(ctx).pop(true),
            ),
            const SizedBox(height: 4),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text(AppStrings.dropoffCancelButton, style: TextStyle(color: AppColors.textSecondary)),
            ),
          ],
        ),
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

  void _confirmEndTrip() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text(AppStrings.tripEndConfirmTitle),
        content: const Text(AppStrings.tripEndConfirmBody),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text(AppStrings.tripEndConfirmNo),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () {
              Navigator.of(ctx).pop();
              ref.read(tripNotifierProvider.notifier).endTrip();
            },
            child: const Text(AppStrings.tripEndConfirmYes),
          ),
        ],
      ),
    );
  }

  void _showDesvioDialog({required bool isRepeat}) {
    showDialog<void>(
      context: context,
      builder: (ctx) {
        _activeDesvioDialogCtx = ctx;
        return AlertDialog(
          title: Text(isRepeat ? AppStrings.desvioRepeatTitle : AppStrings.desvioTitle),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                isRepeat ? AppStrings.desvioRepeatBody : AppStrings.desvioBody,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 16),
              _DesvioOption(
                icon: Icons.alt_route,
                color: Colors.orange,
                title: AppStrings.desvioTemporal,
                subtitle: AppStrings.desvioTemporalDesc,
                onTap: () async {
                  Navigator.of(ctx).pop();
                  ref.read(tripNotifierProvider.notifier).dismissDesvio('trancon');
                  await ref.read(tripNotifierProvider.notifier).createReport('desvio');
                },
              ),
              const SizedBox(height: 10),
              _DesvioOption(
                icon: Icons.map_outlined,
                color: AppColors.error,
                title: AppStrings.desvioRutaDiferente,
                subtitle: AppStrings.desvioRutaDiferenteDesc,
                onTap: () async {
                  Navigator.of(ctx).pop();
                  // Capture context-dependent objects before any await.
                  final s = ref.read(tripNotifierProvider);
                  final messenger = ScaffoldMessenger.of(context);
                  // Create a desvio report first so the episode has start/end
                  // tracking (_desvioReportId) — identical to the trancon path.
                  await ref.read(tripNotifierProvider.notifier).createReport('desvio');
                  ref.read(tripNotifierProvider.notifier).dismissDesvio('ruta_real');
                  if (s is TripActive) {
                    final result = await ref
                        .read(tripNotifierProvider.notifier)
                        .reportRutaReal(s.route.id, s.route.geometry);
                    if (!mounted) return;
                    _showRutaRealResult(messenger, result);
                  }
                },
              ),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        ref.read(tripNotifierProvider.notifier).ignoreDesvio();
                      },
                      icon: const Icon(Icons.snooze, size: 16),
                      label: const Text(AppStrings.desvioIgnore),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        ref.read(tripNotifierProvider.notifier).endTrip();
                      },
                      icon: const Icon(Icons.logout, size: 16),
                      label: const Text(AppStrings.desvioGetOff),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    ).then((_) => _activeDesvioDialogCtx = null);
  }

  void _showDesvioEscalateDialog({required bool isTranscon}) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        _activeDesvioEscalateDialogCtx = ctx;
        return AlertDialog(
          title: Text(isTranscon
              ? AppStrings.desvioEscalateTransconTitle
              : AppStrings.desvioEscalateTitle),
          content: Text(isTranscon
              ? AppStrings.desvioEscalateTransconBody
              : AppStrings.desvioEscalateBody),
          actions: <Widget>[
            FilledButton(
              onPressed: () {
                Navigator.of(ctx).pop();
                ref.read(tripNotifierProvider.notifier).dismissDesvioEscalate();
              },
              child: const Text(AppStrings.stillOnBusYes),
            ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.error),
              onPressed: () {
                Navigator.of(ctx).pop();
                ref.read(tripNotifierProvider.notifier).endTrip();
              },
              icon: const Icon(Icons.logout, size: 16),
              label: const Text(AppStrings.desvioGetOff),
            ),
          ],
        );
      },
    ).then((_) => _activeDesvioEscalateDialogCtx = null);
  }

  void _showDesvioConfirmSheet() {
    AppBottomSheet.show<void>(
      context,
      title: AppStrings.desvioConfirmTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text(AppStrings.desvioConfirmBody),
          const SizedBox(height: 16),
          AppButton.primary(
            label: AppStrings.desvioConfirmYes,
            onPressed: () {
              context.pop();
              ref.read(tripNotifierProvider.notifier).acknowledgeDesvioConfirm();
            },
          ),
          const SizedBox(height: 8),
          AppButton.secondary(
            label: AppStrings.desvioConfirmNo,
            onPressed: () {
              context.pop();
              ref.read(tripNotifierProvider.notifier).resetDesvioConfirm();
            },
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

  void _showRutaRealResult(ScaffoldMessengerState messenger, String result) {
    final (String msg, Color color) = switch (result) {
      'on_route' => (AppStrings.desvioRutaRealOnRoute, AppColors.primaryDark),
      'ok' => (AppStrings.desvioRutaRealSent, AppColors.success),
      _ => (AppStrings.errorUnknown, AppColors.error),
    };
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: color,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(tripNotifierProvider);

    // ── Trip ended — full summary screen ─────────────────────────────────────
    if (state is TripEnded) {
      return _TripSummaryScreen(
        ended: state,
        onClose: () {
          ref.read(tripNotifierProvider.notifier).resetToIdle();
          ref.read(plannerNotifierProvider.notifier).reset();
          ref.read(mapActivePositionsProvider.notifier).state = const <LatLng>[];
          if (mounted) context.go('/map');
        },
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
              onPositionChanged: (_, hasGesture) {
                if (hasGesture && _autoFollow) {
                  setState(() => _autoFollow = false);
                }
              },
            ),
            children: <Widget>[
              TileLayer(
                urlTemplate: AppStrings.tripTileUrl,
                subdomains: AppStrings.osmTileSubdomains,
                userAgentPackageName: AppStrings.osmUserAgent,
                keepBuffer: 3,
                panBuffer: 1,
                tileProvider: const FMTCStore('mapTiles').getTileProvider(
                  settings: FMTCTileProviderSettings(
                    cachedValidDuration: const Duration(days: 30),
                  ),
                ),
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
                    // Timer badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: _TripDurationText(startedAt: active.trip.startedAt),
                    ),
                    const SizedBox(width: 8),
                    // Credits badge
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.amber,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '+${active.trip.creditsEarned} cr',
                        style: const TextStyle(
                          color: Colors.black87,
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                        ),
                      ),
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

          // ── Credit gain floating badge ────────────────────────────────────
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _creditAnimController,
                builder: (_, __) {
                  if (_creditAnimController.isDismissed) return const SizedBox.shrink();
                  return Align(
                    alignment: Alignment.topRight,
                    child: Padding(
                      padding: EdgeInsets.only(top: topPadding + 52, right: 16),
                      child: SlideTransition(
                        position: _creditSlide,
                        child: FadeTransition(
                          opacity: _creditFade,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                            decoration: BoxDecoration(
                              color: Colors.amber,
                              borderRadius: BorderRadius.circular(24),
                              boxShadow: const <BoxShadow>[
                                BoxShadow(
                                  color: Color(0x55000000),
                                  blurRadius: 10,
                                  offset: Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Text(
                              '+$_creditGain 🔥',
                              style: const TextStyle(
                                color: Colors.black87,
                                fontWeight: FontWeight.w900,
                                fontSize: 20,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),

          // ── Re-center + change destination buttons ───────────────────────
          Positioned(
            right: 12,
            bottom: 160,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Builder(
                  builder: (context) {
                    final hasDestination = active.trip.destinationStopId != null ||
                        ref.read(tripNotifierProvider.notifier).hasDropoffMonitor;
                    return Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        ScaleTransition(
                          scale: hasDestination
                              ? const AlwaysStoppedAnimation(1.0)
                              : _destPulse,
                          child: FloatingActionButton.small(
                            heroTag: 'change_dest',
                            backgroundColor: Colors.white,
                            tooltip: AppStrings.tripChangeDestination,
                            onPressed: () => _changeDestination(),
                            child: const Icon(Icons.where_to_vote, color: AppColors.accent),
                          ),
                        ),
                        if (!hasDestination) ...<Widget>[
                          const SizedBox(height: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.primaryDark.withValues(alpha: 0.85),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: const Text(
                              AppStrings.tripAddDestination,
                              style: TextStyle(
                                fontSize: 9,
                                color: AppColors.accent,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ],
                    );
                  },
                ),
                const SizedBox(height: 8),
                FloatingActionButton.small(
                  heroTag: 'recenter',
                  backgroundColor: _autoFollow ? Colors.white : AppColors.primary,
                  onPressed: () {
                    setState(() => _autoFollow = true);
                    try {
                      _mapController.move(center, _mapController.camera.zoom);
                    } catch (_) {}
                  },
                  child: Icon(
                    Icons.my_location,
                    color: _autoFollow ? AppColors.primary : Colors.white,
                  ),
                ),
              ],
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
                            _reportsExpanded ? Icons.expand_less : Icons.expand_more,
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
                                  if (type == 'ruta_real') {
                                    final s = ref.read(tripNotifierProvider);
                                    if (s is TripActive) {
                                      final messenger = ScaffoldMessenger.of(context);
                                      final result = await ref
                                          .read(tripNotifierProvider.notifier)
                                          .reportRutaReal(s.route.id, s.route.geometry);
                                      if (!mounted) return;
                                      _showRutaRealResult(messenger, result);
                                    }
                                  } else {
                                    await ref.read(tripNotifierProvider.notifier).createReport(type);
                                  }
                                },
                              ),
                            );
                          },
                          icon: const Icon(Icons.report_outlined, size: 18),
                          label: const Text(AppStrings.tripReportFab),
                        ),
                      ),
                      const SizedBox(width: 12),
                      // Me bajé (with confirmation)
                      Expanded(
                        flex: 2,
                        child: AppButton.destructive(
                          label: AppStrings.tripEndButton,
                          onPressed: () => _confirmEndTrip(),
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

// ── Trip summary full-screen ──────────────────────────────────────────────────
class _TripSummaryScreen extends StatelessWidget {
  final TripEnded ended;
  final VoidCallback onClose;

  const _TripSummaryScreen({required this.ended, required this.onClose});

  String get _distanceText {
    if (ended.distanceMeters >= 1000) {
      return '${(ended.distanceMeters / 1000).toStringAsFixed(1)} ${AppStrings.tripKmSuffix}';
    }
    return '${ended.distanceMeters} ${AppStrings.tripMetersSuffix}';
  }

  String get _durationText {
    final h = ended.tripDuration.inHours.toString().padLeft(2, '0');
    final m = (ended.tripDuration.inMinutes % 60).toString().padLeft(2, '0');
    final s = (ended.tripDuration.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final botPad = MediaQuery.of(context).padding.bottom;

    return Scaffold(
      backgroundColor: AppColors.primaryDark,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: <Widget>[
            // Header — no fixed height to avoid overflow on small screens
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      color: AppColors.success.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                      border: Border.all(color: AppColors.success, width: 2.5),
                    ),
                    child: const Icon(Icons.check_rounded, color: AppColors.success, size: 40),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    AppStrings.tripSummaryCompleted,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    ended.routeName,
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.7),
                      fontSize: 13,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),

            // White card
            Expanded(
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                ),
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(20, 28, 20, botPad + 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                    // Big credits number
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: <Color>[
                            AppColors.primary.withValues(alpha: 0.08),
                            AppColors.primary.withValues(alpha: 0.02),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: AppColors.primary.withValues(alpha: 0.15),
                        ),
                      ),
                      child: Column(
                        children: <Widget>[
                          Text(
                            '+${ended.totalCreditsEarned}',
                            style: const TextStyle(
                              fontSize: 52,
                              fontWeight: FontWeight.w800,
                              color: AppColors.primary,
                              height: 1,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            AppStrings.tripCreditsLabel,
                            style: TextStyle(
                              fontSize: 14,
                              color: Colors.grey.shade600,
                            ),
                          ),
                          if (ended.completionBonusEarned) ...<Widget>[
                            const SizedBox(height: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: AppColors.success.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Text(
                                AppStrings.tripCompletionBonus,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: AppColors.success,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),

                    // Stats row
                    Row(
                      children: <Widget>[
                        _StatCard(
                          icon: Icons.timer_outlined,
                          label: AppStrings.tripDurationLabel,
                          value: _durationText,
                          color: AppColors.primary,
                        ),
                        const SizedBox(width: 12),
                        _StatCard(
                          icon: Icons.straighten_outlined,
                          label: AppStrings.tripDistanceLabel,
                          value: _distanceText,
                          color: Colors.teal,
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    // Reports card
                    _StatCardWide(
                      icon: Icons.campaign_outlined,
                      label: AppStrings.tripSummaryReports,
                      value: ended.reportsCreated > 0
                          ? '${ended.reportsCreated} ${ended.reportsCreated == 1 ? 'reporte' : 'reportes'}'
                          : AppStrings.tripSummaryNoReports,
                      color: ended.reportsCreated > 0 ? Colors.orange.shade700 : Colors.grey,
                      subtitle: ended.reportsCreated > 0
                          ? 'Gracias por ayudar a la comunidad'
                          : null,
                    ),

                    const SizedBox(height: 12),

                    // Streak card
                    _StatCardWide(
                      icon: Icons.local_fire_department_outlined,
                      label: AppStrings.tripSummaryStreakLabel,
                      value: ended.streakDays > 0
                          ? '${ended.streakDays} ${AppStrings.tripSummaryStreakDays}'
                          : AppStrings.tripSummaryStreakNone,
                      color: ended.streakDays >= 7
                          ? Colors.deepOrange
                          : ended.streakDays > 0
                              ? Colors.orange
                              : Colors.grey,
                      subtitle: ended.streakDays >= 7 ? '¡Bonus de +15 cr activo!' : null,
                    ),

                    if (ended.deviationDetected) ...<Widget>[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade50,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.orange.shade300),
                        ),
                        child: Row(
                          children: <Widget>[
                            Icon(Icons.alt_route, color: Colors.orange.shade700, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                AppStrings.deviationReportBody,
                                style: TextStyle(fontSize: 12, color: Colors.orange.shade900),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    if (!ended.completionBonusEarned && ended.distanceMeters < 2000) ...<Widget>[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.amber.shade50,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.amber.shade300),
                        ),
                        child: Row(
                          children: <Widget>[
                            Icon(Icons.info_outline, color: Colors.amber.shade700, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                AppStrings.tripShortDistance,
                                style: TextStyle(fontSize: 12, color: Colors.amber.shade900),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 24),

                    FilledButton.icon(
                      onPressed: onClose,
                      icon: const Icon(Icons.home_outlined),
                      label: const Text(AppStrings.tripClose),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primaryDark,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, color: color, size: 22),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCardWide extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  final String? subtitle;

  const _StatCardWide({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                  ),
                ],
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
      style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
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

// ── Desvío option tile ────────────────────────────────────────────────────────
class _DesvioOption extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _DesvioOption({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          border: Border.all(color: color.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(10),
          color: color.withValues(alpha: 0.05),
        ),
        child: Row(
          children: <Widget>[
            Icon(icon, color: color, size: 24),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                      color: color,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: color, size: 18),
          ],
        ),
      ),
    );
  }
}
