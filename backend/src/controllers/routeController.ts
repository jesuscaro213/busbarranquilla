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

/// Planificador de destino: rutas cuyas paradas estén a ≤1 km de destino
// Si se proveen originLat/originLng, verifica que el bus pase por el origen
// ANTES que por el destino (stop_order del origen < stop_order del destino).
export const getPlanRoutes = async (req: Request, res: Response): Promise<void> => {
  const { destLat, destLng, originLat, originLng } = req.query;

  if (!destLat || !destLng) {
    res.status(400).json({ message: 'destLat y destLng son obligatorios' });
    return;
  }

  const lat = parseFloat(destLat as string);
  const lng = parseFloat(destLng as string);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ message: 'destLat y destLng deben ser números válidos' });
    return;
  }

  const oLat = originLat ? parseFloat(originLat as string) : null;
  const oLng = originLng ? parseFloat(originLng as string) : null;
  const hasOrigin = oLat !== null && oLng !== null && !isNaN(oLat) && !isNaN(oLng);

  try {
    // When origin is provided, enforce directional constraint:
    // First find the nearest stop to the origin, then among all stops near the destination
    // only consider those with a higher stop_order (i.e. later in the route sequence).
    // This is more robust than comparing just the two nearest stops, because the destination
    // may have a closer stop that happens to be before the origin, but also a valid stop after it.
    const query = hasOrigin
      ? `WITH origin_stops AS (
          SELECT DISTINCT ON (s.route_id)
            s.route_id,
            s.stop_order AS origin_order,
            ROUND(
              (6371 * acos(LEAST(1.0,
                cos(radians($3)) * cos(radians(s.latitude)) *
                cos(radians(s.longitude) - radians($4)) +
                sin(radians($3)) * sin(radians(s.latitude))
              )) * 1000)::numeric
            ) AS origin_distance_meters
          FROM stops s
          JOIN routes r ON r.id = s.route_id AND r.is_active = true
          WHERE (6371 * acos(LEAST(1.0,
              cos(radians($3)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians($4)) +
              sin(radians($3)) * sin(radians(s.latitude))
            ))) <= 0.6
          ORDER BY s.route_id,
            (6371 * acos(LEAST(1.0, cos(radians($3)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians($4)) +
              sin(radians($3)) * sin(radians(s.latitude))
            ))) ASC
        ),
        dest_stops AS (
          SELECT DISTINCT ON (s.route_id)
            s.route_id,
            s.name       AS nearest_stop_name,
            s.latitude   AS nearest_stop_lat,
            s.longitude  AS nearest_stop_lng,
            s.stop_order AS dest_order,
            ROUND(
              (6371 * acos(LEAST(1.0, cos(radians($1)) * cos(radians(s.latitude)) *
                cos(radians(s.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(s.latitude))
              )) * 1000)::numeric
            ) AS distance_meters
          FROM stops s
          JOIN routes r ON r.id = s.route_id AND r.is_active = true
          JOIN origin_stops os ON os.route_id = s.route_id AND s.stop_order > os.origin_order
          WHERE s.leg = 'ida'
          ORDER BY s.route_id,
            (6371 * acos(LEAST(1.0, cos(radians($1)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians($2)) +
              sin(radians($1)) * sin(radians(s.latitude))
            ))) ASC
        ),
        last_reports AS (
          SELECT DISTINCT ON (route_id)
            route_id,
            created_at AS last_report_at,
            ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60) AS minutes_ago
          FROM reports
          WHERE is_active = true
          ORDER BY route_id, created_at DESC
        )
        SELECT
          r.id, r.name, r.code,
          COALESCE(c.name, r.company) AS company_name,
          ds.nearest_stop_name, ds.nearest_stop_lat, ds.nearest_stop_lng,
          ds.distance_meters,
          os.origin_distance_meters,
          (ds.dest_order - os.origin_order) AS stop_difference,
          r.frequency_minutes,
          lr.last_report_at,
          lr.minutes_ago
        FROM dest_stops ds
        JOIN origin_stops os ON os.route_id = ds.route_id
        JOIN routes r ON r.id = ds.route_id
        LEFT JOIN companies c ON c.id = r.company_id
        LEFT JOIN last_reports lr ON lr.route_id = r.id
        WHERE ds.distance_meters <= 1000
        ORDER BY (os.origin_distance_meters + (ds.dest_order - os.origin_order) * 500 + ds.distance_meters) ASC`
      : `WITH nearest_stops AS (
          SELECT DISTINCT ON (s.route_id)
            s.route_id,
            s.name AS nearest_stop_name,
            s.latitude AS nearest_stop_lat,
            s.longitude AS nearest_stop_lng,
            ROUND(
              (6371 * acos(LEAST(1, cos(radians($1)) * cos(radians(s.latitude)) *
                cos(radians(s.longitude) - radians($2)) +
                sin(radians($1)) * sin(radians(s.latitude))
              )) * 1000)::numeric
            ) AS distance_meters
          FROM stops s
          JOIN routes r ON r.id = s.route_id AND r.is_active = true
          ORDER BY s.route_id,
            (6371 * acos(LEAST(1, cos(radians($1)) * cos(radians(s.latitude)) *
              cos(radians(s.longitude) - radians($2)) +
              sin(radians($1)) * sin(radians(s.latitude))
            ))) ASC
        ),
        last_reports AS (
          SELECT DISTINCT ON (route_id)
            route_id,
            created_at AS last_report_at,
            ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60) AS minutes_ago
          FROM reports
          WHERE is_active = true
          ORDER BY route_id, created_at DESC
        )
        SELECT
          r.id, r.name, r.code,
          COALESCE(c.name, r.company) AS company_name,
          ns.nearest_stop_name, ns.nearest_stop_lat, ns.nearest_stop_lng,
          ns.distance_meters,
          r.frequency_minutes,
          lr.last_report_at,
          lr.minutes_ago
        FROM nearest_stops ns
        JOIN routes r ON r.id = ns.route_id
        LEFT JOIN companies c ON c.id = r.company_id
        LEFT JOIN last_reports lr ON lr.route_id = r.id
        WHERE ns.distance_meters <= 1000
        ORDER BY ns.distance_meters ASC`;

    const params = hasOrigin ? [lat, lng, oLat, oLng] : [lat, lng];
    const result = await pool.query(query, params);

    res.json({ routes: result.rows });

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
