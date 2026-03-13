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
  getRouteActivity,
  snapWaypoints,
  getRouteShareInfo,
} from '../controllers/routeController';
import { recommendRoutes } from '../controllers/recommendController';
import {
  reportRouteUpdate,
  updateDeviationReEntry,
  getRouteUpdateAlerts,
  getRouteUpdateAlertsCount,
  dismissRouteAlert,
  applyReportedGeometry,
} from '../controllers/routeUpdateController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Las rutas con nombre deben ir ANTES de /:id
router.get('/nearby', getNearbyRoutes);
router.get('/search', searchRoute);
router.post('/recommend', recommendRoutes);
router.get('/active-feed', authMiddleware, getActiveFeed);
router.get('/plan', authMiddleware, getPlanRoutes);
router.get('/:id/share', getRouteShareInfo);
router.post('/snap-waypoints', authMiddleware, requireRole('admin'), snapWaypoints);
router.get('/update-alerts', authMiddleware, requireRole('admin'), getRouteUpdateAlerts);
router.get('/update-alerts/count', authMiddleware, requireRole('admin'), getRouteUpdateAlertsCount);

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
router.get('/:id/activity', authMiddleware, getRouteActivity);
router.post('/:id/update-report', authMiddleware, reportRouteUpdate);
router.patch('/:id/update-report/reentry', authMiddleware, updateDeviationReEntry);
router.patch('/:id/dismiss-alert', authMiddleware, requireRole('admin'), dismissRouteAlert);
router.patch('/:id/apply-reported-geometry', authMiddleware, requireRole('admin'), applyReportedGeometry);

export default router;
