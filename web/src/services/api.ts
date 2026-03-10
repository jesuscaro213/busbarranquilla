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
  register: (data: { name: string; email: string; password: string; phone?: string; referralCode?: string }) =>
    api.post('/api/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/api/auth/login', data),

  googleLogin: (idToken: string) =>
    api.post('/api/auth/google', { idToken }),

  updateProfile: (data: { name: string }) =>
    api.patch('/api/auth/profile', data),

  getProfile: () =>
    api.get('/api/auth/profile'),
};

// ─── Routes ──────────────────────────────────────────────────────────────────

export const routesApi = {
  list: (params?: { type?: string }) =>
    api.get('/api/routes', { params }),

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

  plan: (destLat: number, destLng: number, originLat?: number, originLng?: number) =>
    api.get('/api/routes/plan', { params: { destLat, destLng, originLat, originLng } }),

  toggleActive: (id: number) =>
    api.patch(`/api/routes/${id}/toggle`),

  getActivity: (id: number) =>
    api.get(`/api/routes/${id}/activity`),

  reportUpdate: (id: number, tipo: 'ruta_real' | 'trancon', geometry?: [number, number][]) =>
    api.post(`/api/routes/${id}/update-report`, { tipo, geometry }),

  applyReportedGeometry: (id: number, geometry: [number, number][]) =>
    api.patch(`/api/routes/${id}/apply-reported-geometry`, { geometry }),

  snapWaypoints: (waypoints: [number, number][]) =>
    api.post('/api/routes/snap-waypoints', { waypoints }),

  scanBlog: (skipManuallyEdited = false) =>
    api.post('/api/admin/routes/scan-blog', { skipManuallyEdited }),

  processImports: (skipManuallyEdited = false) =>
    api.post('/api/admin/routes/process-imports', { skipManuallyEdited }),

  getPendingCount: () =>
    api.get('/api/admin/routes/pending-count'),

  importTransmetro: () =>
    api.post('/api/admin/routes/import-transmetro'),

  importBuses: () =>
    api.post('/api/admin/routes/import-buses'),

  getTransmetroRoutes: () =>
    api.get('/api/admin/transmetro'),

  getBusRoutes: () =>
    api.get('/api/admin/buses'),
};

// ─── Route Update Alerts ──────────────────────────────────────────────────────

export const routeAlertsApi = {
  getAlerts: () =>
    api.get('/api/routes/update-alerts'),

  getAlertsCount: () =>
    api.get('/api/routes/update-alerts/count'),

  dismissAlert: (routeId: number) =>
    api.patch(`/api/routes/${routeId}/dismiss-alert`),
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
  getStats: () =>
    api.get('/api/admin/stats'),
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export type ReportType =
  | 'bus_location' | 'traffic' | 'bus_full' | 'no_service' | 'detour'
  | 'desvio' | 'trancon' | 'lleno' | 'sin_parar' | 'espera'
  | 'bus_disponible';

export type OccupancyState = 'lleno' | 'disponible' | null;

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

  getOccupancy: (routeId: number) =>
    api.get(`/api/reports/occupancy/${routeId}`),

  getRouteReports: (routeId: number) =>
    api.get(`/api/reports/route/${routeId}`),
};

// ─── Credits ─────────────────────────────────────────────────────────────────

export const creditsApi = {
  getBalance: () =>
    api.get('/api/credits/balance'),

  getHistory: (limit = 20, offset = 0) =>
    api.get('/api/credits/history', { params: { limit, offset } }),

  getStats: () =>
    api.get('/api/credits/stats'),

  spend: (data: { amount: number; feature: string; description: string }) =>
    api.post('/api/credits/spend', data),
};

// ─── Payments ────────────────────────────────────────────────────────────────

export const paymentsApi = {
  getPlans: () =>
    api.get('/api/payments/plans'),

  createCheckout: (plan: 'monthly' | 'yearly') =>
    api.post('/api/payments/checkout', { plan }),
};

// ─── Trips ───────────────────────────────────────────────────────────────────

export const tripsApi = {
  getHistory: () =>
    api.get('/api/trips/history'),

  getActive: () =>
    api.get('/api/trips/active'),

  getCurrent: () =>
    api.get('/api/trips/current'),

  getActiveBuses: () =>
    api.get('/api/trips/buses'),

  start: (data: { route_id: number; latitude: number; longitude: number; destination_stop_id?: number }) =>
    api.post('/api/trips/start', data),

  updateLocation: (data: { latitude: number; longitude: number }) =>
    api.post('/api/trips/location', data),

  end: (data?: { suspicious_minutes?: number }) =>
    api.post('/api/trips/end', data ?? {}),
};

// ─── Users / Favorites ───────────────────────────────────────────────────────

export const usersApi = {
  getFavorites: () =>
    api.get('/api/users/favorites'),

  getReferral: () =>
    api.get('/api/users/referral'),

  addFavorite: (routeId: number) =>
    api.post('/api/users/favorites', { route_id: routeId }),

  removeFavorite: (routeId: number) =>
    api.delete(`/api/users/favorites/${routeId}`),
};

export default api;
