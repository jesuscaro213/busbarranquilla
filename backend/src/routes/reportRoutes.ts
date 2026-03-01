import { Router } from 'express';
import { createReport, listNearbyReports, confirmReport, resolveReport } from '../controllers/reportController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// /nearby debe ir ANTES de /:id/confirm para evitar conflictos
router.get('/nearby', listNearbyReports); // público: cualquier visitante ve reportes cercanos
router.post('/', authMiddleware, createReport);
router.put('/:id/confirm', authMiddleware, confirmReport);
router.patch('/:id/resolve', authMiddleware, resolveReport);

export default router;
