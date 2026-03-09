import { useState, useEffect, useCallback } from 'react';
import { routeAlertsApi, routesApi } from '../../services/api';

interface RouteAlert {
  id: number;
  name: string;
  code: string;
  ruta_real_count: number;
  trancon_count: number;
  last_report_at: string;
  route_alert_reviewed_at: string | null;
}

export default function AdminRouteAlerts() {
  const [alerts, setAlerts] = useState<RouteAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await routeAlertsApi.getAlerts();
      setAlerts(res.data.alerts);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDismiss = async (routeId: number) => {
    setDismissing(routeId);
    try {
      await routeAlertsApi.dismissAlert(routeId);
      setAlerts(prev => prev.filter(a => a.id !== routeId));
    } finally {
      setDismissing(null);
    }
  };

  const handleRegenerate = async (routeId: number) => {
    setRegenerating(routeId);
    try {
      await routesApi.regenerateGeometry(routeId);
      await routeAlertsApi.dismissAlert(routeId);
      setAlerts(prev => prev.filter(a => a.id !== routeId));
    } finally {
      setRegenerating(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Alertas de rutas desactualizadas</h1>
        <p className="text-sm text-gray-500 mt-1">
          Rutas donde 3 o más pasajeros reportaron que el bus tomó un camino diferente al mapa.
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-500 text-sm">No hay alertas pendientes.</p>
          <p className="text-gray-400 text-xs mt-1">
            Aparecerán aquí cuando 3+ usuarios reporten una ruta como desactualizada.
          </p>
        </div>
      )}

      {!loading && alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className="bg-white rounded-lg border border-amber-200 shadow-sm overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-100">
                <div className="flex items-center gap-3">
                  <span className="text-lg">⚠️</span>
                  <div>
                    <span className="font-semibold text-gray-900">{alert.name}</span>
                    <span className="ml-2 text-xs font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded">
                      {alert.code}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-gray-400">
                  Último reporte: {formatDate(alert.last_report_at)}
                </span>
              </div>

              {/* Stats */}
              <div className="px-4 py-3 flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-sm font-semibold px-3 py-1 rounded-full">
                    🗺️ {alert.ruta_real_count} dijeron "esta es la ruta real"
                  </span>
                </div>
                {Number(alert.trancon_count) > 0 && (
                  <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 text-sm px-3 py-1 rounded-full">
                    🚧 {alert.trancon_count} dijeron "trancón"
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => handleRegenerate(alert.id)}
                  disabled={regenerating === alert.id || dismissing === alert.id}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
                >
                  {regenerating === alert.id ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : '🔄'}
                  Regenerar geometría y marcar revisada
                </button>
                <button
                  onClick={() => handleDismiss(alert.id)}
                  disabled={dismissing === alert.id || regenerating === alert.id}
                  className="flex items-center gap-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-md transition-colors"
                >
                  {dismissing === alert.id ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : '✓'}
                  Marcar como revisada
                </button>
                <a
                  href={`/admin/buses?highlight=${alert.id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Ver ruta →
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
