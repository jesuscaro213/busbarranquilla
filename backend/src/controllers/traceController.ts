import { Request, Response } from 'express';
import pool from '../config/database';
import { processPendingTraces } from '../services/traceService';

export const saveTrace = async (req: Request, res: Response): Promise<void> => {
  const { route_id, points, started_at, ended_at } = req.body as {
    route_id: number;
    points: { lat: number; lng: number }[];
    started_at: string;
    ended_at: string;
  };
  const userId = (req as any).userId as number;

  try {
    // Validar puntos mínimos
    if (!Array.isArray(points) || points.length < 10) {
      res.status(400).json({ message: 'Not enough GPS points' });
      return;
    }

    // Validar que la ruta existe
    const routeCheck = await pool.query(
      'SELECT id FROM routes WHERE id = $1',
      [route_id]
    );
    if (routeCheck.rows.length === 0) {
      res.status(404).json({ message: 'Route not found' });
      return;
    }

    // Insertar traza
    const insert = await pool.query(
      `INSERT INTO route_traces (route_id, user_id, points, started_at, ended_at, point_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [route_id, userId, JSON.stringify(points), started_at, ended_at, points.length]
    );
    const traceId: string = insert.rows[0].id;

    // Contar trazas pendientes y disparar procesamiento si hay suficientes
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM route_traces WHERE route_id = $1 AND status = 'pending'`,
      [route_id]
    );
    const pendingCount = parseInt(countResult.rows[0].count, 10);
    if (pendingCount >= 5) {
      processPendingTraces(String(route_id)).catch(err =>
        console.error('processPendingTraces error:', err)
      );
    }

    res.status(201).json({ success: true, traceId });
  } catch (error) {
    console.error('Error saving trace:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
