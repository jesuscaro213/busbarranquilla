import { Request, Response } from 'express';
import pool from '../config/database';
import { fetchOSRMGeometry } from '../services/osrmService';
import { computeLegsForRoute } from '../services/legService';

// Listar todas las rutas activas (opcionalmente filtradas por type)
export const listRoutes = async (req: Request, res: Response): Promise<void> => {
  const { type } = req.query;

  try {
    let query = `SELECT r.*, c.name AS company_name
      FROM routes r
      LEFT JOIN companies c ON c.id = r.company_id`;

    if (type === 'transmetro') {
      query += ` WHERE r.type IN ('transmetro', 'alimentadora')`;
    } else if (type === 'bus') {
      query += ` WHERE r.type = 'bus'`;
    }

    query += ` ORDER BY r.name ASC`;

    const result = await pool.query(query);
    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error listando rutas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener ruta por ID con sus paradas
export const getRouteById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const routeResult = await pool.query(
      `SELECT r.*, c.name AS company_name
       FROM routes r
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE r.id = $1`,
      [id]
    );

    if (routeResult.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const stopsResult = await pool.query(
      'SELECT * FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
      [id]
    );

    const route = {
      ...routeResult.rows[0],
      stops: stopsResult.rows
    };

    res.json({ route });

  } catch (error) {
    console.error('Error obteniendo ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Crear ruta nueva (requiere autenticación)
export const createRoute = async (req: Request, res: Response): Promise<void> => {
  const { name, code, company, company_id, first_departure, last_departure, frequency_minutes, geometry } = req.body;

  if (!name || !code) {
    res.status(400).json({ message: 'El nombre y el código de la ruta son obligatorios' });
    return;
  }

  try {
    const codeExists = await pool.query(
      'SELECT id FROM routes WHERE code = $1',
      [code]
    );

    if (codeExists.rows.length > 0) {
      res.status(400).json({ message: 'El código de ruta ya existe' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO routes (name, code, company, company_id, first_departure, last_departure, frequency_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, code, company, company_id ?? null, first_departure, last_departure, frequency_minutes]
    );

    const route = result.rows[0];

    if (Array.isArray(geometry)) {
      // Geometry provided directly — persist and return
      await pool.query('UPDATE routes SET geometry = $1 WHERE id = $2', [JSON.stringify(geometry), route.id]);
      route.geometry = geometry;
    } else {
      // Try OSRM (non-blocking: failure keeps geometry null)
      try {
        const stopsResult = await pool.query(
          'SELECT latitude, longitude FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
          [route.id]
        );
        if (stopsResult.rows.length >= 2) {
          const osrm = await fetchOSRMGeometry(stopsResult.rows);
          if (osrm) {
            await pool.query('UPDATE routes SET geometry = $1 WHERE id = $2', [JSON.stringify(osrm.points), route.id]);
            route.geometry = osrm.points;
          } else {
            console.warn(`Route ${route.id} created without geometry, admin can regenerate`);
          }
        }
      } catch {
        console.warn(`Route ${route.id} created without geometry, admin can regenerate`);
      }
    }

    res.status(201).json({
      message: 'Ruta creada exitosamente',
      route,
    });

  } catch (error) {
    console.error('Error creando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Rutas cercanas a una coordenada (Haversine sobre paradas)
export const getNearbyRoutes = async (req: Request, res: Response): Promise<void> => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    res.status(400).json({ message: 'lat y lng son obligatorios' });
    return;
  }

  const radiusKm = parseFloat(radius as string) || 0.5;

  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (r.id)
           r.*,
           COALESCE(c.name, r.company) AS company_name,
           MIN(
             6371 * acos(LEAST(1.0,
               cos(radians($1)) * cos(radians(s.latitude)) *
               cos(radians(s.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(s.latitude))
             ))
           ) OVER (PARTITION BY r.id) AS min_distance
         FROM routes r
         JOIN stops s ON s.route_id = r.id
         LEFT JOIN companies c ON c.id = r.company_id
         WHERE r.is_active = true
           AND (
             6371 * acos(LEAST(1.0,
               cos(radians($1)) * cos(radians(s.latitude)) *
               cos(radians(s.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(s.latitude))
             ))
           ) < $3
         ORDER BY r.id, min_distance ASC
       ) sub
       ORDER BY min_distance ASC`,
      [parseFloat(lat as string), parseFloat(lng as string), radiusKm]
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error buscando rutas cercanas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Actualizar ruta (requiere admin)
export const updateRoute = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, code, company, company_id, first_departure, last_departure, frequency_minutes, geometry } = req.body;

  try {
    const exists = await pool.query('SELECT id FROM routes WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const result = await pool.query(
      `UPDATE routes
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           company = COALESCE($3, company),
           company_id = COALESCE($4, company_id),
           first_departure = COALESCE($5, first_departure),
           last_departure = COALESCE($6, last_departure),
           frequency_minutes = COALESCE($7, frequency_minutes)
       WHERE id = $8
       RETURNING *`,
      [name, code, company, company_id ?? null, first_departure, last_departure, frequency_minutes, id]
    );

    const route = result.rows[0];

    if (Array.isArray(geometry)) {
      await pool.query('UPDATE routes SET geometry = $1 WHERE id = $2', [JSON.stringify(geometry), id]);
      route.geometry = geometry;
    } else {
      // Regenerar geometría desde paradas actuales
      try {
        const stopsResult = await pool.query(
          'SELECT latitude, longitude FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
          [id]
        );
        if (stopsResult.rows.length >= 2) {
          const osrm = await fetchOSRMGeometry(stopsResult.rows);
          if (osrm) {
            await pool.query('UPDATE routes SET geometry = $1 WHERE id = $2', [JSON.stringify(osrm.points), id]);
            route.geometry = osrm.points;
          } else {
            console.warn(`Route ${id} updated without geometry, admin can regenerate`);
          }
        }
      } catch {
        console.warn(`Route ${id} updated without geometry, admin can regenerate`);
      }
    }

    res.json({ message: 'Ruta actualizada', route });

  } catch (error) {
    console.error('Error actualizando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Eliminar ruta y sus paradas (requiere admin)
export const deleteRoute = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const exists = await pool.query('SELECT id FROM routes WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    // Eliminar paradas primero (FK sin CASCADE)
    await pool.query('DELETE FROM stops WHERE route_id = $1', [id]);
    await pool.query('DELETE FROM routes WHERE id = $1', [id]);

    res.json({ message: 'Ruta eliminada correctamente' });

  } catch (error) {
    console.error('Error eliminando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Alternar is_active de una ruta (requiere admin)
export const toggleRouteActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE routes SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const route = result.rows[0];
    res.json({
      route,
      message: route.is_active ? 'Ruta activada' : 'Ruta desactivada',
    });

  } catch (error) {
    console.error('Error alternando estado de la ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Feed de actividad reciente (últimas 60 min, hasta 8 rutas)
export const getActiveFeed = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `WITH latest_reports AS (
        SELECT DISTINCT ON (route_id)
          route_id,
          created_at AS last_report_at,
          type AS last_report_type,
          ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60) AS minutes_ago
        FROM reports
        WHERE created_at > NOW() - INTERVAL '60 minutes' AND is_active = true
        ORDER BY route_id, created_at DESC
      )
      SELECT
        r.id, r.name, r.code,
        COALESCE(c.name, r.company) AS company_name,
        lr.last_report_at, lr.last_report_type, lr.minutes_ago,
        (SELECT COUNT(*)::int FROM active_trips at2
          WHERE at2.route_id = r.id AND at2.is_active = true) AS active_users_count,
        EXISTS(
          SELECT 1 FROM active_trips at2
          WHERE at2.route_id = r.id AND at2.is_active = true
        ) AS has_active_users,
        true AS has_recent_report
      FROM latest_reports lr
      JOIN routes r ON r.id = lr.route_id
      LEFT JOIN companies c ON c.id = r.company_id
      WHERE r.is_active = true
      ORDER BY lr.last_report_at DESC
      LIMIT 8`
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error obteniendo feed activo:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Haversine distance in km between two lat/lng points
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Minimum distance in km from a point to any point along a polyline
function minDistToGeometry(lat: number, lng: number, geometry: [number, number][]): { dist: number; idx: number } {
  let dist = Infinity;
  let idx = 0;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineKm(lat, lng, geometry[i][0], geometry[i][1]);
    if (d < dist) { dist = d; idx = i; }
  }
  return { dist, idx };
}

// Planificador: busca rutas cuya GEOMETRÍA pase cerca del origen y del destino.
// Mucho más preciso que buscar por paradas — el bus puede pasar a 50 m aunque
// la parada más cercana esté a 800 m.
export const getPlanRoutes = async (req: Request, res: Response): Promise<void> => {
  const { destLat, destLng, originLat, originLng } = req.query;

  if (!destLat || !destLng) {
    res.status(400).json({ message: 'destLat y destLng son obligatorios' });
    return;
  }

  const dLat = parseFloat(destLat as string);
  const dLng = parseFloat(destLng as string);
  if (isNaN(dLat) || isNaN(dLng)) {
    res.status(400).json({ message: 'destLat y destLng deben ser números válidos' });
    return;
  }

  const oLat = originLat ? parseFloat(originLat as string) : null;
  const oLng = originLng ? parseFloat(originLng as string) : null;
  const hasOrigin = oLat !== null && oLng !== null && !isNaN(oLat!) && !isNaN(oLng!);

  // Thresholds: how close the route geometry must pass to each point
  const ORIGIN_THRESHOLD_KM = 0.25;  // 250 m — route must pass within 250 m of origin
  const DEST_THRESHOLD_KM   = 0.45;  // 450 m — route must pass within 450 m of destination

  try {
    // Fetch all active routes with geometry and their stops + last report
    const [routesRes, stopsRes, reportsRes] = await Promise.all([
      pool.query<{
        id: number; name: string; code: string; frequency_minutes: number | null;
        company_name: string | null; geometry: [number, number][] | null;
      }>(
        `SELECT r.id, r.name, r.code, r.frequency_minutes,
                COALESCE(c.name, r.company) AS company_name,
                r.geometry
         FROM routes r
         LEFT JOIN companies c ON c.id = r.company_id
         WHERE r.is_active = true`
      ),
      pool.query<{ id: number; route_id: number; name: string; latitude: string; longitude: string; stop_order: number }>(
        `SELECT id, route_id, name, latitude, longitude, stop_order
         FROM stops ORDER BY route_id, stop_order`
      ),
      pool.query<{ route_id: number; last_report_at: string; minutes_ago: number }>(
        `SELECT DISTINCT ON (route_id) route_id, created_at AS last_report_at,
                ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60)::int AS minutes_ago
         FROM reports WHERE is_active = true
         ORDER BY route_id, created_at DESC`
      ),
    ]);

    // Index stops and reports by route_id
    const stopsByRoute: Record<number, typeof stopsRes.rows> = {};
    for (const s of stopsRes.rows) {
      if (!stopsByRoute[s.route_id]) stopsByRoute[s.route_id] = [];
      stopsByRoute[s.route_id].push(s);
    }
    const reportByRoute: Record<number, typeof reportsRes.rows[0]> = {};
    for (const r of reportsRes.rows) reportByRoute[r.route_id] = r;

    const results: any[] = [];

    for (const route of routesRes.rows) {
      const geometry = route.geometry;
      const stops = stopsByRoute[route.id] ?? [];

      let originDistKm: number;
      let destDistKm: number;
      let boardingStop: typeof stops[0] | null = null;
      let alightingStop: typeof stops[0] | null = null;

      if (geometry && geometry.length >= 2) {
        // ── Geometry-based matching ──────────────────────────────────────────
        const originPt = hasOrigin
          ? minDistToGeometry(oLat!, oLng!, geometry)
          : { dist: 0, idx: 0 };

        if (hasOrigin && originPt.dist > ORIGIN_THRESHOLD_KM) continue;
        originDistKm = originPt.dist;

        // Check destination appears AFTER origin along the route
        const searchFrom = hasOrigin ? originPt.idx + 1 : 0;
        let minDest = Infinity;
        let destIdx = -1;
        for (let i = searchFrom; i < geometry.length; i++) {
          const d = haversineKm(dLat, dLng, geometry[i][0], geometry[i][1]);
          if (d < minDest) { minDest = d; destIdx = i; }
        }
        if (minDest > DEST_THRESHOLD_KM || destIdx === -1) continue;
        destDistKm = minDest;

        // Find nearest stop to origin (boarding) and destination (alighting)
        if (stops.length > 0) {
          let minO = Infinity, minD = Infinity;
          for (const s of stops) {
            const sLat = parseFloat(s.latitude), sLng = parseFloat(s.longitude);
            if (hasOrigin) {
              const d = haversineKm(oLat!, oLng!, sLat, sLng);
              if (d < minO) { minO = d; boardingStop = s; }
            }
            const d2 = haversineKm(dLat, dLng, sLat, sLng);
            if (d2 < minD) { minD = d2; alightingStop = s; }
          }
        }
      } else {
        // ── Fallback: stop-based for routes without geometry ─────────────────
        if (stops.length === 0) continue;
        let minO = Infinity, minD = Infinity;
        let boardIdx = -1, alightIdx = -1;
        for (let i = 0; i < stops.length; i++) {
          const sLat = parseFloat(stops[i].latitude), sLng = parseFloat(stops[i].longitude);
          if (hasOrigin) {
            const d = haversineKm(oLat!, oLng!, sLat, sLng);
            if (d < minO) { minO = d; boardIdx = i; }
          }
          const d2 = haversineKm(dLat, dLng, sLat, sLng);
          if (d2 < minD) { minD = d2; alightIdx = i; }
        }
        if (hasOrigin && minO > 0.8) continue;           // no nearby origin stop
        if (minD > 0.8) continue;                         // no nearby dest stop
        if (hasOrigin && alightIdx <= boardIdx) continue; // wrong direction
        originDistKm = minO;
        destDistKm = minD;
        boardingStop = boardIdx >= 0 ? stops[boardIdx] : null;
        alightingStop = alightIdx >= 0 ? stops[alightIdx] : null;
      }

      const report = reportByRoute[route.id];
      const originM = Math.round((hasOrigin ? originDistKm! : 0) * 1000);
      const destM   = Math.round(
        alightingStop
          ? haversineKm(dLat, dLng, parseFloat(alightingStop.latitude), parseFloat(alightingStop.longitude)) * 1000
          : destDistKm! * 1000
      );

      results.push({
        id: route.id,
        name: route.name,
        code: route.code,
        company_name: route.company_name,
        nearest_stop_name: alightingStop?.name ?? '',
        nearest_stop_lat:  alightingStop ? parseFloat(alightingStop.latitude)  : dLat,
        nearest_stop_lng:  alightingStop ? parseFloat(alightingStop.longitude) : dLng,
        distance_meters:   destM,
        origin_distance_meters: hasOrigin ? originM : null,
        stop_difference: null,
        frequency_minutes: route.frequency_minutes,
        last_report_at: report?.last_report_at ?? null,
        minutes_ago:    report ? Number(report.minutes_ago) : null,
        geometry: route.geometry,
      });
    }

    // Sort: closest total (origin walk + dest walk)
    results.sort((a, b) =>
      ((a.origin_distance_meters ?? 0) + a.distance_meters) -
      ((b.origin_distance_meters ?? 0) + b.distance_meters)
    );

    res.json({ routes: results });

  } catch (error) {
    console.error('Error obteniendo rutas para planificador:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Regenerar geometría de una ruta llamando OSRM (requiere admin)
export const regenerateGeometry = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const stopsResult = await pool.query(
      'SELECT latitude, longitude FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
      [id]
    );

    const osrm = await fetchOSRMGeometry(stopsResult.rows);

    if (!osrm) {
      res.json({ success: false });
      return;
    }

    await pool.query('UPDATE routes SET geometry = $1 WHERE id = $2', [JSON.stringify(osrm.points), id]);
    await computeLegsForRoute(parseInt(id as string, 10));

    res.json({ success: true, pointsCount: osrm.points.length, hadFallbacks: osrm.hadFallbacks });

  } catch (error) {
    console.error('Error regenerando geometría:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Seed deshabilitado — las rutas se crean desde el panel admin
export const seedRoutesHandler = async (_req: Request, res: Response): Promise<void> => {
  res.json({ message: 'Seed deshabilitado. Usa el panel admin para crear rutas.' });
};

// Buscar rutas que sirven entre origen y destino
export const searchRoute = async (req: Request, res: Response): Promise<void> => {
  const { origin, destination } = req.query;

  if (!origin || !destination) {
    res.status(400).json({ message: 'Se requieren los parámetros origin y destination' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT DISTINCT r.*
       FROM routes r
       JOIN stops s1 ON s1.route_id = r.id
       JOIN stops s2 ON s2.route_id = r.id
       WHERE s1.name ILIKE $1
         AND s2.name ILIKE $2
         AND s1.stop_order < s2.stop_order
         AND r.is_active = true
       ORDER BY r.name ASC`,
      [`%${origin}%`, `%${destination}%`]
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error buscando rutas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
