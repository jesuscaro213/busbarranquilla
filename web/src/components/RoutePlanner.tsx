import { useState, useRef, useEffect, useCallback } from 'react';
import { routesApi } from '../services/api';

// ─── Shared type (exported for MapView / Map) ─────────────────────────────────

export interface RouteRecommendation {
  route: {
    id: number;
    name: string;
    code: string;
    company: string | null;
    frequency_minutes: number | null;
  };
  boardingStop: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
  };
  alightingStop: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
  };
  routeSegment: Array<{ latitude: number; longitude: number; name: string }>;
  activeBus: {
    tripId: number;
    latitude: number;
    longitude: number;
    minutesAway: number;
  } | null;
  hasLiveTracking: boolean;
  estimatedArrivalMinutes: number;
  recommendation: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface LatLng { lat: number; lng: number; }

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  userPosition?: [number, number] | null;
  onDestinationSelected?: (lat: number, lng: number) => void;
  onSelectRoute?: (routeId: number) => void;
  onRecommendations?: (routes: RouteRecommendation[]) => void;
  onSelectRecommendation?: (rec: RouteRecommendation) => void;
}

// ─── AddressInput ─────────────────────────────────────────────────────────────

interface AddressInputProps {
  icon: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: NominatimResult) => void;
  onClear: () => void;
}

function AddressInput({ icon, placeholder, value, onChange, onSelect, onClear }: AddressInputProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastTypedRef = useRef(value);

  // Close dropdown when value is changed externally (GPS restore, etc.)
  useEffect(() => {
    if (value !== lastTypedRef.current) {
      setSuggestions([]);
      setOpen(false);
    }
  }, [value]);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(timerRef.current);
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const url =
          'https://nominatim.openstreetmap.org/search' +
          `?q=${encodeURIComponent(q)}&format=json&countrycodes=co` +
          '&viewbox=-74.95,11.10,-74.55,10.80&bounded=1&limit=5';
        const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const data: NominatimResult[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setFetching(false);
      }
    }, 400);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    lastTypedRef.current = v;
    onChange(v);
    if (!v) {
      onClear();
      setSuggestions([]);
      setOpen(false);
      return;
    }
    fetchSuggestions(v);
  };

  const handleSelect = (result: NominatimResult) => {
    lastTypedRef.current = result.display_name;
    onChange(result.display_name);
    setSuggestions([]);
    setOpen(false);
    onSelect(result);
  };

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <span className="absolute left-3 text-sm pointer-events-none">{icon}</span>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          className="w-full border border-gray-200 rounded-xl pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {fetching && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        )}
        {value && !fetching && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              lastTypedRef.current = '';
              onChange('');
              onClear();
              setSuggestions([]);
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-44 overflow-y-auto">
          {suggestions.map((s) => (
            <li
              key={s.place_id}
              onMouseDown={() => handleSelect(s)}
              className="px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 cursor-pointer leading-snug border-b border-gray-50 last:border-0"
            >
              {s.display_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── RoutePlanner ─────────────────────────────────────────────────────────────

export default function RoutePlanner({
  userPosition,
  onDestinationSelected,
  onSelectRoute,
  onRecommendations,
  onSelectRecommendation,
}: Props) {
  // Origin
  const [originText, setOriginText] = useState('Mi ubicación actual');
  const [originLatLng, setOriginLatLng] = useState<LatLng | null>(null);
  const [originIsGps, setOriginIsGps] = useState(true);

  // Destination
  const [destText, setDestText] = useState('');
  const [destLatLng, setDestLatLng] = useState<LatLng | null>(null);

  // Results
  const [recommendations, setRecommendations] = useState<RouteRecommendation[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);

  // Stable callback refs
  const onDestinationSelectedRef = useRef(onDestinationSelected);
  const onRecommendationsRef = useRef(onRecommendations);
  const onSelectRecommendationRef = useRef(onSelectRecommendation);
  useEffect(() => { onDestinationSelectedRef.current = onDestinationSelected; }, [onDestinationSelected]);
  useEffect(() => { onRecommendationsRef.current = onRecommendations; }, [onRecommendations]);
  useEffect(() => { onSelectRecommendationRef.current = onSelectRecommendation; }, [onSelectRecommendation]);

  // Sync GPS coords when in GPS mode
  useEffect(() => {
    if (userPosition && originIsGps) {
      setOriginLatLng({ lat: userPosition[0], lng: userPosition[1] });
    }
  }, [userPosition, originIsGps]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  // Origin handlers
  const handleOriginChange = (v: string) => {
    setOriginText(v);
    if (v && v !== 'Mi ubicación actual') {
      setOriginIsGps(false);
      setOriginLatLng(null); // Must select from Nominatim to re-enable search
    }
  };

  const handleOriginSelect = (result: NominatimResult) => {
    setOriginIsGps(false);
    setOriginLatLng({ lat: parseFloat(result.lat), lng: parseFloat(result.lon) });
  };

  const handleOriginClear = () => {
    setOriginIsGps(true);
    if (userPosition) {
      setOriginLatLng({ lat: userPosition[0], lng: userPosition[1] });
      setOriginText('Mi ubicación actual');
    } else {
      setOriginLatLng(null);
    }
  };

  // Destination handlers
  const handleDestChange = (v: string) => {
    setDestText(v);
    if (!v) setDestLatLng(null);
  };

  const handleDestSelect = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setDestLatLng({ lat, lng });
    onDestinationSelectedRef.current?.(lat, lng);
  };

  const handleDestClear = () => {
    setDestLatLng(null);
    setRecommendations([]);
    setSearched(false);
    setSelectedRouteId(null);
    onRecommendationsRef.current?.([]);
    onSelectRecommendationRef.current?.({} as RouteRecommendation);
  };

  // Search
  const handleSearch = async () => {
    if (!originLatLng || !destLatLng) return;
    setLoading(true);
    setSearched(false);
    setRecommendations([]);
    try {
      const res = await routesApi.recommend({
        originLat: originLatLng.lat,
        originLng: originLatLng.lng,
        destLat: destLatLng.lat,
        destLng: destLatLng.lng,
      });
      const results: RouteRecommendation[] = res.data.recommendations;
      setRecommendations(results);
      setSearched(true);
      onRecommendationsRef.current?.(results);
    } catch {
      setRecommendations([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const handleTakeRoute = (rec: RouteRecommendation) => {
    setSelectedRouteId(rec.route.id);
    onSelectRoute?.(rec.route.id);
    onSelectRecommendationRef.current?.(rec);
    showToast(
      `El bus ${rec.route.name} pasa por tu destino. Súbete en ${rec.boardingStop.name} y bájate en ${rec.alightingStop.name}`
    );
  };

  const canSearch = !!(originLatLng && destLatLng);

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden w-full max-w-xs relative">
      {/* Toast */}
      {toast && (
        <div className="absolute left-3 right-3 top-14 z-10 bg-blue-600 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl text-center leading-snug">
          {toast}
        </div>
      )}

      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
      >
        <span>🔍 Planear viaje</span>
        <span className="text-gray-400">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100 p-3 space-y-2">

          {/* Campo origen */}
          <AddressInput
            icon="📍"
            placeholder="Desde (tu ubicación)"
            value={originText}
            onChange={handleOriginChange}
            onSelect={handleOriginSelect}
            onClear={handleOriginClear}
          />

          {/* Campo destino */}
          <AddressInput
            icon="🏁"
            placeholder="¿A dónde vas?"
            value={destText}
            onChange={handleDestChange}
            onSelect={handleDestSelect}
            onClear={handleDestClear}
          />

          {/* Aviso sin GPS */}
          {originIsGps && !userPosition && (
            <p className="text-xs text-amber-600 px-1">
              ⚠️ Esperando GPS — activa la ubicación o escribe una dirección de origen.
            </p>
          )}

          {/* Botón buscar */}
          <button
            onClick={handleSearch}
            disabled={!canSearch || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Buscando...' : 'Buscar rutas'}
          </button>

          {/* Loading */}
          {loading && (
            <p className="text-xs text-gray-400 text-center animate-pulse py-1">
              Calculando rutas...
            </p>
          )}

          {/* Resultados */}
          {searched && !loading && (
            <div className="max-h-72 overflow-y-auto space-y-2 mt-1">
              {recommendations.length === 0 ? (
                <div className="text-center py-3 space-y-1">
                  <p className="text-sm">🔄</p>
                  <p className="text-xs text-gray-500 font-medium">Sin rutas directas</p>
                  <p className="text-xs text-gray-400 leading-snug">
                    Considera caminar al centro más cercano y tomar un bus distinto.
                  </p>
                </div>
              ) : (
                recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.route.id}
                    rec={rec}
                    selected={selectedRouteId === rec.route.id}
                    onTake={() => handleTakeRoute(rec)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tarjeta de recomendación ─────────────────────────────────────────────────

function RecommendationCard({
  rec,
  selected,
  onTake,
}: {
  rec: RouteRecommendation;
  selected: boolean;
  onTake: () => void;
}) {
  return (
    <div
      className={`rounded-xl border p-2.5 space-y-1.5 transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-gray-50'
      }`}
    >
      {/* Cabecera ruta */}
      <div className="flex items-center gap-2">
        <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
          {rec.route.code}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate text-xs">{rec.route.name}</p>
          {rec.route.company && (
            <p className="text-xs text-gray-400 truncate">{rec.route.company}</p>
          )}
        </div>
      </div>

      {/* Paradas */}
      <div className="space-y-0.5 text-xs text-gray-600">
        <p>
          <span className="text-green-600 font-semibold">↑ Súbete en: </span>
          {rec.boardingStop.name}
          <span className="text-gray-400"> · {rec.boardingStop.distanceMeters} m</span>
        </p>
        <p>
          <span className="text-red-500 font-semibold">↓ Bájate en: </span>
          {rec.alightingStop.name}
        </p>
      </div>

      {/* ETA */}
      {rec.hasLiveTracking && rec.activeBus ? (
        <p className="text-xs font-semibold text-green-600">
          🟢 Bus en camino — aprox. {rec.activeBus.minutesAway} min
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          🕐 Frecuencia cada {rec.route.frequency_minutes ?? '?'} min
        </p>
      )}

      {/* CTA */}
      <button
        onClick={onTake}
        className={`w-full py-1.5 rounded-lg text-xs font-bold transition-colors ${
          selected
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-blue-500 text-blue-600 hover:bg-blue-50'
        }`}
      >
        {selected ? '✓ Seleccionado' : 'Tomar este bus'}
      </button>
    </div>
  );
}
