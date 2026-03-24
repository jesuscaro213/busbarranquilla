# Spec 54 — Geocodificación dual: Nominatim + Photon en paralelo

**Status:** Applied

## Problema

Nominatim falla con nombres coloquiales de lugares en Barranquilla ("Plus House Los Andes",
"Éxito de la 72", conjuntos residenciales, etc.). Photon (photon.komoot.io) cubre estos POIs
correctamente y es gratis sin restricciones comerciales.

Problemas adicionales encontrados durante implementación:
- Nominatim no entendía abreviaturas colombianas ("Cr 14" en vez de "Carrera 14")
- La caché guardaba resultados vacíos, bloqueando búsquedas futuras
- Múltiples requests Nominatim por búsqueda causaban 429 rate limit

## Solución final

Nominatim y Photon corren **en paralelo** (`Future.wait`). Los resultados se mergean
deduplicando por `displayName`. Nominatim recibe la query con abreviaturas expandidas.
Solo se cachea cuando hay resultados.

## Archivos modificados

- `lib/features/planner/providers/planner_notifier.dart`
- `lib/features/planner/widgets/address_search_field.dart`

No requiere cambios en backend ni en Railway.

---

## Implementación en `planner_notifier.dart`

### Providers Dio

```dart
final photonDioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: 'https://photon.komoot.io',
    connectTimeout: const Duration(seconds: 6),
    receiveTimeout: const Duration(seconds: 6),
  ));
});

final nominatimDioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(
    baseUrl: 'https://nominatim.openstreetmap.org',
    connectTimeout: const Duration(seconds: 3),
    receiveTimeout: const Duration(seconds: 3),
    headers: {'User-Agent': 'MiBusApp/1.0'},
  ));
});
```

### Campos en `PlannerNotifier`

```dart
DateTime? _nominatimBlockedUntil;  // cooldown 30s tras 429
```

### `_searchWithFallback` — paralelo + merge

```dart
Future<List<NominatimResult>> _searchWithFallback(String cleanQuery) async {
  final now = DateTime.now();
  final nominatimBlocked = _nominatimBlockedUntil != null && now.isBefore(_nominatimBlockedUntil!);

  final futures = <Future<List<NominatimResult>>>[
    if (!nominatimBlocked) _fetchNominatimBestEffort(cleanQuery, now)
    else Future.value(const <NominatimResult>[]),
    _fetchPhoton(cleanQuery),
  ];

  final results = await Future.wait(futures);
  final nominatimResults = results[0];
  final photonResults = results[1];

  // Merge — Nominatim primero, Photon append sin duplicados
  final merged = <NominatimResult>[...nominatimResults];
  final seen = nominatimResults.map((r) => r.displayName.toLowerCase()).toSet();
  for (final r in photonResults) {
    if (seen.add(r.displayName.toLowerCase())) merged.add(r);
  }
  return merged;
}
```

### `_fetchNominatimBestEffort` — 1 sola request

```dart
Future<List<NominatimResult>> _fetchNominatimBestEffort(String cleanQuery, DateTime now) async {
  try {
    final normalized = _normalizeColombianAddress(cleanQuery);
    final expanded = _expandForNominatim(normalized);
    return await _fetchNominatim('$expanded Barranquilla Colombia');
  } catch (e) {
    if (e.toString().contains('429')) {
      _nominatimBlockedUntil = now.add(const Duration(seconds: 30));
    }
    return const <NominatimResult>[];
  }
}
```

### `_expandForNominatim` — expande abreviaturas + quita `#`

```dart
static String _expandForNominatim(String query) {
  var result = query.replaceAll(RegExp(r'\s*#\s*'), ' ');
  result = result.replaceFirstMapped(
    RegExp(r'^(Cr|Cra|Cl|Dg|Tv|Tr|Av|Ak)\b', caseSensitive: false),
    (m) => switch (m[0]!.toLowerCase()) {
      'cr' || 'cra' => 'Carrera',
      'cl'          => 'Calle',
      'dg'          => 'Diagonal',
      'tv' || 'tr'  => 'Transversal',
      'av'          => 'Avenida',
      'ak'          => 'Autopista',
      _             => m[0]!,
    },
  );
  return result.replaceAll(RegExp(r'\s+'), ' ').trim();
}
```

### `_fetchPhoton` — GeoJSON filtrado al bbox AMB

```dart
Future<List<NominatimResult>> _fetchPhoton(String q) async {
  try {
    final response = await ref.read(photonDioProvider).get<Map<String, dynamic>>(
      '/api',
      queryParameters: {
        'q': '$q Barranquilla',
        'lang': 'es',
        'limit': 6,
        'bbox': '-74.98,10.82,-74.62,11.08',
      },
    );
    // parse features → filter bbox → build displayName from name+city+state
    ...
  } catch (_) {
    return const <NominatimResult>[];
  }
}
```

### Caché — solo cuando hay resultados

```dart
final results = await _searchWithFallback(cleanQuery);
if (results.isNotEmpty) {
  _searchCache[cacheKey] = results;
}
```

### Debounce en `address_search_field.dart`

Subido de 300ms → **1100ms** para respetar el rate limit de 1 req/s de Nominatim.

---

## Comportamiento resultante

```
"Plus House Los Andes"
  Nominatim: "Plus House Los Andes Barranquilla Colombia" → 0
  Photon:    "Plus House Los Andes Barranquilla"         → ✅ resultado

"Cr 14 # 45"
  Nominatim: "Carrera 14 45 Barranquilla Colombia"       → ✅ resultado
  Photon:    "Cr 14 # 45 Barranquilla"                   → 0 o complementa

"Cevillar"
  Nominatim: "Cevillar Barranquilla Colombia"            → depende de OSM
  Photon:    "Cevillar Barranquilla"                     → ✅ barrio / POI

429 en Nominatim → bloqueado 30s → solo Photon responde en ese intervalo
```

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze
```

Debe retornar 0 issues.
