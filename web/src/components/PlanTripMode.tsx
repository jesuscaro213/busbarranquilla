import { useEffect, useRef, useState } from 'react';
import { routesApi, usersApi, stopsApi } from '../services/api';

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
  origin_distance_meters: number | null;
  stop_difference: number | null;
  frequency_minutes: number | null;
  last_report_at: string | null;
  minutes_ago: number | null;
  geometry?: [number, number][] | null;
}

interface NearbyRoute {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  min_distance: number; // km
  geometry?: [number, number][] | null;
}

interface StopForMap {
  latitude: number;
  longitude: number;
}

interface Props {
  userPosition: [number, number] | null;
  mapPickedOrigin?: { lat: number; lng: number } | null;
  mapPickedDest?: { lat: number; lng: number } | null;
  onRequestMapPick?: (field: 'origin' | 'dest') => void;
  onPlanUpdate: (params: {
    origin: { lat: number; lng: number } | null;
    dest: { lat: number; lng: number } | null;
    routeStops: StopForMap[];
    dropoffStop: { latitude: number; longitude: number; name: string } | null;
  }) => void;
}

// Reverse geocode a coordinate to a human-readable label
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=es&zoom=18`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    if (data.display_name) {
      // Return road + suburb if available, else first part
      const parts = data.display_name.split(',');
      return parts.slice(0, 2).join(',').trim();
    }
  } catch { /* fall through */ }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Expand Colombian address abbreviations so Nominatim can understand them
function expandColombianAddress(query: string): string {
  return query
    .replace(/\bCra\.?\s*/gi, 'Carrera ')
    .replace(/\bCl\.?\s*/gi, 'Calle ')
    .replace(/\bKr\.?\s*/gi, 'Carrera ')
    .replace(/\bDg\.?\s*/gi, 'Diagonal ')
    .replace(/\bTv\.?\s*/gi, 'Transversal ')
    .replace(/\bAv\.?\s*/gi, 'Avenida ')
    .replace(/\bAk\.?\s*/gi, 'Avenida Carrera ')
    .trim();
}

// Extract the main street fragment before the '#' (cross-street number)
// "Carrera 59B #79-400" → "Carrera 59B"
function mainStreet(query: string): string {
  return query.replace(/#.*$/, '').trim();
}

// Return the index in a geometry array closest to the given coordinate
function findClosestIndex(geometry: [number, number][], lat: number, lng: number): number {
  let minDist = Infinity;
  let idx = 0;
  for (let i = 0; i < geometry.length; i++) {
    const d = (geometry[i][0] - lat) ** 2 + (geometry[i][1] - lng) ** 2;
    if (d < minDist) { minDist = d; idx = i; }
  }
  return idx;
}

// Parse a Colombian address like "Cra. 59B #79-400" into its components.
// Returns null if the input doesn't match the [Street] [N] #[Cross]-[Dist] pattern.
function parseColombianAddress(input: string): {
  mainStreet: string;
  crossStreet: string;
  distance: number;
} | null {
  const normalized = expandColombianAddress(input);
  // Match: <street-with-number> #<cross-number> - <distance>
  const match = normalized.match(/^(.+?)\s*#\s*(\d+[A-Za-z]?)\s*-\s*(\d+)/i);
  if (!match) return null;

  const main = match[1].trim();
  const crossNum = match[2].trim();
  const distance = parseInt(match[3], 10);

  const mainLower = main.toLowerCase();
  let crossType: string;
  if (mainLower.includes('carrera')) {
    crossType = 'Calle';
  } else if (mainLower.includes('calle')) {
    crossType = 'Carrera';
  } else {
    // Diagonal / Transversal / Avenida — default Calle; geocodeInBarranquilla will try Carrera too
    crossType = 'Calle';
  }

  return { mainStreet: main, crossStreet: `${crossType} ${crossNum}`, distance };
}

// Query Overpass API for the node shared by two streets inside Barranquilla's bounding box.
async function findIntersectionOverpass(
  main: string,
  cross: string,
): Promise<{ lat: number; lng: number } | null> {
  const bbox = '10.85,-74.93,11.10,-74.70';
  const query =
    `[out:json][timeout:15];\n` +
    `way["name"~"${main}",i](${bbox})->.a;\n` +
    `way["name"~"${cross}",i](${bbox})->.b;\n` +
    `node(w.a)(w.b);\n` +
    `out;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (Array.isArray(data.elements) && data.elements.length > 0) {
      return { lat: data.elements[0].lat, lng: data.elements[0].lon };
    }
  } catch { /* timeout or network error — fall through */ }
  return null;
}

// Search with multiple fallback strategies for Colombian addresses
async function geocodeInBarranquilla(query: string): Promise<NominatimResult[]> {
  const base = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=co&accept-language=es';
  const viewbox = '&viewbox=-74.93,10.85,-74.70,11.10';

  // 1. Overpass intersection lookup for "Street #Cross-Dist" format
  const parsed = parseColombianAddress(query);
  if (parsed) {
    let intersection = await findIntersectionOverpass(parsed.mainStreet, parsed.crossStreet);

    // For ambiguous main types (Diagonal/Transversal/Avenida), also try alternate cross type
    if (!intersection) {
      const mainLower = parsed.mainStreet.toLowerCase();
      const isAmbiguous = !mainLower.includes('carrera') && !mainLower.includes('calle');
      if (isAmbiguous) {
        const altCross = parsed.crossStreet.startsWith('Calle')
          ? parsed.crossStreet.replace('Calle', 'Carrera')
          : parsed.crossStreet.replace('Carrera', 'Calle');
        intersection = await findIntersectionOverpass(parsed.mainStreet, altCross);
        if (intersection) {
          return [{
            place_id: 0,
            display_name: `${parsed.mainStreet} × ${altCross}`,
            lat: String(intersection.lat),
            lon: String(intersection.lng),
          }];
        }
      }
    }

    if (intersection) {
      return [{
        place_id: 0,
        display_name: `${parsed.mainStreet} × ${parsed.crossStreet}`,
        lat: String(intersection.lat),
        lon: String(intersection.lng),
      }];
    }
  }

  // 2–4. Nominatim fallback strategies
  const expanded = expandColombianAddress(query);
  const street = mainStreet(expanded);

  const queries = [
    expanded,
    street,
    expandColombianAddress(mainStreet(query)),
  ].filter((q, i, arr) => q.length > 1 && arr.indexOf(q) === i);

  const attempts: string[] = [];
  for (const q of queries) {
    attempts.push(`${base}${viewbox}&q=${encodeURIComponent(q + ', Barranquilla')}`);
    attempts.push(`${base}&q=${encodeURIComponent(q + ', Barranquilla, Colombia')}`);
  }

  for (const url of attempts) {
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      const data: NominatimResult[] = await res.json();
      if (data.length > 0) return data;
    } catch { /* try next */ }
  }
  return [];
}

export default function PlanTripMode({
  userPosition,
  mapPickedOrigin,
  mapPickedDest,
  onRequestMapPick,
  onPlanUpdate,
}: Props) {
  // Origin
  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<NominatimResult[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [originIsGps, setOriginIsGps] = useState(true);
  const originDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Destination
  const [destQuery, setDestQuery] = useState('');
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null);
  const [destLabel, setDestLabel] = useState('');
  const destDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Results
  const [results, setResults] = useState<PlanRoute[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<PlanRoute | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [searchError, setSearchError] = useState('');
  const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
  const [selectedNearby, setSelectedNearby] = useState<NearbyRoute | null>(null);
  const previewRouteIdRef = useRef<number | null>(null);

  // ── Load favorites on mount ────────────────────────────────────────────
  useEffect(() => {
    usersApi.getFavorites()
      .then((r) => {
        const ids = new Set<number>((r.data.favorites as { id: number }[]).map((f) => f.id));
        setFavorites(ids);
      })
      .catch(() => {});
  }, []);

  // ── Sync GPS position when in GPS mode ────────────────────────────────
  useEffect(() => {
    if (userPosition && originIsGps) {
      setOrigin({ lat: userPosition[0], lng: userPosition[1] });
    }
  }, [userPosition, originIsGps]);

  // ── Fetch nearby routes whenever origin changes ────────────────────────
  useEffect(() => {
    if (!origin) return;
    routesApi.nearby(origin.lat, origin.lng, 0.5)
      .then((res) => setNearbyRoutes(res.data.routes ?? []))
      .catch(() => {});
  }, [origin?.lat, origin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle map-picked origin ───────────────────────────────────────────
  useEffect(() => {
    if (!mapPickedOrigin) return;
    setOriginIsGps(false);
    setOriginSuggestions([]);
    setOrigin(mapPickedOrigin);
    reverseGeocode(mapPickedOrigin.lat, mapPickedOrigin.lng).then((label) => {
      setOriginQuery(label);
    });
  }, [mapPickedOrigin]);

  // ── Handle map-picked destination ─────────────────────────────────────
  useEffect(() => {
    if (!mapPickedDest) return;
    setSuggestions([]);
    setSearchError('');
    setDest(mapPickedDest);
    reverseGeocode(mapPickedDest.lat, mapPickedDest.lng).then((label) => {
      setDestQuery(label);
      setDestLabel(label);
    });
    fetchPlan(mapPickedDest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapPickedDest]);

  // ── Origin autocomplete ────────────────────────────────────────────────
  const handleOriginInput = (value: string) => {
    setOriginQuery(value);
    setOriginIsGps(false);
    setOrigin(null); // mark as unresolved until user confirms
    if (!value.trim()) {
      setOriginSuggestions([]);
      return;
    }
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current);
    if (value.length < 3) { setOriginSuggestions([]); return; }
    originDebounceRef.current = setTimeout(async () => {
      try {
        const data = await geocodeInBarranquilla(value);
        setOriginSuggestions(data);
      } catch {
        setOriginSuggestions([]);
      }
    }, 500);
  };

  const handleOriginSearch = async () => {
    if (!originQuery.trim() || originQuery.length < 3) return;
    setOriginSuggestions([]);
    const data = await geocodeInBarranquilla(originQuery);
    if (data.length > 0) {
      setOrigin({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
      setOriginQuery(data[0].display_name.split(',')[0]);
    }
  };

  const handleOriginKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !origin) {
      e.preventDefault();
      handleOriginSearch();
    }
  };

  const selectOriginSuggestion = (s: NominatimResult) => {
    setOrigin({ lat: parseFloat(s.lat), lng: parseFloat(s.lon) });
    setOriginQuery(s.display_name.split(',')[0]);
    setOriginSuggestions([]);
    setOriginIsGps(false);
  };

  const resetOriginToGps = () => {
    setOriginIsGps(true);
    setOriginQuery('');
    setOriginSuggestions([]);
    if (userPosition) setOrigin({ lat: userPosition[0], lng: userPosition[1] });
  };

  // ── Destination autocomplete ───────────────────────────────────────────
  const handleDestInput = (value: string) => {
    setDestQuery(value);
    setDest(null);
    setDestLabel('');
    setSearchError('');
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    if (value.length < 3) { setSuggestions([]); return; }
    // Use expanded form for autocomplete queries so abbreviations work
    destDebounceRef.current = setTimeout(async () => {
      try {
        const data = await geocodeInBarranquilla(expandColombianAddress(value));
        setSuggestions(data);
      } catch {
        setSuggestions([]);
      }
    }, 500);
  };

  const selectSuggestion = (s: NominatimResult) => {
    const coord = { lat: parseFloat(s.lat), lng: parseFloat(s.lon) };
    setDest(coord);
    setDestLabel(s.display_name.split(',')[0]);
    setDestQuery(s.display_name.split(',')[0]);
    setSuggestions([]);
    fetchPlan(coord);
  };

  // ── Manual search (Enter or Buscar button) ────────────────────────────
  const handleManualSearch = async () => {
    if (!destQuery.trim() || destQuery.length < 3) return;
    setSuggestions([]);
    setSearchError('');
    setPlanLoading(true);
    const userTyped = destQuery; // preserve exactly what the user wrote
    try {
      const data = await geocodeInBarranquilla(destQuery);
      if (data.length === 0) {
        setSearchError('No se encontró esa dirección. Prueba con el nombre del barrio, un lugar reconocido, o toca el mapa para elegir el punto.');
        setPlanLoading(false);
        return;
      }
      const first = data[0];
      const coord = { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
      setDest(coord);
      // Keep what the user typed — don't replace with the geocoded label
      setDestLabel(userTyped);
      // destQuery stays as-is (no setDestQuery here)
      await fetchPlan(coord);
    } catch {
      setSearchError('Error al buscar. Verifica tu conexión.');
      setPlanLoading(false);
    }
  };

  const handleDestKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !dest) {
      e.preventDefault();
      handleManualSearch();
    }
  };

  // ── Preview a nearby route on the map ─────────────────────────────────
  const handleNearbyPreview = async (route: NearbyRoute) => {
    if (selectedNearby?.id === route.id) {
      setSelectedNearby(null);
      previewRouteIdRef.current = null;
      onPlanUpdate({ origin, dest: null, routeStops: [], dropoffStop: null });
      return;
    }
    setSelectedNearby(route);
    previewRouteIdRef.current = route.id;
    // Limpiar ruta anterior del mapa inmediatamente
    onPlanUpdate({ origin, dest: null, routeStops: [], dropoffStop: null });

    // Usar geometría que ya viene en la respuesta de /nearby si está disponible
    if (route.geometry && route.geometry.length >= 2) {
      if (previewRouteIdRef.current !== route.id) return;
      const routeStops: StopForMap[] = route.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
      onPlanUpdate({ origin, dest: null, routeStops, dropoffStop: null });
      return;
    }

    // Fallback: fetch paradas si la ruta no tiene geometría guardada
    try {
      const stopsRes = await stopsApi.listByRoute(route.id);
      if (previewRouteIdRef.current !== route.id) return;
      const stops = (stopsRes.data.stops as { latitude: number; longitude: number; stop_order: number }[])
        .sort((a, b) => a.stop_order - b.stop_order);
      if (stops.length >= 2) {
        const routeStops: StopForMap[] = stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
        onPlanUpdate({ origin, dest: null, routeStops, dropoffStop: null });
      } else {
        // Sin geometría ni paradas — deseleccionar
        setSelectedNearby(null);
        previewRouteIdRef.current = null;
      }
    } catch {
      if (previewRouteIdRef.current === route.id) {
        setSelectedNearby(null);
        previewRouteIdRef.current = null;
      }
    }
  };

  // ── Fetch plan ─────────────────────────────────────────────────────────
  const fetchPlan = async (destination: { lat: number; lng: number }) => {
    setPlanLoading(true);
    setResults([]);
    setSelectedRoute(null);
    setSelectedNearby(null);
    previewRouteIdRef.current = null;
    onPlanUpdate({ origin, dest: destination, routeStops: [], dropoffStop: null });
    try {
      const res = await routesApi.plan(destination.lat, destination.lng, origin?.lat, origin?.lng);
      setResults(res.data.routes as PlanRoute[]);
    } catch {
      setResults([]);
    } finally {
      setPlanLoading(false);
    }
  };

  // ── Select a result → update map ──────────────────────────────────────
  const handleSelectRoute = async (route: PlanRoute) => {
    setSelectedRoute(route);

    let routeStops: StopForMap[] = [
      { latitude: route.nearest_stop_lat, longitude: route.nearest_stop_lng },
    ];

    try {
      const [routeRes, stopsRes] = await Promise.all([
        routesApi.getById(route.id),
        stopsApi.listByRoute(route.id),
      ]);
      const fullRoute = routeRes.data.route as { geometry?: [number, number][] | null };
      const stops = (stopsRes.data.stops as { latitude: number; longitude: number; stop_order: number }[])
        .sort((a, b) => a.stop_order - b.stop_order);

      if (stops.length >= 2) {
        // Find the dropoff stop by matching the nearest_stop coordinates
        const dropoffStop = stops.reduce((best, s) => {
          const d = (s.latitude - route.nearest_stop_lat) ** 2 + (s.longitude - route.nearest_stop_lng) ** 2;
          const db = (best.latitude - route.nearest_stop_lat) ** 2 + (best.longitude - route.nearest_stop_lng) ** 2;
          return d < db ? s : best;
        });

        // Find the boarding stop by matching origin, or use the first stop
        const boardingStop = origin
          ? stops.reduce((best, s) => {
              const d = (s.latitude - origin.lat) ** 2 + (s.longitude - origin.lng) ** 2;
              const db = (best.latitude - origin.lat) ** 2 + (best.longitude - origin.lng) ** 2;
              return d < db ? s : best;
            })
          : stops[0];

        const boardOrder = boardingStop.stop_order;
        const dropOrder  = dropoffStop.stop_order;
        const startStop  = boardOrder <= dropOrder ? boardingStop : dropoffStop;
        const endStop    = boardOrder <= dropOrder ? dropoffStop  : boardingStop;

        if (fullRoute.geometry && fullRoute.geometry.length >= 2) {
          const geo = fullRoute.geometry;
          const startIdx = findClosestIndex(geo, startStop.latitude, startStop.longitude);
          const endIdx   = findClosestIndex(geo, endStop.latitude,   endStop.longitude);

          if (endIdx > startIdx) {
            // Segmento recortado entre abordaje y bajada
            routeStops = geo.slice(startIdx, endIdx + 1)
              .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          } else {
            // Recorte falló (ruta circular o índices invertidos) — mostrar geometría completa
            routeStops = geo.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          }
        } else {
          // Sin geometría: usar paradas entre abordaje y bajada como segmentos rectos
          const minOrder = Math.min(boardOrder, dropOrder);
          const maxOrder = Math.max(boardOrder, dropOrder);
          const segment  = stops.filter(s => s.stop_order >= minOrder && s.stop_order <= maxOrder);
          if (segment.length >= 2) {
            routeStops = segment.map(s => ({ latitude: s.latitude, longitude: s.longitude }));
          } else {
            // Fallback final: todas las paradas
            routeStops = stops.map(s => ({ latitude: s.latitude, longitude: s.longitude }));
          }
        }
      }
    } catch { /* fallback al punto único */ }

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
    setSearchError('');
    setSelectedNearby(null);
    previewRouteIdRef.current = null;
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
      {/* Origin input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-green-500 rounded-full shrink-0 pointer-events-none" />
        <input
          type="text"
          value={originIsGps ? '' : originQuery}
          onChange={(e) => handleOriginInput(e.target.value)}
          onKeyDown={handleOriginKeyDown}
          placeholder="Mi ubicación actual"
          className="w-full border border-gray-200 rounded-xl pl-8 pr-24 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {!originIsGps && originQuery.length >= 3 && !origin && (
            <button
              onClick={handleOriginSearch}
              className="bg-green-600 text-white text-xs px-2 py-1 rounded-lg hover:bg-green-700"
            >
              Buscar
            </button>
          )}
          {!originIsGps && (
            <button
              onClick={resetOriginToGps}
              title="Volver a mi GPS"
              className="text-gray-400 hover:text-green-600 text-xs px-1.5 py-1"
            >
              📍
            </button>
          )}
          {onRequestMapPick && (
            <button
              onClick={() => onRequestMapPick('origin')}
              title="Elegir en el mapa"
              className="text-gray-400 hover:text-blue-600 text-xs px-1.5 py-1"
            >
              🗺️
            </button>
          )}
        </div>

        {/* Origin suggestions */}
        {originSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-50 overflow-hidden">
            {originSuggestions.map((s) => (
              <button
                key={s.place_id}
                onClick={() => selectOriginSuggestion(s)}
                className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-green-50 border-b border-gray-50 last:border-0 truncate"
              >
                {s.display_name.split(',').slice(0, 2).join(', ')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Destination input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-red-400 pointer-events-none">📍</span>
        <input
          type="text"
          value={destQuery}
          onChange={(e) => handleDestInput(e.target.value)}
          onKeyDown={handleDestKeyDown}
          placeholder="¿A dónde vas?"
          className="w-full border border-gray-200 rounded-xl pl-8 pr-24 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {/* Buscar button */}
          {destQuery.length >= 3 && !dest && !planLoading && (
            <button
              onClick={handleManualSearch}
              className="bg-blue-600 text-white text-xs px-2 py-1 rounded-lg hover:bg-blue-700"
            >
              Buscar
            </button>
          )}
          {/* Clear button */}
          {destLabel && (
            <button
              onClick={reset}
              className="text-gray-400 hover:text-gray-600 text-xs px-1.5 py-1"
            >
              ✕
            </button>
          )}
          {/* Map pick button */}
          {onRequestMapPick && !destLabel && (
            <button
              onClick={() => onRequestMapPick('dest')}
              title="Elegir en el mapa"
              className="text-gray-400 hover:text-blue-600 text-xs px-1.5 py-1"
            >
              🗺️
            </button>
          )}
        </div>

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

      {/* Search error */}
      {searchError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 space-y-1">
          <p>{searchError}</p>
          {onRequestMapPick && (
            <button
              onClick={() => onRequestMapPick('dest')}
              className="text-blue-600 font-semibold underline"
            >
              Toca aquí para elegir el punto en el mapa →
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {planLoading && (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* No results */}
      {!planLoading && dest && results.length === 0 && !searchError && (
        <div className="text-center py-6 text-gray-400 text-sm space-y-1">
          <p>Sin rutas encontradas cerca de tu destino.</p>
          <p className="text-xs">Prueba con otro punto de referencia.</p>
        </div>
      )}

      {/* Results */}
      {!planLoading && results.length > 0 && (
        <div className="space-y-2 max-h-[48vh] overflow-y-auto pb-2">
          <p className="text-xs text-gray-500">
            {results.length} ruta{results.length !== 1 ? 's' : ''} pasan cerca de tu destino
          </p>
          {results.map((r) => (
            <div
              key={r.id}
              onClick={() => handleSelectRoute(r)}
              className="w-full text-left bg-white border border-gray-100 rounded-xl p-3 hover:bg-blue-50 hover:border-blue-100 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900 truncate flex-1">
                  {r.company_name ?? r.name}
                </span>
                <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
                  {r.code}
                </span>
                <button
                  onClick={(e) => toggleFavorite(e, r.id)}
                  className="shrink-0 text-base leading-none"
                >
                  {favorites.has(r.id) ? '⭐' : '☆'}
                </button>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500 pl-0.5 flex-wrap">
                {r.origin_distance_meters != null && (
                  <span>🚶 {r.origin_distance_meters} m para subir</span>
                )}
                <span>🏁 {r.distance_meters} m al bajar</span>
                {r.frequency_minutes && <span>🕐 Cada {r.frequency_minutes} min</span>}
                {r.minutes_ago !== null && (
                  <span className="text-amber-600">📡 {r.minutes_ago} min</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Buses en tu zona — shown before a destination is set */}
      {!dest && !planLoading && !searchError && nearbyRoutes.length > 0 && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🚌 Buses en tu zona</p>
          <div className="space-y-1">
            {nearbyRoutes.map((r) => {
              const isSelected = selectedNearby?.id === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => handleNearbyPreview(r)}
                  className={`w-full flex items-center justify-between text-sm rounded-xl px-2 py-1.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-100 border border-transparent'
                  }`}
                >
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className={`font-semibold truncate w-full text-left leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                      {r.company_name ?? r.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isSelected ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-700'}`}>
                      {r.code}
                    </span>
                    <span className="text-xs text-gray-400">
                      {Math.round(r.min_distance * 1000)} m
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mini info bar when a route is selected */}
          {selectedNearby ? (
            <div className="flex items-center justify-between bg-blue-600 text-white rounded-xl px-3 py-2 mt-1">
              <p className="text-xs">
                <span className="font-bold">{selectedNearby.company_name ?? selectedNearby.name}</span>
                {' '}<span className="opacity-75">{selectedNearby.code}</span>
                {' — '}¿Va a tu destino? Escríbelo arriba ↑
              </p>
              <button
                onClick={() => {
                  setSelectedNearby(null);
                  onPlanUpdate({ origin, dest: null, routeStops: [], dropoffStop: null });
                }}
                className="ml-2 text-white/70 hover:text-white text-sm leading-none"
              >
                ✕
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Toca una ruta para verla en el mapa.</p>
          )}
        </div>
      )}

      {/* Tip when no destination yet and no nearby routes */}
      {!dest && !planLoading && !searchError && nearbyRoutes.length === 0 && (
        <p className="text-xs text-gray-400 text-center pt-1">
          Escribe tu destino o toca 🗺️ para elegirlo en el mapa
        </p>
      )}
    </div>
  );
}
