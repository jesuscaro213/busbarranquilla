import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { reportsApi, tripsApi } from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';
import { useState } from 'react';
import type { RouteRecommendation } from './RoutePlanner';

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
  onUserLocation?: (lat: number, lng: number) => void;
  destinationCenter?: { lat: number; lng: number } | null;
  recommendedRoutes?: RouteRecommendation[];
  selectedRoute?: RouteRecommendation | null;
}

// Centro de Barranquilla
const BARRANQUILLA_CENTER: [number, number] = [10.9685, -74.7813];

const USER_ICON = L.divIcon({
  html: '<div style="background:#2563eb;border:3px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const BUS_ICON = L.divIcon({
  html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4))">🚍</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

// ─── Íconos de recomendación ──────────────────────────────────────────────────

const BOARDING_ICON = L.divIcon({
  html: '<div style="background:#16a34a;color:white;font-size:10px;font-weight:700;padding:3px 7px;border-radius:99px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">↑ Súbete aquí</div>',
  className: '',
  iconAnchor: [48, 12],
});

const ALIGHTING_ICON = L.divIcon({
  html: '<div style="background:#dc2626;color:white;font-size:10px;font-weight:700;padding:3px 7px;border-radius:99px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">↓ Bájate aquí</div>',
  className: '',
  iconAnchor: [48, 12],
});

const SMALL_BOARDING_ICON = L.divIcon({
  html: '<div style="background:#16a34a;width:10px;height:10px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  className: '',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

// ─── Capa de recomendaciones en el mapa ───────────────────────────────────────

function RecommendationLayer({
  recommendations,
  selectedRoute,
}: {
  recommendations: RouteRecommendation[];
  selectedRoute: RouteRecommendation | null | undefined;
}) {
  const map = useMap();
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    // Limpiar capa anterior
    layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current = [];

    if (selectedRoute) {
      // ── Ruta seleccionada: visualización completa ───────────────────────────

      // Marcador verde parada de abordaje
      const boardingMarker = L.marker(
        [selectedRoute.boardingStop.latitude, selectedRoute.boardingStop.longitude],
        { icon: BOARDING_ICON, zIndexOffset: 500 }
      )
        .addTo(map)
        .bindPopup(
          `<b>Súbete aquí</b><br>${selectedRoute.boardingStop.name}<br><small>${selectedRoute.boardingStop.distanceMeters} m desde tu posición</small>`
        );
      layersRef.current.push(boardingMarker);

      // Marcador rojo parada de bajada
      const alightingMarker = L.marker(
        [selectedRoute.alightingStop.latitude, selectedRoute.alightingStop.longitude],
        { icon: ALIGHTING_ICON, zIndexOffset: 500 }
      )
        .addTo(map)
        .bindPopup(
          `<b>Bájate aquí</b><br>${selectedRoute.alightingStop.name}`
        );
      layersRef.current.push(alightingMarker);

      // Línea azul del recorrido entre abordaje y bajada
      if (selectedRoute.routeSegment.length >= 2) {
        const points = selectedRoute.routeSegment.map(
          (s) => [s.latitude, s.longitude] as [number, number]
        );
        const polyline = L.polyline(points, {
          color: '#2563eb',
          weight: 5,
          opacity: 0.75,
          dashArray: undefined,
        }).addTo(map);
        layersRef.current.push(polyline);

        // Ajustar vista para mostrar el recorrido completo
        const allPoints: [number, number][] = [
          [selectedRoute.boardingStop.latitude, selectedRoute.boardingStop.longitude],
          ...points,
          [selectedRoute.alightingStop.latitude, selectedRoute.alightingStop.longitude],
        ];
        map.fitBounds(L.latLngBounds(allPoints), { padding: [50, 50], maxZoom: 15 });
      }

      // Bus activo sobre la ruta
      if (selectedRoute.activeBus) {
        const activeBusIcon = L.divIcon({
          html: '<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))">🚌</div>',
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const busMarker = L.marker(
          [selectedRoute.activeBus.latitude, selectedRoute.activeBus.longitude],
          { icon: activeBusIcon, zIndexOffset: 1000 }
        )
          .addTo(map)
          .bindPopup(
            `<b>Bus ${selectedRoute.route.name}</b><br>aprox. ${selectedRoute.activeBus.minutesAway} min para llegar`
          );
        layersRef.current.push(busMarker);
      }

    } else if (recommendations.length > 0) {
      // ── Sin selección: pequeños puntos en las paradas de abordaje ────────────
      for (const rec of recommendations) {
        const marker = L.marker(
          [rec.boardingStop.latitude, rec.boardingStop.longitude],
          { icon: SMALL_BOARDING_ICON }
        )
          .addTo(map)
          .bindTooltip(`${rec.route.code} — ${rec.boardingStop.name}`, { direction: 'top' });
        layersRef.current.push(marker);
      }
    }

    return () => {
      layersRef.current.forEach((l) => map.removeLayer(l));
      layersRef.current = [];
    };
  }, [selectedRoute, recommendations, map]);

  return null;
}

function MapFlyTo({ center }: { center?: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo([center.lat, center.lng], 16, { duration: 1.2 });
    }
  }, [center, map]);
  return null;
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Componente interno: rastrea GPS del usuario y lo muestra en el mapa
function UserLocationTracker({ onUserLocation }: { onUserLocation?: (lat: number, lng: number) => void }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onUserLocation?.(latitude, longitude);

        if (!markerRef.current) {
          markerRef.current = L.marker([latitude, longitude], { icon: USER_ICON })
            .addTo(map)
            .bindPopup('Tú');
        } else {
          markerRef.current.setLatLng([latitude, longitude]);
        }
      },
      (err) => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 10000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Componente interno: carga buses activos y suscribe a eventos de socket
function BusTracker() {
  const map = useMap();
  const busMarkersRef = useRef<Map<number, L.Marker>>(new Map());

  useEffect(() => {
    let mounted = true;

    tripsApi.getActiveBuses().then((res) => {
      if (!mounted) return;
      for (const bus of res.data.buses) {
        const marker = L.marker(
          [parseFloat(bus.current_latitude), parseFloat(bus.current_longitude)],
          { icon: BUS_ICON }
        )
          .addTo(map)
          .bindPopup(`🚍 ${bus.route_name ?? 'Bus activo'} ${bus.route_code ? `(${bus.route_code})` : ''}`);
        busMarkersRef.current.set(bus.id, marker);
      }
    }).catch(() => {});

    const socket = getSocket();

    socket.on('bus:joined', (data: { tripId: number; routeId: number; latitude: number; longitude: number }) => {
      const marker = L.marker([data.latitude, data.longitude], { icon: BUS_ICON })
        .addTo(map)
        .bindPopup('🚍 Bus activo');
      busMarkersRef.current.set(data.tripId, marker);
    });

    socket.on('bus:location', (data: { tripId: number; routeId: number; latitude: number; longitude: number }) => {
      busMarkersRef.current.get(data.tripId)?.setLatLng([data.latitude, data.longitude]);
    });

    socket.on('bus:left', (data: { tripId: number }) => {
      const marker = busMarkersRef.current.get(data.tripId);
      if (marker) {
        map.removeLayer(marker);
        busMarkersRef.current.delete(data.tripId);
      }
    });

    return () => {
      mounted = false;
      socket.off('bus:joined');
      socket.off('bus:location');
      socket.off('bus:left');
      disconnectSocket();
      busMarkersRef.current.forEach((marker) => map.removeLayer(marker));
      busMarkersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function MapView({
  onMapClick,
  refreshTrigger,
  onUserLocation,
  destinationCenter,
  recommendedRoutes = [],
  selectedRoute,
}: Props) {
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    reportsApi
      .getNearby(BARRANQUILLA_CENTER[0], BARRANQUILLA_CENTER[1], 10)
      .then((res) => setReports(res.data.reports))
      .catch(() => {});
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
      <UserLocationTracker onUserLocation={onUserLocation} />
      <BusTracker />
      <MapFlyTo center={destinationCenter} />
      <RecommendationLayer
        recommendations={recommendedRoutes}
        selectedRoute={selectedRoute}
      />

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
