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
  getActiveFeed,
  getPlanRoutes,
  regenerateGeometry,
} from '../controllers/routeController';
import { recommendRoutes } from '../controllers/recommendController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Las rutas con nombre deben ir ANTES de /:id
router.get('/nearby', getNearbyRoutes);
router.get('/search', searchRoute);
router.post('/recommend', recommendRoutes);
router.get('/active-feed', authMiddleware, getActiveFeed);
router.get('/plan', authMiddleware, getPlanRoutes);

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
router.post('/:id/regenerate-geometry', authMiddleware, requireRole('admin'), regenerateGeometry);

export default router;
