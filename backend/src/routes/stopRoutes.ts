import { Router } from 'express';
import { addStop, listStops, deleteStop } from '../controllers/stopController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// /route/:routeId debe ir ANTES de /:id para evitar conflicto de parámetros
router.get('/route/:routeId', listStops);
router.post('/', authMiddleware, addStop);
router.delete('/:id', authMiddleware, deleteStop);

export default router;
