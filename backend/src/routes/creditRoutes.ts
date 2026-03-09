import { Router } from 'express';
import { getBalance, getHistory, spendCredits, getStats } from '../controllers/creditController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.get('/balance', authMiddleware, getBalance);
router.get('/history', authMiddleware, getHistory);
router.get('/stats', authMiddleware, getStats);
router.post('/spend', authMiddleware, spendCredits);

export default router;
