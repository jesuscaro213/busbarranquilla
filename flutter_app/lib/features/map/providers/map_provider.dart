import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/data/repositories/reports_repository.dart';
import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/data/repositories/trips_repository.dart';
import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../../../core/socket/socket_service.dart';
import 'map_state.dart';

final selectedFeedRouteProvider = StateProvider<BusRoute?>((ref) => null);

class MapNotifier extends Notifier<MapState> {
  Timer? _refreshTimer;
  bool _initialized = false;
  bool _socketBound = false;

  @override
  MapState build() {
    ref.onDispose(() {
      _refreshTimer?.cancel();
      final socket = ref.read(socketServiceProvider);
      socket.off('bus:location');
      socket.off('bus:joined');
      socket.off('bus:left');
    });

    return const MapLoading();
  }

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    state = const MapLoading();
    await _loadAll();
    _bindSocketListeners();
    _startRefreshTimer();
  }

  Future<void> retry() async {
    state = const MapLoading();
    await _loadAll();
  }

  Future<void> _loadAll() async {
    final pos = await LocationService.getCurrentPosition();
    if (pos == null) {
      state = const MapError(AppStrings.locationRequired);
      return;
    }

    final lat = pos.latitude;
    final lng = pos.longitude;

    final futures = await Future.wait<Result<dynamic>>(<Future<Result<dynamic>>>[
      ref.read(tripsRepositoryProvider).getBuses(),
      ref.read(reportsRepositoryProvider).getNearby(lat: lat, lng: lng),
      ref.read(routesRepositoryProvider).activeFeed(),
    ]);

    final busesResult = futures[0] as Result<List<ActiveTrip>>;
    final reportsResult = futures[1] as Result<List<Report>>;
    final feedResult = futures[2] as Result<List<BusRoute>>;

    final tripCurrentResult = await ref.read(tripsRepositoryProvider).getCurrent();

    if (busesResult is Failure<List<ActiveTrip>>) {
      state = MapError(busesResult.error.message);
      return;
    }
    if (reportsResult is Failure<List<Report>>) {
      state = MapError(reportsResult.error.message);
      return;
    }
    if (feedResult is Failure<List<BusRoute>>) {
      state = MapError(feedResult.error.message);
      return;
    }

    int? activeTripRouteId;
    switch (tripCurrentResult) {
      case Success<ActiveTrip?>(data: final trip):
        activeTripRouteId = trip?.routeId;
      case Failure():
        activeTripRouteId = null;
    }

    state = MapReady(
      userPosition: LatLng(lat, lng),
      buses: (busesResult as Success<List<ActiveTrip>>).data,
      reports: (reportsResult as Success<List<Report>>).data,
      activeFeedRoutes: (feedResult as Success<List<BusRoute>>).data,
      activeTripRouteId: activeTripRouteId,
    );
  }

  void _startRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      await _refreshData();
    });
  }

  Future<void> _refreshData() async {
    if (state is! MapReady) return;

    final current = state as MapReady;
    final userPos = current.userPosition;
    if (userPos == null) return;

    final futures = await Future.wait<Result<dynamic>>(<Future<Result<dynamic>>>[
      ref.read(tripsRepositoryProvider).getBuses(),
      ref.read(reportsRepositoryProvider).getNearby(lat: userPos.latitude, lng: userPos.longitude),
      ref.read(routesRepositoryProvider).activeFeed(),
    ]);

    final busesResult = futures[0] as Result<List<ActiveTrip>>;
    final reportsResult = futures[1] as Result<List<Report>>;
    final feedResult = futures[2] as Result<List<BusRoute>>;

    if (busesResult is Success<List<ActiveTrip>> &&
        reportsResult is Success<List<Report>> &&
        feedResult is Success<List<BusRoute>>) {
      state = current.copyWith(
        buses: busesResult.data,
        reports: reportsResult.data,
        activeFeedRoutes: feedResult.data,
      );
    }
  }

  Future<void> confirmReport(int reportId) async {
    final result = await ref.read(reportsRepositoryProvider).confirm(reportId);
    if (result is Success<void>) {
      await _refreshData();
    }
  }

  void _bindSocketListeners() {
    if (_socketBound) return;
    _socketBound = true;

    final socket = ref.read(socketServiceProvider);

    socket.on('bus:location', (dynamic payload) {
      if (state is! MapReady || payload is! Map) return;
      final current = state as MapReady;
      final data = Map<String, dynamic>.from(payload);
      final tripId = data['tripId'];
      final lat = data['latitude'];
      final lng = data['longitude'];
      if (tripId is! int || lat is! num || lng is! num) return;

      final updated = current.buses.map((bus) {
        if (bus.id != tripId) return bus;
        return bus.copyWith(
          currentLatitude: lat.toDouble(),
          currentLongitude: lng.toDouble(),
        );
      }).toList(growable: false);

      state = current.copyWith(buses: updated);
    });

    socket.on('bus:joined', (dynamic payload) {
      if (state is! MapReady || payload is! Map) return;
      final current = state as MapReady;
      final data = Map<String, dynamic>.from(payload);

      final tripId = data['tripId'];
      final routeId = data['routeId'];
      final lat = data['latitude'];
      final lng = data['longitude'];
      if (tripId is! int || lat is! num || lng is! num) return;

      final exists = current.buses.any((b) => b.id == tripId);
      if (exists) return;

      final newBus = ActiveTrip(
        id: tripId,
        routeId: routeId is int ? routeId : null,
        currentLatitude: lat.toDouble(),
        currentLongitude: lng.toDouble(),
        creditsEarned: 0,
        isActive: true,
      );

      state = current.copyWith(buses: <ActiveTrip>[...current.buses, newBus]);
    });

    socket.on('bus:left', (dynamic payload) {
      if (state is! MapReady || payload is! Map) return;
      final current = state as MapReady;
      final data = Map<String, dynamic>.from(payload);
      final tripId = data['tripId'];
      if (tripId is! int) return;

      final remaining = current.buses.where((b) => b.id != tripId).toList(growable: false);
      state = current.copyWith(buses: remaining);
    });
  }
}

final mapNotifierProvider = NotifierProvider<MapNotifier, MapState>(MapNotifier.new);
