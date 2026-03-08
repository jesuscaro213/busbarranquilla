import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { awardCredits } from '../controllers/creditController';

interface JwtPayload {
  id: number;
  email: string;
  role: string;
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ message: 'No tienes autorización' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    (req as any).userId = decoded.id;
    (req as any).userEmail = decoded.email;

    // Verificar si el premium venció — actualizar rol a free si es necesario
    const userRes = await pool.query(
      `SELECT role, is_premium, premium_expires_at, trial_expires_at, credits FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (userRes.rows.length === 0) {
      res.status(401).json({ message: 'Usuario no encontrado' });
      return;
    }

    const user = userRes.rows[0];
    let role = user.role ?? 'free';

    // Detectar expiración de premium (no aplica a admin)
    if (role === 'premium') {
      const premiumExpired =
        user.premium_expires_at && new Date(user.premium_expires_at) < new Date();
      const trialExpired =
        !user.premium_expires_at && user.trial_expires_at && new Date(user.trial_expires_at) < new Date();

      if (premiumExpired || trialExpired) {
        // Bajar a free
        await pool.query(
          `UPDATE users SET role = 'free', is_premium = false WHERE id = $1`,
          [decoded.id]
        );
        role = 'free';

        // Si quedó con 0 créditos porque era premium, reactivar con 25
        if (user.credits <= 0) {
          await awardCredits(decoded.id, 25, 'earn', 'Créditos de reactivación al vencer Premium');
        }
      }
    }

    (req as any).userRole = role;
    next();

  } catch (error) {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};
