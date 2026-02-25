import { Request, Response } from 'express';
import pool from '../config/database';

// Helper reutilizable para otorgar créditos
export const awardCredits = async (
  userId: number,
  amount: number,
  type: string,
  description: string
): Promise<void> => {
  await pool.query(
    'UPDATE users SET credits = credits + $1 WHERE id = $2',
    [amount, userId]
  );
  await pool.query(
    'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
    [userId, amount, type, description]
  );
};

// Obtener saldo del usuario (protegido)
export const getBalance = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT credits, is_premium, trial_expires_at, premium_expires_at FROM users WHERE id = $1',
      [(req as any).userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const user = result.rows[0];
    res.json({
      credits: user.credits,
      is_premium: user.is_premium,
      trial_expires_at: user.trial_expires_at,
      premium_expires_at: user.premium_expires_at
    });

  } catch (error) {
    console.error('Error obteniendo saldo:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Historial de transacciones (protegido)
export const getHistory = async (req: Request, res: Response): Promise<void> => {
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const result = await pool.query(
      'SELECT * FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [(req as any).userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM credit_transactions WHERE user_id = $1',
      [(req as any).userId]
    );

    res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].count)
    });

  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Gastar créditos en una función (protegido)
export const spendCredits = async (req: Request, res: Response): Promise<void> => {
  const { amount, feature, description } = req.body;

  if (!amount || amount <= 0) {
    res.status(400).json({ message: 'El monto debe ser mayor a 0' });
    return;
  }

  try {
    const result = await pool.query(
      'SELECT credits, is_premium, premium_expires_at, trial_expires_at FROM users WHERE id = $1',
      [(req as any).userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const user = result.rows[0];

    const premiumActive =
      user.is_premium &&
      (user.premium_expires_at > new Date() || user.trial_expires_at > new Date());

    if (premiumActive) {
      res.json({ message: 'Premium: sin costo', credits_used: 0 });
      return;
    }

    if (user.credits < amount) {
      res.status(402).json({
        message: 'Créditos insuficientes',
        credits_needed: amount,
        credits_available: user.credits
      });
      return;
    }

    await pool.query(
      'UPDATE users SET credits = credits - $1 WHERE id = $2',
      [amount, (req as any).userId]
    );

    await pool.query(
      'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
      [(req as any).userId, -amount, 'spend', description || feature]
    );

    const updated = await pool.query(
      'SELECT credits FROM users WHERE id = $1',
      [(req as any).userId]
    );

    res.json({
      message: 'Créditos gastados exitosamente',
      credits_remaining: updated.rows[0].credits
    });

  } catch (error) {
    console.error('Error gastando créditos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
