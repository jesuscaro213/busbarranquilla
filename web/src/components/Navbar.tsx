import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="bg-brand-900 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <span className="text-2xl">🚌</span>
          <span>MiBus</span>
          <span className="text-xs font-normal text-blue-300 hidden sm:inline">Barranquilla</span>
        </Link>

        {/* Links */}
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link to="/" className="hover:text-blue-300 transition-colors">Inicio</Link>
              <Link to="/map" className="hover:text-blue-300 transition-colors">Mapa</Link>
              <div className="flex items-center gap-1 bg-blue-800 rounded-full px-3 py-1">
                <span className="text-yellow-400">★</span>
                <span className="font-semibold">{user.credits}</span>
                <span className="text-blue-300 text-xs">créditos</span>
              </div>
              {user.is_premium && (
                <span className="bg-yellow-500 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full">
                  PREMIUM
                </span>
              )}
              <span className="text-blue-200 hidden md:inline">{user.name}</span>
              <button
                onClick={handleLogout}
                className="text-blue-300 hover:text-white transition-colors"
              >
                Salir
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="hover:text-blue-300 transition-colors">Iniciar sesión</Link>
              <Link
                to="/register"
                className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded-full transition-colors font-medium"
              >
                Registrarse
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
