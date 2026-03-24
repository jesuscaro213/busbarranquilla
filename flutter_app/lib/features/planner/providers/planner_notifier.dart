import 'dart:async';

import 'package:flutter/foundation.dart';
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

final photonDioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: 'https://photon.komoot.io',
    connectTimeout: const Duration(seconds: 6),
    receiveTimeout: const Duration(seconds: 6),
  ));
});

final nominatimDioProvider = Provider<Dio>((ref) {
  return Dio(
    BaseOptions(
      baseUrl: 'https://nominatim.openstreetmap.org',
      connectTimeout: const Duration(seconds: 3),
      receiveTimeout: const Duration(seconds: 3),
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
  final Map<String, List<NominatimResult>> _searchCache = <String, List<NominatimResult>>{};
  DateTime? _nominatimBlockedUntil;

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
      final pos = await LocationService.getBestEffortPosition();
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

    final cacheKey = cleanQuery.toLowerCase();
    final cached = _searchCache[cacheKey];
    if (cached != null) {
      debugPrint('[PERF][NOMINATIM] caché hit para "$cleanQuery" → ${cached.length} resultados');
      return cached;
    }

    try {
      final results = await _searchWithFallback(cleanQuery);

      if (results.isNotEmpty) {
        _searchCache[cacheKey] = results;
      }
      debugPrint('[PERF][NOMINATIM] resultados → ${results.length}');
      return results;
    } catch (_) {
      debugPrint('[PERF][NOMINATIM] error/timeout');
      return const <NominatimResult>[];
    }
  }

  Future<List<NominatimResult>> _searchWithFallback(String cleanQuery) async {
    final sw = Stopwatch()..start();
    debugPrint('[PERF] buscando "$cleanQuery"...');

    final now = DateTime.now();
    final nominatimBlocked = _nominatimBlockedUntil != null && now.isBefore(_nominatimBlockedUntil!);

    // Nominatim y Photon corren en paralelo — resultados se mergean al final.
    final futures = <Future<List<NominatimResult>>>[
      if (!nominatimBlocked) _fetchNominatimBestEffort(cleanQuery, now) else Future.value(const <NominatimResult>[]),
      _fetchPhoton(cleanQuery),
    ];

    if (nominatimBlocked) {
      debugPrint('[PERF][NOMINATIM] pausado por 429 — solo Photon');
    }

    final results = await Future.wait(futures);
    final nominatimResults = results[0];
    final photonResults = results[1];

    debugPrint('[PERF][NOMINATIM] ${nominatimResults.length} resultados en ${sw.elapsedMilliseconds}ms');
    debugPrint('[PERF][PHOTON] ${photonResults.length} resultados en ${sw.elapsedMilliseconds}ms');

    // Merge sin duplicados — Nominatim primero (más preciso en direcciones formales)
    final merged = <NominatimResult>[...nominatimResults];
    final seen = nominatimResults.map((r) => r.displayName.toLowerCase()).toSet();
    for (final r in photonResults) {
      if (seen.add(r.displayName.toLowerCase())) {
        merged.add(r);
      }
    }

    debugPrint('[PERF] total ${merged.length} resultados en ${sw.elapsedMilliseconds}ms');
    return merged;
  }

  /// 1 sola request a Nominatim — normaliza, expande abreviaturas y agrega contexto de ciudad.
  /// Photon (paralelo) cubre los casos que Nominatim no encuentra.
  Future<List<NominatimResult>> _fetchNominatimBestEffort(String cleanQuery, DateTime now) async {
    try {
      final normalized = _normalizeColombianAddress(cleanQuery);
      final expanded = _expandForNominatim(normalized);
      return await _fetchNominatim('$expanded Barranquilla Colombia');
    } catch (e) {
      if (e.toString().contains('429')) {
        _nominatimBlockedUntil = now.add(const Duration(seconds: 30));
        debugPrint('[PERF][NOMINATIM] 429 — pausando 30s');
      } else {
        debugPrint('[PERF][NOMINATIM] error/timeout: $e');
      }
      return const <NominatimResult>[];
    }
  }


  Future<List<NominatimResult>> _fetchPhoton(String q) async {
    try {
      final response = await ref.read(photonDioProvider).get<Map<String, dynamic>>(
        '/api',
        queryParameters: <String, dynamic>{
          'q': '$q Barranquilla',
          'lang': 'es',
          'limit': 6,
          'bbox': '-74.98,10.82,-74.62,11.08',
        },
      );

      final features = (response.data?['features'] as List<dynamic>?) ?? const <dynamic>[];
      final results = <NominatimResult>[];

      for (final feature in features) {
        if (feature is! Map) continue;
        final geometry = feature['geometry'] as Map<String, dynamic>?;
        final coords = geometry?['coordinates'] as List<dynamic>?;
        if (coords == null || coords.length < 2) continue;

        final lng = (coords[0] as num).toDouble();
        final lat = (coords[1] as num).toDouble();

        if (lat < _minLat || lat > _maxLat || lng < _minLng || lng > _maxLng) continue;

        final props = (feature['properties'] as Map<String, dynamic>?) ?? <String, dynamic>{};
        final name = props['name']?.toString() ?? '';
        final city = props['city']?.toString() ?? props['county']?.toString() ?? '';
        final state = props['state']?.toString() ?? '';

        if (name.isEmpty) continue;

        final parts = <String>[name, if (city.isNotEmpty) city, if (state.isNotEmpty) state];
        results.add(NominatimResult(
          displayName: parts.join(', '),
          lat: lat,
          lng: lng,
        ));
      }

      return results;
    } catch (_) {
      return const <NominatimResult>[];
    }
  }

  Future<List<NominatimResult>> _fetchNominatim(String q) async {
    final response = await ref.read(nominatimDioProvider).get<List<dynamic>>(
      '/search',
      queryParameters: <String, dynamic>{
        'q': q,
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
  }

  /// Normalizes Colombian addresses:
  ///   "Cr 52 N 45-12"  → "Cr 52 #45-12"
  ///   "Calle 30 N 42"  → "Calle 30 #42"
  /// The "N" separator (case-insensitive, surrounded by spaces) is replaced with "#".
  static String _normalizeColombianAddress(String query) {
    return query.replaceAllMapped(_colombianAddressRe, (match) => ' #');
  }

  /// Expands abbreviated Colombian street types and removes the "#" separator
  /// so Nominatim can match OSM data (e.g. "Cr 14 # 45" → "Carrera 14 45").
  static String _expandForNominatim(String query) {
    // Remove "#" separator
    var result = query.replaceAll(RegExp(r'\s*#\s*'), ' ');

    // Expand street-type abbreviation at the start of the query
    result = result.replaceFirstMapped(
      RegExp(r'^(Cr|Cra|Cl|Dg|Tv|Tr|Av|Ak)\b', caseSensitive: false),
      (m) => switch (m[0]!.toLowerCase()) {
        'cr' || 'cra' => 'Carrera',
        'cl' => 'Calle',
        'dg' => 'Diagonal',
        'tv' || 'tr' => 'Transversal',
        'av' => 'Avenida',
        'ak' => 'Autopista',
        _ => m[0]!,
      },
    );

    return result.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  Future<void> planRoute({
    double? originLat,
    double? originLng,
    required double destLat,
    required double destLng,
  }) async {
    state = const PlannerLoading();

    final sw = Stopwatch()..start();
    debugPrint('[PERF][PLAN] planificando ruta...');
    final result = await ref.read(routesRepositoryProvider).plan(
      originLat: originLat,
      originLng: originLng,
      destLat: destLat,
      destLng: destLng,
    );

    switch (result) {
      case Success<List<PlanResult>>(data: final routes):
        debugPrint('[PERF][PLAN] respuesta en ${sw.elapsedMilliseconds}ms → ${routes.length} rutas');
        state = PlannerResults(
          originLabel: _selectedOrigin?.displayName ?? AppStrings.originLabel,
          destLabel: _selectedDest?.displayName ?? AppStrings.destLabel,
          results: routes,
          selectedOrigin: _selectedOrigin,
          selectedDest: _selectedDest,
        );
      case Failure<List<PlanResult>>(error: final error):
        debugPrint('[PERF][PLAN] error tras ${sw.elapsedMilliseconds}ms: ${error.message}');
        state = PlannerError(error.message);
    }
  }
}

final plannerNotifierProvider = NotifierProvider<PlannerNotifier, PlannerState>(PlannerNotifier.new);
