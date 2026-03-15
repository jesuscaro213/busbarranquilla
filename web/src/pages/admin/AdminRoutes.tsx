import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routesApi, stopsApi, adminApi } from '../../services/api';
import { getSocket } from '../../services/socket';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Route {
  id: number;
  name: string;
  code: string;
  company: string | null;
  company_name: string | null;
  company_id: number | null;
  first_departure: string | null;
  last_departure: string | null;
  frequency_minutes: number | null;
  is_active: boolean;
  status: string | null;
  manually_edited_at: string | null;
}

interface Company {
  id: number;
  name: string;
  is_active: boolean;
}

interface RouteFormData {
  name: string;
  code: string;
  company_id: string;
  first_departure: string;
  last_departure: string;
  frequency_minutes: string;
}

interface Stop {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

interface BackendStop {
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
}

const EMPTY_FORM: RouteFormData = {
  name: '',
  code: '',
  company_id: '',
  first_departure: '',
  last_departure: '',
  frequency_minutes: '',
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StepBadgeProps {
  number: number;
  label: string;
  active: boolean;
  done: boolean;
}

function StepBadge({ number, label, active, done }: StepBadgeProps) {
  const circleClass = done
    ? 'bg-blue-600 text-white'
    : active
    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
    : 'bg-gray-200 text-gray-500';

  const labelClass = active ? 'text-blue-700 font-semibold' : done ? 'text-blue-600' : 'text-gray-400';

  return (
    <div className="flex items-center gap-2">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${circleClass}`}>
        {done ? '✓' : number}
      </span>
      <span className={`text-sm whitespace-nowrap ${labelClass}`}>{label}</span>
    </div>
  );
}

interface Step1FormProps {
  form: RouteFormData;
  onChange: (data: RouteFormData) => void;
  companies: Company[];
  loadingCompanies: boolean;
}

function Step1Form({ form, onChange, companies, loadingCompanies }: Step1FormProps) {
  function set(field: keyof RouteFormData, value: string) {
    onChange({ ...form, [field]: value });
  }

  return (
    <div className="max-w-xl mx-auto py-8 px-6 space-y-5">
      {/* Nombre */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nombre <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Ej: Portal del Gato → Centro → Uninorte"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Código */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Código <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={form.code}
          onChange={e => set('code', e.target.value.toUpperCase())}
          placeholder="Ej: C01"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
        />
      </div>

      {/* Empresa */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
        <select
          value={form.company_id}
          onChange={e => set('company_id', e.target.value)}
          disabled={loadingCompanies}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">
            {loadingCompanies ? 'Cargando empresas…' : '— Sin empresa —'}
          </option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Horarios */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Primera salida</label>
          <input
            type="time"
            value={form.first_departure}
            onChange={e => set('first_departure', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Última salida</label>
          <input
            type="time"
            value={form.last_departure}
            onChange={e => set('last_departure', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Frecuencia */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Frecuencia (minutos)
        </label>
        <input
          type="number"
          min={1}
          max={120}
          value={form.frequency_minutes}
          onChange={e => set('frequency_minutes', e.target.value)}
          placeholder="Ej: 10"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminRoutes() {
  const [searchParams] = useSearchParams();

  // ── Route list state ────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [routesError, setRoutesError] = useState<string | null>(null);

  // ── Search & filter state ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'active' | 'inactive'>('');
  const [filterProcess, setFilterProcess] = useState<'' | 'pending' | 'done' | 'error' | 'processing'>('');
  const [filterManual, setFilterManual] = useState<'' | 'manual' | 'auto'>('');
  const [filterGeometry, setFilterGeometry] = useState<'' | 'yes' | 'no'>('');
  const [groupByCompany, setGroupByCompany] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [regenToast, setRegenToast] = useState<string | null>(null);
  const [regenLoadingId, setRegenLoadingId] = useState<number | null>(null);
  const [toggleLoadingId, setToggleLoadingId] = useState<number | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'all' | 'skip_manual'>('skip_manual');
  const [scanProgress, setScanProgress] = useState<{
    total: number;
    current: number;
    currentRoute: string;
    status: 'scanning' | 'done' | 'processing';
  } | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [pendingCount, setPendingCount] = useState(0);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<RouteFormData>(EMPTY_FORM);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // ── Step 2 — stops ──────────────────────────────────────────────────────────
  const [stops, setStops] = useState<Stop[]>([]);
  const [geocodeText, setGeocodeText] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState({ current: 0, total: 0 });
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // ── Step 2 — geometry ───────────────────────────────────────────────────────
  const [customGeometry, setCustomGeometry] = useState<[number, number][] | null>(null);
  const [isEditingGeometry, setIsEditingGeometry] = useState(false);
  const [osrmGeometry, setOsrmGeometry] = useState<[number, number][] | null>(null);
  const [geomBeforeEdit, setGeomBeforeEdit] = useState<[number, number][] | null>(null);
  // Waypoints: puntos de control que el admin arrastra (pocos, extraídos de la geometría)
  const [waypoints, setWaypoints] = useState<[number, number][] | null>(null);
  const [snapping, setSnapping] = useState(false);

  // ── Step 2 — map ────────────────────────────────────────────────────────────
  const [mapReady, setMapReady] = useState(false);
  const [locatingStop, setLocatingStop] = useState<string | null>(null);

  // ── Step 2 — save ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── AI description parser ────────────────────────────────────────────────────
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{ labels: string[]; failed: string[] } | null>(null);
  const [aiDiff, setAiDiff] = useState<{
    newWaypoints: [number, number][];   // anchor points from Claude/Overpass
    newGeometry: [number, number][];    // full OSRM road-following geometry
    newStops: Stop[];
    labels: string[];
    failed: string[];
    // Spatial diff segments: consecutive points classified as same/changed vs existing geometry
    segments: { type: 'same' | 'changed'; points: [number, number][] }[];
    changedSegments: number;
    sameSegments: number;
  } | null>(null);

  // ── Map refs ────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  const locatingStopRef = useRef<string | null>(null);
  const geomMarkersRef = useRef<L.Marker[]>([]);
  const geomPolylineRef = useRef<L.Polyline | null>(null);
  const isEditingGeometryRef = useRef(false);
  const waypointsRef = useRef<[number, number][] | null>(null);
  const refTrackLayersRef = useRef<L.Polyline[]>([]); // tracks de referencia GPS de reportantes
  const diffLayersRef = useRef<(L.Polyline | L.CircleMarker)[]>([]); // diff comparison overlay
  const autoOpenHandledRef = useRef(false); // evita re-abrir al recargar rutas
  const [refTracks, setRefTracks] = useState<{ user_name: string; geometry: [number, number][] }[]>([]);
  const [showRefTracks, setShowRefTracks] = useState(true);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Sync refs with state
  useEffect(() => {
    locatingStopRef.current = locatingStop;
  }, [locatingStop]);

  useEffect(() => {
    isEditingGeometryRef.current = isEditingGeometry;
  }, [isEditingGeometry]);

  // ── Load routes ────────────────────────────────────────────────────────────

  const loadPendingCount = useCallback(async () => {
    try {
      const res = await routesApi.getPendingCount();
      setPendingCount((res.data as { pending: number }).pending);
    } catch {
      // silencioso
    }
  }, []);

  const loadRoutes = useCallback(async () => {
    setLoadingRoutes(true);
    setRoutesError(null);
    try {
      const res = await routesApi.list();
      setRoutes(res.data.routes as Route[]);
    } catch {
      setRoutesError('Error al cargar las rutas. Intenta de nuevo.');
    } finally {
      setLoadingRoutes(false);
    }
  }, []);

  useEffect(() => {
    loadRoutes();
    loadPendingCount();
  }, [loadRoutes, loadPendingCount]);

  // ── Auto-abrir ruta en editor si viene desde AlertaRoutes ─────────────────
  useEffect(() => {
    const editRouteId = searchParams.get('editRoute');
    if (!editRouteId || routes.length === 0 || autoOpenHandledRef.current) return;

    const target = routes.find(r => r.id === Number(editRouteId));
    if (!target) return;

    autoOpenHandledRef.current = true; // solo una vez aunque routes recargue

    // Cargar tracks de referencia del sessionStorage
    try {
      const stored = sessionStorage.getItem('admin_route_ref_tracks');
      if (stored) {
        const data = JSON.parse(stored) as { routeId: number; tracks: { user_name: string; geometry: [number, number][] }[] };
        if (data.routeId === target.id && data.tracks?.length > 0) {
          setRefTracks(data.tracks);
          setShowRefTracks(true);
        }
      }
    } catch { /* ignorar */ }

    openEditModal(target, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, searchParams]);

  // ── Load companies when modal opens ────────────────────────────────────────

  useEffect(() => {
    if (!modalOpen) return;
    setLoadingCompanies(true);
    adminApi
      .getCompanies(true)
      .then(res => setCompanies(res.data.companies as Company[]))
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCompanies(false));
  }, [modalOpen]);

  // ── Modal helpers ──────────────────────────────────────────────────────────

  function openModal() {
    setEditingRoute(null);
    setForm(EMPTY_FORM);
    setStep(1);
    setStops([]);
    setGeocodeText('');
    setSaveError(null);
    setCustomGeometry(null);
    setOsrmGeometry(null);
    setIsEditingGeometry(false);
    setGeomBeforeEdit(null);
    setModalOpen(true);
  }

  async function openEditModal(route: Route, autoStartGeomEdit = false) {
    setEditingRoute(route);
    setForm({
      name: route.name,
      code: route.code,
      company_id: route.company_id ? String(route.company_id) : '',
      first_departure: route.first_departure ?? '',
      last_departure: route.last_departure ?? '',
      frequency_minutes: route.frequency_minutes != null ? String(route.frequency_minutes) : '',
    });
    setStep(1);
    setStops([]);
    setGeocodeText('');
    setSaveError(null);
    setIsEditingGeometry(false);
    setGeomBeforeEdit(null);

    // Load existing geometry from backend
    let geom: [number, number][] | null = null;
    try {
      const res = await routesApi.getById(route.id);
      const fullRoute = res.data.route as { geometry?: [number, number][] | null };
      geom = fullRoute.geometry && fullRoute.geometry.length >= 2 ? fullRoute.geometry : null;
      setOsrmGeometry(geom);
      setCustomGeometry(geom);
    } catch {
      setOsrmGeometry(null);
      setCustomGeometry(null);
    }

    setModalOpen(true);

    // Si viene desde Alertas con tracks de referencia, abrir editor directamente
    if (autoStartGeomEdit) {
      const wpts = geom ? extractWaypoints(geom) : [];
      setGeomBeforeEdit(geom);
      setWaypoints(wpts);
      waypointsRef.current = wpts;
      setIsEditingGeometry(true);
      // Navegar directamente al paso 2 (geometría)
      setStep(2);
    }
  }

  function closeModal() {
    setModalOpen(false);
    setEditingRoute(null);
    setForm(EMPTY_FORM);
    setStep(1);
    setStops([]);
    setGeocodeText('');
    setSaveError(null);
    setLocatingStop(null);
    setCustomGeometry(null);
    setOsrmGeometry(null);
    setIsEditingGeometry(false);
    setGeomBeforeEdit(null);
    setRefTracks([]);
    setAiDiff(null);
    setAiResult(null);
    sessionStorage.removeItem('admin_route_ref_tracks');
  }

  const canNext = form.name.trim() !== '' && form.code.trim() !== '';

  async function goToStep2() {
    if (editingRoute) {
      try {
        const res = await stopsApi.listByRoute(editingRoute.id);
        const loaded = (res.data.stops as BackendStop[]).map(s => ({
          id: crypto.randomUUID(),
          name: s.name,
          lat: parseFloat(String(s.latitude)),
          lng: parseFloat(String(s.longitude)),
        }));
        setStops(loaded);
      } catch {
        setStops([]);
      }
    }
    setStep(2);
  }

  // ── AI description parser ────────────────────────────────────────────────────

  // Haversine distance in meters between two lat/lng points
  function haversineM(a: [number, number], b: [number, number]): number {
    const R = 6371000;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLng = (b[1] - a[1]) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  // Spatial diff: classify each point in newGeom as 'same' or 'changed' vs existingGeom
  // Returns consecutive segments grouped by type
  function computeSpatialDiff(
    newGeom: [number, number][],
    existingGeom: [number, number][],
    thresholdM = 200
  ): { type: 'same' | 'changed'; points: [number, number][] }[] {
    if (!existingGeom.length) return [{ type: 'changed', points: newGeom }];

    // Classify each point in the new geometry
    const types = newGeom.map(np => {
      const minDist = existingGeom.reduce((min, ep) => Math.min(min, haversineM(np, ep)), Infinity);
      return minDist <= thresholdM ? 'same' : 'changed';
    });

    // Group consecutive points into segments, overlapping by 1 point for visual continuity
    const segments: { type: 'same' | 'changed'; points: [number, number][] }[] = [];
    let curType = types[0] as 'same' | 'changed';
    let curPts: [number, number][] = [newGeom[0]];

    for (let i = 1; i < newGeom.length; i++) {
      if (types[i] === curType) {
        curPts.push(newGeom[i]);
      } else {
        segments.push({ type: curType, points: curPts });
        curType = types[i] as 'same' | 'changed';
        curPts = [newGeom[i - 1], newGeom[i]]; // overlap 1 point so segments connect
      }
    }
    segments.push({ type: curType, points: curPts });
    return segments;
  }

  async function handleParseWithAI() {
    if (!geocodeText.trim()) return;
    setAiParsing(true);
    setAiResult(null);
    setAiDiff(null);
    try {
      // Step 1: Claude extracts 5-8 key anchor points, Overpass geocodes them (~3s)
      const res = await routesApi.parseDescription(geocodeText);
      const { waypoints: anchorWps, labels, failed } = res.data as {
        waypoints: [number, number][];
        labels: string[];
        failed: string[];
      };

      // Step 2: OSRM generates full road-following geometry from anchor points
      let fullGeometry: [number, number][] = anchorWps;
      try {
        const snapRes = await routesApi.snapWaypoints(anchorWps);
        fullGeometry = snapRes.data.geometry as [number, number][];
      } catch { /* use raw anchor points if OSRM unavailable */ }

      const newStops: Stop[] = anchorWps.map((wp, i) => ({
        id: crypto.randomUUID(),
        name: labels[i] ?? `Punto ${i + 1}`,
        lat: wp[0],
        lng: wp[1],
      }));

      setAiResult({ labels, failed });

      const existingGeom = customGeometry ?? osrmGeometry;
      if (editingRoute && existingGeom && existingGeom.length >= 2) {
        // Step 3: Spatial diff — compare new OSRM geometry vs existing geometry point by point
        const segments = computeSpatialDiff(fullGeometry, existingGeom, 200);
        const changedSegments = segments.filter(s => s.type === 'changed').length;
        const sameSegments = segments.filter(s => s.type === 'same').length;
        setAiDiff({ newWaypoints: anchorWps, newGeometry: fullGeometry, newStops, labels, failed, segments, changedSegments, sameSegments });
      } else {
        // No existing geometry — apply immediately
        setStops(newStops);
        setCustomGeometry(fullGeometry);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al interpretar con IA';
      window.alert(msg);
    } finally {
      setAiParsing(false);
    }
  }

  function applyAiDiff() {
    if (!aiDiff) return;
    setStops(aiDiff.newStops);
    setCustomGeometry(aiDiff.newGeometry);
    setAiDiff(null);
  }

  function discardAiDiff() {
    setAiDiff(null);
    setAiResult(null);
  }

  // ── Geocoder (UNTOUCHED) ────────────────────────────────────────────────────

  async function handleGeocode() {
    const names = geocodeText
      .split(/–|-/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (names.length === 0) return;

    setGeocoding(true);
    setGeocodingProgress({ current: 0, total: names.length });

    const newStops: Stop[] = [];

    for (let i = 0; i < names.length; i++) {
      setGeocodingProgress({ current: i + 1, total: names.length });
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(names[i])}, Barranquilla, Colombia&format=json&limit=1`
        );
        const data = await res.json() as Array<{ lat: string; lon: string }>;
        if (data.length > 0) {
          newStops.push({
            id: crypto.randomUUID(),
            name: names[i],
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
          });
        } else {
          newStops.push({ id: crypto.randomUUID(), name: names[i], lat: null, lng: null });
        }
      } catch {
        newStops.push({ id: crypto.randomUUID(), name: names[i], lat: null, lng: null });
      }
      if (i < names.length - 1) {
        await sleep(1100);
      }
    }

    setStops(prev => [...prev, ...newStops]);
    setGeocoding(false);
  }

  // ── Drag and drop (UNTOUCHED) ───────────────────────────────────────────────

  function handleDragStart(index: number) {
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent<HTMLLIElement>) {
    e.preventDefault();
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const reordered = [...stops];
    const [dragged] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, dragged);
    setStops(reordered);
    setDragIndex(null);
  }

  function removeStop(id: string) {
    setStops(prev => prev.filter(s => s.id !== id));
  }

  // ── Waypoint helpers ───────────────────────────────────────────────────────

  function extractWaypoints(geometry: [number, number][], targetCount = 12): [number, number][] {
    if (geometry.length <= targetCount) return [...geometry];
    const result: [number, number][] = [];
    const step = (geometry.length - 1) / (targetCount - 1);
    for (let i = 0; i < targetCount; i++) {
      result.push(geometry[Math.round(i * step)]);
    }
    return result;
  }

  const snapAndUpdate = useCallback(async (wpts: [number, number][]) => {
    setSnapping(true);
    try {
      const res = await routesApi.snapWaypoints(wpts);
      setCustomGeometry(res.data.geometry as [number, number][]);
    } catch {
      // Fallback: usar los waypoints directamente si OSRM falla
      setCustomGeometry(wpts);
    } finally {
      setSnapping(false);
    }
  }, []);

  // ── Map initialization ─────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 2) {
      setMapReady(false);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    const timer = setTimeout(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [10.9685, -74.7813],
        zoom: 13,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      map.on('click', (e: L.LeafletMouseEvent) => {
        // Locate mode takes priority
        if (locatingStopRef.current !== null) {
          setStops(prev =>
            prev.map(s =>
              s.id === locatingStopRef.current
                ? { ...s, lat: e.latlng.lat, lng: e.latlng.lng }
                : s
            )
          );
          setLocatingStop(null);
        } else if (isEditingGeometryRef.current) {
          // Geometry edit mode — add waypoint and snap to roads
          const newWpt: [number, number] = [e.latlng.lat, e.latlng.lng];
          const newWaypoints = [...(waypointsRef.current ?? []), newWpt];
          setWaypoints(newWaypoints);
          waypointsRef.current = newWaypoints;
          snapAndUpdate(newWaypoints);
        } else {
          // Default — add stop
          setStops(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: `Parada ${prev.length + 1}`,
              lat: e.latlng.lat,
              lng: e.latlng.lng,
            },
          ]);
        }
      });

      mapRef.current = map;
      setMapReady(true);
    }, 50);

    return () => {
      clearTimeout(timer);
      setMapReady(false);
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      geomMarkersRef.current.forEach(m => m.remove());
      geomMarkersRef.current = [];
      if (geomPolylineRef.current) {
        geomPolylineRef.current.remove();
        geomPolylineRef.current = null;
      }
      diffLayersRef.current.forEach(l => l.remove());
      diffLayersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map cursor ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = locatingStop
      ? 'crosshair'
      : isEditingGeometry
      ? 'cell'
      : '';
  }, [locatingStop, isEditingGeometry]);

  // ── ESC cancels locate mode ────────────────────────────────────────────────

  useEffect(() => {
    if (!locatingStop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLocatingStop(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locatingStop]);

  // ── Render stops on map ────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous stop markers and polyline
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    // Hide stop markers in geometry edit mode
    if (isEditingGeometry) return;

    type ValidStop = Stop & { order: number; lat: number; lng: number };
    const validStops = stops
      .map((s, i) => ({ ...s, order: i }))
      .filter((s): s is ValidStop => s.lat !== null && s.lng !== null);

    const total = validStops.length;

    validStops.forEach((stop, vi) => {
      const isFirst = vi === 0;
      const isLast = vi === total - 1 && total > 1;
      const bg = isFirst ? '#16a34a' : isLast ? '#dc2626' : '#2563eb';

      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bg};color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.4);">${stop.order + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([stop.lat, stop.lng], { icon, draggable: true });

      marker.on('dragend', () => {
        const { lat, lng } = marker.getLatLng();
        setStops(prev => prev.map(s => s.id === stop.id ? { ...s, lat, lng } : s));
      });

      marker.bindPopup(`
        <div style="min-width:150px;font-family:sans-serif">
          <strong style="display:block;margin-bottom:6px;font-size:13px">${stop.name}</strong>
          <button data-stopid="${stop.id}" style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;width:100%">Eliminar</button>
        </div>
      `);

      marker.on('popupopen', (e: L.PopupEvent) => {
        const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>(`[data-stopid="${stop.id}"]`);
        if (btn) {
          btn.addEventListener('click', () => {
            setStops(prev => prev.filter(s => s.id !== stop.id));
            map.closePopup();
          }, { once: true });
        }
      });

      marker.addTo(map);
      markersRef.current.push(marker);
    });

    if (total > 1) {
      const coords = validStops.map(s => [s.lat, s.lng] as L.LatLngTuple);
      polylineRef.current = L.polyline(coords, {
        color: '#3B82F6',
        weight: 4,
        opacity: 0.8,
      }).addTo(map);
    }
  }, [stops, mapReady, isEditingGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render reference tracks (GPS reportado por usuarios) ──────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Limpiar tracks anteriores
    refTrackLayersRef.current.forEach(l => l.remove());
    refTrackLayersRef.current = [];

    if (!isEditingGeometry || !showRefTracks) return;

    const COLORS = ['#F97316', '#FB923C', '#EA580C', '#C2410C', '#FED7AA'];
    refTracks.forEach((track, idx) => {
      if (!track.geometry || track.geometry.length < 2) return;
      const latlngs = track.geometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
      const color = COLORS[idx % COLORS.length];
      const layer = L.polyline(latlngs, { color, weight: 4, opacity: 0.75, dashArray: '8,5' })
        .bindTooltip(`Track GPS: ${track.user_name}`, { sticky: true, direction: 'top' })
        .addTo(map);
      refTrackLayersRef.current.push(layer);
    });
  }, [isEditingGeometry, mapReady, refTracks, showRefTracks]);

  // ── Render AI diff overlay ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    diffLayersRef.current.forEach(l => l.remove());
    diffLayersRef.current = [];

    if (!map || !mapReady || !aiDiff) return;

    const existingGeom = customGeometry ?? osrmGeometry;

    // 1. Existing route: thin gray dashed — shows what's being replaced
    if (existingGeom && existingGeom.length >= 2) {
      const layer = L.polyline(
        existingGeom.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
        { color: '#94A3B8', weight: 3, opacity: 0.6, dashArray: '8,5' }
      ).bindTooltip('Trazado actual (guardado)', { sticky: true }).addTo(map);
      diffLayersRef.current.push(layer);
    }

    // 2. New geometry colored by segment:
    //    blue  = follows same streets as before (unchanged)
    //    green = new/different streets
    aiDiff.segments.forEach(seg => {
      if (seg.points.length < 2) return;
      const color = seg.type === 'same' ? '#3B82F6' : '#22C55E';
      const tooltip = seg.type === 'same' ? 'Sin cambios' : '¡Tramo nuevo!';
      const layer = L.polyline(
        seg.points.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
        { color, weight: 5, opacity: 0.95 }
      ).bindTooltip(tooltip, { sticky: true }).addTo(map);
      diffLayersRef.current.push(layer);
    });

    // 3. Anchor points from Claude (the 5-8 key turning points)
    aiDiff.newWaypoints.forEach((wp, i) => {
      const circle = L.circleMarker([wp[0], wp[1]], {
        radius: 6, color: 'white', weight: 2,
        fillColor: '#F59E0B', fillOpacity: 1,
      }).bindTooltip(`${i + 1}. ${aiDiff.labels[i] ?? ''}`, { sticky: true }).addTo(map);
      diffLayersRef.current.push(circle);
    });

    // Fit map to full new geometry
    if (aiDiff.newGeometry.length >= 2) {
      const bounds = L.latLngBounds(aiDiff.newGeometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [aiDiff, mapReady, customGeometry, osrmGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render geometry on map ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clear previous geometry markers and polyline
    geomMarkersRef.current.forEach(m => m.remove());
    geomMarkersRef.current = [];
    if (geomPolylineRef.current) {
      geomPolylineRef.current.remove();
      geomPolylineRef.current = null;
    }

    if (isEditingGeometry && waypoints && waypoints.length >= 1) {
      // Draggable orange waypoint markers — drag to snap to roads, click to delete
      waypoints.forEach(([lat, lng], idx) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#F59E0B;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.5);cursor:grab;display:flex;align-items:center;justify-content:center;">
            <span style="color:white;font-size:9px;font-weight:bold;line-height:1;">${idx + 1}</span>
          </div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        const marker = L.marker([lat, lng], { icon, draggable: true });

        marker.on('dragend', () => {
          const { lat: newLat, lng: newLng } = marker.getLatLng();
          const newWaypoints = [...(waypointsRef.current ?? [])] as [number, number][];
          newWaypoints[idx] = [newLat, newLng];
          setWaypoints(newWaypoints);
          waypointsRef.current = newWaypoints;
          snapAndUpdate(newWaypoints);
        });

        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          const current = waypointsRef.current ?? [];
          if (current.length <= 2) return;
          const newWaypoints = current.filter((_, i) => i !== idx) as [number, number][];
          setWaypoints(newWaypoints);
          waypointsRef.current = newWaypoints;
          snapAndUpdate(newWaypoints);
        });

        marker.addTo(map);
        geomMarkersRef.current.push(marker);
      });

      // Blue polyline (OSRM-snapped, many points) while editing
      if (customGeometry && customGeometry.length >= 2) {
        geomPolylineRef.current = L.polyline(
          customGeometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
          { color: '#3B82F6', weight: 3, opacity: 0.9 }
        ).addTo(map);
      }
    } else if (!isEditingGeometry && customGeometry && customGeometry.length >= 2) {
      // Green polyline when saved / not editing
      geomPolylineRef.current = L.polyline(
        customGeometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
        { color: '#10B981', weight: 4, opacity: 0.8 }
      ).addTo(map);
    }
  }, [isEditingGeometry, customGeometry, waypoints, mapReady, snapAndUpdate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save route (create or edit) ────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    type ValidStop = Stop & { lat: number; lng: number };
    const validStops = stops.filter((s): s is ValidStop => s.lat !== null && s.lng !== null);

    try {
      const payload: {
        name: string;
        code: string;
        company_id?: number;
        first_departure?: string;
        last_departure?: string;
        frequency_minutes?: number;
        geometry?: [number, number][] | null;
      } = {
        name: form.name,
        code: form.code,
        company_id: form.company_id ? parseInt(form.company_id) : undefined,
        first_departure: form.first_departure || undefined,
        last_departure: form.last_departure || undefined,
        frequency_minutes: form.frequency_minutes ? parseInt(form.frequency_minutes) : undefined,
      };

      if (customGeometry !== null) {
        payload.geometry = customGeometry;
      }

      let routeId: number;

      if (editingRoute) {
        await routesApi.update(editingRoute.id, payload);
        routeId = editingRoute.id;
        await stopsApi.deleteByRoute(routeId);
      } else {
        const res = await routesApi.create(payload);
        routeId = (res.data.route as Route).id;
      }

      for (let i = 0; i < validStops.length; i++) {
        await stopsApi.add({
          route_id: routeId,
          name: validStops[i].name,
          latitude: validStops[i].lat,
          longitude: validStops[i].lng,
          stop_order: i + 1,
        });
      }

      closeModal();
      await loadRoutes();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar la ruta';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Delete route ────────────────────────────────────────────────────────────

  async function handleDeleteRoute(routeId: number) {
    if (!window.confirm('¿Eliminar esta ruta y todas sus paradas? Esta acción no se puede deshacer.')) return;
    try {
      await stopsApi.deleteByRoute(routeId);
      await routesApi.delete(routeId);
      await loadRoutes();
    } catch {
      window.alert('Error al eliminar la ruta. Intenta de nuevo.');
    }
  }

  // ── Toggle route active state ──────────────────────────────────────────────

  async function handleToggleActive(routeId: number) {
    setToggleLoadingId(routeId);
    try {
      await routesApi.toggleActive(routeId);
      await loadRoutes();
    } catch {
      window.alert('Error al cambiar el estado de la ruta.');
    } finally {
      setToggleLoadingId(null);
    }
  }

  // ── Scan blog ──────────────────────────────────────────────────────────────

  async function handleScanBlog() {
    setScanLoading(true);
    setScanResult(null);
    setScanProgress(null);
    setProgressLabel('Escaneando blog');

    const socket = getSocket();
    socket.on('scan:progress', (data: {
      total: number;
      current: number;
      currentRoute: string;
      status: 'scanning' | 'done';
      result?: { new: number; updated: number; unchanged: number; skipped: number; errors: number };
    }) => {
      if (data.status === 'done') {
        setScanProgress(null);
        const r = data.result!;
        const skippedMsg = r.skipped > 0 ? `, ${r.skipped} omitidas (editadas)` : '';
        setScanResult(
          `✅ Escaneo: ${r.new} nuevas, ${r.updated} actualizadas, ` +
          `${r.unchanged} sin cambios${skippedMsg}, ${r.errors} error${r.errors !== 1 ? 'es' : ''}`
        );
      } else {
        setScanProgress({ total: data.total, current: data.current, currentRoute: data.currentRoute, status: data.status });
      }
    });

    try {
      await routesApi.scanBlog(importMode === 'skip_manual');
      await loadRoutes();
      await loadPendingCount();
    } catch {
      setScanResult('❌ Error en el escaneo');
      setScanProgress(null);
    } finally {
      socket.off('scan:progress');
      setScanLoading(false);
    }
  }

  // ── Process imports ────────────────────────────────────────────────────────

  async function handleProcessImports() {
    setScanLoading(true);
    setScanResult(null);
    setScanProgress(null);
    setProgressLabel('Procesando rutas');

    const socket = getSocket();
    socket.on('process:progress', (data: {
      total: number;
      current: number;
      currentRoute: string;
      status: 'processing' | 'done';
      result?: { processed: number; errors: number };
      completedRoute?: { id: number; name: string; status: string; is_active: boolean };
    }) => {
      if (data.status === 'done') {
        setScanProgress(null);
        const r = data.result!;
        const skippedMsg = (r as any).skipped > 0 ? `, ${(r as any).skipped} omitidas (editadas)` : '';
        setScanResult(
          `✅ Procesamiento: ${r.processed} listas${skippedMsg}, ${r.errors} error${r.errors !== 1 ? 'es' : ''}`
        );
      } else {
        setScanProgress({ total: data.total, current: data.current, currentRoute: data.currentRoute, status: data.status });
        if (data.completedRoute) {
          const cr = data.completedRoute;
          setRoutes(prev => {
            const exists = prev.find(r => r.id === cr.id);
            if (exists) return prev.map(r => r.id === cr.id ? { ...r, ...cr } : r);
            return [...prev, cr as Route];
          });
        }
      }
    });

    try {
      await routesApi.processImports(importMode === 'skip_manual');
      await loadRoutes();
      await loadPendingCount();
    } catch {
      setScanResult('❌ Error en el procesamiento');
      setScanProgress(null);
    } finally {
      socket.off('process:progress');
      setScanLoading(false);
    }
  }

  // ── Regenerate geometry ────────────────────────────────────────────────────

  async function handleRegenGeometry(routeId: number) {
    setRegenLoadingId(routeId);
    try {
      const res = await routesApi.regenerateGeometry(routeId);
      const { pointsCount, hadFallbacks } = res.data as { pointsCount: number; hadFallbacks: boolean };
      setRegenToast(
        hadFallbacks
          ? `Trazado regenerado (${pointsCount} pts, con tramos rectos)`
          : `Trazado regenerado (${pointsCount} pts)`
      );
    } catch {
      setRegenToast('Error al regenerar el trazado');
    } finally {
      setRegenLoadingId(null);
      setTimeout(() => setRegenToast(null), 4000);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── RouteRow inner component ────────────────────────────────────────────────
  function RouteRow({ route, showCompany = false }: { route: Route; showCompany?: boolean }) {
    return (
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3 font-mono font-semibold text-blue-700">{route.code}</td>
        <td className="px-4 py-3 text-gray-900">
          <span className="flex items-center gap-1.5">
            {route.name}
            {route.manually_edited_at && (
              <span
                title={`Editada manualmente el ${new Date(route.manually_edited_at).toLocaleDateString('es-CO')}`}
                className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
              >
                ✏️ manual
              </span>
            )}
          </span>
        </td>
        {showCompany && (
          <td className="px-4 py-3 text-gray-500">{route.company_name ?? route.company ?? '—'}</td>
        )}
        <td className="px-4 py-3 text-gray-500">
          {route.frequency_minutes != null ? `${route.frequency_minutes} min` : '—'}
        </td>
        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
          {route.first_departure && route.last_departure ? `${route.first_departure} – ${route.last_departure}` : '—'}
        </td>
        <td className="px-4 py-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${route.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {route.is_active ? 'Activa' : 'Inactiva'}
          </span>
        </td>
        <td className="px-4 py-3">
          {route.status === 'pending' && <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Pendiente</span>}
          {route.status === 'processing' && <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Procesando</span>}
          {route.status === 'done' && <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Lista</span>}
          {route.status === 'error' && <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Error</span>}
        </td>
        <td className="px-4 py-3">
          <div className="relative" ref={openDropdownId === route.id ? dropdownRef : null}>
            <button
              onClick={() => setOpenDropdownId(openDropdownId === route.id ? null : route.id)}
              className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 px-2 py-1 rounded text-base font-bold transition-colors"
              title="Acciones"
            >
              ⋮
            </button>
            {openDropdownId === route.id && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                <button onClick={() => { openEditModal(route); setOpenDropdownId(null); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg transition-colors">
                  ✏️ Editar
                </button>
                <button onClick={() => { handleToggleActive(route.id); setOpenDropdownId(null); }} disabled={toggleLoadingId === route.id} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {route.is_active ? '🔴 Desactivar' : '🟢 Activar'}
                </button>
                <button onClick={() => { handleRegenGeometry(route.id); setOpenDropdownId(null); }} disabled={regenLoadingId === route.id} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {regenLoadingId === route.id ? '⏳ Regenerando…' : '🔄 Regenerar geometría'}
                </button>
                <hr className="border-gray-100" />
                <button onClick={() => { handleDeleteRoute(route.id); setOpenDropdownId(null); }} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg transition-colors">
                  🗑️ Eliminar
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  }

  // ── Derived: filtered routes ────────────────────────────────────────────────
  const filteredRoutes = routes.filter(r => {
    const q = search.toLowerCase();
    if (q && !r.name.toLowerCase().includes(q) && !r.code.toLowerCase().includes(q) && !(r.company_name ?? r.company ?? '').toLowerCase().includes(q)) return false;
    if (filterCompany && (r.company_name ?? r.company ?? '') !== filterCompany) return false;
    if (filterStatus === 'active' && !r.is_active) return false;
    if (filterStatus === 'inactive' && r.is_active) return false;
    if (filterProcess && r.status !== filterProcess) return false;
    if (filterManual === 'manual' && !r.manually_edited_at) return false;
    if (filterManual === 'auto' && r.manually_edited_at) return false;
    return true;
  });

  const uniqueCompanies = Array.from(new Set(routes.map(r => r.company_name ?? r.company ?? '—'))).sort();

  // Group by company
  const grouped: Record<string, Route[]> = {};
  for (const r of filteredRoutes) {
    const key = r.company_name ?? r.company ?? '—';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
  const groupKeys = Object.keys(grouped).sort();

  const activeFiltersCount = [filterCompany, filterStatus, filterProcess, filterManual, filterGeometry].filter(Boolean).length;

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function clearFilters() {
    setSearch('');
    setFilterCompany('');
    setFilterStatus('');
    setFilterProcess('');
    setFilterManual('');
    setFilterGeometry('');
  }

  return (
    <div className="p-6">
      {/* Regenerate toast */}
      {regenToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          {regenToast}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Rutas</h1>
        <div className="flex items-center gap-2">
          {/* Import mode selector */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium">
            <button
              onClick={() => setImportMode('skip_manual')}
              className={`px-2.5 py-1.5 rounded-md transition-colors ${
                importMode === 'skip_manual'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="No sobreescribir rutas editadas manualmente"
            >
              🔒 Solo nuevas
            </button>
            <button
              onClick={() => setImportMode('all')}
              className={`px-2.5 py-1.5 rounded-md transition-colors ${
                importMode === 'all'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              title="Actualizar todas las rutas, incluyendo las editadas manualmente"
            >
              🔄 Todas
            </button>
          </div>
          <button
            onClick={handleScanBlog}
            disabled={scanLoading}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            🔍 Escanear blog
          </button>
          {pendingCount > 0 && (
            <button
              onClick={handleProcessImports}
              disabled={scanLoading}
              className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            >
              ⚙️ Procesar rutas ({pendingCount} pendientes)
            </button>
          )}
          <button
            onClick={openModal}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
          >
            <span className="text-base font-bold">+</span>
            Nueva Ruta
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {scanProgress && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span className="font-medium">{progressLabel} ({scanProgress.current}/{scanProgress.total})</span>
            <span>{scanProgress.total > 0 ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 mb-1.5">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 truncate">{scanProgress.currentRoute}</p>
        </div>
      )}

      {/* Scan result message */}
      {scanResult && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium ${
          scanResult.startsWith('✅')
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {scanResult}
        </div>
      )}

      {/* ── Search & filters ──────────────────────────────────────────────── */}
      {!loadingRoutes && !routesError && routes.length > 0 && (
        <div className="mb-4 space-y-2">
          {/* Quick search + toggle row */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, código o empresa…"
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
              )}
            </div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${showAdvanced ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              ⚙️ Filtros
              {activeFiltersCount > 0 && (
                <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">{activeFiltersCount}</span>
              )}
            </button>
            <button
              onClick={() => setGroupByCompany(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${groupByCompany ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              title="Agrupar por empresa"
            >
              🏢 Agrupar
            </button>
          </div>

          {/* Advanced filters panel */}
          {showAdvanced && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Empresa</label>
                  <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Todas</option>
                    {uniqueCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Todos</option>
                    <option value="active">🟢 Activa</option>
                    <option value="inactive">⚫ Inactiva</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Proceso</label>
                  <select value={filterProcess} onChange={e => setFilterProcess(e.target.value as typeof filterProcess)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Todos</option>
                    <option value="pending">🟡 Pendiente</option>
                    <option value="processing">🔵 Procesando</option>
                    <option value="done">✅ Lista</option>
                    <option value="error">🔴 Error</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Edición</label>
                  <select value={filterManual} onChange={e => setFilterManual(e.target.value as typeof filterManual)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Todas</option>
                    <option value="manual">✏️ Editadas manualmente</option>
                    <option value="auto">🤖 Sin edición manual</option>
                  </select>
                </div>
              </div>
              {activeFiltersCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-red-600 hover:text-red-800 font-medium">
                  ✕ Limpiar filtros
                </button>
              )}
            </div>
          )}

          {/* Results count */}
          <p className="text-xs text-gray-400">
            {filteredRoutes.length} de {routes.length} rutas
            {activeFiltersCount > 0 || search ? ' (filtradas)' : ''}
          </p>
        </div>
      )}

      {/* ── Routes table ──────────────────────────────────────────────────── */}
      {loadingRoutes ? (
        <div className="text-center py-16 text-gray-400">Cargando rutas…</div>
      ) : routesError ? (
        <div className="text-center py-16 text-red-500">{routesError}</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No hay rutas registradas. Crea la primera con el botón de arriba.
        </div>
      ) : filteredRoutes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-3xl mb-2">🔍</p>
          <p className="font-medium">Sin resultados</p>
          <p className="text-sm mt-1">Prueba con otros términos o limpia los filtros.</p>
        </div>
      ) : groupByCompany ? (
        /* ── Grouped view ── */
        <div className="space-y-3">
          {groupKeys.map(company => {
            const isCollapsed = collapsedGroups.has(company);
            const groupRoutes = grouped[company];
            return (
              <div key={company} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(company)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <span className="flex items-center gap-2 font-semibold text-gray-700 text-sm">
                    🏢 {company}
                    <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">{groupRoutes.length}</span>
                    <span className="text-xs font-normal text-gray-400">
                      {groupRoutes.filter(r => r.is_active).length} activas
                    </span>
                  </span>
                  <span className="text-gray-400 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                {/* Group table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white border-b border-gray-100 text-gray-500 uppercase text-xs tracking-wide">
                        <tr>
                          <th className="px-4 py-2 text-left">Código</th>
                          <th className="px-4 py-2 text-left">Nombre</th>
                          <th className="px-4 py-2 text-left">Frecuencia</th>
                          <th className="px-4 py-2 text-left">Horario</th>
                          <th className="px-4 py-2 text-left">Estado</th>
                          <th className="px-4 py-2 text-left">Proceso</th>
                          <th className="px-4 py-2 text-left">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {groupRoutes.map(route => <RouteRow key={route.id} route={route} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Flat view ── */
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Código</th>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Frecuencia</th>
                <th className="px-4 py-3 text-left">Horario</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Proceso</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRoutes.map(route => <RouteRow key={route.id} route={route} showCompany />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
        >
          <div
            className="w-[95vw] h-[95vh] bg-white rounded-xl flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingRoute ? `Editar Ruta — ${editingRoute.code}` : 'Nueva Ruta'}
              </h2>
              <button
                onClick={closeModal}
                aria-label="Cerrar"
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none transition-colors"
              >
                ×
              </button>
            </div>

            {/* Stepper */}
            <div className="flex items-center px-6 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
              <StepBadge number={1} label="Datos básicos" active={step === 1} done={step > 1} />
              <div className={`flex-1 h-0.5 mx-3 rounded ${step > 1 ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <StepBadge number={2} label="Paradas en mapa" active={step === 2} done={false} />
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-hidden">
              {step === 1 ? (
                <div className="h-full overflow-y-auto">
                  <Step1Form
                    form={form}
                    onChange={setForm}
                    companies={companies}
                    loadingCompanies={loadingCompanies}
                  />
                </div>
              ) : (
                <div className="flex h-full">

                  {/* ── Left panel ──────────────────────────────────────── */}
                  <div className="w-80 bg-gray-800 flex flex-col overflow-hidden shrink-0">

                    {/* Geocoder section */}
                    <div className="p-4 border-b border-gray-700 shrink-0">
                      <label className="block text-xs font-medium text-gray-300 uppercase tracking-wide mb-1">
                        Recorrido
                      </label>
                      <textarea
                        rows={4}
                        value={geocodeText}
                        onChange={e => setGeocodeText(e.target.value)}
                        disabled={geocoding}
                        placeholder="Nevada – Granabastos – Avenida Murillo"
                        className="w-full bg-gray-700 text-gray-100 placeholder-gray-500 border border-gray-600 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <div className="mt-2 flex flex-col gap-1.5">
                        <button
                          onClick={handleParseWithAI}
                          disabled={aiParsing || geocoding || geocodeText.trim() === ''}
                          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium text-sm px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                          title="Interpreta texto libre del PDF y extrae el trazado automáticamente"
                        >
                          {aiParsing ? '✨ Interpretando…' : '✨ Interpretar con IA'}
                        </button>
                        <button
                          onClick={handleGeocode}
                          disabled={geocoding || aiParsing || geocodeText.trim() === ''}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium text-sm px-3 py-2 rounded-lg transition-colors"
                          title="Geocodifica nombres de paradas separados por guiones"
                        >
                          {geocoding
                            ? `Procesando ${geocodingProgress.current} / ${geocodingProgress.total}…`
                            : 'Geocodificar paradas'}
                        </button>
                      </div>
                      {/* AI diff comparison card */}
                      {aiDiff ? (
                        <div className="mt-3 rounded-lg border border-purple-700 bg-purple-900/30 p-3 text-xs space-y-2">
                          <p className="font-semibold text-purple-200 flex items-center gap-1.5">
                            ✨ Comparación por calles
                          </p>
                          {/* Legend */}
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-4 h-1 rounded" style={{ background: '#94A3B8' }}></span>
                              Actual
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-4 h-1.5 rounded bg-blue-500"></span>
                              Sin cambios
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="inline-block w-4 h-1.5 rounded bg-green-500"></span>
                              Tramo nuevo
                            </span>
                          </div>
                          {/* Summary */}
                          {aiDiff.changedSegments === 0 ? (
                            <p className="text-green-400">✅ El recorrido es igual al actual</p>
                          ) : (
                            <p className="text-amber-300">
                              ⚠️ {aiDiff.changedSegments} tramo{aiDiff.changedSegments > 1 ? 's' : ''} nuevo{aiDiff.changedSegments > 1 ? 's' : ''} · {aiDiff.sameSegments} sin cambios
                            </p>
                          )}
                          <p className="text-gray-400">{aiDiff.newWaypoints.length} puntos clave · ruta por calles vía OSRM</p>
                          {aiDiff.failed.length > 0 && (
                            <details className="text-amber-400 cursor-pointer">
                              <summary>⚠️ {aiDiff.failed.length} puntos sin geocodificar</summary>
                              <ul className="mt-1 pl-2 space-y-0.5 text-gray-400">
                                {aiDiff.failed.map((f, i) => <li key={i}>· {f}</li>)}
                              </ul>
                            </details>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button onClick={applyAiDiff}
                              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium text-xs px-2 py-1.5 rounded-lg transition-colors">
                              ✅ Aplicar
                            </button>
                            <button onClick={discardAiDiff}
                              className="flex-1 bg-gray-600 hover:bg-gray-500 text-gray-200 font-medium text-xs px-2 py-1.5 rounded-lg transition-colors">
                              ❌ Descartar
                            </button>
                          </div>
                        </div>
                      ) : aiResult && (
                        <div className="mt-2 text-xs space-y-1">
                          <p className="text-green-400">✅ {aiResult.labels.length} intersecciones encontradas</p>
                          {aiResult.failed.length > 0 && (
                            <details className="text-amber-400 cursor-pointer">
                              <summary>⚠️ {aiResult.failed.length} sin geocodificar</summary>
                              <ul className="mt-1 pl-2 space-y-0.5 text-gray-400">
                                {aiResult.failed.map((f, i) => <li key={i}>· {f}</li>)}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Stops list */}
                    <div className="flex-1 overflow-y-auto p-4">
                      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
                        Paradas ({stops.length})
                      </p>
                      {stops.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8 leading-relaxed">
                          Pega un recorrido arriba o haz click en el mapa
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {stops.map((stop, index) => (
                            <li
                              key={stop.id}
                              draggable
                              onDragStart={() => handleDragStart(index)}
                              onDragOver={handleDragOver}
                              onDrop={() => handleDrop(index)}
                              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 rounded-lg px-2 py-2 cursor-grab active:cursor-grabbing transition-colors"
                            >
                              <span className="text-gray-500 select-none text-base leading-none shrink-0">
                                ⠿
                              </span>
                              <span className="text-xs font-mono text-gray-400 w-5 shrink-0 text-center">
                                {index + 1}
                              </span>
                              <span className="flex-1 text-sm text-gray-100 truncate">
                                {stop.name}
                              </span>
                              {stop.lat === null ? (
                                <span className="flex items-center gap-1 shrink-0">
                                  <span className="text-xs bg-red-900/60 text-red-300 px-1.5 py-0.5 rounded whitespace-nowrap">
                                    ⚠️ Sin ubicar
                                  </span>
                                  <button
                                    onClick={() => !isEditingGeometry && setLocatingStop(stop.id)}
                                    disabled={isEditingGeometry}
                                    className="text-xs text-blue-400 hover:text-blue-300 underline whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    Ubicar
                                  </button>
                                </span>
                              ) : (
                                <span className="text-xs bg-green-900/60 text-green-300 px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap font-mono">
                                  {stop.lat.toFixed(3)}, {stop.lng!.toFixed(3)}
                                </span>
                              )}
                              <button
                                onClick={() => removeStop(stop.id)}
                                aria-label="Eliminar parada"
                                className="text-gray-500 hover:text-red-400 transition-colors shrink-0 text-sm leading-none"
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* ── Geometry section ──────────────────────────────── */}
                    <div className="p-4 border-t border-gray-700 shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                          Trazado
                        </span>
                        {customGeometry !== null && !isEditingGeometry && (
                          <span className="text-xs bg-emerald-900/60 text-emerald-300 px-2 py-0.5 rounded-full">
                            ✏️ Personalizado
                          </span>
                        )}
                      </div>

                      {isEditingGeometry ? (
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-400 mb-2 leading-tight">
                            {snapping
                              ? '⏳ Calculando ruta por calles…'
                              : `${waypoints?.length ?? 0} puntos naranjas · arrastra para seguir calles · clic en mapa para añadir · clic en punto para eliminar`
                            }
                          </p>
                          {refTracks.length > 0 && (
                            <button
                              onClick={() => setShowRefTracks(v => !v)}
                              className="w-full text-xs bg-orange-900/50 hover:bg-orange-800/60 text-orange-300 font-medium px-3 py-1.5 rounded-lg transition-colors"
                            >
                              {showRefTracks ? '🟠 Ocultar' : '🟠 Mostrar'} track{refTracks.length > 1 ? 's' : ''} GPS ({refTracks.length})
                            </button>
                          )}
                          <button
                            onClick={() => setIsEditingGeometry(false)}
                            disabled={snapping}
                            className="w-full text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium px-3 py-2 rounded-lg transition-colors"
                          >
                            ✅ Guardar trazado
                          </button>
                          <button
                            onClick={() => {
                              setCustomGeometry(osrmGeometry);
                              const wpts = osrmGeometry ? extractWaypoints(osrmGeometry) : [];
                              setWaypoints(wpts);
                              waypointsRef.current = wpts;
                            }}
                            disabled={snapping}
                            className="w-full text-xs bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-gray-200 font-medium px-3 py-2 rounded-lg transition-colors"
                          >
                            🔄 Resetear a OSRM
                          </button>
                          <button
                            onClick={() => {
                              setCustomGeometry(geomBeforeEdit);
                              setIsEditingGeometry(false);
                              setWaypoints(null);
                              waypointsRef.current = null;
                            }}
                            className="w-full text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 font-medium px-3 py-2 rounded-lg transition-colors"
                          >
                            ❌ Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setGeomBeforeEdit(customGeometry);
                            const wpts = customGeometry ? extractWaypoints(customGeometry) : [];
                            setWaypoints(wpts);
                            waypointsRef.current = wpts;
                            setIsEditingGeometry(true);
                          }}
                          className="w-full text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium px-3 py-2 rounded-lg transition-colors"
                        >
                          ✏️ Editar trazado por calles
                        </button>
                      )}
                    </div>

                    {/* Save error */}
                    {saveError && (
                      <div className="mx-4 mb-2 px-3 py-2 bg-red-900/60 text-red-300 text-xs rounded-lg">
                        {saveError}
                      </div>
                    )}

                    {/* Bottom buttons */}
                    <div className="p-4 border-t border-gray-700 flex gap-2 shrink-0">
                      <button
                        onClick={() => setStep(1)}
                        disabled={saving}
                        className="flex-1 px-3 py-2 text-gray-300 hover:text-white font-medium text-sm border border-gray-600 hover:border-gray-500 rounded-lg transition-colors disabled:opacity-50"
                      >
                        ← Atrás
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={stops.length === 0 || saving}
                        className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors"
                      >
                        {saving ? 'Guardando…' : 'Guardar Ruta'}
                      </button>
                    </div>
                  </div>

                  {/* ── Right panel — Leaflet map ────────────────────────── */}
                  <div className="flex-1 relative">
                    {/* Geometry edit mode banner */}
                    {isEditingGeometry && (
                      <div className="absolute top-0 left-0 right-0 bg-blue-600 text-white text-sm font-medium px-4 py-2 flex items-center justify-between" style={{ zIndex: 1000 }}>
                        <span>✏️ Modo edición de trazado — click en el mapa para añadir puntos</span>
                        <button
                          onClick={() => {
                            setCustomGeometry(geomBeforeEdit);
                            setIsEditingGeometry(false);
                          }}
                          className="ml-4 text-blue-200 hover:text-white font-bold text-base leading-none"
                        >
                          ✕ ESC
                        </button>
                      </div>
                    )}

                    {/* Locate mode banner */}
                    {locatingStop && !isEditingGeometry && (
                      <div className="absolute top-0 left-0 right-0 bg-yellow-400 text-yellow-900 text-sm font-medium px-4 py-2 flex items-center justify-between" style={{ zIndex: 1000 }}>
                        <span>
                          📍 Haz click en el mapa para ubicar:{' '}
                          <strong>{stops.find(s => s.id === locatingStop)?.name}</strong>
                        </span>
                        <button
                          onClick={() => setLocatingStop(null)}
                          className="ml-4 text-yellow-700 hover:text-yellow-900 font-bold text-base leading-none"
                        >
                          ✕ ESC
                        </button>
                      </div>
                    )}

                    <div ref={mapContainerRef} className="h-full w-full" />
                  </div>

                </div>
              )}
            </div>

            {/* Modal footer — only in step 1 */}
            {step === 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
                <div />
                <button
                  onClick={goToStep2}
                  disabled={!canNext}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
