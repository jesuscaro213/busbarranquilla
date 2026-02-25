import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';

const VALID_TYPES = ['bus_location', 'traffic', 'bus_full', 'no_service', 'detour'] as const;

const CREDITS_BY_TYPE: Record<string, number> = {
  bus_location: 5,
  traffic: 4,
  bus_full: 3,
  no_service: 4,
  detour: 4
};

// Crear reporte (protegido)
export const createReport = async (req: Request, res: Response): Promise<void> => {
  const { route_id, type, latitude, longitude, description } = req.body;
  const userId = (req as any).userId;

  if (!type || latitude === undefined || longitude === undefined) {
    res.status(400).json({ message: 'type, latitude y longitude son obligatorios' });
    return;
  }

  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ message: 'Tipo de reporte inválido' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO reports (user_id, route_id, type, latitude, longitude, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, route_id || null, type, latitude, longitude, description || null]
    );

    const report = result.rows[0];
    const creditsEarned = CREDITS_BY_TYPE[type];

    await awardCredits(userId, creditsEarned, 'earn', `Reporte: ${type}`);

    res.status(201).json({
      message: 'Reporte creado exitosamente',
      report,
      credits_earned: creditsEarned
    });

  } catch (error) {
    console.error('Error creando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Listar reportes cercanos (protegido)
export const listNearbyReports = async (req: Request, res: Response): Promise<void> => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    res.status(400).json({ message: 'lat y lng son obligatorios' });
    return;
  }

  const radiusKm = parseFloat(radius as string) || 1;

  try {
    const result = await pool.query(
      `SELECT * FROM (
        SELECT *,
          (6371 * acos(
            cos(radians($1)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(latitude))
          )) AS distance
        FROM reports
        WHERE is_active = true AND expires_at > NOW()
      ) t
      WHERE t.distance < $3
      ORDER BY t.distance ASC`,
      [parseFloat(lat as string), parseFloat(lng as string), radiusKm]
    );

    res.json({ reports: result.rows });

  } catch (error) {
    console.error('Error listando reportes cercanos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Confirmar reporte de otro usuario (protegido)
export const confirmReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).userId;

  try {
    const result = await pool.query(
      'SELECT * FROM reports WHERE id = $1 AND is_active = true AND expires_at > NOW()',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Reporte no encontrado o expirado' });
      return;
    }

    const report = result.rows[0];

    if (report.user_id === userId) {
      res.status(400).json({ message: 'No puedes confirmar tu propio reporte' });
      return;
    }

    const updated = await pool.query(
      'UPDATE reports SET confirmations = confirmations + 1 WHERE id = $1 RETURNING confirmations',
      [id]
    );

    await awardCredits(report.user_id, 2, 'earn', 'Confirmación de reporte');

    res.json({
      message: 'Reporte confirmado',
      confirmations: updated.rows[0].confirmations
    });

  } catch (error) {
    console.error('Error confirmando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
