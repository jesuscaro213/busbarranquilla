import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createCheckout, getPlans, handleWebhook } from '../controllers/paymentController';

const router = Router();

router.get('/plans', getPlans);
// DEBUG — eliminar después
router.get('/debug-env', (_req, res) => {
  res.json({
    WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY ? '✅ set' : '❌ missing',
    WOMPI_PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY ? '✅ set' : '❌ missing',
    WOMPI_EVENT_SECRET: process.env.WOMPI_EVENT_SECRET ? '✅ set' : '❌ missing',
    APP_URL: process.env.APP_URL ?? '❌ missing',
    NODE_ENV: process.env.NODE_ENV ?? 'undefined',
  });
});
router.post('/checkout', authMiddleware, createCheckout);
router.post('/webhook', handleWebhook);

export default router;
