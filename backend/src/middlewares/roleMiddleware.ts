import { Request, Response, NextFunction } from 'express';

/**
 * Middleware de autorización por rol.
 * Siempre debe ir DESPUÉS de authMiddleware.
 * Uso: router.post('/', authMiddleware, requireRole('admin'), controller)
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as any).userRole as string | undefined;

    if (!userRole || !roles.includes(userRole)) {
      res.status(403).json({ error: 'Acceso denegado. No tienes permisos para esta acción.' });
      return;
    }

    next();
  };
};
