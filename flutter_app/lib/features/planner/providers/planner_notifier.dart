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
  bool _disposed = false;
  Timer? _nearbyRefreshTimer;
  final Map<String, List<NominatimResult>> _searchCache = <String, List<NominatimResult>>{};
  DateTime? _nominatimBlockedUntil;

  @override
  PlannerState build() {
    _disposed = false;
    ref.onDispose(() {
      _disposed = true;
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

    // ── Intersection detection (e.g. "Calle 72 Cr 50") ──────────────────────
    final intersection = _parseIntersection(cleanQuery);
    if (intersection != null) {
      final main = intersection[0];
      final cross = intersection[1];
      debugPrint('[PERF][OVERPASS] intersección detectada: $main × $cross');

      // Try Overpass (precise) and Nominatim fallback in parallel
      final intersectionResults = await Future.wait(<Future<NominatimResult?>>[
        _fetchOverpassIntersection(main, cross),
        _fetchNominatimIntersection(main, cross),
      ]);

      final overpassResult = intersectionResults[0];
      final nominatimFallback = intersectionResults[1];

      final best = overpassResult ?? nominatimFallback;
      if (best != null) {
        debugPrint('[PERF] intersección encontrada en ${sw.elapsedMilliseconds}ms');
        // Show the query as-is (what the user typed) instead of the expanded label
        return <NominatimResult>[NominatimResult(displayName: cleanQuery, lat: best.lat, lng: best.lng)];
      }
      debugPrint('[PERF][OVERPASS] no encontrado, fallback a Nominatim+Photon');
    }

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
  /// Applies globally — not just at the start — so "Calle 72 Cr 50" works.
  static String _expandForNominatim(String query) {
    var result = query.replaceAll(RegExp(r'\s*#\s*'), ' ');
    result = result.replaceAllMapped(
      RegExp(r'\b(Cr|Cra|Cl|Dg|Tv|Tr|Av|Ak)\b', caseSensitive: false),
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

  /// Detects an intersection query. Two patterns supported:
  ///   1. "Cr 50 # 75" — # notation; cross type is inferred from main type.
  ///   2. "Calle 72 Cr 50" — both types explicit.
  /// Returns [mainStreet, crossStreet] (expanded) if detected, null otherwise.
  static List<String>? _parseIntersection(String query) {
    final normalized = _normalizeColombianAddress(query);

    // Pattern 1: "Cr 50 # 75" (Colombian # notation)
    final hashRe = RegExp(
      r'^(Cr|Cra|Cl|Calle|Carrera|Dg|Diagonal|Tv|Tr|Transversal|Av|Avenida|Ak|Autopista)\s+(\d+[A-Za-z]?)\s*#\s*(\d+[A-Za-z]?)',
      caseSensitive: false,
    );
    final hashMatch = hashRe.firstMatch(normalized.trim());
    if (hashMatch != null) {
      final mainExpanded = _expandStreetType(hashMatch.group(1)!);
      final crossExpanded = _inferCrossType(mainExpanded);
      return <String>[
        '$mainExpanded ${hashMatch.group(2)!}',
        '$crossExpanded ${hashMatch.group(3)!}',
      ];
    }

    // Pattern 2: "Calle 72 Cr 50" (two explicit street types)
    final expanded = _expandForNominatim(normalized);
    const types = r'(?:Carrera|Calle|Diagonal|Transversal|Avenida|Autopista)';
    final re = RegExp(
      r'^(' + types + r'\s+\d+[A-Za-z]?)\s+(?:con\s+)?(' + types + r'\s+\d+[A-Za-z]?)\s*$',
      caseSensitive: false,
    );
    final m = re.firstMatch(expanded);
    if (m == null) return null;
    return <String>[m.group(1)!.trim(), m.group(2)!.trim()];
  }

  static String _expandStreetType(String abbr) {
    return switch (abbr.toLowerCase()) {
      'cr' || 'cra' => 'Carrera',
      'cl' || 'calle' => 'Calle',
      'dg' || 'diagonal' => 'Diagonal',
      'tv' || 'tr' || 'transversal' => 'Transversal',
      'av' || 'avenida' => 'Avenida',
      'ak' || 'autopista' => 'Autopista',
      _ => abbr,
    };
  }

  /// Infers the cross street type from the main street type.
  /// Carrera (N-S) crosses with Calle (E-W) and vice versa.
  static String _inferCrossType(String mainType) {
    return switch (mainType.toLowerCase()) {
      'carrera' => 'Calle',
      'calle' => 'Carrera',
      'diagonal' => 'Transversal',
      'transversal' => 'Diagonal',
      _ => 'Calle',
    };
  }

  /// Calls Overpass to find the node where [main] and [cross] streets meet.
  /// Returns a single NominatimResult or null if not found / timeout.
  static Future<NominatimResult?> _fetchOverpassIntersection(
    String main,
    String cross,
  ) async {
    String osmPattern(String street) {
      final lower = street.toLowerCase();
      final num = RegExp(r'\d+[A-Za-z]?$').firstMatch(street)?.group(0) ?? '';
      if (lower.contains('carrera')) return '(Carrera|Cra\\.?|Kr\\.?)\\s*$num';
      if (lower.contains('calle')) return '(Calle|Cl\\.?)\\s*$num';
      if (lower.contains('diagonal')) return '(Diagonal|Dg\\.?)\\s*$num';
      if (lower.contains('transversal')) return '(Transversal|Tv\\.?)\\s*$num';
      if (lower.contains('avenida')) return '(Avenida|Av\\.?)\\s*$num';
      return street;
    }

    const bbox = '10.82,-74.98,11.08,-74.62';
    final mainPat = osmPattern(main);
    final crossPat = osmPattern(cross);
    final query =
        '[out:json][timeout:8];\n'
        'way["name"~"$mainPat",i]($bbox)->.a;\n'
        'way["name"~"$crossPat",i]($bbox)->.b;\n'
        'node(w.a)(w.b);\n'
        'out;';
    try {
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 8),
      ));
      // Send as form-encoded map so Dio serializes it correctly
      final response = await dio.post<Map<String, dynamic>>(
        'https://overpass-api.de/api/interpreter',
        data: <String, String>{'data': query},
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          responseType: ResponseType.json,
        ),
      );
      final elements = response.data?['elements'] as List<dynamic>?;
      if (elements != null && elements.isNotEmpty) {
        final node = elements.first as Map<String, dynamic>;
        final lat = (node['lat'] as num).toDouble();
        final lng = (node['lon'] as num).toDouble();
        return NominatimResult(
          displayName: '$main × $cross',
          lat: lat,
          lng: lng,
        );
      }
    } catch (e) {
      debugPrint('[PERF][OVERPASS] error: $e');
    }
    return null;
  }

  /// Nominatim fallback for intersections when Overpass fails.
  /// Searches the full intersection text with limit=1 and returns 1 result.
  Future<NominatimResult?> _fetchNominatimIntersection(
    String main,
    String cross,
  ) async {
    try {
      final q = '$main $cross Barranquilla Colombia';
      final response = await ref.read(nominatimDioProvider).get<List<dynamic>>(
        '/search',
        queryParameters: <String, dynamic>{
          'q': q,
          'format': 'jsonv2',
          'limit': 1,
          'countrycodes': 'co',
          'bounded': 1,
          'viewbox': '-74.98,11.08,-74.62,10.82',
        },
      );
      final items = response.data ?? const <dynamic>[];
      if (items.isNotEmpty && items.first is Map) {
        final parsed = NominatimResult.fromJson(Map<String, dynamic>.from(items.first as Map));
        final inBounds = parsed.lat >= _minLat && parsed.lat <= _maxLat &&
            parsed.lng >= _minLng && parsed.lng <= _maxLng;
        if (inBounds) {
          // Override the display name with the clean intersection label
          return NominatimResult(
            displayName: '$main × $cross',
            lat: parsed.lat,
            lng: parsed.lng,
          );
        }
      }
    } catch (e) {
      debugPrint('[PERF][NOMINATIM-INTERSECTION] error: $e');
    }
    return null;
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

    if (_disposed) return;

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
