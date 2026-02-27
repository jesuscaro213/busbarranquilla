import { Router } from 'express';
import {
  getActiveTrip,
  getActiveBuses,
  startTrip,
  updateLocation,
  endTrip,
} from '../controllers/tripController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Rutas con nombre antes de rutas con parámetros (aunque no hay params aquí)
router.get('/active', authMiddleware, getActiveTrip);
router.get('/buses', getActiveBuses); // público: cualquier visitante ve los buses activos
router.post('/start', authMiddleware, startTrip);
router.post('/location', authMiddleware, updateLocation);
router.post('/end', authMiddleware, endTrip);

export default router;
