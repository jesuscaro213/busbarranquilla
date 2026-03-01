import { Router } from 'express';
import { saveTrace } from '../controllers/traceController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/', authMiddleware, saveTrace);

export default router;
