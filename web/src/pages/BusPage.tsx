import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { routesApi } from '../services/api';

interface Route {
  id: number;
  name: string;
  code: string;
  company: string | null;
  company_name: string | null;
  first_departure: string | null;
  last_departure: string | null;
  frequency_minutes: number | null;
  is_active: boolean;
}

export default function BusPage() {
  const { id } = useParams<{ id: string }>();
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showAppBanner, setShowAppBanner] = useState(true);
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => {
    if (!id) return;
    routesApi.getById(Number(id))
      .then((res) => setRoute(res.data.route as Route))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">🚌</div>
          <p className="text-gray-500 text-sm">Cargando ruta…</p>
        </div>
      </div>
    );
  }

  if (notFound || !route) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🚫</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Ruta no encontrada</h1>
          <p className="text-gray-500 text-sm mb-6">El bus que buscas no existe o fue desactivado.</p>
          <Link to="/map" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors">
            Ver mapa
          </Link>
        </div>
      </div>
    );
  }

  const company = route.company_name || route.company;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-10 space-y-5">
        {isMobile && showAppBanner && (
          <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between gap-3 rounded-2xl">
            <div>
              <p className="text-sm font-semibold">🚌 Abre MiBus</p>
              <p className="text-xs text-blue-200">Sigue el bus en tiempo real</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={`mibus://bus/${id}`}
                className="bg-white text-blue-700 text-xs font-bold px-3 py-1.5 rounded-lg"
              >
                Abrir app
              </a>
              <button
                type="button"
                onClick={() => setShowAppBanner(false)}
                className="text-blue-200 hover:text-white text-lg leading-none"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 text-center">
          <div className="text-5xl mb-3">🚌</div>
          <span className="inline-block bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-lg mb-3">
            {route.code}
          </span>
          <h1 className="text-2xl font-bold text-gray-900">{route.name}</h1>
          {company && <p className="text-gray-500 text-sm mt-1">{company}</p>}
          {!route.is_active && (
            <span className="inline-block mt-3 bg-red-100 text-red-700 text-xs font-semibold px-3 py-1 rounded-full">
              Ruta inactiva
            </span>
          )}
        </div>

        {/* Info */}
        {(route.first_departure || route.last_departure || route.frequency_minutes) && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700">Horarios</p>
            <div className="grid grid-cols-2 gap-3 text-sm text-gray-600">
              {route.first_departure && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Primer bus</p>
                  <p className="font-medium">{route.first_departure}</p>
                </div>
              )}
              {route.last_departure && (
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Último bus</p>
                  <p className="font-medium">{route.last_departure}</p>
                </div>
              )}
              {route.frequency_minutes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Frecuencia</p>
                  <p className="font-medium">Cada {route.frequency_minutes} min</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="bg-blue-600 rounded-2xl p-6 text-center text-white space-y-3">
          <p className="font-semibold text-lg">¿Vas a tomar este bus?</p>
          <p className="text-blue-100 text-sm">Entra a MiBus y ve en tiempo real dónde está.</p>
          <Link
            to="/map"
            className="inline-block bg-white text-blue-700 font-bold text-sm px-6 py-2.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Abrir mapa
          </Link>
        </div>

        <p className="text-center text-xs text-gray-400">
          MiBus — Barranquilla en tiempo real ·{' '}
          <Link to="/register" className="text-blue-500 hover:underline">Crear cuenta gratis</Link>
        </p>
      </div>
    </div>
  );
}
