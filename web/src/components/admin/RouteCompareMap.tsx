import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RutaData } from './RutaCard';

interface Props {
  ruta: RutaData;
  onClose: () => void;
}

export default function RouteCompareMap({ ruta, onClose }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const allLatLngs: L.LatLng[] = [];

    // Green polyline: new geometry from PDF (itinerary A)
    const newItinerary = ruta.itinerarios[0];
    if (newItinerary?.waypoints.length) {
      const newLatLngs = newItinerary.waypoints.map(w => L.latLng(w.lat, w.lon));
      L.polyline(newLatLngs, { color: '#16a34a', weight: 4, opacity: 0.85 })
        .bindTooltip('Nuevo (PDF)', { sticky: true })
        .addTo(map);
      allLatLngs.push(...newLatLngs);
    }

    // Blue polyline: current DB geometry (only for modifications)
    if (!ruta.es_nueva && ruta.dbData?.geometry?.length) {
      const dbLatLngs = ruta.dbData.geometry.map(([lat, lng]) => L.latLng(lat, lng));
      L.polyline(dbLatLngs, { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '8 4' })
        .bindTooltip('Actual (DB)', { sticky: true })
        .addTo(map);
      allLatLngs.push(...dbLatLngs);
    }

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] });
    } else {
      // Default: center on Barranquilla
      map.setView([10.96, -74.80], 12);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [ruta]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <span className="font-bold text-gray-900">{ruta.codigo}</span>
            <span className="ml-2 text-sm text-gray-500">{ruta.nombre}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
          >
            x
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 px-5 py-2 text-xs border-b bg-gray-50">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 h-1 bg-green-600 rounded" />
            Nuevo trazado (PDF)
          </span>
          {!ruta.es_nueva && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-1 bg-blue-600 rounded border-t-2 border-dashed" />
              Trazado actual (DB)
            </span>
          )}
          {ruta.es_nueva && (
            <span className="text-green-700 font-medium">Ruta nueva — no existe en DB</span>
          )}
        </div>

        {/* Map */}
        <div ref={containerRef} className="flex-1" style={{ minHeight: '400px' }} />
      </div>
    </div>
  );
}
