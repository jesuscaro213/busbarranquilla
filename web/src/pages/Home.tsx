import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { routesApi } from '../services/api';
import CreditBalance from '../components/CreditBalance';

interface Route {
  id: number;
  name: string;
  code: string;
  company: string | null;
  first_departure: string | null;
  last_departure: string | null;
  frequency_minutes: number | null;
  is_active: boolean;
}

export default function Home() {
  const { user } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    routesApi.list()
      .then((res) => setRoutes(res.data.routes))
      .finally(() => setRoutesLoading(false));
  }, []);

  const filtered = routes.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Bienvenida */}
      <div className="bg-gradient-to-r from-brand-900 to-blue-700 rounded-2xl p-6 text-white">
        <h2 className="text-xl font-bold">
          {user ? `¡Hola, ${user.name.split(' ')[0]}! 👋` : '¡Bienvenido a MiBus!'}
        </h2>
        <p className="text-blue-200 text-sm mt-1">
          Transporte público de Barranquilla en tiempo real
        </p>
        <div className="flex gap-3 mt-4">
          <Link
            to="/map"
            className="bg-white text-brand-900 font-semibold text-sm px-4 py-2 rounded-full hover:bg-blue-50 transition-colors"
          >
            🗺 Ver mapa
          </Link>
          {!user && (
            <Link
              to="/register"
              className="bg-blue-500 text-white font-semibold text-sm px-4 py-2 rounded-full hover:bg-blue-400 transition-colors"
            >
              Registrarse gratis
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rutas */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">Rutas activas</h3>
            <span className="text-sm text-gray-400">{filtered.length} rutas</span>
          </div>

          {/* Buscador */}
          <input
            type="text"
            placeholder="Buscar ruta por nombre o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {routesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-xl p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-3xl mb-2">🔍</p>
              <p>No se encontraron rutas</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((route) => (
                <div
                  key={route.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:border-blue-200 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded">
                          {route.code}
                        </span>
                        <h4 className="font-semibold text-gray-900 text-sm">{route.name}</h4>
                      </div>
                      {route.company && (
                        <p className="text-xs text-gray-400 mt-1">{route.company}</p>
                      )}
                    </div>
                    <span className="text-green-500 text-xs font-medium">Activa</span>
                  </div>

                  {(route.first_departure || route.frequency_minutes) && (
                    <div className="flex gap-4 mt-3 text-xs text-gray-500">
                      {route.first_departure && (
                        <span>🕐 Primer bus: {route.first_departure}</span>
                      )}
                      {route.last_departure && (
                        <span>🕙 Último: {route.last_departure}</span>
                      )}
                      {route.frequency_minutes && (
                        <span>🔄 Cada {route.frequency_minutes} min</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel lateral */}
        <div className="space-y-4">
          {user && <CreditBalance />}

          {/* Tabla de créditos */}
          <div className="bg-white rounded-xl shadow p-5">
            <h4 className="font-semibold text-gray-900 mb-3">Gana créditos 🪙</h4>
            <ul className="space-y-2 text-sm">
              {[
                ['🚌 Ubicación del bus', '+5'],
                ['🚗 Reportar trancón', '+4'],
                ['🚫 Bus no pasando', '+4'],
                ['👥 Bus lleno/vacío', '+3'],
                ['✅ Confirmar reporte', '+2'],
              ].map(([action, credits]) => (
                <li key={action} className="flex justify-between">
                  <span className="text-gray-600">{action}</span>
                  <span className="text-green-600 font-semibold">{credits}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Planes */}
          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl p-5">
            <h4 className="font-semibold text-gray-900 mb-1">👑 Premium</h4>
            <p className="text-sm text-gray-600 mb-3">Todo ilimitado desde</p>
            <p className="text-2xl font-bold text-gray-900">$4.900 <span className="text-sm font-normal text-gray-500">COP/mes</span></p>
            <p className="text-xs text-gray-500 mt-1">o $39.900/año (32% ahorro)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
