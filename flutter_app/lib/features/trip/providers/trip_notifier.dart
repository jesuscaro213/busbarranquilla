import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/stops_repository.dart';
import '../../../core/data/repositories/trips_repository.dart';
import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import '../monitors/auto_resolve_monitor.dart';
import '../monitors/dropoff_monitor.dart';
import '../monitors/inactivity_monitor.dart';
import 'trip_state.dart';

class TripNotifier extends Notifier<TripState> {
  Timer? _locationTimer;
  DropoffMonitor? _dropoffMonitor;
  InactivityMonitor? _inactivityMonitor;
  AutoResolveMonitor? _autoResolveMonitor;

  @override
  TripState build() {
    ref.onDispose(_disposeMonitorsAndTimers);
    return const TripIdle();
  }

  bool get isActive => state is TripActive;

  Future<void> startTrip(int routeId, {int? destinationStopId}) async {
    state = const TripLoading();

    final pos = await LocationService.getCurrentPosition();
    if (pos == null) {
      state = const TripError(AppStrings.locationRequired);
      return;
    }

    final startResult = await ref.read(tripsRepositoryProvider).start(<String, dynamic>{
      'route_id': routeId,
      'destination_stop_id': destinationStopId,
      'latitude': pos.latitude,
      'longitude': pos.longitude,
    });

    late final ActiveTrip trip;
    switch (startResult) {
      case Success<ActiveTrip>(data: final data):
        trip = data;
      case Failure<ActiveTrip>(error: final error):
        state = TripError(error.message);
        return;
    }

    final routeResult = await ref.read(routesRepositoryProvider).getById(routeId);
    late final BusRoute route;
    switch (routeResult) {
      case Success<BusRoute>(data: final data):
        route = data;
      case Failure<BusRoute>(error: final error):
        state = TripError(error.message);
        return;
    }

    final stopsResult = await ref.read(stopsRepositoryProvider).listByRoute(routeId);
    final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(routeId);

    late final List<Stop> stops;
    switch (stopsResult) {
      case Success<List<Stop>>(data: final data):
        stops = data;
      case Failure<List<Stop>>(error: final error):
        state = TripError(error.message);
        return;
    }

    late final List<Report> reports;
    switch (reportsResult) {
      case Success<List<Report>>(data: final data):
        reports = data;
      case Failure<List<Report>>(error: final error):
        state = TripError(error.message);
        return;
    }

    final activeState = TripActive(
      trip: trip,
      route: route,
      stops: stops,
      reports: reports,
    );

    state = activeState;

    ref.read(socketServiceProvider).joinRoute(routeId);
    _startLocationBroadcast();
    _startMonitors(activeState, destinationStopId);
  }

  Future<void> endTrip() async {
    if (state is! TripActive) {
      state = const TripIdle();
      return;
    }

    final active = state as TripActive;

    _disposeMonitorsAndTimers();
    if (active.trip.routeId != null) {
      ref.read(socketServiceProvider).leaveRoute(active.trip.routeId!);
    }

    await ref.read(tripsRepositoryProvider).end();
    state = const TripIdle();
  }

  Future<void> confirmReport(int reportId) async {
    if (state is! TripActive) return;

    final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
    switch (result) {
      case Success<void>():
        await _reloadReports();
      case Failure<void>():
        return;
    }
  }

  Future<void> createReport(String type) async {
    if (state is! TripActive) return;

    final active = state as TripActive;
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) return;

    final result = await ref.read(reportsRepositoryProvider).create(<String, dynamic>{
      'route_id': active.route.id,
      'type': type,
      'latitude': pos.latitude,
      'longitude': pos.longitude,
    });

    switch (result) {
      case Success<Report>():
        await _reloadReports();
      case Failure<Report>():
        return;
    }
  }

  void _startLocationBroadcast() {
    _locationTimer?.cancel();
    _locationTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      if (state is! TripActive) return;

      final active = state as TripActive;
      final pos = await LocationService.getCurrentPosition();
      if (pos == null) return;

      final updateResult = await ref.read(tripsRepositoryProvider).updateLocation(<String, dynamic>{
        'latitude': pos.latitude,
        'longitude': pos.longitude,
      });

      if (updateResult is Success<int>) {
        ref.read(socketServiceProvider).sendLocation(pos.latitude, pos.longitude);
        state = active.copyWith(
          trip: active.trip.copyWith(
            currentLatitude: pos.latitude,
            currentLongitude: pos.longitude,
            creditsEarned: updateResult.data,
          ),
        );
      }
    });
  }

  void _startMonitors(TripActive activeState, int? destinationStopId) {
    _disposeMonitorsOnly();

    if (destinationStopId != null) {
      Stop? destination;
      for (final stop in activeState.stops) {
        if (stop.id == destinationStopId) {
          destination = stop;
          break;
        }
      }
      if (destination != null) {
        _dropoffMonitor = DropoffMonitor(
          destination: destination,
          onPrepare: () {
            if (state is! TripActive) return;
            final active = state as TripActive;
            state = active.copyWith(dropoffAlert: DropoffAlert.prepare);
          },
          onAlight: () {
            if (state is! TripActive) return;
            final active = state as TripActive;
            state = active.copyWith(dropoffAlert: DropoffAlert.alight);
          },
          onMissed: () {
            if (state is! TripActive) return;
            final active = state as TripActive;
            state = active.copyWith(dropoffAlert: DropoffAlert.missed);
          },
        )..start();
      }
    }

    _inactivityMonitor = InactivityMonitor(
      onAsk: () {},
      onAutoEnd: () {
        unawaited(endTrip());
      },
    )..start();

    _autoResolveMonitor = AutoResolveMonitor(
      reports: activeState.reports,
      onResolve: (reportId) => _resolveReport(reportId),
    )..start();
  }

  Future<void> _resolveReport(int reportId) async {
    if (state is! TripActive) return;
    final result = await ref.read(reportsRepositoryProvider).resolve(reportId);
    if (result is Success<void>) {
      await _reloadReports();
    }
  }

  Future<void> _reloadReports() async {
    if (state is! TripActive) return;
    final active = state as TripActive;

    final reportsResult = await ref.read(reportsRepositoryProvider).getRouteReports(active.route.id);
    if (reportsResult is Success<List<Report>>) {
      final updatedReports = reportsResult.data;
      state = active.copyWith(reports: updatedReports);
      _autoResolveMonitor?.reports
        ..clear()
        ..addAll(updatedReports);
    }
  }

  void _disposeMonitorsOnly() {
    _dropoffMonitor?.dispose();
    _dropoffMonitor = null;

    _inactivityMonitor?.dispose();
    _inactivityMonitor = null;

    _autoResolveMonitor?.dispose();
    _autoResolveMonitor = null;
  }

  void _disposeMonitorsAndTimers() {
    _locationTimer?.cancel();
    _locationTimer = null;
    _disposeMonitorsOnly();
  }
}

final tripNotifierProvider = NotifierProvider<TripNotifier, TripState>(TripNotifier.new);
