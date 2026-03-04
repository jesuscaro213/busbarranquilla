import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { routesApi, stopsApi } from '../../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransmetroRoute {
  id: number;
  name: string;
  code: string;
  type: 'transmetro' | 'alimentadora';
  color: string;
  company: string | null;
  company_name: string | null;
  is_active: boolean;
  stop_count: number;
  geometry: [number, number][] | null;
}

interface BackendStop {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  if (type === 'transmetro') {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-900 text-white whitespace-nowrap">
        Troncal
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-200 text-sky-900 whitespace-nowrap">
      Alimentadora
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminTransmetro() {
  // ── Route list state ─────────────────────────────────────────────────────
  const [routes, setRoutes] = useState<TransmetroRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Import state ─────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // ── Row-action state ─────────────────────────────────────────────────────
  const [toggleLoadingId, setToggleLoadingId] = useState<number | null>(null);
  const [regenLoadingId, setRegenLoadingId] = useState<number | null>(null);
  const [regenToast, setRegenToast] = useState<string | null>(null);

  // ── Dropdown state ───────────────────────────────────────────────────────
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // ── Map modal state ──────────────────────────────────────────────────────
  const [mapRoute, setMapRoute] = useState<TransmetroRoute | null>(null);
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
      const res = await routesApi.getTransmetroRoutes();
      setRoutes(res.data.routes as TransmetroRoute[]);
    } catch {
      setError('Error al cargar las rutas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // ── Click outside dropdown ────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Import from OSM ───────────────────────────────────────────────────────

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const res = await routesApi.importTransmetro();
      const r = res.data.result as { imported: number; updated: number; errors: number };
      setImportResult(
        `✅ ${r.imported} importada${r.imported !== 1 ? 's' : ''}, ` +
        `${r.updated} actualizada${r.updated !== 1 ? 's' : ''}, ` +
        `${r.errors} error${r.errors !== 1 ? 'es' : ''}`
      );
      await loadRoutes();
    } catch {
      setImportResult('❌ Error al importar desde OSM');
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

  // ── Regenerate geometry ───────────────────────────────────────────────────

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

  // ── Delete route ──────────────────────────────────────────────────────────

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

  // ── Map modal ─────────────────────────────────────────────────────────────

  async function openMapModal(route: TransmetroRoute) {
    setMapRoute(route);
    setMapStops([]);
    setMapStopsLoading(true);
    try {
      const res = await stopsApi.listByRoute(route.id);
      setMapStops(res.data.stops as BackendStop[]);
    } catch {
      setMapStops([]);
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
          color: mapRoute.color || '#e60000',
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
      const bg = isFirst ? '#16a34a' : isLast ? '#dc2626' : (mapRoute.color || '#e60000');

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">

      {/* Regen toast */}
      {regenToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          {regenToast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transmetro</h1>
          <p className="text-sm text-gray-500 mt-0.5">Rutas troncales y alimentadoras importadas desde OpenStreetMap</p>
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 bg-red-700 hover:bg-red-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium text-sm transition-colors"
        >
          {importing ? '⏳ Importando…' : '🚇 Importar desde OSM'}
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

      {/* Table */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando rutas…</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : routes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          No hay rutas Transmetro. Usa el botón "Importar desde OSM" para importarlas.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Color</th>
                <th className="px-4 py-3 text-left">Paradas</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {routes.map(route => (
                <tr key={route.id} className="hover:bg-gray-50 transition-colors">

                  {/* Nombre + código */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{route.name}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{route.code}</div>
                  </td>

                  {/* Tipo */}
                  <td className="px-4 py-3">
                    <TypeBadge type={route.type} />
                  </td>

                  {/* Color */}
                  <td className="px-4 py-3">
                    <div
                      className="w-5 h-5 rounded-full border border-gray-300 shadow-sm"
                      style={{ backgroundColor: route.color || '#e60000' }}
                      title={route.color || '#e60000'}
                    />
                  </td>

                  {/* Paradas */}
                  <td className="px-4 py-3 text-gray-600 tabular-nums">
                    {route.stop_count}
                  </td>

                  {/* Estado */}
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      route.is_active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {route.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>

                  {/* Acciones — dropdown */}
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
                        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                          <button
                            onClick={() => { openMapModal(route); setOpenDropdownId(null); }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg transition-colors"
                          >
                            🗺️ Ver en mapa
                          </button>
                          <button
                            onClick={() => { handleToggleActive(route.id); setOpenDropdownId(null); }}
                            disabled={toggleLoadingId === route.id}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {route.is_active ? '🔴 Desactivar' : '🟢 Activar'}
                          </button>
                          <button
                            onClick={() => { handleRegenGeometry(route.id); setOpenDropdownId(null); }}
                            disabled={regenLoadingId === route.id}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {regenLoadingId === route.id ? '⏳ Regenerando…' : '🔄 Regenerar geometría'}
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
                  style={{ backgroundColor: mapRoute.color || '#e60000' }}
                />
                <h2 className="text-base font-semibold text-gray-900 truncate">{mapRoute.name}</h2>
                <TypeBadge type={mapRoute.type} />
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
              {!mapRoute.geometry && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                  <p className="text-gray-400 text-sm">Esta ruta no tiene geometría guardada. Usa "Regenerar geometría".</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
