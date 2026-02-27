import api from './api';

// ─── Users ────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'premium' | 'free';

export interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  credits: number;
  role: UserRole;
  is_premium: boolean;
  is_active: boolean;
  trial_expires_at: string;
  premium_expires_at: string | null;
  reputation: number;
  created_at: string;
}

// ─── Companies ────────────────────────────────────────────────────────────────

export interface Company {
  id: number;
  name: string;
  nit: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CompanyRoute {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  frequency_minutes: number | null;
}

export interface CompanyInput {
  name: string;
  nit?: string;
  phone?: string;
  email?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const adminService = {
  // Users
  getUsers: (role?: string) =>
    api.get<{ users: AdminUser[]; total: number }>('/api/admin/users', {
      params: role && role !== 'all' ? { role } : undefined,
    }),

  updateUserRole: (id: number, role: string) =>
    api.patch<{ user: AdminUser }>(`/api/admin/users/${id}/role`, { role }),

  toggleUserActive: (id: number) =>
    api.patch<{ user: AdminUser; message: string }>(`/api/admin/users/${id}/toggle-active`),

  deleteUser: (id: number) =>
    api.delete<{ message: string }>(`/api/admin/users/${id}`),

  // Companies
  getCompanies: () =>
    api.get<{ companies: Company[]; total: number }>('/api/admin/companies'),

  getCompanyById: (id: number) =>
    api.get<{ company: Company; routes: CompanyRoute[] }>(`/api/admin/companies/${id}`),

  createCompany: (data: CompanyInput) =>
    api.post<{ message: string; company: Company }>('/api/admin/companies', data),

  updateCompany: (id: number, data: CompanyInput) =>
    api.put<{ message: string; company: Company }>(`/api/admin/companies/${id}`, data),

  toggleCompanyActive: (id: number) =>
    api.patch<{ company: Company; message: string }>(`/api/admin/companies/${id}/toggle-active`),

  deleteCompany: (id: number) =>
    api.delete<{ message: string }>(`/api/admin/companies/${id}`),
};
