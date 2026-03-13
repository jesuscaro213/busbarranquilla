import { Request, Response } from 'express';
import pool from '../config/database';

const RUTA_REAL_THRESHOLD = 3; // reportes para activar alerta

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function minDistToGeometryMeters(lat: number, lng: number, geometry: [number,number][]): number {
  let min = Infinity;
  for (const [gLat, gLng] of geometry) {
    const d = haversineMeters(lat, lng, gLat, gLng);
    if (d < min) min = d;
  }
  return min;
}

// POST /api/routes/:id/update-report
// Usuario reporta que el bus tomó un camino diferente
export const reportRouteUpdate = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { tipo, lat, lng } = req.body;
  const userId = (req as any).userId;

  if (!['trancon', 'ruta_real'].includes(tipo)) {
    res.status(400).json({ message: 'tipo debe ser trancon o ruta_real' });
    return;
  }

  try {
    let geomValue: string | null = null;

    if (tipo === 'ruta_real') {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);

      if (isNaN(userLat) || isNaN(userLng)) {
        res.status(400).json({ message: 'lat y lng son requeridos para ruta_real' });
        return;
      }

      // Fetch route geometry to validate position
      const routeResult = await pool.query(
        `SELECT geometry FROM routes WHERE id = $1`,
        [id]
      );
      const routeGeometry: [number, number][] | null = routeResult.rows[0]?.geometry ?? null;

      if (routeGeometry && routeGeometry.length >= 2) {
        const distMeters = minDistToGeometryMeters(userLat, userLng, routeGeometry);
        if (distMeters < 200) {
          res.status(400).json({
            on_route: true,
            message: 'Estás sobre la ruta registrada, el reporte no aplica',
          });
          return;
        }
      }

      // Valid deviation — store start point
      geomValue = JSON.stringify([[userLat, userLng]]);
    }

    await pool.query(
      `INSERT INTO route_update_reports (route_id, user_id, tipo, reported_geometry)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (route_id, user_id)
       DO UPDATE SET tipo = $3, created_at = NOW(), reported_geometry = COALESCE($4, route_update_reports.reported_geometry)`,
      [id, userId, tipo, geomValue]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM route_update_reports
       WHERE route_id = $1
         AND tipo = 'ruta_real'
         AND created_at > NOW() - INTERVAL '30 days'`,
      [id]
    );
    const total = parseInt(countResult.rows[0].total, 10);

    res.json({ ok: true, ruta_real_count: total, threshold_reached: total >= RUTA_REAL_THRESHOLD });
  } catch (error) {
    console.error('Error en reportRouteUpdate:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/routes/:id/update-report/reentry
// Called by the Flutter app when GPS re-enters the registered route after a ruta_real report.
// Updates reported_geometry from [start] to [start, end], giving admin the full outdated segment.
export const updateDeviationReEntry = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { lat, lng } = req.body;
  const userId = (req as any).userId;

  const endLat = parseFloat(lat);
  const endLng = parseFloat(lng);

  if (isNaN(endLat) || isNaN(endLng)) {
    res.status(400).json({ message: 'lat y lng son requeridos' });
    return;
  }

  try {
    const existing = await pool.query(
      `SELECT reported_geometry FROM route_update_reports
       WHERE route_id = $1 AND user_id = $2 AND tipo = 'ruta_real'`,
      [id, userId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ message: 'No se encontró un reporte ruta_real activo' });
      return;
    }

    const currentGeom: [number, number][] | null = existing.rows[0].reported_geometry;

    // Only update if we have exactly the start point (avoid overwriting a complete segment)
    if (!currentGeom || currentGeom.length !== 1) {
      res.json({ ok: true, updated: false });
      return;
    }

    const updatedGeom: [number, number][] = [[currentGeom[0][0], currentGeom[0][1]], [endLat, endLng]];

    await pool.query(
      `UPDATE route_update_reports
       SET reported_geometry = $1
       WHERE route_id = $2 AND user_id = $3 AND tipo = 'ruta_real'`,
      [JSON.stringify(updatedGeom), id, userId]
    );

    res.json({ ok: true, updated: true });
  } catch (error) {
    console.error('Error en updateDeviationReEntry:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/routes/update-alerts  (solo admin)
// Rutas que superaron el umbral de reportes "ruta_real" en los últimos 30 días
export const getRouteUpdateAlerts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const alertsResult = await pool.query(
      `SELECT
         r.id,
         r.name,
         r.code,
         r.geometry,
         r.route_alert_reviewed_at,
         COUNT(rur.id) FILTER (WHERE rur.tipo = 'ruta_real') AS ruta_real_count,
         COUNT(rur.id) FILTER (WHERE rur.tipo = 'trancon')   AS trancon_count,
         MAX(rur.created_at) AS last_report_at
       FROM routes r
       JOIN route_update_reports rur
         ON rur.route_id = r.id
        AND rur.created_at > NOW() - INTERVAL '30 days'
       GROUP BY r.id
       HAVING COUNT(rur.id) FILTER (WHERE rur.tipo = 'ruta_real') >= $1
          AND (
            r.route_alert_reviewed_at IS NULL
            OR MAX(rur.created_at) > r.route_alert_reviewed_at
          )
       ORDER BY ruta_real_count DESC, last_report_at DESC`,
      [RUTA_REAL_THRESHOLD]
    );

    // Para cada alerta, obtener reportantes y sus últimas posiciones GPS
    const alerts = await Promise.all(
      alertsResult.rows.map(async (row) => {
        // Reportantes con nombre, tipo y geometría reportada
        const reportersResult = await pool.query(
          `SELECT u.name AS user_name, rur.tipo, rur.created_at, rur.reported_geometry
           FROM route_update_reports rur
           JOIN users u ON u.id = rur.user_id
           WHERE rur.route_id = $1
             AND rur.created_at > NOW() - INTERVAL '30 days'
           ORDER BY rur.created_at DESC`,
          [row.id]
        );

        // Últimas posiciones GPS de usuarios que reportaron "ruta_real" (viajes activos o recientes)
        const gpsResult = await pool.query(
          `SELECT at.current_latitude AS lat, at.current_longitude AS lng, at.last_location_at
           FROM active_trips at
           WHERE at.route_id = $1
             AND at.last_location_at > NOW() - INTERVAL '7 days'
             AND at.user_id IN (
               SELECT user_id FROM route_update_reports
               WHERE route_id = $1
                 AND tipo = 'ruta_real'
                 AND created_at > NOW() - INTERVAL '30 days'
             )
           ORDER BY at.last_location_at DESC
           LIMIT 20`,
          [row.id]
        );

        return {
          ...row,
          reporters: reportersResult.rows,
          reporter_positions: gpsResult.rows.map((p: { lat: string; lng: string }) => [
            parseFloat(p.lat),
            parseFloat(p.lng),
          ]),
          // Geometrías GPS reportadas (solo ruta_real con geometría guardada)
          reported_geometries: reportersResult.rows
            .filter((r: { tipo: string; reported_geometry: unknown }) =>
              r.tipo === 'ruta_real' && r.reported_geometry
            )
            .map((r: { user_name: string; reported_geometry: [number, number][] }) => ({
              user_name: r.user_name,
              geometry: r.reported_geometry,
            })),
        };
      })
    );

    res.json({ alerts });
  } catch (error) {
    console.error('Error en getRouteUpdateAlerts:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/routes/update-alerts/count  (solo admin)
// Número de alertas pendientes para el badge del sidebar
export const getRouteUpdateAlertsCount = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT r.id) AS total
       FROM routes r
       JOIN route_update_reports rur
         ON rur.route_id = r.id
        AND rur.created_at > NOW() - INTERVAL '30 days'
        AND rur.tipo = 'ruta_real'
       WHERE (
         r.route_alert_reviewed_at IS NULL
         OR rur.created_at > r.route_alert_reviewed_at
       )
       GROUP BY r.id
       HAVING COUNT(rur.id) >= $1`,
      [RUTA_REAL_THRESHOLD]
    );

    res.json({ count: result.rowCount ?? 0 });
  } catch (error) {
    console.error('Error en getRouteUpdateAlertsCount:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/routes/:id/apply-reported-geometry  (solo admin)
// Reemplaza la geometría de la ruta con el track GPS reportado por un usuario
// Marca manually_edited_at = NOW() para que los imports no la pisen
export const applyReportedGeometry = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { geometry } = req.body; // [lat, lng][]

  if (!Array.isArray(geometry) || geometry.length < 2) {
    res.status(400).json({ message: 'geometry debe ser un array de al menos 2 puntos' });
    return;
  }

  try {
    await pool.query(
      `UPDATE routes
       SET geometry = $1, manually_edited_at = NOW(), route_alert_reviewed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(geometry), id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en applyReportedGeometry:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/routes/:id/dismiss-alert  (solo admin)
// Marca la alerta como revisada — desaparece hasta que lleguen nuevos reportes
export const dismissRouteAlert = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE routes SET route_alert_reviewed_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en dismissRouteAlert:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
