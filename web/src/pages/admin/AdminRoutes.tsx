import React, { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routesApi, stopsApi, adminApi } from '../../services/api';

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

  // ── Route list state ────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [routesError, setRoutesError] = useState<string | null>(null);

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<RouteFormData>(EMPTY_FORM);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // ── Step 2 — stops (geocoder untouched) ────────────────────────────────────
  const [stops, setStops] = useState<Stop[]>([]);
  const [geocodeText, setGeocodeText] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodingProgress, setGeocodingProgress] = useState({ current: 0, total: 0 });
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // ── Step 2 — map ────────────────────────────────────────────────────────────
  const [mapReady, setMapReady] = useState(false);
  const [locatingStop, setLocatingStop] = useState<string | null>(null);

  // ── Step 2 — save ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Map refs ────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);
  const locatingStopRef = useRef<string | null>(null);

  // Keep locatingStopRef current so the map click handler always has the latest value
  useEffect(() => {
    locatingStopRef.current = locatingStop;
  }, [locatingStop]);

  // ── Load routes ────────────────────────────────────────────────────────────

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
  }, [loadRoutes]);

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
    setModalOpen(true);
  }

  function openEditModal(route: Route) {
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
    setModalOpen(true);
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
  }

  const canNext = form.name.trim() !== '' && form.code.trim() !== '';

  async function goToStep2() {
    if (editingRoute) {
      try {
        const res = await stopsApi.listByRoute(editingRoute.id);
        const loaded = (res.data.stops as BackendStop[]).map(s => ({
          id: crypto.randomUUID(),
          name: s.name,
          lat: s.latitude,
          lng: s.longitude,
        }));
        setStops(loaded);
      } catch {
        setStops([]);
      }
    }
    setStep(2);
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
        if (locatingStopRef.current !== null) {
          setStops(prev =>
            prev.map(s =>
              s.id === locatingStopRef.current
                ? { ...s, lat: e.latlng.lat, lng: e.latlng.lng }
                : s
            )
          );
          setLocatingStop(null);
        } else {
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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map cursor for locate mode ─────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = locatingStop ? 'crosshair' : '';
  }, [locatingStop]);

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

    // Clear previous markers and polyline
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

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
  }, [stops, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save route (create or edit) ────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    type ValidStop = Stop & { lat: number; lng: number };
    const validStops = stops.filter((s): s is ValidStop => s.lat !== null && s.lng !== null);

    try {
      const payload = {
        name: form.name,
        code: form.code,
        company_id: form.company_id ? parseInt(form.company_id) : undefined,
        first_departure: form.first_departure || undefined,
        last_departure: form.last_departure || undefined,
        frequency_minutes: form.frequency_minutes ? parseInt(form.frequency_minutes) : undefined,
      };

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rutas</h1>
        <button
          onClick={openModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          <span className="text-base font-bold">+</span>
          Nueva Ruta
        </button>
      </div>

      {/* Routes table */}
      {loadingRoutes ? (
        <div className="text-center py-16 text-gray-400">Cargando rutas…</div>
      ) : routesError ? (
        <div className="text-center py-16 text-red-500">{routesError}</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No hay rutas registradas. Crea la primera con el botón de arriba.
        </div>
      ) : (
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
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {routes.map(route => (
                <tr key={route.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-semibold text-blue-700">
                    {route.code}
                  </td>
                  <td className="px-4 py-3 text-gray-900">{route.name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {route.company_name ?? route.company ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {route.frequency_minutes != null
                      ? `${route.frequency_minutes} min`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {route.first_departure && route.last_departure
                      ? `${route.first_departure} – ${route.last_departure}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        route.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {route.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(route)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteRoute(route.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={closeModal}
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
                      <button
                        onClick={handleGeocode}
                        disabled={geocoding || geocodeText.trim() === ''}
                        className="mt-2 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-medium text-sm px-3 py-2 rounded-lg transition-colors"
                      >
                        {geocoding
                          ? `Procesando ${geocodingProgress.current} / ${geocodingProgress.total}…`
                          : 'Geocodificar'}
                      </button>
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
                                    onClick={() => setLocatingStop(stop.id)}
                                    className="text-xs text-blue-400 hover:text-blue-300 underline whitespace-nowrap"
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
                    {/* Locate mode banner */}
                    {locatingStop && (
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
