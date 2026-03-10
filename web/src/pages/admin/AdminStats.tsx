import { useEffect, useState } from 'react';
import { adminApi } from '../../services/api';

interface Stats {
  users: { total: number; active: number; premium: number; new_this_week: number };
  trips: { total: number; today: number; this_week: number; active_now: number };
  reports: { total: number; today: number; this_week: number };
  credits: { earned_today: number; earned_total: number };
  active_now: number;
  top_routes: { id: number; name: string; code: string; trips_24h: number }[];
}

function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: number | string; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.getStats()
      .then((res) => setStats(res.data as Stats))
      .catch(() => setError('No se pudo cargar las estadísticas.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Estadísticas generales de MiBus</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse">
              <div className="h-3 w-2/3 bg-gray-200 rounded mb-3" />
              <div className="h-8 w-1/2 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      ) : stats ? (
        <>
          {/* Usuarios */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Usuarios</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total usuarios" value={stats.users.total} />
              <StatCard label="Usuarios activos" value={stats.users.active} />
              <StatCard label="Premium" value={stats.users.premium} color="text-emerald-600" />
              <StatCard label="Nuevos esta semana" value={stats.users.new_this_week} color="text-blue-600" />
            </div>
          </div>

          {/* Viajes */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Viajes</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="En curso ahora" value={stats.active_now} color="text-green-600" sub="buses activos" />
              <StatCard label="Hoy" value={stats.trips.today} />
              <StatCard label="Esta semana" value={stats.trips.this_week} />
              <StatCard label="Total histórico" value={stats.trips.total} />
            </div>
          </div>

          {/* Reportes */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Reportes</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard label="Hoy" value={stats.reports.today} />
              <StatCard label="Esta semana" value={stats.reports.this_week} />
              <StatCard label="Total histórico" value={stats.reports.total} />
            </div>
          </div>

          {/* Créditos */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Créditos distribuidos</p>
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Hoy" value={`+${stats.credits.earned_today}`} color="text-yellow-600" />
              <StatCard label="Total histórico" value={`+${stats.credits.earned_total}`} color="text-yellow-600" />
            </div>
          </div>

          {/* Top rutas */}
          {stats.top_routes.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Rutas más activas (24h)</p>
              <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-100">
                {stats.top_routes.map((route, i) => (
                  <div key={route.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                      <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded shrink-0">
                        {route.code}
                      </span>
                      <span className="text-sm text-gray-700 truncate">{route.name}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 shrink-0">
                      {route.trips_24h} viaje{route.trips_24h !== 1 ? 's' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
