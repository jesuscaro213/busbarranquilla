import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import AdminRoute from './components/AdminRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Map from './pages/Map';
import PremiumPage from './pages/PremiumPage';
import PaymentResultPage from './pages/PaymentResultPage';
import Profile from './pages/Profile';
import TripHistory from './pages/TripHistory';
import BusPage from './pages/BusPage';
import AdminLayout from './pages/admin/AdminLayout';
import AdminUsers from './pages/admin/AdminUsers';
import AdminCompanies from './pages/admin/AdminCompanies';
import AdminTransmetro from './pages/admin/AdminTransmetro';
import AdminBuses from './pages/admin/AdminBuses';
import AdminRouteAlerts from './pages/admin/AdminRouteAlerts';
import AdminStats from './pages/admin/AdminStats';
import AdminRoutes from './pages/admin/AdminRoutes';
import AdminGpsReports from './pages/admin/AdminGpsReports';
import ResolutionProcessor from './pages/admin/ResolutionProcessor';

function PublicLayout() {
  return <><Navbar /><Outlet /></>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="text-4xl mb-3">🚌</div>
          <p className="text-gray-500 text-sm">Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Layout público — con Navbar */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<Map />} />
        <Route path="/premium" element={<PremiumPage />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/trips/history" element={<TripHistory />} />
        <Route path="/bus/:id" element={<BusPage />} />
        <Route path="/payment/result" element={<PaymentResultPage />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>

      {/* Layout admin — con AdminRoute guard + AdminLayout sidebar */}
      <Route element={<AdminRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<Navigate to="/admin/stats" replace />} />
          <Route path="/admin/stats" element={<AdminStats />} />
          <Route path="/admin/users" element={<AdminUsers />} />
          <Route path="/admin/companies" element={<AdminCompanies />} />
          <Route path="/admin/buses" element={<AdminBuses />} />
          <Route path="/admin/transmetro" element={<AdminTransmetro />} />
          <Route path="/admin/routes" element={<AdminRoutes />} />
          <Route path="/admin/route-alerts" element={<AdminRouteAlerts />} />
          <Route path="/admin/gps-reports" element={<AdminGpsReports />} />
          <Route path="/admin/resolutions" element={<ResolutionProcessor />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
