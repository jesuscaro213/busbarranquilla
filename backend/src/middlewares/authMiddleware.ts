import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ message: 'No tienes autorización' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: number, email: string };
    (req as any).userId = decoded.id;
    (req as any).userEmail = decoded.email;

    next();

  } catch (error) {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};