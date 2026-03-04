import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routesApi, stopsApi } from '../../services/api';

interface BusRoute {
  id: number;
  name: string;
  code: string;
  color: string;
  company: string | null;
  company_name: string | null;
  is_active: boolean;
  stop_count: number;
}

interface BackendStop {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
}

export default function AdminBuses() {
  // ── List state ────────────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<BusRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // ── Import state ──────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // ── Row-action state ──────────────────────────────────────────────────────
  const [toggleLoadingId, setToggleLoadingId] = useState<number | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // ── Map modal state ───────────────────────────────────────────────────────
  const [mapRoute, setMapRoute] = useState<(BusRoute & { geometry: [number, number][] | null }) | null>(null);
  const [mapStops, setMapStops] = useState<BackendStop[]>([]);
  const [mapStopsLoading, setMapStopsLoading] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  // ── Load routes ───────────────────────────────────────────────────────────

  const loadRoutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await routesApi.getBusRoutes();
      setRoutes(res.data.routes as BusRoute[]);
    } catch {
      setError('Error al cargar las rutas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // ── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Import ────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!window.confirm(
      '¿Importar las 85 rutas de buses desde la AMBQ?\n\n' +
      'Esto puede tardar varios minutos. Las rutas existentes se actualizarán y las nuevas se crearán.'
    )) return;

    setImporting(true);
    setImportResult(null);
    try {
      const res = await routesApi.importBuses();
      const r = res.data.result as { imported: number; updated: number; errors: number; skipped: number };
      setImportResult(
        `✅ ${r.imported} nueva${r.imported !== 1 ? 's' : ''}, ` +
        `${r.updated} actualizada${r.updated !== 1 ? 's' : ''}, ` +
        `${r.skipped} omitida${r.skipped !== 1 ? 's' : ''}, ` +
        `${r.errors} error${r.errors !== 1 ? 'es' : ''}`
      );
      await loadRoutes();
    } catch {
      setImportResult('❌ Error al importar desde AMBQ');
    } finally {
      setImporting(false);
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

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

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(routeId: number) {
    if (!window.confirm('¿Eliminar esta ruta y todas sus paradas? Esta acción no se puede deshacer.')) return;
    try {
      await stopsApi.deleteByRoute(routeId);
      await routesApi.delete(routeId);
      await loadRoutes();
    } catch {
      window.alert('Error al eliminar la ruta.');
    }
  }

  // ── Open map modal ────────────────────────────────────────────────────────

  async function openMapModal(route: BusRoute) {
    setMapStops([]);
    setMapStopsLoading(true);
    try {
      const [routeRes, stopsRes] = await Promise.all([
        routesApi.getById(route.id),
        stopsApi.listByRoute(route.id),
      ]);
      const fullRoute = routeRes.data.route as { geometry: [number, number][] | null };
      setMapRoute({ ...route, geometry: fullRoute.geometry ?? null });
      setMapStops(stopsRes.data.stops as BackendStop[]);
    } catch {
      setMapRoute({ ...route, geometry: null });
    } finally {
      setMapStopsLoading(false);
    }
  }

  // ESC closes map modal
  useEffect(() => {
    if (!mapRoute) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMapRoute(null); setMapStops([]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mapRoute]);

  // Initialize Leaflet map when modal opens / closes
  useEffect(() => {
    if (!mapRoute) {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      return;
    }

    const timer = setTimeout(() => {
      if (!mapContainerRef.current || mapRef.current) return;

      const center: [number, number] =
        mapRoute.geometry && mapRoute.geometry.length > 0
          ? mapRoute.geometry[Math.floor(mapRoute.geometry.length / 2)]
          : [10.9685, -74.7813];

      const map = L.map(mapContainerRef.current, { center, zoom: 13 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      if (mapRoute.geometry && mapRoute.geometry.length >= 2) {
        const coords = mapRoute.geometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
        const pl = L.polyline(coords, {
          color: mapRoute.color || '#1d4ed8',
          weight: 5,
          opacity: 0.85,
        }).addTo(map);
        polylineRef.current = pl;
        map.fitBounds(pl.getBounds(), { padding: [40, 40] });
      }

      mapRef.current = map;
    }, 50);

    return () => {
      clearTimeout(timer);
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [mapRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render stop markers when stops arrive
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapRoute) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const total = mapStops.length;
    mapStops.forEach((stop, i) => {
      const isFirst = i === 0;
      const isLast = i === total - 1 && total > 1;
      const bg = isFirst ? '#16a34a' : isLast ? '#dc2626' : (mapRoute.color || '#1d4ed8');

      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bg};color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.4);">${i + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 22],
        popupAnchor: [0, -24],
      });

      const marker = L.marker([stop.latitude, stop.longitude], { icon });
      marker.bindPopup(`<strong style="font-size:12px;font-family:sans-serif">${stop.name}</strong>`);
      marker.addTo(map);
      markersRef.current.push(marker);
    });
  }, [mapStops, mapRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = routes.filter(r =>
    r.code.toLowerCase().includes(search.toLowerCase()) ||
    (r.company_name ?? r.company ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const byCompany = filtered.reduce<Record<string, BusRoute[]>>((acc, r) => {
    const key = r.company_name ?? r.company ?? 'Sin empresa';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const companyCount = Object.keys(
    routes.reduce<Record<string, true>>((acc, r) => {
      acc[r.company_name ?? r.company ?? 'Sin empresa'] = true;
      return acc;
    }, {})
  ).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Buses urbanos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Rutas importadas desde la AMBQ · {routes.length} rutas · {companyCount} empresas
          </p>
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          {importing ? '⏳ Importando…' : '🚌 Importar desde AMBQ'}
        </button>
      </div>

      {/* Import result */}
      {importResult && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm font-medium ${
          importResult.startsWith('✅')
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {importResult}
        </div>
      )}

      {/* Search */}
      {routes.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            placeholder="Buscar por código o empresa…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando rutas…</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No hay rutas de buses. Usa el botón "Importar desde AMBQ" para importarlas.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byCompany).sort(([a], [b]) => a.localeCompare(b)).map(([company, companyRoutes]) => (
            /* overflow-visible so the row dropdown isn't clipped */
            <div key={company} className="rounded-xl border border-gray-200">

              {/* Company header */}
              <div className="bg-gray-100 px-4 py-2 flex items-center justify-between rounded-t-xl">
                <span className="font-semibold text-gray-700 text-sm">{company}</span>
                <span className="text-xs text-gray-400">
                  {companyRoutes.length} ruta{companyRoutes.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Routes table */}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {companyRoutes.map((route, idx) => (
                    <tr
                      key={route.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        idx === companyRoutes.length - 1 ? 'last-row' : ''
                      }`}
                    >
                      {/* Color dot */}
                      <td className="px-4 py-2.5 w-8">
                        <div
                          className="w-4 h-4 rounded-full border border-gray-300"
                          style={{ backgroundColor: route.color || '#1d4ed8' }}
                        />
                      </td>

                      {/* Code */}
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-gray-800 font-medium">{route.code}</span>
                      </td>

                      {/* Stops */}
                      <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                        {route.stop_count} parada{route.stop_count !== 1 ? 's' : ''}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          route.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {route.is_active ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>

                      {/* Actions dropdown */}
                      <td className="px-4 py-2.5 text-right">
                        <div
                          className="relative inline-block"
                          ref={openDropdownId === route.id ? dropdownRef : null}
                        >
                          <button
                            onClick={() => setOpenDropdownId(openDropdownId === route.id ? null : route.id)}
                            className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 px-2 py-1 rounded text-base font-bold transition-colors"
                          >
                            ⋮
                          </button>

                          {openDropdownId === route.id && (
                            <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-xl z-[100]">
                              <button
                                onClick={() => { openMapModal(route); setOpenDropdownId(null); }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg transition-colors"
                              >
                                🗺️ Ver en mapa
                              </button>
                              <button
                                onClick={() => { handleToggleActive(route.id); setOpenDropdownId(null); }}
                                disabled={toggleLoadingId === route.id}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                              >
                                {route.is_active ? '🔴 Desactivar' : '🟢 Activar'}
                              </button>
                              <hr className="border-gray-100" />
                              <button
                                onClick={() => { handleDelete(route.id); setOpenDropdownId(null); }}
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg transition-colors"
                              >
                                🗑️ Eliminar
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── Map modal ──────────────────────────────────────────────────────── */}
      {mapRoute && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => { setMapRoute(null); setMapStops([]); }}
        >
          <div
            className="w-[92vw] h-[88vh] bg-white rounded-xl flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-4 h-4 rounded-full border border-gray-300 shrink-0"
                  style={{ backgroundColor: mapRoute.color || '#1d4ed8' }}
                />
                <h2 className="text-base font-semibold text-gray-900 truncate">{mapRoute.code}</h2>
                <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {mapRoute.company_name ?? mapRoute.company ?? ''}
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                  {mapStopsLoading ? 'Cargando paradas…' : `${mapStops.length} paradas`}
                </span>
              </div>
              <button
                onClick={() => { setMapRoute(null); setMapStops([]); }}
                aria-label="Cerrar"
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xl leading-none transition-colors shrink-0 ml-3"
              >
                ×
              </button>
            </div>

            {/* Map container */}
            <div className="flex-1 relative">
              <div ref={mapContainerRef} className="h-full w-full" />
              {!mapRoute.geometry && !mapStopsLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                  <p className="text-gray-400 text-sm">Esta ruta no tiene geometría guardada.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
