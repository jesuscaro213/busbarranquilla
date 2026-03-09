import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';

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
    (req as any).userRole = decoded.role;

    // Verificar expiración de premium en cada request (silencioso)
    if (decoded.role === 'premium') {
      pool.query(
        `UPDATE users
         SET is_premium = false, role = 'free'
         WHERE id = $1
           AND is_premium = true
           AND premium_expires_at IS NOT NULL
           AND premium_expires_at < NOW()
           AND trial_expires_at < NOW()`,
        [decoded.id]
      ).catch(() => {});
    }

    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};
