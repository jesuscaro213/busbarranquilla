import { Router } from 'express';
import { listSuggestions, applySuggestion, discardSuggestion } from '../controllers/suggestionController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.get('/', authMiddleware, listSuggestions);
router.post('/:id/apply', authMiddleware, applySuggestion);
router.post('/:id/discard', authMiddleware, discardSuggestion);

export default router;
