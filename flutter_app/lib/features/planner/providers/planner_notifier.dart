import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';

import '../../../core/data/repositories/routes_repository.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/plan_result.dart';
import '../../../core/error/result.dart';
import '../../../core/l10n/strings.dart';
import '../../../core/location/location_service.dart';
import '../models/nominatim_result.dart';
import 'planner_state.dart';

final selectedPlanRouteProvider = StateProvider<PlanResult?>((ref) => null);

final nominatimDioProvider = Provider<Dio>((ref) {
  return Dio(
    BaseOptions(
      baseUrl: 'https://nominatim.openstreetmap.org',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: const <String, String>{
        'User-Agent': 'MiBusApp/1.0',
      },
    ),
  );
});

class PlannerNotifier extends Notifier<PlannerState> {
  static final RegExp _colombianAddressRe = RegExp(r'\s+[Nn]\s+');
  static const double _minLat = 10.82;
  static const double _maxLat = 11.08;
  static const double _minLng = -74.98;
  static const double _maxLng = -74.62;

  NominatimResult? _selectedOrigin;
  NominatimResult? _selectedDest;
  bool _originIsGps = false;
  Timer? _nearbyRefreshTimer;

  @override
  PlannerState build() {
    ref.onDispose(() {
      _nearbyRefreshTimer?.cancel();
      _nearbyRefreshTimer = null;
    });
    return const PlannerIdle();
  }

  NominatimResult? get selectedOrigin => _selectedOrigin;
  NominatimResult? get selectedDest => _selectedDest;

  Future<void> loadNearbyForOrigin(NominatimResult origin) async {
    final result = await ref.read(routesRepositoryProvider).nearby(
      lat: origin.lat,
      lng: origin.lng,
      radius: 0.3,
    );

    if (result is Success<List<BusRoute>> && state is PlannerIdle) {
      state = (state as PlannerIdle).copyWith(nearbyRoutes: result.data);
    }
  }

  void setOrigin(NominatimResult origin) {
    _selectedOrigin = origin;
    _originIsGps = origin.displayName == AppStrings.currentLocationLabel;

    if (state is PlannerResults) {
      final current = state as PlannerResults;
      state = current.copyWith(
        selectedOrigin: origin,
        originLabel: origin.displayName,
      );
      return;
    }

    state = PlannerIdle(
      selectedOrigin: _selectedOrigin,
      selectedDest: _selectedDest,
    );

    unawaited(loadNearbyForOrigin(origin));
    _restartNearbyRefreshTimer();
  }

  void _restartNearbyRefreshTimer() {
    _nearbyRefreshTimer?.cancel();
    _nearbyRefreshTimer = null;
    if (!_originIsGps) return;

    _nearbyRefreshTimer = Timer.periodic(const Duration(minutes: 2), (_) async {
      if (state is! PlannerIdle) return;

      // Get fresh GPS position so nearby routes use current location, not the
      // coordinates captured when the screen first loaded.
      final pos = await LocationService.getCurrentPosition();
      if (pos == null) return;

      final updated = NominatimResult(
        displayName: AppStrings.currentLocationLabel,
        lat: pos.latitude,
        lng: pos.longitude,
      );
      _selectedOrigin = updated;
      if (state is PlannerIdle) {
        state = (state as PlannerIdle).copyWith(selectedOrigin: updated);
      }
      await loadNearbyForOrigin(updated);
    });
  }

  void setDestination(NominatimResult destination) {
    _selectedDest = destination;

    if (state is PlannerResults) {
      final current = state as PlannerResults;
      state = current.copyWith(
        selectedDest: destination,
        destLabel: destination.displayName,
      );
      return;
    }

    state = PlannerIdle(
      selectedOrigin: _selectedOrigin,
      selectedDest: _selectedDest,
    );
  }

  void reset() {
    _selectedOrigin = null;
    _selectedDest = null;
    _originIsGps = false;
    _nearbyRefreshTimer?.cancel();
    _nearbyRefreshTimer = null;
    state = const PlannerIdle();
  }

  Future<List<NominatimResult>> searchAddress(String query) async {
    final cleanQuery = query.trim();
    if (cleanQuery.length < 3) {
      return const <NominatimResult>[];
    }

    try {
      final response = await ref.read(nominatimDioProvider).get<List<dynamic>>(
        '/search',
        queryParameters: <String, dynamic>{
          'q': '${_normalizeColombianAddress(cleanQuery)} Barranquilla Colombia',
          'format': 'jsonv2',
          'limit': 6,
          'countrycodes': 'co',
          'bounded': 1,
          'viewbox': '-74.98,11.08,-74.62,10.82',
          'addressdetails': 1,
        },
      );

      final items = response.data ?? const <dynamic>[];
      final results = <NominatimResult>[];

      for (final item in items) {
        if (item is! Map) continue;
        final parsed = NominatimResult.fromJson(Map<String, dynamic>.from(item));
        final isInBounds = parsed.lat >= _minLat &&
            parsed.lat <= _maxLat &&
            parsed.lng >= _minLng &&
            parsed.lng <= _maxLng;
        if (isInBounds) {
          results.add(parsed);
        }
      }

      return results;
    } catch (_) {
      return const <NominatimResult>[];
    }
  }

  /// Normalizes Colombian addresses:
  ///   "Cr 52 N 45-12"  → "Cr 52 #45-12"
  ///   "Calle 30 N 42"  → "Calle 30 #42"
  /// The "N" separator (case-insensitive, surrounded by spaces) is replaced with "#".
  static String _normalizeColombianAddress(String query) {
    return query.replaceAllMapped(_colombianAddressRe, (match) => ' #');
  }

  Future<void> planRoute({
    double? originLat,
    double? originLng,
    required double destLat,
    required double destLng,
  }) async {
    state = const PlannerLoading();

    final result = await ref.read(routesRepositoryProvider).plan(
      originLat: originLat,
      originLng: originLng,
      destLat: destLat,
      destLng: destLng,
    );

    switch (result) {
      case Success<List<PlanResult>>(data: final routes):
        state = PlannerResults(
          originLabel: _selectedOrigin?.displayName ?? AppStrings.originLabel,
          destLabel: _selectedDest?.displayName ?? AppStrings.destLabel,
          results: routes,
          selectedOrigin: _selectedOrigin,
          selectedDest: _selectedDest,
        );
      case Failure<List<PlanResult>>(error: final error):
        state = PlannerError(error.message);
    }
  }
}

final plannerNotifierProvider = NotifierProvider<PlannerNotifier, PlannerState>(PlannerNotifier.new);
