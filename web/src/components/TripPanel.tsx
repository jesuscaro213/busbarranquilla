import { useEffect, useRef, useState } from 'react';
import { routesApi, tripsApi } from '../services/api';

interface Route {
  id: number;
  name: string;
  code: string;
  frequency_minutes: number | null;
}

interface ActiveTrip {
  id: number;
  route_id: number | null;
  route_name: string | null;
  route_code: string | null;
  credits_earned: number;
}

interface Props {
  userPosition: [number, number] | null;
  onTripChange?: (active: boolean) => void;
  preselectedRouteId?: number | null;
}

export default function TripPanel({ userPosition, onTripChange, preselectedRouteId }: Props) {
  const [isOnTrip, setIsOnTrip] = useState(false);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | ''>('');
  const [creditsThisTrip, setCreditsThisTrip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cargar estado de viaje al montar (recuperación tras recarga)
  useEffect(() => {
    tripsApi.getActive()
      .then((res) => {
        if (res.data.trip) {
          setActiveTrip(res.data.trip);
          setIsOnTrip(true);
          setCreditsThisTrip(res.data.trip.credits_earned ?? 0);
          onTripChange?.(true);
          startLocationInterval();
        }
      })
      .catch(() => {/* no autenticado */});

    routesApi.list()
      .then((res) => setRoutes(res.data.routes))
      .catch(() => {});

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincronizar con ruta preseleccionada desde NearbyRoutes
  useEffect(() => {
    if (preselectedRouteId) setSelectedRouteId(preselectedRouteId);
  }, [preselectedRouteId]);

  const startLocationInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!userPosition) return;
      tripsApi.updateLocation({ latitude: userPosition[0], longitude: userPosition[1] })
        .then((res) => {
          if (res.data.credited) {
            setCreditsThisTrip(res.data.creditsEarned);
          }
        })
        .catch(() => {});
    }, 30000);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleStart = async () => {
    if (!userPosition) {
      showToast('Esperando tu ubicación GPS...');
      return;
    }
    if (!selectedRouteId) {
      showToast('Selecciona una ruta primero');
      return;
    }

    setLoading(true);
    try {
      const res = await tripsApi.start({
        route_id: selectedRouteId as number,
        latitude: userPosition[0],
        longitude: userPosition[1],
      });
      setActiveTrip(res.data.trip);
      setCreditsThisTrip(0);
      setIsOnTrip(true);
      onTripChange?.(true);
      startLocationInterval();
      showToast('¡Viaje iniciado! Transmitiendo ubicación.');
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Error al iniciar el viaje');
    } finally {
      setLoading(false);
    }
  };

  const handleEnd = async () => {
    setLoading(true);
    try {
      const res = await tripsApi.end();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsOnTrip(false);
      setActiveTrip(null);
      setSelectedRouteId('');
      onTripChange?.(false);
      showToast(`¡Llegaste! Ganaste ${res.data.totalCreditsEarned} créditos en este viaje 🎉`);
    } catch (err: any) {
      showToast(err?.response?.data?.message ?? 'Error al finalizar el viaje');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl p-4 space-y-3 w-full max-w-xs">
      {/* Toast */}
      {toast && (
        <div className="bg-blue-600 text-white text-sm rounded-xl px-3 py-2 text-center">
          {toast}
        </div>
      )}

      {!isOnTrip ? (
        <>
          <p className="font-semibold text-gray-800 text-sm">¿En qué bus vas?</p>
          <select
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Selecciona una ruta...</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleStart}
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Iniciando...' : '🚌 Me subí'}
          </button>
        </>
      ) : (
        <>
          <div className="text-center">
            <p className="font-semibold text-gray-800 text-sm">
              En ruta: <span className="text-blue-600">{activeTrip?.route_name ?? 'Bus activo'}</span>
            </p>
            <p className="text-2xl font-bold text-green-600 mt-1">+{creditsThisTrip} 💰</p>
            <p className="text-xs text-gray-400">créditos ganados este viaje</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-green-600 justify-center">
            <span className="animate-pulse w-2 h-2 bg-green-500 rounded-full inline-block" />
            Transmitiendo ubicación...
          </div>
          <button
            onClick={handleEnd}
            disabled={loading}
            className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Finalizando...' : '🛑 Me bajé'}
          </button>
        </>
      )}
    </div>
  );
}
