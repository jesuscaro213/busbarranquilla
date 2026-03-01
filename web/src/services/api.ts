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
    config.headers.set('Authorization', `Bearer ${token}`);
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

  nearby: (lat: number, lng: number, radius = 0.5) =>
    api.get('/api/routes/nearby', { params: { lat, lng, radius } }),

  create: (data: {
    name: string;
    code: string;
    company?: string;
    company_id?: number;
    first_departure?: string;
    last_departure?: string;
    frequency_minutes?: number;
    geometry?: [number, number][] | null;
  }) => api.post('/api/routes', data),

  update: (id: number, data: {
    name?: string;
    code?: string;
    company?: string;
    company_id?: number;
    first_departure?: string;
    last_departure?: string;
    frequency_minutes?: number;
    geometry?: [number, number][] | null;
  }) => api.put(`/api/routes/${id}`, data),

  delete: (id: number) =>
    api.delete(`/api/routes/${id}`),

  regenerateGeometry: (id: number) =>
    api.post(`/api/routes/${id}/regenerate-geometry`),

  recommend: (data: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
  }) => api.post('/api/routes/recommend', data),

  activeFeed: () =>
    api.get('/api/routes/active-feed'),

  plan: (destLat: number, destLng: number) =>
    api.get('/api/routes/plan', { params: { destLat, destLng } }),

  toggleActive: (id: number) =>
    api.patch(`/api/routes/${id}/toggle`),

  scanBlog: () =>
    api.post('/api/admin/routes/scan-blog'),

  processImports: () =>
    api.post('/api/admin/routes/process-imports'),

  getPendingCount: () =>
    api.get('/api/admin/routes/pending-count'),
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

  deleteByRoute: (routeId: number) =>
    api.delete(`/api/stops/route/${routeId}`),
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminApi = {
  getCompanies: (isActive?: boolean) =>
    api.get('/api/admin/companies', {
      params: isActive !== undefined ? { is_active: isActive } : undefined,
    }),
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export type ReportType =
  | 'bus_location' | 'traffic' | 'bus_full' | 'no_service' | 'detour'
  | 'desvio' | 'trancon' | 'casi_lleno' | 'lleno' | 'sin_parar' | 'espera';

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

  resolve: (id: number) =>
    api.patch(`/api/reports/${id}/resolve`),
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

// ─── Trips ───────────────────────────────────────────────────────────────────

export const tripsApi = {
  getActive: () =>
    api.get('/api/trips/active'),

  getCurrent: () =>
    api.get('/api/trips/current'),

  getActiveBuses: () =>
    api.get('/api/trips/buses'),

  start: (data: { route_id: number; latitude: number; longitude: number }) =>
    api.post('/api/trips/start', data),

  updateLocation: (data: { latitude: number; longitude: number }) =>
    api.post('/api/trips/location', data),

  end: () =>
    api.post('/api/trips/end'),
};

// ─── Users / Favorites ───────────────────────────────────────────────────────

export const usersApi = {
  getFavorites: () =>
    api.get('/api/users/favorites'),

  addFavorite: (routeId: number) =>
    api.post('/api/users/favorites', { route_id: routeId }),

  removeFavorite: (routeId: number) =>
    api.delete(`/api/users/favorites/${routeId}`),
};

export default api;
