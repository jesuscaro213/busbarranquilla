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

interface ActivityEvent {
  type: 'active_trip' | 'boarding' | 'alighting' | 'report';
  report_type?: string;
  minutes_ago: number;
  lat: number;
  lng: number;
  confirmations?: number;
  description?: string | null;
}

interface ActivityData {
  active_count: number;
  last_activity_minutes: number | null;
  events: ActivityEvent[];
  active_positions: { lat: number; lng: number; minutes_ago: number }[];
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
  onBoardRoute?: (routeId: number, destinationStopId?: number) => void;
  onActivityPositions?: (positions: { lat: number; lng: number; minutes_ago: number }[]) => void;
}

const GEOAPIFY_KEY = '5ccd06229fa54e23ad29c21a62e545d4';
// Barranquilla metropolitan area bounding box: south,west,north,east
// Covers Barranquilla + Soledad + Malambo + Puerto Colombia + Galapa
const BQ_BBOX = { south: 10.82, west: -74.98, north: 11.08, east: -74.62 };
// Bias center: Barranquilla downtown
const BQ_CENTER = { lat: 10.9878, lng: -74.7889 };

// Returns true if coordinates are within the metro area bounding box
function isInMetroArea(lat: number, lng: number): boolean {
  return lat >= BQ_BBOX.south && lat <= BQ_BBOX.north
    && lng >= BQ_BBOX.west && lng <= BQ_BBOX.east;
}

// Reverse geocode a coordinate to a human-readable label
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&lang=es&apiKey=${GEOAPIFY_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const name = data.features?.[0]?.properties?.formatted as string | undefined;
    if (name) return name.split(',').slice(0, 2).join(',').trim();
  } catch { /* fall through */ }
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Expand Colombian address abbreviations
function expandColombianAddress(query: string): string {
  return query
    .replace(/\bCra\.?\s*/gi, 'Carrera ')
    .replace(/\bCr\.?\s*/gi, 'Carrera ')
    .replace(/\bCl\.?\s*/gi, 'Calle ')
    .replace(/\bKr\.?\s*/gi, 'Carrera ')
    .replace(/\bDg\.?\s*/gi, 'Diagonal ')
    .replace(/\bTv\.?\s*/gi, 'Transversal ')
    .replace(/\bAv\.?\s*/gi, 'Avenida ')
    .replace(/\bAk\.?\s*/gi, 'Avenida Carrera ')
    .trim();
}


// Return closest index in geometry array
function findClosestIndex(geometry: [number, number][], lat: number, lng: number): number {
  let minDist = Infinity;
  let idx = 0;
  for (let i = 0; i < geometry.length; i++) {
    const d = (geometry[i][0] - lat) ** 2 + (geometry[i][1] - lng) ** 2;
    if (d < minDist) { minDist = d; idx = i; }
  }
  return idx;
}

// Normalize Colombian address separators:
// "Cr 52 N 45-30" → "Cr 52 #45-30"  (N = número, common alternative to #)
// "Cr 52 N 45"    → "Cr 52 #45"
function normalizeAddressSeparator(input: string): string {
  // Replace isolated "N" or "No" followed by digits with "#"
  // but only when it follows a street identifier (not part of "Norte" in a name)
  return input.replace(/\s+[Nn][oO]?\.\s*(\d)/g, ' #$1').replace(/\s+[Nn]\s+(\d)/g, ' #$1');
}

// Parse Colombian address "Cra. 59B #79-400" or "Cra 59B #79"
// Also handles intersection format "Calle 72 Cr 52" / "Calle 72 con Carrera 52"
function parseColombianAddress(input: string): {
  mainStreet: string;
  crossStreet: string;
  distance: number;
} | null {
  const withNorm = normalizeAddressSeparator(input);
  const normalized = expandColombianAddress(withNorm);

  // Pattern 1: standard address with # separator — "Carrera 52 #72-30"
  const matchHash = normalized.match(/^(.+?)\s*#\s*(\d+[A-Za-z]?)(?:\s*-\s*(\d+))?/i);
  if (matchHash) {
    const main = matchHash[1].trim();
    const crossNum = matchHash[2].trim();
    const distance = matchHash[3] ? parseInt(matchHash[3], 10) : 0;
    const mainLower = main.toLowerCase();
    const crossType = mainLower.includes('carrera') ? 'Calle'
      : mainLower.includes('calle') ? 'Carrera'
      : 'Calle';
    return { mainStreet: main, crossStreet: `${crossType} ${crossNum}`, distance };
  }

  // Pattern 2: two street types — "Calle 72 Carrera 52" / "Calle 72 con Carrera 52"
  const streetTypes = '(?:Carrera|Calle|Diagonal|Transversal|Avenida)';
  const matchTwo = normalized.match(
    new RegExp(`^(${streetTypes}\\s+\\d+[A-Za-z]?)\\s+(?:con\\s+)?(${streetTypes}\\s+\\d+[A-Za-z]?)\\s*$`, 'i')
  );
  if (matchTwo) {
    return { mainStreet: matchTwo[1].trim(), crossStreet: matchTwo[2].trim(), distance: 0 };
  }

  return null;
}

// Build a flexible regex for a Colombian street name in Overpass
// "Carrera 52" → "(Carrera|Cra\.?|Kr\.?)\s*52"
// "Calle 45"   → "(Calle|Cl\.?)\s*45"
function streetOsmPattern(streetName: string): string {
  const lower = streetName.toLowerCase();
  const num = streetName.match(/\d+[A-Za-z]?$/)?.[0] ?? '';
  if (lower.includes('carrera')) return `(Carrera|Cra\\.?|Kr\\.?)\\s*${num}`;
  if (lower.includes('calle'))   return `(Calle|Cl\\.?)\\s*${num}`;
  if (lower.includes('diagonal')) return `(Diagonal|Dg\\.?)\\s*${num}`;
  if (lower.includes('transversal')) return `(Transversal|Tv\\.?)\\s*${num}`;
  if (lower.includes('avenida')) return `(Avenida|Av\\.?)\\s*${num}`;
  return streetName;
}

// Overpass intersection lookup for street crosses
async function findIntersectionOverpass(
  main: string,
  cross: string,
): Promise<{ lat: number; lng: number } | null> {
  const bbox = `${BQ_BBOX.south},${BQ_BBOX.west},${BQ_BBOX.north},${BQ_BBOX.east}`;
  const mainPat = streetOsmPattern(main);
  const crossPat = streetOsmPattern(cross);
  const query =
    `[out:json][timeout:15];\n` +
    `way["name"~"${mainPat}",i](${bbox})->.a;\n` +
    `way["name"~"${crossPat}",i](${bbox})->.b;\n` +
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
  } catch { /* timeout or network error */ }
  return null;
}

// Returns true for strings that look like postal codes (all digits, 4-7 chars)
function isPostalCode(s: string): boolean {
  return /^\d{4,7}$/.test(s.trim());
}

// Pick best neighborhood label from Photon/Geoapify properties, excluding postal codes
function pickNeighborhood(p: any): string | null {
  const candidates = [
    p?.quarter,
    p?.neighbourhood,
    p?.suburb,
    p?.district,
    p?.county,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && !isPostalCode(c)) return c;
  }
  return null;
}

// Search with Photon → Geoapify fallback
async function geocodeInBarranquilla(query: string): Promise<NominatimResult[]> {
  // 1. Overpass for Colombian address format "Cra X #Y-Z" / "Cra X N Y"
  const parsed = parseColombianAddress(query);
  if (parsed) {
    let crossLabel = parsed.crossStreet;
    let intersection = await findIntersectionOverpass(parsed.mainStreet, parsed.crossStreet);

    if (!intersection) {
      // Try swapping Calle ↔ Carrera for ambiguous main streets
      const mainLower = parsed.mainStreet.toLowerCase();
      const isAmbiguous = !mainLower.includes('carrera') && !mainLower.includes('calle');
      if (isAmbiguous) {
        const altCross = parsed.crossStreet.startsWith('Calle')
          ? parsed.crossStreet.replace('Calle', 'Carrera')
          : parsed.crossStreet.replace('Carrera', 'Calle');
        intersection = await findIntersectionOverpass(parsed.mainStreet, altCross);
        if (intersection) crossLabel = altCross;
      }
    }

    if (intersection) return [{
      place_id: 0,
      display_name: `${parsed.mainStreet} × ${crossLabel}`,
      lat: String(intersection.lat),
      lon: String(intersection.lng),
    }];

    // Overpass found nothing — try Geoapify with the intersection as text
    const label = `${parsed.mainStreet} × ${parsed.crossStreet}`;
    try {
      const geoText = `${parsed.mainStreet} con ${parsed.crossStreet}, Barranquilla, Colombia`;
      const geoUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(geoText)}&filter=countrycode:co&bias=proximity:${BQ_CENTER.lng},${BQ_CENTER.lat}&limit=1&lang=es&apiKey=${GEOAPIFY_KEY}`;
      const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
      const geoData = await geoRes.json();
      if (Array.isArray(geoData.features) && geoData.features.length > 0) {
        const p = geoData.features[0].properties;
        return [{ place_id: 0, display_name: label, lat: String(p.lat), lon: String(p.lon) }];
      }
    } catch { /* fall through */ }

    // Last resort — Photon with both street names (no # sign)
    try {
      const photonQ = `${parsed.mainStreet} ${parsed.crossStreet} Barranquilla`;
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(photonQ)}&lat=${BQ_CENTER.lat}&lon=${BQ_CENTER.lng}&limit=5&lang=es&bbox=${BQ_BBOX.west},${BQ_BBOX.south},${BQ_BBOX.east},${BQ_BBOX.north}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const data = await res.json();
      if (Array.isArray(data.features) && data.features.length > 0) {
        const useful = data.features.filter((f: any) =>
          f.properties?.type !== 'city' && f.properties?.type !== 'state'
          && f.properties?.name !== 'Barranquilla'
        );
        if (useful.length > 0) {
          const f = useful[0];
          return [{ place_id: 0, display_name: label, lat: String(f.geometry.coordinates[1]), lon: String(f.geometry.coordinates[0]) }];
        }
      }
    } catch { /* fall through */ }

    // Nothing found — return an empty list (better than garbage results)
    return [];
  }

  const searchQuery = expandColombianAddress(query);

  // 2. Nominatim (OpenStreetMap official geocoder — bounded=1 strictly limits to viewbox)
  // viewbox format: left,top,right,bottom  (west,north,east,south)
  try {
    const viewbox = `${BQ_BBOX.west},${BQ_BBOX.north},${BQ_BBOX.east},${BQ_BBOX.south}`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery + ', Barranquilla')}&format=jsonv2&limit=8&countrycodes=co&bounded=1&viewbox=${viewbox}&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'es', 'User-Agent': 'MiBus/1.0 (mibus.co)' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const results = data
        .filter((r: any) => isInMetroArea(parseFloat(r.lat), parseFloat(r.lon)))
        .map((r: any, i: number) => {
          const addr = r.address ?? {};
          const street = addr.road ?? addr.pedestrian ?? addr.path ?? '';
          const houseNum = addr.house_number ? ` #${addr.house_number}` : '';
          const neighborhood = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? addr.city_district ?? '';
          const city = addr.city ?? addr.town ?? 'Barranquilla';
          // Use display name of the place if it's a POI (not just a street)
          const label = r.name && r.name !== street ? r.name : street;
          return {
            place_id: i,
            display_name: [label + houseNum, neighborhood, city].filter(Boolean).join(', '),
            lat: r.lat,
            lon: r.lon,
          };
        });
      if (results.length > 0) return deduplicateResults(results);
    }
  } catch { /* fall through to Geoapify */ }

  // 3. Geoapify fallback — strict rect filter for metro area
  try {
    const rectFilter = `rect:${BQ_BBOX.west},${BQ_BBOX.south},${BQ_BBOX.east},${BQ_BBOX.north}`;
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(searchQuery + ', Barranquilla, Colombia')}&filter=${rectFilter}&bias=proximity:${BQ_CENTER.lng},${BQ_CENTER.lat}&limit=8&lang=es&apiKey=${GEOAPIFY_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (Array.isArray(data.features) && data.features.length > 0) {
      const results = data.features
        .filter((f: any) => isInMetroArea(f.properties.lat, f.properties.lon))
        .map((f: any, i: number) => {
          const p = f.properties ?? {};
          const streetPart = p.street
            ? (p.housenumber ? `${p.street} #${p.housenumber}` : p.street)
            : (p.name ?? '');
          const neighborhood = pickNeighborhood(p);
          const city = p.city ?? p.town ?? 'Barranquilla';
          return {
            place_id: i,
            display_name: [streetPart || p.name, neighborhood, city]
              .filter(Boolean).join(', ') || query,
            lat: String(p.lat),
            lon: String(p.lon),
          };
        });
      if (results.length > 0) return deduplicateResults(results);
    }
  } catch { /* all strategies exhausted */ }

  return [];
}

// Remove duplicate display_names and city-only results from geocoder output
function deduplicateResults(results: NominatimResult[]): NominatimResult[] {
  const GARBAGE = new Set(['Barranquilla', 'Perímetro Urbano Barranquilla', 'Colombia']);
  const seen = new Set<string>();
  const out: NominatimResult[] = [];
  for (const r of results) {
    const name = r.display_name.trim();
    if (GARBAGE.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(r);
    if (out.length >= 4) break; // max 4 unique results
  }
  return out;
}

export default function PlanTripMode({
  userPosition,
  mapPickedOrigin,
  mapPickedDest,
  onRequestMapPick,
  onPlanUpdate,
  onBoardRoute,
  onActivityPositions,
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
  const [selectedDropoffStopId, setSelectedDropoffStopId] = useState<number | undefined>(undefined);
  const [activityByRoute, setActivityByRoute] = useState<Record<number, ActivityData>>({});
  const [activityExpanded, setActivityExpanded] = useState<Record<number, boolean>>({});
  const [activityLoading, setActivityLoading] = useState<Record<number, boolean>>({});
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [searchError, setSearchError] = useState('');
  const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [selectedNearby, setSelectedNearby] = useState<NearbyRoute | null>(null);
  const previewRouteIdRef = useRef<number | null>(null);
  const nearbyFetchedRef = useRef(false);
  const originRef = useRef<{ lat: number; lng: number } | null>(null);

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

  // ── Fetch nearby routes ────────────────────────────────────────────────
  const fetchNearbyRoutes = (pos: { lat: number; lng: number }) => {
    setNearbyLoading(true);
    routesApi.nearby(pos.lat, pos.lng, 0.3)
      .then((res) => setNearbyRoutes(res.data.routes ?? []))
      .catch(() => {})
      .finally(() => setNearbyLoading(false));
  };

  // Carga inicial GPS: solo la primera vez, no en cada movimiento
  useEffect(() => {
    if (!origin || !originIsGps || nearbyFetchedRef.current) return;
    nearbyFetchedRef.current = true;
    originRef.current = origin;
    fetchNearbyRoutes(origin);
  }, [origin, originIsGps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si el origen cambia a manual (dirección escrita o punto en mapa), refetch inmediato
  useEffect(() => {
    if (!origin || originIsGps) return;
    originRef.current = origin;
    fetchNearbyRoutes(origin);
  }, [origin?.lat, origin?.lng, originIsGps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh cada 2 minutos cuando el origen es GPS
  useEffect(() => {
    if (!originIsGps) return;
    const interval = setInterval(() => {
      if (originRef.current) fetchNearbyRoutes(originRef.current);
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [originIsGps]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle map-picked origin ───────────────────────────────────────────
  useEffect(() => {
    if (!mapPickedOrigin) return;
    if (originDebounceRef.current) clearTimeout(originDebounceRef.current);
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
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
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

    // Fetch actividad de la ruta seleccionada (non-blocking)
    if (!activityByRoute[route.id]) {
      setActivityLoading(prev => ({ ...prev, [route.id]: true }));
      try {
        const res = await routesApi.getActivity(route.id);
        setActivityByRoute(prev => ({ ...prev, [route.id]: res.data }));
        onActivityPositions?.(res.data.active_positions);
      } catch { /* silencioso */ } finally {
        setActivityLoading(prev => ({ ...prev, [route.id]: false }));
      }
    } else {
      onActivityPositions?.(activityByRoute[route.id].active_positions);
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
    setSelectedDropoffStopId(undefined);

    let routeStops: StopForMap[] = [
      { latitude: route.nearest_stop_lat, longitude: route.nearest_stop_lng },
    ];

    try {
      const [routeRes, stopsRes] = await Promise.all([
        routesApi.getById(route.id),
        stopsApi.listByRoute(route.id),
      ]);
      const fullRoute = routeRes.data.route as { geometry?: [number, number][] | null };
      const stops = (stopsRes.data.stops as { id: number; latitude: number; longitude: number; stop_order: number }[])
        .sort((a, b) => a.stop_order - b.stop_order);

      if (stops.length >= 2) {
        // Find the dropoff stop by matching the nearest_stop coordinates
        const dropoffStop = stops.reduce((best, s) => {
          const d = (s.latitude - route.nearest_stop_lat) ** 2 + (s.longitude - route.nearest_stop_lng) ** 2;
          const db = (best.latitude - route.nearest_stop_lat) ** 2 + (best.longitude - route.nearest_stop_lng) ** 2;
          return d < db ? s : best;
        });
        setSelectedDropoffStopId(dropoffStop.id);

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

    // Fetch activity for this route (non-blocking)
    if (!activityByRoute[route.id]) {
      setActivityLoading(prev => ({ ...prev, [route.id]: true }));
      try {
        const res = await routesApi.getActivity(route.id);
        const data: ActivityData = res.data;
        setActivityByRoute(prev => ({ ...prev, [route.id]: data }));
        onActivityPositions?.(data.active_positions);
      } catch { /* silencioso */ } finally {
        setActivityLoading(prev => ({ ...prev, [route.id]: false }));
      }
    } else {
      onActivityPositions?.(activityByRoute[route.id].active_positions);
    }
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

  // Capturar selectedRouteId antes del early return para usarlo en results.map
  const selectedRouteId = selectedRoute?.id ?? null;

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

        {onBoardRoute && (
          <button
            onClick={() => onBoardRoute(selectedRoute.id, selectedDropoffStopId)}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
          >
            🚌 Me subí a este bus
          </button>
        )}
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
              className="text-gray-400 hover:text-green-600 text-xs px-2 py-1 rounded-lg hover:bg-green-50"
            >
              GPS
            </button>
          )}
          {onRequestMapPick && (
            <button
              onClick={() => onRequestMapPick('origin')}
              className="text-blue-600 text-xs px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 font-medium"
            >
              En mapa
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
              className="text-blue-600 text-xs px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 font-medium"
            >
              En mapa
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
          {results.map((r) => {
            const rId = (r as PlanRoute).id;
            const activity = activityByRoute[rId];
            const isExpanded = activityExpanded[rId] ?? false;
            const isLoadingActivity = activityLoading[rId] ?? false;
            const isSelected = selectedRouteId === rId;

            const REPORT_LABELS: Record<string, string> = {
              trancon: '🚧 Trancón', lleno: '🔴 Bus lleno', bus_disponible: '🟢 Hay sillas',
              desvio: '↩️ Desvío', espera: '⏳ Mucha espera',
              traffic: '🚧 Trancón', bus_full: '🔴 Bus lleno', no_service: '⛔ Sin servicio',
            };

            return (
              <div
                key={rId}
                className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                  isSelected ? 'border-blue-300' : 'border-gray-100'
                }`}
              >
                {/* Main card row */}
                <div
                  onClick={() => handleSelectRoute(r)}
                  className="p-3 hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900 truncate flex-1">
                      {r.company_name ?? r.name}
                    </span>
                    <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
                      {r.code}
                    </span>
                    <button onClick={(e) => toggleFavorite(e, r.id)} className="shrink-0 text-base leading-none">
                      {favorites.has(r.id) ? '⭐' : '☆'}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs pl-0.5 flex-wrap">
                    {r.origin_distance_meters != null && (() => {
                      const d = r.origin_distance_meters;
                      const cls = d <= 300 ? 'text-green-600' : d <= 600 ? 'text-amber-600' : 'text-red-500';
                      return <span className={`font-medium ${cls}`}>{d <= 600 ? '🚶' : '⚠️'} {d} m para subir{d > 600 ? ' (lejos)' : ''}</span>;
                    })()}
                    {(() => {
                      const d = r.distance_meters;
                      const cls = d <= 300 ? 'text-green-600' : d <= 600 ? 'text-amber-600' : 'text-red-500';
                      return <span className={`font-medium ${cls}`}>🏁 {d} m{d > 600 ? ' al bajar (lejos)' : ' al bajar'}</span>;
                    })()}
                    {r.frequency_minutes && <span className="text-gray-500">🕐 Cada {r.frequency_minutes} min</span>}
                  </div>
                </div>

                {/* Activity summary bar */}
                {(activity || isLoadingActivity) && (
                  <div className="border-t border-gray-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActivityExpanded(prev => ({ ...prev, [r.id]: !isExpanded }));
                      }}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-gray-600">
                        {isLoadingActivity ? (
                          <span className="text-gray-400">Cargando actividad...</span>
                        ) : activity ? (
                          <>
                            {activity.active_count > 0
                              ? <span className="text-green-600 font-semibold">🚌 {activity.active_count} {activity.active_count === 1 ? 'persona en el bus ahora' : 'personas en el bus ahora'}</span>
                              : activity.last_activity_minutes !== null
                                ? <span className="text-amber-600">📡 Última actividad hace {activity.last_activity_minutes} min</span>
                                : <span className="text-gray-400">Sin actividad reciente</span>
                            }
                          </>
                        ) : null}
                      </span>
                      {activity && activity.events.length > 0 && (
                        <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                      )}
                    </button>

                    {/* Expanded events list */}
                    {isExpanded && activity && activity.events.length > 0 && (
                      <div className="px-3 pb-2 space-y-1 border-t border-gray-50">
                        {activity.events.map((ev, i) => {
                          const timeStr = ev.minutes_ago < 1 ? 'hace un momento' : `hace ${ev.minutes_ago} min`;
                          if (ev.type === 'boarding') return (
                            <p key={i} className="text-xs text-gray-500">🟢 Alguien abordó {timeStr}</p>
                          );
                          if (ev.type === 'alighting') return (
                            <p key={i} className="text-xs text-gray-500">🔵 Alguien bajó {timeStr}</p>
                          );
                          if (ev.type === 'report') return (
                            <p key={i} className="text-xs text-gray-600">
                              {REPORT_LABELS[ev.report_type ?? ''] ?? '📍 Reporte'} {timeStr}
                              {ev.confirmations && ev.confirmations > 0 ? ` · ${ev.confirmations} confirmaciones` : ''}
                            </p>
                          );
                          return null;
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Buses en tu zona — shown before a destination is set */}
      {!dest && !planLoading && !searchError && (nearbyLoading || nearbyRoutes.length > 0) && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-3 space-y-1">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🚌 Buses en tu zona</p>
            {originIsGps && (
              <button
                onClick={() => { if (originRef.current) fetchNearbyRoutes(originRef.current); }}
                disabled={nearbyLoading}
                className="text-xs text-blue-500 disabled:opacity-40 font-medium"
              >
                {nearbyLoading ? 'Actualizando...' : '↻ Actualizar'}
              </button>
            )}
          </div>
          {nearbyRoutes.map((r) => {
            const isSelected = selectedNearby?.id === r.id;
            return (
              <div key={r.id} className={`rounded-xl border transition-colors ${isSelected ? 'bg-white border-blue-200' : 'border-transparent'}`}>
                <button
                  onClick={() => handleNearbyPreview(r)}
                  className={`w-full flex items-center justify-between text-sm px-2 py-1.5 rounded-xl transition-colors ${
                    isSelected ? 'text-blue-900' : 'hover:bg-gray-100 text-gray-800'
                  }`}
                >
                  <span className={`font-semibold truncate text-left leading-tight`}>
                    {r.company_name ?? r.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isSelected ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-700'}`}>
                      {r.code}
                    </span>
                    <span className="text-xs text-gray-400">{Math.round(r.min_distance * 1000)} m</span>
                  </div>
                </button>

                {isSelected && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {/* Actividad de la ruta */}
                    {activityLoading[r.id] && (
                      <p className="text-xs text-gray-400">Cargando actividad...</p>
                    )}
                    {activityByRoute[r.id] && (() => {
                      const act = activityByRoute[r.id];
                      return act.active_count > 0
                        ? <p className="text-xs text-green-600 font-semibold">🚌 {act.active_count} {act.active_count === 1 ? 'persona en el bus ahora' : 'personas en el bus ahora'}</p>
                        : act.last_activity_minutes !== null
                          ? <p className="text-xs text-amber-600">📡 Última actividad hace {act.last_activity_minutes} min</p>
                          : <p className="text-xs text-gray-400">Sin actividad reciente</p>;
                    })()}
                    <p className="text-xs text-gray-500">¿Va a tu destino? Escríbelo arriba ↑</p>
                    {onBoardRoute && (
                      <button
                        onClick={() => onBoardRoute(r.id)}
                        className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
                      >
                        🚌 Me subí a este bus
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
