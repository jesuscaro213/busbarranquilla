import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createCheckout, getPlans, handleWebhook } from '../controllers/paymentController';

const router = Router();

router.get('/plans', getPlans);
router.post('/checkout', authMiddleware, createCheckout);
router.post('/webhook', handleWebhook);

export default router;
