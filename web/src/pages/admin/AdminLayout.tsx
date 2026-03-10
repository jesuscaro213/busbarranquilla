import { useState, useEffect } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { routeAlertsApi } from '../../services/api';

const navItems = [
  { to: '/admin/stats', label: 'Dashboard', emoji: '📊' },
  { to: '/admin/users', label: 'Usuarios', emoji: '👥' },
  { to: '/admin/buses', label: 'Buses', emoji: '🚍' },
  { to: '/admin/transmetro', label: 'Transmetro', emoji: '🚇' },
  { to: '/admin/companies', label: 'Empresas', emoji: '🏢' },
  { to: '/admin/route-alerts', label: 'Alertas de rutas', emoji: '⚠️', badge: true },
];

export default function AdminLayout() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertsCount, setAlertsCount] = useState(0);

  useEffect(() => {
    routeAlertsApi.getAlertsCount()
      .then(res => setAlertsCount(res.data.count ?? 0))
      .catch(() => {});
    const interval = setInterval(() => {
      routeAlertsApi.getAlertsCount()
        .then(res => setAlertsCount(res.data.count ?? 0))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen">

      {/* ── Sidebar desktop (md+) ── */}
      <aside className="hidden md:flex w-60 bg-gray-900 text-gray-100 flex-col shrink-0">
        <div className="px-6 py-5 border-b border-gray-700">
          <span className="text-lg font-bold tracking-tight">MiBus Admin</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, emoji, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span>{emoji}</span>
              <span className="flex-1">{label}</span>
              {badge && alertsCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                  {alertsCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-gray-700 space-y-3">
          <p className="text-sm text-gray-400 truncate">{user?.name}</p>
          <Link
            to="/map"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Volver al mapa
          </Link>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">

        {/* ── Top bar mobile (< md) ── */}
        <header className="md:hidden bg-gray-900 text-gray-100 flex items-center justify-between px-4 py-3 shrink-0">
          <span className="font-bold tracking-tight">MiBus Admin</span>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded-md hover:bg-gray-700 transition-colors"
            aria-label="Menú"
          >
            {menuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </header>

        {/* ── Mobile dropdown menu ── */}
        {menuOpen && (
          <nav className="md:hidden bg-gray-800 text-gray-100 px-4 py-3 space-y-1 shrink-0">
            {navItems.map(({ to, label, emoji, badge }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`
                }
              >
                <span>{emoji}</span>
                <span className="flex-1">{label}</span>
                {badge && alertsCount > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                    {alertsCount}
                  </span>
                )}
              </NavLink>
            ))}
            <div className="border-t border-gray-700 pt-3 mt-1 space-y-2">
              <p className="text-xs text-gray-500 px-3">{user?.name}</p>
              <Link
                to="/map"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                ← Volver al mapa
              </Link>
            </div>
          </nav>
        )}

        {/* ── Page content ── */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
