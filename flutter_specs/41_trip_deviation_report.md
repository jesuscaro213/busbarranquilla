# Spec 41 — Auto-reporte de ruta diferente al finalizar viaje

## Problem

Cuando un bus toma una ruta diferente al trazado registrado, el sistema puede detectarlo en tiempo
real (DesvioMonitor) pero no genera evidencia persistente ni la muestra al usuario al cerrar el
viaje. El equipo de admin no sabe si el desvío ocurrió durante toda la ruta o en un solo segmento.

Esta spec acumula la traza GPS del usuario durante el viaje, compara contra la geometría registrada
al finalizar, y si detecta desvío: auto-inserta un `route_update_report` y muestra un mapa
comparativo en el resumen de viaje (ruta registrada en azul, trayectoria real en naranja).

---

## Files to modify

- `backend/src/config/schema.ts`
- `backend/src/controllers/tripController.ts`
- `flutter_app/lib/core/domain/models/trip_end_result.dart`
- `flutter_app/lib/features/trip/providers/trip_state.dart`
- `flutter_app/lib/features/trip/providers/trip_notifier.dart`
- `flutter_app/lib/features/trip/screens/active_trip_screen.dart`
- `flutter_app/lib/core/l10n/strings.dart`

---

## Step 1 — Backend migrations

**File:** `backend/src/config/schema.ts`

### 1a. Add `gps_trace` column and drop the UNIQUE constraint on `route_update_reports`

Add after the existing `custom_destination_name` migration:

```typescript
// old
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS custom_destination_name TEXT DEFAULT NULL`);
```

```typescript
// new
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS custom_destination_name TEXT DEFAULT NULL`);
await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS gps_trace JSONB DEFAULT '[]'`);

// Allow multiple ruta_real reports per user per route (different tramos on the same route).
// The old UNIQUE(route_id, user_id) only kept one report per user, overwriting earlier tramos.
await pool.query(`
  ALTER TABLE route_update_reports
    DROP CONSTRAINT IF EXISTS route_update_reports_route_id_user_id_key
`);
```

**Why:** Without this change a user who reports two different tramos on the same route loses the
first one when the second is saved. Removing the constraint lets each tramo be stored independently.

---

## Step 2 — Backend: Accumulate GPS trace in `updateLocation`

**File:** `backend/src/controllers/tripController.ts`

Add a separate GPS trace append **before** the main UPDATE query in `updateLocation`.

```typescript
// old
    const updated = await pool.query(
      `UPDATE active_trips
       SET current_latitude = $1,
           current_longitude = $2,
           last_location_at = NOW(),
           credits_earned = $3,
           total_distance_meters = $4
       WHERE id = $5
       RETURNING *`,
      [latitude, longitude, creditsEarned, totalDistance, trip.id]
    );
```

```typescript
// new
    // Append GPS point to trace (cap at 500 to avoid unbounded growth)
    await pool.query(
      `UPDATE active_trips
       SET gps_trace = CASE
         WHEN jsonb_array_length(gps_trace) >= 500 THEN gps_trace
         ELSE gps_trace || jsonb_build_array(jsonb_build_array($1::float, $2::float))
       END
       WHERE id = $3`,
      [latitude, longitude, trip.id]
    );

    const updated = await pool.query(
      `UPDATE active_trips
       SET current_latitude = $1,
           current_longitude = $2,
           last_location_at = NOW(),
           credits_earned = $3,
           total_distance_meters = $4
       WHERE id = $5
       RETURNING *`,
      [latitude, longitude, creditsEarned, totalDistance, trip.id]
    );
```

---

## Step 3 — Backend: Add geometry helpers

**File:** `backend/src/controllers/tripController.ts`

Add after the existing `haversineMeters` function:

```typescript
// old
const MAX_TRIP_LOCATION_CREDITS = 15; // máx créditos por ubicación en un viaje (~15 min activos)
```

```typescript
// new
const MAX_TRIP_LOCATION_CREDITS = 15; // máx créditos por ubicación en un viaje (~15 min activos)

/** Minimum distance (km) from a point to any segment of a route polyline. */
function minDistToGeometryKm(lat: number, lng: number, geometry: [number, number][]): number {
  let min = Infinity;
  for (const [gLat, gLng] of geometry) {
    const d = haversineMeters(lat, lng, gLat, gLng) / 1000;
    if (d < min) min = d;
  }
  return min;
}

/** Average lat/lng of a list of points. Returns null if the list is empty. */
function centroid(points: [number, number][]): [number, number] | null {
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lng];
}

/**
 * Splits a GPS trace into "off-route clusters": groups of consecutive points
 * that are all >200 m from the route geometry. Clusters with fewer than 3
 * points are discarded as noise.
 */
function findOffRouteClusters(
  trace: [number, number][],
  geometry: [number, number][]
): [number, number][][] {
  const clusters: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const point of trace) {
    if (minDistToGeometryKm(point[0], point[1], geometry) > 0.2) {
      current.push(point);
    } else {
      if (current.length >= 3) clusters.push(current);
      current = [];
    }
  }
  if (current.length >= 3) clusters.push(current);
  return clusters;
}
```

---

## Step 4 — Backend: Cluster-based deviation detection in `endTrip`

**File:** `backend/src/controllers/tripController.ts`

Add deviation detection block **before** the final UPDATE that closes the trip.

Logic:
- Split the GPS trace into "off-route clusters" (consecutive points >200m from route).
- For each cluster, check if its centroid is within 500m of any tramo the user already reported
  manually via DesvioMonitor during this trip. If so → skip (already covered). If not → insert a
  new `route_update_reports` row for that unreported tramo.
- `deviationDetected = true` whenever ANY tramo (manual or auto-detected) was found.

```typescript
// old
    const updated = await pool.query(
      `UPDATE active_trips
       SET is_active = false, ended_at = NOW(), credits_earned = $2
       WHERE id = $1
       RETURNING *`,
      [trip.id, totalEarned]
    );
```

```typescript
// new
    // ── Deviation detection ──────────────────────────────────────────────────
    const trace: [number, number][] = Array.isArray(trip.gps_trace) ? trip.gps_trace : [];
    let deviationDetected = false;
    const gpsTrace: [number, number][] = trace;

    if (trip.route_id && trace.length >= 5) {
      const routeRes = await pool.query(
        'SELECT geometry FROM routes WHERE id = $1',
        [trip.route_id]
      );
      const geometry: [number, number][] = routeRes.rows[0]?.geometry ?? [];

      if (geometry.length >= 2) {
        // Load all tramos already reported manually by this user during this trip.
        const existingRes = await pool.query(
          `SELECT reported_geometry FROM route_update_reports
           WHERE user_id = $1 AND route_id = $2 AND tipo = 'ruta_real' AND created_at >= $3`,
          [userId, trip.route_id, trip.started_at]
        );

        // Compute centroid of each existing manual report so we can compare positions.
        const existingCentroids: [number, number][] = existingRes.rows
          .map((r: { reported_geometry: unknown }) => {
            const pts: [number, number][] = Array.isArray(r.reported_geometry)
              ? (r.reported_geometry as [number, number][])
              : [];
            return centroid(pts);
          })
          .filter((c): c is [number, number] => c !== null);

        // Any manual report → mark deviation detected (for the summary map display).
        if (existingCentroids.length > 0) deviationDetected = true;

        // Find unreported off-route clusters and auto-insert a report for each.
        const clusters = findOffRouteClusters(trace, geometry);

        for (const cluster of clusters) {
          const clusterCenter = centroid(cluster);
          if (!clusterCenter) continue;

          // Skip this cluster if it is within 500m of an already-reported tramo.
          const alreadyReported = existingCentroids.some(
            (c) => haversineMeters(clusterCenter[0], clusterCenter[1], c[0], c[1]) < 500
          );
          if (alreadyReported) continue;

          // New, unreported tramo → auto-insert.
          deviationDetected = true;
          await pool.query(
            `INSERT INTO route_update_reports (route_id, user_id, tipo, reported_geometry)
             VALUES ($1, $2, 'ruta_real', $3)`,
            [trip.route_id, userId, JSON.stringify(cluster)]
          );
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const updated = await pool.query(
      `UPDATE active_trips
       SET is_active = false, ended_at = NOW(), credits_earned = $2
       WHERE id = $1
       RETURNING *`,
      [trip.id, totalEarned]
    );
```

---

## Step 5 — Backend: Add deviation fields to `endTrip` response

**File:** `backend/src/controllers/tripController.ts`

```typescript
// old
    res.json({
      trip: updated.rows[0],
      totalCreditsEarned: updated.rows[0].credits_earned,
      distance_meters: Math.round(tripDistanceMeters),
      completion_bonus_earned: completionBonus > 0,
    });
```

```typescript
// new
    res.json({
      trip: updated.rows[0],
      totalCreditsEarned: updated.rows[0].credits_earned,
      distance_meters: Math.round(tripDistanceMeters),
      completion_bonus_earned: completionBonus > 0,
      deviation_detected: deviationDetected,
      gps_trace: deviationDetected ? gpsTrace : [],
    });
```

---

## Step 6 — Flutter: Update `TripEndResult` model

**File:** `flutter_app/lib/core/domain/models/trip_end_result.dart`

```dart
// old
import 'active_trip.dart';
import 'model_parsers.dart';

class TripEndResult {
  final ActiveTrip trip;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;

  const TripEndResult({
    required this.trip,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
  });

  factory TripEndResult.fromJson(Map<String, dynamic> json) {
    final tripRaw = json['trip'];
    final tripMap = tripRaw is Map<String, dynamic>
        ? tripRaw
        : (tripRaw is Map ? Map<String, dynamic>.from(tripRaw) : <String, dynamic>{});

    return TripEndResult(
      trip: ActiveTrip.fromJson(tripMap),
      totalCreditsEarned: asInt(json['totalCreditsEarned']),
      distanceMeters: asInt(json['distance_meters']),
      completionBonusEarned: asBool(json['completion_bonus_earned']),
    );
  }
}
```

```dart
// new
import 'package:latlong2/latlong.dart';

import 'active_trip.dart';
import 'model_parsers.dart';

class TripEndResult {
  final ActiveTrip trip;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final bool deviationDetected;
  final List<LatLng> gpsTrace;

  const TripEndResult({
    required this.trip,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    this.deviationDetected = false,
    this.gpsTrace = const [],
  });

  factory TripEndResult.fromJson(Map<String, dynamic> json) {
    final tripRaw = json['trip'];
    final tripMap = tripRaw is Map<String, dynamic>
        ? tripRaw
        : (tripRaw is Map ? Map<String, dynamic>.from(tripRaw) : <String, dynamic>{});

    return TripEndResult(
      trip: ActiveTrip.fromJson(tripMap),
      totalCreditsEarned: asInt(json['totalCreditsEarned']),
      distanceMeters: asInt(json['distance_meters']),
      completionBonusEarned: asBool(json['completion_bonus_earned']),
      deviationDetected: asBool(json['deviation_detected']),
      gpsTrace: asLatLngList(json['gps_trace'] ?? const []),
    );
  }
}
```

---

## Step 7 — Flutter: Update `TripEnded` state

**File:** `flutter_app/lib/features/trip/providers/trip_state.dart`

### 7a. Add import at the top

```dart
// old
import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
```

```dart
// new
import 'package:latlong2/latlong.dart';

import '../../../core/domain/models/active_trip.dart';
import '../../../core/domain/models/bus_route.dart';
import '../../../core/domain/models/report.dart';
import '../../../core/domain/models/stop.dart';
```

### 7b. Add new fields to `TripEnded`

```dart
// old
final class TripEnded extends TripState {
  final String routeName;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final Duration tripDuration;
  final int reportsCreated;
  final int streakDays;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
    this.reportsCreated = 0,
    this.streakDays = 0,
  });
}
```

```dart
// new
final class TripEnded extends TripState {
  final String routeName;
  final int totalCreditsEarned;
  final int distanceMeters;
  final bool completionBonusEarned;
  final Duration tripDuration;
  final int reportsCreated;
  final int streakDays;
  final bool deviationDetected;
  final List<LatLng> gpsTrace;
  final List<LatLng> routeGeometry;

  const TripEnded({
    required this.routeName,
    required this.totalCreditsEarned,
    required this.distanceMeters,
    required this.completionBonusEarned,
    required this.tripDuration,
    this.reportsCreated = 0,
    this.streakDays = 0,
    this.deviationDetected = false,
    this.gpsTrace = const [],
    this.routeGeometry = const [],
  });
}
```

---

## Step 8 — Flutter: Update `endTrip()` in `TripNotifier`

**File:** `flutter_app/lib/features/trip/providers/trip_notifier.dart`

### 8a. Capture route geometry before the call

```dart
// old
    final active = state as TripActive;
    final startedAt = active.trip.startedAt;
    final routeName = active.route.name;
```

```dart
// new
    final active = state as TripActive;
    final startedAt = active.trip.startedAt;
    final routeName = active.route.name;
    final routeGeometry = active.route.geometry;
```

### 8b. Pass new fields to `TripEnded`

```dart
// old
      case Success<TripEndResult>(data: final data):
        state = TripEnded(
          routeName: routeName,
          totalCreditsEarned: data.totalCreditsEarned,
          distanceMeters: data.distanceMeters,
          completionBonusEarned: data.completionBonusEarned,
          tripDuration: duration,
          reportsCreated: reportsCreated,
          streakDays: streakDays,
        );
```

```dart
// new
      case Success<TripEndResult>(data: final data):
        state = TripEnded(
          routeName: routeName,
          totalCreditsEarned: data.totalCreditsEarned,
          distanceMeters: data.distanceMeters,
          completionBonusEarned: data.completionBonusEarned,
          tripDuration: duration,
          reportsCreated: reportsCreated,
          streakDays: streakDays,
          deviationDetected: data.deviationDetected,
          gpsTrace: data.gpsTrace,
          routeGeometry: routeGeometry,
        );
```

---

## Step 9 — Flutter: Add deviation card and map to `_TripSummaryScreen`

**File:** `flutter_app/lib/features/trip/screens/active_trip_screen.dart`

### 9a. Insert deviation section in the Column

```dart
// old
                    if (!ended.completionBonusEarned && ended.distanceMeters < 2000) ...<Widget>[
```

```dart
// new
                    if (ended.deviationDetected) ...<Widget>[
                      const SizedBox(height: 12),
                      _DeviationMapSection(ended: ended),
                    ],

                    if (!ended.completionBonusEarned && ended.distanceMeters < 2000) ...<Widget>[
```

### 9b. Add `_DeviationMapSection` widget class

Add after the closing `}` of the `_StatCardWide` class (after the last widget class in the file):

```dart
// add
class _DeviationMapSection extends StatelessWidget {
  final TripEnded ended;

  const _DeviationMapSection({required this.ended});

  LatLngBounds? _computeBounds() {
    final allPoints = <LatLng>[...ended.routeGeometry, ...ended.gpsTrace];
    if (allPoints.isEmpty) return null;
    return LatLngBounds.fromPoints(allPoints);
  }

  @override
  Widget build(BuildContext context) {
    final bounds = _computeBounds();

    return Container(
      decoration: BoxDecoration(
        color: Colors.orange.shade50,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.orange.shade300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
            child: Row(
              children: <Widget>[
                Icon(Icons.alt_route, color: Colors.orange.shade700, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    AppStrings.deviationReportTitle,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: Colors.orange.shade900,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
            child: Text(
              AppStrings.deviationReportBody,
              style: TextStyle(fontSize: 12, color: Colors.orange.shade800),
            ),
          ),
          if (bounds != null && (ended.routeGeometry.isNotEmpty || ended.gpsTrace.isNotEmpty))
            ClipRRect(
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(14)),
              child: SizedBox(
                height: 180,
                child: FlutterMap(
                  options: MapOptions(
                    initialCameraFit: CameraFit.bounds(
                      bounds: bounds,
                      padding: const EdgeInsets.all(24),
                    ),
                    interactionOptions: const InteractionOptions(
                      flags: InteractiveFlag.none,
                    ),
                  ),
                  children: <Widget>[
                    TileLayer(
                      urlTemplate:
                          'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                      subdomains: const ['a', 'b', 'c', 'd'],
                    ),
                    if (ended.routeGeometry.isNotEmpty)
                      PolylineLayer(
                        polylines: <Polyline>[
                          Polyline(
                            points: ended.routeGeometry,
                            strokeWidth: 3,
                            color: Colors.blue.shade600,
                          ),
                        ],
                      ),
                    if (ended.gpsTrace.isNotEmpty)
                      PolylineLayer(
                        polylines: <Polyline>[
                          Polyline(
                            points: ended.gpsTrace,
                            strokeWidth: 3,
                            color: Colors.orange.shade700,
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 2),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Row(
              children: <Widget>[
                _LegendDot(color: Colors.blue.shade600),
                const SizedBox(width: 4),
                Text(
                  AppStrings.deviationReportRegistered,
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                ),
                const SizedBox(width: 12),
                _LegendDot(color: Colors.orange.shade700),
                const SizedBox(width: 4),
                Text(
                  AppStrings.deviationReportActual,
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade600),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;

  const _LegendDot({required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
```

---

## Step 10 — Flutter: Add strings

**File:** `flutter_app/lib/core/l10n/strings.dart`

Add before the closing `}` of the `AppStrings` class (after `helpPremiumTitle`):

```dart
// old
  static const helpPremiumTitle = 'MiBus Premium';
}
```

```dart
// new
  static const helpPremiumTitle = 'MiBus Premium';

  // Deviation report — trip summary
  static const deviationReportTitle = 'Se detectó una ruta diferente';
  static const deviationReportBody =
      'El recorrido del bus fue diferente al trazado registrado. '
      'Se generó un reporte automático para mejorar el mapa.';
  static const deviationReportRegistered = 'Ruta registrada';
  static const deviationReportActual = 'Ruta recorrida';
}
```

---

## Verification

```bash
~/development/flutter/bin/flutter analyze
```

Must return **0 issues**.

---

## Summary of changes

| Component | Change |
|---|---|
| `route_update_reports` UNIQUE | **Eliminada** la constraint `UNIQUE(route_id, user_id)` — permite múltiples tramos por usuario por ruta |
| `active_trips.gps_trace` | Nueva columna JSONB — acumula trayectoria GPS del viaje |
| `updateLocation` | Append del punto GPS a `gps_trace` (máx 500 puntos) |
| Helpers en `tripController` | `minDistToGeometryKm`, `centroid`, `findOffRouteClusters` |
| `endTrip` | Detección por clústeres: compara cada tramo fuera de ruta contra reportes manuales (centroide ±500m); inserta solo tramos nuevos, no duplica los ya reportados |
| `endTrip` response | Nuevos campos: `deviation_detected`, `gps_trace` |
| `TripEndResult` | Nuevos campos: `deviationDetected`, `gpsTrace` |
| `TripEnded` | Nuevos campos: `deviationDetected`, `gpsTrace`, `routeGeometry` |
| `endTrip()` notifier | Captura `routeGeometry` antes de finalizar; pasa los tres nuevos campos a `TripEnded` |
| `_TripSummaryScreen` | Muestra `_DeviationMapSection` si `deviationDetected` |
| `_DeviationMapSection` | Mapa 180px con polyline azul (registrada) y naranja (recorrida) + leyenda |
