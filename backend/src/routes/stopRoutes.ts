import { Router } from 'express';
import { addStop, listStops, deleteStop, deleteStopsByRoute } from '../controllers/stopController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Las rutas con segmento fijo deben ir ANTES de las de parámetro
router.get('/route/:routeId', listStops);
router.delete('/route/:routeId', authMiddleware, requireRole('admin'), deleteStopsByRoute);

router.post('/', authMiddleware, requireRole('admin'), addStop);
router.delete('/:id', authMiddleware, deleteStop);

export default router;
