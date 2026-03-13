import { Router } from 'express';
import { register, login, getProfile, googleLogin, updateProfile, updateFcmToken } from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin);
router.get('/profile', authMiddleware, getProfile);
router.patch('/profile', authMiddleware, updateProfile);
router.patch('/fcm-token', authMiddleware, updateFcmToken);

export default router;
