import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isPremium = Boolean(user && (user.is_premium || user.role === 'premium'));
  const showPremiumLink = Boolean(user && user.role !== 'premium' && user.role !== 'admin');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    setMenuOpen(false);
  };

  return (
    <nav className="bg-brand-900 text-white shadow-md relative z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <span className="text-2xl">🚌</span>
          <span>MiBus</span>
          <span className="text-xs font-normal text-blue-300 hidden sm:inline">Barranquilla</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link to="/" className="hover:text-blue-300 transition-colors">Inicio</Link>
              <Link to="/map" className="hover:text-blue-300 transition-colors">Mapa</Link>
              {showPremiumLink && (
                <Link to="/premium" className="hover:text-blue-300 transition-colors">⚡ Premium</Link>
              )}
              <div className="flex items-center gap-1 bg-blue-800 rounded-full px-3 py-1">
                <span className="text-yellow-400">★</span>
                <span className="font-semibold">{user.credits}</span>
                <span className="text-blue-300 text-xs">créditos</span>
              </div>
              {isPremium && (
                <Link to="/premium" className="bg-emerald-500 text-emerald-950 text-xs font-bold px-2 py-0.5 rounded-full">
                  ✓ Premium
                </Link>
              )}
              {user.role === 'admin' && (
                <Link to="/admin" className="hover:text-blue-300 transition-colors">
                  ⚙️ Administración
                </Link>
              )}
              <Link to="/profile" className="flex items-center gap-2 text-blue-200 hover:text-white transition-colors">
                <span className="w-7 h-7 rounded-full bg-blue-700 text-xs font-bold flex items-center justify-center">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <span>{user.name}</span>
              </Link>
              <button onClick={handleLogout} className="text-blue-300 hover:text-white transition-colors">
                Salir
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="hover:text-blue-300 transition-colors">Iniciar sesión</Link>
              <Link to="/register" className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-full transition-colors font-medium">
                Registrarse
              </Link>
            </>
          )}
        </div>

        {/* Mobile right side */}
        <div className="flex md:hidden items-center gap-3">
          {user && (
            <div className="flex items-center gap-1 bg-blue-800 rounded-full px-2.5 py-1 text-sm">
              <span className="text-yellow-400">★</span>
              <span className="font-semibold">{user.credits}</span>
            </div>
          )}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="p-1.5 rounded-lg hover:bg-blue-800 transition-colors"
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
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden bg-brand-900 border-t border-blue-800 px-4 py-3 space-y-1">
          {user ? (
            <>
              <div className="flex items-center gap-2 py-2 border-b border-blue-800 mb-2">
                <span className="font-semibold text-white">{user.name}</span>
                {user.is_premium && (
                  <span className="bg-yellow-500 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full">
                    PREMIUM
                  </span>
                )}
                {user.role === 'admin' && (
                  <span className="bg-blue-700 text-blue-200 text-xs font-bold px-2 py-0.5 rounded-full">
                    ADMIN
                  </span>
                )}
              </div>
              <Link to="/" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                Inicio
              </Link>
              <Link to="/map" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                Mapa
              </Link>
              <Link to="/profile" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                👤 Perfil
              </Link>
              {showPremiumLink && (
                <Link to="/premium" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                  ⚡ Premium
                </Link>
              )}
              {isPremium && (
                <Link to="/premium" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm text-emerald-300 hover:text-emerald-200 transition-colors">
                  ✓ Premium
                </Link>
              )}
              {user.role === 'admin' && (
                <Link to="/admin" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                  ⚙️ Administración
                </Link>
              )}
              <button onClick={handleLogout} className="block w-full text-left py-2.5 text-sm text-blue-300 hover:text-white transition-colors">
                Salir
              </button>
            </>
          ) : (
            <>
              <Link to="/login" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm hover:text-blue-300 transition-colors">
                Iniciar sesión
              </Link>
              <Link to="/register" onClick={() => setMenuOpen(false)} className="block py-2.5 text-sm font-medium text-blue-300 hover:text-white transition-colors">
                Registrarse
              </Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
