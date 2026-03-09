import { Router } from 'express';
import { register, login, getProfile, googleLogin, updateProfile } from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin);
router.get('/profile', authMiddleware, getProfile);
router.patch('/profile', authMiddleware, updateProfile);

export default router;
