import { Router } from 'express';
import { addFavorite, removeFavorite, listFavorites, getReferralSummary } from '../controllers/userController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.get('/favorites', authMiddleware, listFavorites);
router.get('/referral', authMiddleware, getReferralSummary);
router.post('/favorites', authMiddleware, addFavorite);
router.delete('/favorites/:routeId', authMiddleware, removeFavorite);

export default router;
