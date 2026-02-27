import { Router } from 'express';
import {
  listRoutes,
  getRouteById,
  createRoute,
  updateRoute,
  deleteRoute,
  toggleRouteActive,
  searchRoute,
  getNearbyRoutes,
  seedRoutesHandler,
} from '../controllers/routeController';
import { recommendRoutes } from '../controllers/recommendController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Las rutas con nombre deben ir ANTES de /:id
router.get('/nearby', getNearbyRoutes);
router.get('/search', searchRoute);
router.post('/recommend', recommendRoutes);

if (process.env.NODE_ENV !== 'production') {
  router.get('/seed', authMiddleware, requireRole('admin'), seedRoutesHandler);
}

router.get('/', listRoutes);
router.get('/:id', getRouteById);

// Operaciones de escritura: solo admin
router.post('/', authMiddleware, requireRole('admin'), createRoute);
router.put('/:id', authMiddleware, requireRole('admin'), updateRoute);
router.delete('/:id', authMiddleware, requireRole('admin'), deleteRoute);
router.patch('/:id/toggle', authMiddleware, requireRole('admin'), toggleRouteActive);

export default router;
