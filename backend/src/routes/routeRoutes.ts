import { Router } from 'express';
import { listRoutes, getRouteById, createRoute, searchRoute } from '../controllers/routeController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// /search debe ir ANTES de /:id para que Express no interprete "search" como un ID
router.get('/search', searchRoute);
router.get('/', listRoutes);
router.get('/:id', getRouteById);
router.post('/', authMiddleware, createRoute);

export default router;
