import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { reportsApi } from '../services/api';

// Fix Leaflet default icon (Vite asset issue)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const REPORT_ICONS: Record<string, string> = {
  bus_location: '🚌',
  traffic:      '🚗',
  bus_full:     '👥',
  no_service:   '🚫',
  detour:       '↪️',
};

interface Report {
  id: number;
  type: string;
  latitude: number;
  longitude: number;
  description: string | null;
  confirmations: number;
  created_at: string;
}

interface Props {
  onMapClick?: (lat: number, lng: number) => void;
  refreshTrigger?: number;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Centro de Barranquilla
const BARRANQUILLA_CENTER: [number, number] = [10.9685, -74.7813];

export default function MapView({ onMapClick, refreshTrigger }: Props) {
  const [reports, setReports] = useState<Report[]>([]);

  const loadReports = () => {
    reportsApi
      .getNearby(BARRANQUILLA_CENTER[0], BARRANQUILLA_CENTER[1], 10)
      .then((res) => setReports(res.data.reports))
      .catch(() => {/* sin sesión activa, ignorar */});
  };

  useEffect(() => {
    loadReports();
  }, [refreshTrigger]);

  return (
    <MapContainer
      center={BARRANQUILLA_CENTER}
      zoom={13}
      className="h-full w-full rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ClickHandler onMapClick={onMapClick} />

      {reports.map((report) => {
        const icon = L.divIcon({
          html: `<div class="text-2xl drop-shadow">${REPORT_ICONS[report.type] ?? '📍'}</div>`,
          className: '',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        });

        return (
          <Marker
            key={report.id}
            position={[report.latitude, report.longitude]}
            icon={icon}
          >
            <Popup>
              <div className="text-sm space-y-1">
                <p className="font-semibold">
                  {REPORT_ICONS[report.type]} {report.type.replace('_', ' ')}
                </p>
                {report.description && (
                  <p className="text-gray-600">{report.description}</p>
                )}
                <p className="text-gray-400 text-xs">
                  ✅ {report.confirmations} confirmaciones
                </p>
                <p className="text-gray-400 text-xs">
                  {new Date(report.created_at).toLocaleTimeString('es-CO')}
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
