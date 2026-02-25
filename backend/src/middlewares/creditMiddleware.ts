import { Request, Response, NextFunction } from 'express';
import pool from '../config/database';

export const requireCredits = (cost: number, description: string) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).userId;
      const result = await pool.query(
        'SELECT credits, is_premium, premium_expires_at, trial_expires_at FROM users WHERE id = $1',
        [userId]
      );
      const user = result.rows[0];

      const premiumActive =
        user.is_premium &&
        (user.premium_expires_at > new Date() || user.trial_expires_at > new Date());

      if (premiumActive) {
        next();
        return;
      }

      if (user.credits < cost) {
        res.status(402).json({
          message: 'Créditos insuficientes',
          credits_needed: cost,
          credits_available: user.credits
        });
        return;
      }

      await pool.query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [cost, userId]
      );
      await pool.query(
        'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
        [userId, -cost, 'spend', description]
      );

      next();
    } catch (error) {
      console.error('Error en creditMiddleware:', error);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  };
};
