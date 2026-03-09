import { Request, Response } from 'express';
import pool from '../config/database';

const RUTA_REAL_THRESHOLD = 3; // reportes para activar alerta

// POST /api/routes/:id/update-report
// Usuario reporta que el bus tomó un camino diferente
export const reportRouteUpdate = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { tipo } = req.body; // 'trancon' | 'ruta_real'
  const userId = (req as any).userId;

  if (!['trancon', 'ruta_real'].includes(tipo)) {
    res.status(400).json({ message: 'tipo debe ser trancon o ruta_real' });
    return;
  }

  try {
    // Upsert: si el usuario ya reportó esta ruta, actualiza el tipo y timestamp
    await pool.query(
      `INSERT INTO route_update_reports (route_id, user_id, tipo)
       VALUES ($1, $2, $3)
       ON CONFLICT (route_id, user_id)
       DO UPDATE SET tipo = $3, created_at = NOW()`,
      [id, userId, tipo]
    );

    // Verificar si se alcanzó el umbral de ruta_real
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

// GET /api/routes/update-alerts  (solo admin)
// Rutas que superaron el umbral de reportes "ruta_real" en los últimos 30 días
export const getRouteUpdateAlerts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT
         r.id,
         r.name,
         r.code,
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

    res.json({ alerts: result.rows });
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
