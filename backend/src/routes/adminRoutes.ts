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
  toggleRouteActive,
  scanBlogRoutes,
  processImportedRoutes,
  getPendingCount,
  importOSMTransmetro,
  importOSMBuses,
  listTransmetroRoutes,
  listBusRoutes,
  getAdminStats,
} from '../controllers/adminController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();

// Todas las rutas admin requieren authMiddleware + requireRole('admin')
router.get('/stats', authMiddleware, requireRole('admin'), getAdminStats);
router.get('/users', authMiddleware, requireRole('admin'), getAllUsers);
router.get('/users/:id', authMiddleware, requireRole('admin'), getUserById);
router.patch('/users/:id/role', authMiddleware, requireRole('admin'), updateUserRole);
router.patch('/users/:id/toggle-active', authMiddleware, requireRole('admin'), toggleUserActive);
router.delete('/users/:id', authMiddleware, requireRole('admin'), deleteUser);

// Routes — named routes BEFORE any /:id params
router.get('/routes/pending-count', authMiddleware, requireRole('admin'), getPendingCount);
router.post('/routes/scan-blog', authMiddleware, requireRole('admin'), scanBlogRoutes);
router.post('/routes/process-imports', authMiddleware, requireRole('admin'), processImportedRoutes);
router.post('/routes/import-transmetro', authMiddleware, requireRole('admin'), importOSMTransmetro);
router.post('/routes/import-buses', authMiddleware, requireRole('admin'), importOSMBuses);
router.get('/transmetro', authMiddleware, requireRole('admin'), listTransmetroRoutes);
router.get('/buses', authMiddleware, requireRole('admin'), listBusRoutes);
router.patch('/routes/:id/toggle-active', authMiddleware, requireRole('admin'), toggleRouteActive);

// Companies
router.get('/companies', authMiddleware, requireRole('admin'), getAllCompanies);
router.get('/companies/:id', authMiddleware, requireRole('admin'), getCompanyById);
router.post('/companies', authMiddleware, requireRole('admin'), createCompany);
router.put('/companies/:id', authMiddleware, requireRole('admin'), updateCompany);
router.patch('/companies/:id/toggle-active', authMiddleware, requireRole('admin'), toggleCompanyActive);
router.delete('/companies/:id', authMiddleware, requireRole('admin'), deleteCompany);

export default router;
