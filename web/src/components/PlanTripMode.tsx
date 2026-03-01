import { useEffect, useRef, useState } from 'react';
import { routesApi, usersApi } from '../services/api';

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface PlanRoute {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  nearest_stop_name: string;
  nearest_stop_lat: number;
  nearest_stop_lng: number;
  distance_meters: number;
  frequency_minutes: number | null;
  last_report_at: string | null;
  minutes_ago: number | null;
  geometry?: [number, number][] | null;
}

interface StopForMap {
  latitude: number;
  longitude: number;
}

interface Props {
  userPosition: [number, number] | null;
  onPlanUpdate: (params: {
    origin: { lat: number; lng: number } | null;
    dest: { lat: number; lng: number } | null;
    routeStops: StopForMap[];
    dropoffStop: { latitude: number; longitude: number; name: string } | null;
  }) => void;
}

export default function PlanTripMode({ userPosition, onPlanUpdate }: Props) {
  // Origin
  const [originLabel] = useState('Mi ubicación actual');
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);

  // Destination
  const [destQuery, setDestQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Results
  const [results, setResults] = useState<PlanRoute[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<PlanRoute | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  // ── Load favorites on mount ────────────────────────────────────────────
  useEffect(() => {
    usersApi.getFavorites()
      .then((r) => {
        const ids = new Set<number>((r.data.favorites as { id: number }[]).map((f) => f.id));
        setFavorites(ids);
      })
      .catch(() => {});
  }, []);

  // ── Sync origin with GPS position ──────────────────────────────────────
  useEffect(() => {
    if (userPosition && !origin) {
      setOrigin({ lat: userPosition[0], lng: userPosition[1] });
    }
  }, [userPosition, origin]);

  // ── Nominatim autocomplete ─────────────────────────────────────────────
  const handleDestInput = (value: string) => {
    setDestQuery(value);
    setDest(null);
    setDestLabel('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const url =
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(value + ', Barranquilla')}&countrycodes=co&viewbox=-74.93,10.85,-74.70,11.10&bounded=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const data: NominatimResult[] = await res.json();
        setSuggestions(data);
      } catch {
        setSuggestions([]);
      }
    }, 500);
  };

  const selectSuggestion = (s: NominatimResult) => {
    setDest({ lat: parseFloat(s.lat), lng: parseFloat(s.lon) });
    setDestLabel(s.display_name.split(',')[0]);
    setDestQuery(s.display_name.split(',')[0]);
    setSuggestions([]);
  };

  // ── Auto-search when both origin + dest are set ────────────────────────
  useEffect(() => {
    if (!dest) return;
    fetchPlan(dest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest]);

  const fetchPlan = async (destination: { lat: number; lng: number }) => {
    setPlanLoading(true);
    setResults([]);
    setSelectedRoute(null);
    onPlanUpdate({ origin, dest: destination, routeStops: [], dropoffStop: null });
    try {
      const res = await routesApi.plan(destination.lat, destination.lng);
      setResults(res.data.routes as PlanRoute[]);
    } catch {
      setResults([]);
    } finally {
      setPlanLoading(false);
    }
  };

  // ── Select a result → update map (usa geometry guardada si existe) ────
  const handleSelectRoute = async (route: PlanRoute) => {
    setSelectedRoute(route);

    // Fallback: punto único de la parada más cercana
    let routeStops: StopForMap[] = [
      { latitude: route.nearest_stop_lat, longitude: route.nearest_stop_lng },
    ];

    // Intentar usar geometry completa desde getById
    try {
      const res = await routesApi.getById(route.id);
      const fullRoute = res.data.route as { geometry?: [number, number][] | null };
      if (fullRoute.geometry && fullRoute.geometry.length >= 2) {
        routeStops = fullRoute.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
      }
    } catch {
      // Fallback al punto único ya definido
    }

    onPlanUpdate({
      origin,
      dest,
      routeStops,
      dropoffStop: {
        latitude: route.nearest_stop_lat,
        longitude: route.nearest_stop_lng,
        name: route.nearest_stop_name,
      },
    });
  };

  const toggleFavorite = async (e: React.MouseEvent, routeId: number) => {
    e.stopPropagation();
    const isFav = favorites.has(routeId);
    setFavorites((prev) => {
      const next = new Set(prev);
      isFav ? next.delete(routeId) : next.add(routeId);
      return next;
    });
    try {
      if (isFav) await usersApi.removeFavorite(routeId);
      else await usersApi.addFavorite(routeId);
    } catch {
      setFavorites((prev) => {
        const next = new Set(prev);
        isFav ? next.add(routeId) : next.delete(routeId);
        return next;
      });
    }
  };

  const reset = () => {
    setDest(null);
    setDestLabel('');
    setDestQuery('');
    setResults([]);
    setSelectedRoute(null);
    onPlanUpdate({ origin, dest: null, routeStops: [], dropoffStop: null });
  };

  // ── Route detail ───────────────────────────────────────────────────────
  if (selectedRoute) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => {
            setSelectedRoute(null);
            onPlanUpdate({ origin, dest, routeStops: [], dropoffStop: null });
          }}
          className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1"
        >
          ← Volver a resultados
        </button>

        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="bg-blue-600 text-white text-sm font-bold px-2.5 py-1 rounded-lg">
              {selectedRoute.code}
            </span>
            <span className="font-semibold text-gray-900">{selectedRoute.name}</span>
          </div>
          {selectedRoute.company_name && (
            <p className="text-xs text-gray-500">{selectedRoute.company_name}</p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="bg-white rounded-xl p-2 text-center">
              <p className="text-xs text-gray-400">Parada más cercana</p>
              <p className="text-sm font-medium text-gray-800 truncate">{selectedRoute.nearest_stop_name}</p>
              <p className="text-xs text-blue-600 font-semibold">🚶 {selectedRoute.distance_meters} m</p>
            </div>
            <div className="bg-white rounded-xl p-2 text-center">
              <p className="text-xs text-gray-400">Frecuencia</p>
              <p className="text-sm font-medium text-gray-800">
                {selectedRoute.frequency_minutes ? `Cada ${selectedRoute.frequency_minutes} min` : '—'}
              </p>
              {selectedRoute.minutes_ago !== null && (
                <p className="text-xs text-amber-600">Último reporte {selectedRoute.minutes_ago} min</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-400 pt-1">
            📍 Te deja en: <strong>{selectedRoute.nearest_stop_name}</strong>
          </p>
        </div>

        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          ⚠️ El recorrido exacto de la ruta se muestra aproximado. Los horarios pueden variar.
        </p>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Origin chip */}
      <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
        <span className="w-2.5 h-2.5 bg-green-500 rounded-full shrink-0" />
        <span className="text-sm text-gray-700 truncate">
          {originLabel}
        </span>
      </div>

      {/* Destination input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400">📍</span>
        <input
          type="text"
          value={destQuery}
          onChange={(e) => handleDestInput(e.target.value)}
          placeholder="¿A dónde vas?"
          className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {destLabel && (
          <button
            onClick={reset}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
          >
            ✕
          </button>
        )}

        {/* Suggestions dropdown */}
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-50 overflow-hidden">
            {suggestions.map((s) => (
              <button
                key={s.place_id}
                onClick={() => selectSuggestion(s)}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-blue-50 border-b border-gray-50 last:border-0 truncate"
              >
                {s.display_name.split(',').slice(0, 2).join(', ')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {planLoading && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Results */}
      {!planLoading && dest && results.length === 0 && (
        <div className="text-center py-6 text-gray-400 text-sm">
          <p>Sin rutas encontradas cerca de tu destino.</p>
          <p className="text-xs mt-1">Prueba con otro punto de referencia.</p>
        </div>
      )}

      {!planLoading && results.length > 0 && (
        <div className="space-y-2 max-h-[48vh] overflow-y-auto pb-2">
          <p className="text-xs text-gray-500">
            {results.length} ruta{results.length !== 1 ? 's' : ''} pasan cerca de tu destino
          </p>
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => handleSelectRoute(r)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-3 hover:bg-blue-50 hover:border-blue-100 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
                  {r.code}
                </span>
                <span className="text-sm font-medium text-gray-800 truncate flex-1">{r.name}</span>
                <button
                  onClick={(e) => toggleFavorite(e, r.id)}
                  className="shrink-0 text-base leading-none"
                >
                  {favorites.has(r.id) ? '⭐' : '☆'}
                </button>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500 pl-0.5">
                <span>🚶 {r.distance_meters} m al destino</span>
                {r.frequency_minutes && <span>🕐 Cada {r.frequency_minutes} min</span>}
                {r.minutes_ago !== null && (
                  <span className="text-amber-600">📡 {r.minutes_ago} min</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1 pl-0.5">
                📍 Te deja en: {r.nearest_stop_name}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Tip when no destination yet */}
      {!dest && !planLoading && (
        <p className="text-xs text-gray-400 text-center pt-2">
          Escribe tu destino para ver las rutas disponibles
        </p>
      )}
    </div>
  );
}
