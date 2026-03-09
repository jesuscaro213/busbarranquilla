import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { tripsApi } from '../services/api';

interface HistoryTrip {
  id: number;
  route_id: number | null;
  route_name: string | null;
  route_code: string | null;
  started_at: string;
  ended_at: string;
  credits_earned: number;
  duration_minutes: number | string | null;
}

function formatDate(dateInput: string): string {
  return new Date(dateInput).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TripHistory() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<HistoryTrip[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    setError(null);
    tripsApi.getHistory()
      .then((res) => {
        setTrips((res.data?.trips ?? []) as HistoryTrip[]);
      })
      .catch(() => {
        setError('No se pudo cargar tu historial de viajes.');
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Historial</p>
          <h1 className="text-2xl font-bold text-gray-900">Tus últimos viajes</h1>
        </div>
        <Link to="/profile" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
          ← Volver al perfil
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse">
          <div className="h-4 w-1/3 bg-gray-200 rounded mb-3" />
          <div className="h-4 w-1/2 bg-gray-100 rounded" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
          <p className="text-gray-700 font-medium">Aún no has hecho ningún viaje.</p>
          <p className="text-gray-500 text-sm mt-1">¡Sube a un bus y empieza!</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-100">
          {trips.map((trip) => (
            <div key={trip.id} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {trip.route_code && (
                    <span className="bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded">
                      {trip.route_code}
                    </span>
                  )}
                  <p className="font-semibold text-gray-900 truncate">
                    {trip.route_name || 'Ruta sin nombre'}
                  </p>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDate(trip.started_at)} · {Number(trip.duration_minutes ?? 0)} min
                </p>
              </div>

              <p className="text-sm font-semibold text-green-600 shrink-0">
                +{trip.credits_earned} créditos
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
