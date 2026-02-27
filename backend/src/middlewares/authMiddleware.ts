import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  id: number;
  email: string;
  role: string;
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ message: 'No tienes autorización' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    (req as any).userId = decoded.id;
    (req as any).userEmail = decoded.email;
    (req as any).userRole = decoded.role ?? 'free'; // compatibilidad con tokens anteriores sin role

    next();

  } catch (error) {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};
