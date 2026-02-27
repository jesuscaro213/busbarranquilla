import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUserRole,
  toggleUserActive,
  deleteUser,
  getAllCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  toggleCompanyActive,
  deleteCompany,
} from '../controllers/adminController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Todas las rutas admin requieren authMiddleware + requireRole('admin')
router.get('/users', authMiddleware, requireRole('admin'), getAllUsers);
router.get('/users/:id', authMiddleware, requireRole('admin'), getUserById);
router.patch('/users/:id/role', authMiddleware, requireRole('admin'), updateUserRole);
router.patch('/users/:id/toggle-active', authMiddleware, requireRole('admin'), toggleUserActive);
router.delete('/users/:id', authMiddleware, requireRole('admin'), deleteUser);

// Companies
router.get('/companies', authMiddleware, requireRole('admin'), getAllCompanies);
router.get('/companies/:id', authMiddleware, requireRole('admin'), getCompanyById);
router.post('/companies', authMiddleware, requireRole('admin'), createCompany);
router.put('/companies/:id', authMiddleware, requireRole('admin'), updateCompany);
router.patch('/companies/:id/toggle-active', authMiddleware, requireRole('admin'), toggleCompanyActive);
router.delete('/companies/:id', authMiddleware, requireRole('admin'), deleteCompany);

export default router;
