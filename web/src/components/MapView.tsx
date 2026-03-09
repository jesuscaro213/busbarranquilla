import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { reportsApi, tripsApi, routesApi } from '../services/api';
import { getSocket, disconnectSocket } from '../services/socket';
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
  route_id: number | null;
  latitude: number;
  longitude: number;
  description: string | null;
  confirmations: number;
  created_at: string;
}

interface Props {
  onMapClick?: (lat: number, lng: number) => void;
  onCenterChange?: (lat: number, lng: number) => void;
  refreshTrigger?: number;
  onUserLocation?: (lat: number, lng: number) => void;
  destinationCenter?: { lat: number; lng: number } | null;
  recommendedRoutes?: RouteRecommendation[];
  selectedRoute?: RouteRecommendation | null;
  gpsEnabled?: boolean;
  feedRouteStops?: { latitude: number; longitude: number }[];
  feedRouteGeometry?: [number, number][] | null;
  activeTripGeometry?: [number, number][] | null;
  planOrigin?: { lat: number; lng: number } | null;
  planDest?: { lat: number; lng: number } | null;
  planRouteStops?: { latitude: number; longitude: number }[];
  planDropoffStop?: { latitude: number; longitude: number; name: string } | null;
  catchBusBoardingStop?: { latitude: number; longitude: number; name: string } | null;
  catchBusUserPosition?: [number, number] | null;
  routeActivityPositions?: { lat: number; lng: number; minutes_ago: number }[];
}

// Centro de Barranquilla
const BARRANQUILLA_CENTER: [number, number] = [10.9685, -74.7813];

const USER_ICON = L.divIcon({
  html: `<div style="position:relative;width:24px;height:24px">
    <div class="animate-ping" style="position:absolute;inset:0;background:#3b82f6;border-radius:50%;opacity:0.35"></div>
    <div style="position:absolute;inset:4px;background:#2563eb;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(37,99,235,0.4)"></div>
  </div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const USER_ON_BUS_ICON = L.divIcon({
  html: `<div style="position:relative;width:36px;height:36px">
    <div class="animate-ping" style="position:absolute;inset:0;background:#16a34a;border-radius:50%;opacity:0.3"></div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.4))">🚌</div>
  </div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const BUS_ICON = L.divIcon({
  html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4))">🚍</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const ACTIVITY_BUS_ICON = L.divIcon({
  html: `<div style="position:relative;width:32px;height:32px">
    <div style="position:absolute;inset:0;background:#f59e0b;border-radius:50%;opacity:0.25;animation:ping 1.5s cubic-bezier(0,0,.2,1) infinite"></div>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))">🚌</div>
  </div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
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

function CenterTracker({ onCenterChange }: { onCenterChange?: (lat: number, lng: number) => void }) {
  const map = useMapEvents({
    moveend() {
      const c = map.getCenter();
      onCenterChange?.(c.lat, c.lng);
    },
    zoomend() {
      const c = map.getCenter();
      onCenterChange?.(c.lat, c.lng);
    },
  });
  return null;
}

// Componente interno: rastrea GPS del usuario y lo muestra en el mapa
function UserLocationTracker({
  onUserLocation,
  gpsEnabled,
  isOnTrip,
}: {
  onUserLocation?: (lat: number, lng: number) => void;
  gpsEnabled: boolean;
  isOnTrip: boolean;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Cambiar icono cuando el usuario sube o baja del bus
  useEffect(() => {
    if (!markerRef.current) return;
    markerRef.current.setIcon(isOnTrip ? USER_ON_BUS_ICON : USER_ICON);
    markerRef.current.setPopupContent(isOnTrip ? '🚌 Estás en el bus' : 'Tú estás aquí');
  }, [isOnTrip]);

  useEffect(() => {
    if (!gpsEnabled) return;
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onUserLocation?.(latitude, longitude);

        if (!markerRef.current) {
          markerRef.current = L.marker([latitude, longitude], { icon: isOnTrip ? USER_ON_BUS_ICON : USER_ICON })
            .addTo(map)
            .bindPopup(isOnTrip ? '🚌 Estás en el bus' : 'Tú estás aquí');
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
  }, [gpsEnabled]);

  return null;
}

// Íconos para PlanLayer
const PLAN_ORIGIN_ICON = L.divIcon({
  html: '<div style="background:#16a34a;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const PLAN_DEST_ICON = L.divIcon({
  html: '<div style="background:#dc2626;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const PLAN_DROPOFF_ICON = L.divIcon({
  html: '<div style="background:#d97706;color:white;font-size:10px;font-weight:700;padding:3px 7px;border-radius:99px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)">↓ Bajarse aquí</div>',
  className: '',
  iconAnchor: [55, 12],
});

// Componente interno: capa de visualización del planificador
function PlanLayer({
  origin,
  dest,
  routeStops,
  dropoffStop,
}: {
  origin: { lat: number; lng: number } | null | undefined;
  dest: { lat: number; lng: number } | null | undefined;
  routeStops: { latitude: number; longitude: number }[];
  dropoffStop: { latitude: number; longitude: number; name: string } | null | undefined;
}) {
  const map = useMap();
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current = [];

    const bounds: [number, number][] = [];

    if (origin) {
      const m = L.marker([origin.lat, origin.lng], { icon: PLAN_ORIGIN_ICON, zIndexOffset: 600 })
        .addTo(map)
        .bindPopup('Tu origen');
      layersRef.current.push(m);
      bounds.push([origin.lat, origin.lng]);
    }

    if (dest) {
      const m = L.marker([dest.lat, dest.lng], { icon: PLAN_DEST_ICON, zIndexOffset: 600 })
        .addTo(map)
        .bindPopup('Tu destino');
      layersRef.current.push(m);
      bounds.push([dest.lat, dest.lng]);
    }

    if (routeStops.length >= 2) {
      const points: [number, number][] = routeStops.map((s) => [s.latitude, s.longitude]);
      layersRef.current.push(
        L.polyline(points, { color: '#2563eb', weight: 5, opacity: 0.8 }).addTo(map)
      );
      points.forEach((p) => bounds.push(p));
    }

    if (dropoffStop) {
      const m = L.marker([dropoffStop.latitude, dropoffStop.longitude], {
        icon: PLAN_DROPOFF_ICON,
        zIndexOffset: 700,
      })
        .addTo(map)
        .bindPopup(`<b>Bajarse aquí</b><br>${dropoffStop.name}`);
      layersRef.current.push(m);
      bounds.push([dropoffStop.latitude, dropoffStop.longitude]);

      if (dest) {
        const dashed = L.polyline(
          [[dropoffStop.latitude, dropoffStop.longitude], [dest.lat, dest.lng]],
          { color: '#6b7280', weight: 2, dashArray: '6 4', opacity: 0.7 }
        ).addTo(map);
        layersRef.current.push(dashed);
      }
    }

    if (bounds.length >= 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 15 });
    }

    return () => {
      layersRef.current.forEach((l) => map.removeLayer(l));
      layersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dest, routeStops, dropoffStop]);

  return null;
}

// Componente interno: dibuja la polyline de una ruta del feed
function FeedRouteLayer({
  stops,
  geometry,
}: {
  stops: { latitude: number; longitude: number }[];
  geometry?: [number, number][] | null;
}) {
  const map = useMap();
  const polylineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }

    // Usar geometry guardada si existe; fallback: línea recta entre paradas
    let points: [number, number][];
    if (geometry && geometry.length >= 2) {
      points = geometry;
    } else if (stops.length >= 2) {
      points = stops.map((s) => [s.latitude, s.longitude]);
    } else {
      return;
    }

    polylineRef.current = L.polyline(points, {
      color: '#7c3aed',
      weight: 5,
      opacity: 0.85,
    }).addTo(map);

    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });

    return () => {
      if (polylineRef.current) {
        map.removeLayer(polylineRef.current);
        polylineRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, geometry]);

  return null;
}

// Componente interno: dibuja la polyline de la ruta durante un viaje activo
function ActiveTripLayer({ geometry }: { geometry?: [number, number][] | null }) {
  const map = useMap();
  const polylineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (polylineRef.current) {
      map.removeLayer(polylineRef.current);
      polylineRef.current = null;
    }
    if (!geometry || geometry.length < 2) return;

    polylineRef.current = L.polyline(geometry, {
      color: '#16a34a',
      weight: 5,
      opacity: 0.8,
    }).addTo(map);

    return () => {
      if (polylineRef.current) {
        map.removeLayer(polylineRef.current);
        polylineRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  return null;
}

// Componente interno: marcador "Súbete aquí" + línea caminata para CatchBusMode vista 'waiting'
function BoardingMarkerLayer({
  stop,
  userPosition,
}: {
  stop: { latitude: number; longitude: number; name: string } | null | undefined;
  userPosition?: [number, number] | null;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
    if (lineRef.current) { map.removeLayer(lineRef.current); lineRef.current = null; }
    if (!stop) return;

    markerRef.current = L.marker([stop.latitude, stop.longitude], {
      icon: BOARDING_ICON,
      zIndexOffset: 800,
    }).addTo(map).bindPopup(`<b>Súbete aquí</b><br>${stop.name?.trim() || 'Parada más cercana'}`);

    // Dashed walking line from user to boarding stop
    if (userPosition) {
      lineRef.current = L.polyline(
        [userPosition, [stop.latitude, stop.longitude]],
        { color: '#16a34a', weight: 3, dashArray: '8 6', opacity: 0.8 }
      ).addTo(map);

      // Fit both user and stop in view
      map.fitBounds(
        L.latLngBounds([userPosition, [stop.latitude, stop.longitude]]),
        { padding: [60, 60], maxZoom: 17 }
      );
    } else {
      map.flyTo([stop.latitude, stop.longitude], 15, { duration: 1.0 });
    }

    return () => {
      if (markerRef.current) { map.removeLayer(markerRef.current); markerRef.current = null; }
      if (lineRef.current) { map.removeLayer(lineRef.current); lineRef.current = null; }
    };
  }, [stop, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// ─── Capa de todas las rutas (filtrable por tipo) ─────────────────────────────

type RouteFilter = 'all' | 'transmetro' | 'bus';

interface RouteWithGeometry {
  id: number;
  type: string;
  color: string | null;
  geometry: [number, number][] | null;
}

function RouteGeometryLayer({ filter }: { filter: RouteFilter }) {
  const map = useMap();
  const polylinesRef = useRef<L.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => map.removeLayer(p));
    polylinesRef.current = [];

    if (filter === 'all') return;

    routesApi.list({ type: filter }).then((res) => {
      const routes = res.data.routes as RouteWithGeometry[];
      for (const route of routes) {
        if (!route.geometry || route.geometry.length < 2) continue;

        const isTransmetro = route.type === 'transmetro' || route.type === 'alimentadora';
        const color = isTransmetro ? (route.color || '#e60000') : '#1d4ed8';

        const pl = L.polyline(
          route.geometry.map(([lat, lng]) => [lat, lng] as L.LatLngTuple),
          { color, weight: 3, opacity: 0.7 }
        ).addTo(map);
        polylinesRef.current.push(pl);
      }
    }).catch(() => {});

    return () => {
      polylinesRef.current.forEach((p) => map.removeLayer(p));
      polylinesRef.current = [];
    };
  }, [filter, map]); // eslint-disable-line react-hooks/exhaustive-deps

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

const FILTER_LABELS: Record<RouteFilter, string> = {
  all: 'Todos',
  transmetro: '🚇 Transmetro',
  bus: '🚌 Buses',
};

export default function MapView({
  onMapClick,
  onCenterChange,
  refreshTrigger,
  onUserLocation,
  destinationCenter,
  recommendedRoutes = [],
  selectedRoute,
  gpsEnabled = false,
  feedRouteStops = [],
  feedRouteGeometry,
  activeTripGeometry,
  planOrigin,
  planDest,
  planRouteStops = [],
  planDropoffStop,
  catchBusBoardingStop,
  catchBusUserPosition,
  routeActivityPositions = [],
}: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [routeFilter, setRouteFilter] = useState<RouteFilter>('all');

  useEffect(() => {
    reportsApi
      .getNearby(BARRANQUILLA_CENTER[0], BARRANQUILLA_CENTER[1], 10)
      .then((res) => setReports(res.data.reports))
      .catch(() => {});
  }, [refreshTrigger]);

  return (
    <div className="relative h-full w-full">

      {/* ── Filter toggle buttons ────────────────────────────────────────── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-0.5 bg-white/90 backdrop-blur-sm rounded-full px-1.5 py-1 shadow-md pointer-events-auto">
        {(['all', 'transmetro', 'bus'] as RouteFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setRouteFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
              routeFilter === f
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

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
      <CenterTracker onCenterChange={onCenterChange} />
      <UserLocationTracker onUserLocation={onUserLocation} gpsEnabled={gpsEnabled} isOnTrip={!!activeTripGeometry} />
      <BusTracker />
      <MapFlyTo center={destinationCenter} />
      {/* All-routes layer — always behind specific layers */}
      <RouteGeometryLayer filter={routeFilter} />
      <FeedRouteLayer stops={feedRouteStops} geometry={feedRouteGeometry} />
      <ActiveTripLayer geometry={activeTripGeometry} />
      <BoardingMarkerLayer stop={catchBusBoardingStop} userPosition={catchBusUserPosition} />
      {routeActivityPositions.map((pos, i) => (
        <Marker
          key={`activity-${i}`}
          position={[pos.lat, pos.lng]}
          icon={ACTIVITY_BUS_ICON}
        >
          <Popup>🚌 En el bus · hace {pos.minutes_ago < 1 ? 'un momento' : `${pos.minutes_ago} min`}</Popup>
        </Marker>
      ))}
      <PlanLayer
        origin={planOrigin}
        dest={planDest}
        routeStops={planRouteStops}
        dropoffStop={planDropoffStop}
      />
      <RecommendationLayer
        recommendations={recommendedRoutes}
        selectedRoute={selectedRoute}
      />

      {selectedRoute && reports
        .filter(r => {
          if (r.route_id !== selectedRoute.route.id) return false;
          const ageMs = Date.now() - new Date(r.created_at).getTime();
          return ageMs <= 60 * 60 * 1000; // solo últimos 60 min
        })
        .map((report) => {
          const icon = L.divIcon({
            html: `<div class="text-2xl drop-shadow">${REPORT_ICONS[report.type] ?? '📍'}</div>`,
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
          });

          const ageMs = Date.now() - new Date(report.created_at).getTime();
          const ageMins = Math.floor(ageMs / 60000);
          const timeAgo = ageMins < 1 ? 'hace un momento'
            : ageMins < 60 ? `hace ${ageMins} min`
            : 'hace 1h';

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
                  <p className="text-gray-400 text-xs">{timeAgo}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
    </MapContainer>
    </div>
  );
}
