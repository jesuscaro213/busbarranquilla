import { useEffect, useState } from 'react';
import { routesApi } from '../services/api';

interface Route {
  id: number;
  name: string;
  code: string;
  frequency_minutes: number | null;
  min_distance: number;
}

interface Props {
  userPosition: [number, number] | null;
  onSelectRoute: (routeId: number) => void;
}

export default function NearbyRoutes({ userPosition, onSelectRoute }: Props) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [collapsed, setCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userPosition) return;
    setLoading(true);
    routesApi
      .nearby(userPosition[0], userPosition[1], 0.5)
      .then((res) => setRoutes(res.data.routes))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userPosition]);

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden w-full">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
      >
        <span>
          🗺️ Rutas cercanas
          {routes.length > 0 && (
            <span className="ml-2 bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
              {routes.length}
            </span>
          )}
        </span>
        <span className="text-gray-400">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100 max-h-48 overflow-y-auto">
          {loading && (
            <p className="text-xs text-gray-400 text-center py-3">Buscando rutas...</p>
          )}
          {!loading && routes.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-3">
              {userPosition ? 'Sin rutas a 500 m' : 'Esperando ubicación GPS...'}
            </p>
          )}
          {routes.map((route) => (
            <button
              key={route.id}
              onClick={() => onSelectRoute(route.id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0"
            >
              <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
                {route.code}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{route.name}</p>
                {route.frequency_minutes && (
                  <p className="text-xs text-gray-400">Cada {route.frequency_minutes} min</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
