import { Router } from 'express';
import { addFavorite, removeFavorite, listFavorites } from '../controllers/userController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.get('/favorites', authMiddleware, listFavorites);
router.post('/favorites', authMiddleware, addFavorite);
router.delete('/favorites/:routeId', authMiddleware, removeFavorite);

export default router;
