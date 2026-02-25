import axios from 'axios';

// URL vacía → las peticiones van a /api/... en el mismo origen.
// El proxy de Vite (dev) o el servidor web (prod) las reenvía al backend.
const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
});

// Adjuntar JWT en cada request si existe
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Auth ────────────────────────────────────────────────────────────────────

export const authApi = {
  register: (data: { name: string; email: string; password: string; phone?: string }) =>
    api.post('/api/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/api/auth/login', data),

  getProfile: () =>
    api.get('/api/auth/profile'),
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const routesApi = {
  list: () =>
    api.get('/api/routes'),

  getById: (id: number) =>
    api.get(`/api/routes/${id}`),

  search: (origin: string, destination: string) =>
    api.get('/api/routes/search', { params: { origin, destination } }),

  create: (data: {
    name: string;
    code: string;
    company?: string;
    first_departure?: string;
    last_departure?: string;
    frequency_minutes?: number;
  }) => api.post('/api/routes', data),
};

// ─── Stops ───────────────────────────────────────────────────────────────────

export const stopsApi = {
  listByRoute: (routeId: number) =>
    api.get(`/api/stops/route/${routeId}`),

  add: (data: {
    route_id: number;
    name: string;
    latitude: number;
    longitude: number;
    stop_order: number;
  }) => api.post('/api/stops', data),

  delete: (id: number) =>
    api.delete(`/api/stops/${id}`),
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export type ReportType = 'bus_location' | 'traffic' | 'bus_full' | 'no_service' | 'detour';

export const reportsApi = {
  getNearby: (lat: number, lng: number, radius = 1) =>
    api.get('/api/reports/nearby', { params: { lat, lng, radius } }),

  create: (data: {
    route_id?: number;
    type: ReportType;
    latitude: number;
    longitude: number;
    description?: string;
  }) => api.post('/api/reports', data),

  confirm: (id: number) =>
    api.put(`/api/reports/${id}/confirm`),
};

// ─── Credits ─────────────────────────────────────────────────────────────────

export const creditsApi = {
  getBalance: () =>
    api.get('/api/credits/balance'),

  getHistory: (limit = 20, offset = 0) =>
    api.get('/api/credits/history', { params: { limit, offset } }),

  spend: (data: { amount: number; feature: string; description: string }) =>
    api.post('/api/credits/spend', data),
};

export default api;
