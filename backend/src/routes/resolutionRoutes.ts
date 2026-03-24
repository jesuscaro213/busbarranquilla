import { Router } from 'express';
import multer from 'multer';
import { parseResolution, applyResolution } from '../controllers/resolutionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se aceptan archivos PDF'));
  },
});

router.post(
  '/parse',
  authMiddleware,
  requireRole('admin'),
  upload.single('file'),
  parseResolution
);

router.post(
  '/apply',
  authMiddleware,
  requireRole('admin'),
  applyResolution
);

export default router;
