import { Request, Response } from 'express';
import pool from '../config/database';
import { haversineKm } from './routeController';

// POST /api/routes/:id/waiting-alert
// Body: { userLat, userLng }
// Charges 3 credits to free users; free for premium/admin.
export const subscribeWaitingAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const routeId = parseInt(req.params.id, 10);
  const { userLat, userLng } = req.body;

  if (!userLat || !userLng) {
    res.status(400).json({ error: 'userLat and userLng required' });
    return;
  }

  const userResult = await pool.query(
    'SELECT credits, is_premium, role FROM users WHERE id = $1',
    [userId],
  );
  const user = userResult.rows[0];
  const isFree = !user.is_premium && user.role === 'free';

  if (isFree) {
    if (user.credits < 3) {
      res.status(402).json({ error: 'insufficient_credits', required: 3, current: user.credits });
      return;
    }
    await pool.query(
      `UPDATE users SET credits = credits - 3 WHERE id = $1`,
      [userId],
    );
    await pool.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, -3, 'spend', 'Alerta bus llegando')`,
      [userId],
    );
  }

  // Deactivate any previous alert for same user+route
  await pool.query(
    `UPDATE waiting_alerts SET is_active = false
     WHERE user_id = $1 AND route_id = $2`,
    [userId, routeId],
  );

  await pool.query(
    `INSERT INTO waiting_alerts (user_id, route_id, user_lat, user_lng)
     VALUES ($1, $2, $3, $4)`,
    [userId, routeId, userLat, userLng],
  );

  res.json({ ok: true });
};

// DELETE /api/routes/:id/waiting-alert
export const unsubscribeWaitingAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const routeId = parseInt(req.params.id, 10);

  await pool.query(
    `UPDATE waiting_alerts SET is_active = false
     WHERE user_id = $1 AND route_id = $2`,
    [userId, routeId],
  );

  res.json({ ok: true });
};
