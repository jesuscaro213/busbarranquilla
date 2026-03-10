import { useEffect, useState, useRef, useCallback } from 'react';
import { routesApi, tripsApi, reportsApi, usersApi, creditsApi } from '../services/api';
import type { ReportType } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../services/socket';
import CatchBusNearby from './CatchBusNearby';
import CatchBusList from './CatchBusList';
import CatchBusWaiting from './CatchBusWaiting';
import CatchBusActive from './CatchBusActive';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Route {
  id: number;
  name: string;
  code: string;
  type: string;
  color: string | null;
  company_name: string | null;
  frequency_minutes: number | null;
  first_departure: string | null;
  last_departure: string | null;
  is_active: boolean;
  geometry: [number, number][] | null;
  min_distance?: number; // km, only present from /nearby endpoint
}

interface ActiveTripFull {
  id: number;
  route_id: number | null;
  route_name: string | null;
  route_code: string | null;
  started_at: string;
  credits_earned: number;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_stop_name: string | null;
}

interface SummaryData {
  routeName: string;
  routeCode: string;
  elapsedSecs: number;
  credits: number;
  distanceMeters?: number;
  completionBonusEarned?: boolean;
  note?: string;
}

type View = 'list' | 'waiting' | 'active' | 'summary';

interface Props {
  userPosition: [number, number] | null;
  onTripChange: (active: boolean) => void;
  onRouteGeometry?: (geom: [number, number][] | null) => void;
  onBoardingStop?: (stop: { latitude: number; longitude: number; name: string } | null) => void;
  initialRouteId?: number;
  initialDestinationStopId?: number;
  onTripEnd?: () => void;
}

interface RouteReport {
  id: number;
  user_id: number;
  type: ReportType;
  description: string | null;
  confirmations: number;
  confirmed_by_me: boolean;
  credits_awarded_to_reporter: boolean;
  active_users: number;
  needed_confirmations: number;
  is_valid: boolean;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const REPORT_RATE_LIMIT_TOAST = 'Ya reportaste mucho hoy en esta ruta 🙏';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distancia en metros de un punto (px,py) al segmento (ax,ay)→(bx,by)
function distToSegmentMeters(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineMeters(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return haversineMeters(px, py, ax + t * dx, ay + t * dy);
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CatchBusMode({ userPosition, onTripChange, onRouteGeometry, onBoardingStop, initialRouteId, initialDestinationStopId, onTripEnd }: Props) {
  const { user } = useAuth();

  // Route list
  const [routes, setRoutes] = useState<Route[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  type RouteTypeFilter = 'all' | 'transmetro' | 'bus';
  const [typeFilter, setTypeFilter] = useState<RouteTypeFilter>('all');
  const [loading, setLoading] = useState(true);
  const [nearbyRoutes, setNearbyRoutes] = useState<Route[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);

  // Navigation state machine
  const [view, setView] = useState<View>('list');
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);

  // Boarding stop (nearest stop for selected route)
  const [boardingStop, setBoardingStop] = useState<{ latitude: number; longitude: number; name: string } | null>(null);

  // Modals
  const [showBoardConfirm, setShowBoardConfirm] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [boardingDistanceWarning, setBoardingDistanceWarning] = useState<number | null>(null);

  // Active trip
  const [activeTrip, setActiveTrip] = useState<ActiveTripFull | null>(null);
  const [creditsThisTrip, setCreditsThisTrip] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [tripLoading, setTripLoading] = useState(false);
  const [gpsLost, setGpsLost] = useState(false);
  const [flashedBtn, setFlashedBtn] = useState<ReportType | null>(null);
  const [deviationAlert, setDeviationAlert] = useState(false);
  const [inactiveAlert, setInactiveAlert] = useState(false);
  const [suspiciousAlert, setSuspiciousAlert] = useState(false);
  const [dropoffPrompt, setDropoffPrompt] = useState(false);
  const [dropoffBanner, setDropoffBanner] = useState<'prepare' | 'now' | 'missed' | null>(null);

  // Post-trip summary
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);

  // Ocupación
  const [occupancyState, setOccupancyState] = useState<'lleno' | 'disponible' | null>(null);
  const [userLastOccupancy, setUserLastOccupancy] = useState<'lleno' | 'bus_disponible' | null>(null);
  const [occupancyCooldownEnd, setOccupancyCooldownEnd] = useState<number | null>(null);
  // Mapa de ocupación por ruta (para lista y Cerca de ti)
  const [routeOccupancy, setRouteOccupancy] = useState<Record<number, 'lleno' | 'disponible'>>({});

  // Reportes de otros en la misma ruta
  const [routeReports, setRouteReports] = useState<RouteReport[]>([]);
  const [confirmCreditsEarned, setConfirmCreditsEarned] = useState(0);

  // Route activity (last hour)
  interface ActivityEvent { type: string; minutes_ago: number; confirmations?: number }
  interface ActivityData { active_count: number; last_activity_minutes: number | null; events: ActivityEvent[] }
  const [routeActivity, setRouteActivity] = useState<ActivityData | null>(null);

  // Toast: keyed to auto-dismiss the correct one
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);

  // Refs — stable across renders, safe to use inside intervals
  const userPositionRef = useRef<[number, number] | null>(null);
  const lastGpsRef = useRef<number>(Date.now());
  const trafficReportRef = useRef<{ reportId: number; lat: number; lng: number } | null>(null);
  const occupancyReportRef = useRef<number | null>(null); // ID del último reporte lleno
  const occupancyCreditedRef = useRef<Set<ReportType>>(new Set()); // tipos que ya ganaron crédito este viaje
  const monitor1Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitor2Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const outOfRouteSecondsRef = useRef<number>(0);
  const ignoreDeviationUntilRef = useRef<number>(0);
  const routeStopsRef = useRef<{ lat: number; lng: number }[]>([]);
  const routeGeometryRef = useRef<[number, number][] | null>(null);
  const monitor3Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);
  const inactiveSecondsRef = useRef<number>(0);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasBeenWarnedRef = useRef<boolean>(false); // ya mostró la alerta de inactividad una vez
  const monitor4Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertActivatedRef = useRef<boolean>(false);
  const alertDeclinedRef = useRef<boolean>(false);
  const prevDistToDestRef = useRef<number | null>(null);

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsCheckRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsTrackRef         = useRef<[number, number][]>([]); // track GPS del viaje actual

  // ── beforeunload: cerrar viaje si usuario cierra la pestaña ───────────
  useEffect(() => {
    if (!activeTrip) return;
    const handler = () => {
      navigator.sendBeacon('/api/trips/end', JSON.stringify({}));
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeTrip?.id]); // solo re-registrar si cambia el ID del viaje, no en cada update de créditos

  // ── Emitir geometry de la ruta activa al mapa ──────────────────────────
  useEffect(() => {
    if (!activeTrip?.route_id || routes.length === 0) return;
    const route = routes.find((r) => r.id === activeTrip.route_id);
    onRouteGeometry?.(route?.geometry ?? null);
  }, [activeTrip, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling de ocupación cada 2 min mientras hay viaje activo ──────────
  useEffect(() => {
    if (!activeTrip?.route_id) { setOccupancyState(null); return; }
    const fetch = () => {
      reportsApi.getOccupancy(activeTrip.route_id!)
        .then((r) => setOccupancyState(r.data.state))
        .catch(() => {});
    };
    fetch();
    const interval = setInterval(fetch, 120_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.route_id]);


  // ── Keep userPositionRef in sync ───────────────────────────────────────
  useEffect(() => {
    userPositionRef.current = userPosition;
    if (userPosition) {
      lastGpsRef.current = Date.now();
      setGpsLost(false);
    }
  }, [userPosition]);

  // ── Fetch nearby routes + ocupación (solo al montar o manual/cada 2 min) ──
  const nearbyFetchedRef = useRef(false);

  const fetchNearbyRoutes = (pos: [number, number]) => {
    setNearbyLoading(true);
    routesApi.nearby(pos[0], pos[1], 0.3)
      .then(async (res) => {
        const routes: Route[] = res.data.routes ?? [];
        setNearbyRoutes(routes);
        const results = await Promise.allSettled(
          routes.map((r) => reportsApi.getOccupancy(r.id).then((o) => ({ id: r.id, state: o.data.state })))
        );
        const map: Record<number, 'lleno' | 'disponible'> = {};
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.state) {
            map[r.value.id] = r.value.state;
          }
        }
        setRouteOccupancy((prev) => ({ ...prev, ...map }));
      })
      .catch(() => setNearbyRoutes([]))
      .finally(() => setNearbyLoading(false));
  };

  // Carga inicial: espera hasta tener posición, luego no vuelve a dispararse por movimiento
  useEffect(() => {
    if (!userPosition || nearbyFetchedRef.current) return;
    nearbyFetchedRef.current = true;
    fetchNearbyRoutes(userPosition);
  }, [userPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh cada 2 minutos (solo en vista de lista)
  useEffect(() => {
    if (view !== 'list') return;
    const interval = setInterval(() => {
      const pos = userPositionRef.current;
      if (pos) fetchNearbyRoutes(pos);
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Monitor 1: auto-resolver trancón si el bus se movió >1km ────────────
  useEffect(() => {
    if (!activeTrip) return;

    monitor1Ref.current = setInterval(() => {
      const report = trafficReportRef.current;
      const pos = userPositionRef.current;
      if (!report || !pos) return;

      const dist = haversineMeters(report.lat, report.lng, pos[0], pos[1]);
      if (dist > 1000) {
        reportsApi.resolve(report.reportId)
          .then((res) => {
            const mins: number = res.data?.duration_minutes ?? 0;
            showToast(mins > 0
              ? `✅ Trancón resuelto — duró ~${mins} min`
              : '✅ Trancón resuelto automáticamente'
            );
            trafficReportRef.current = null;
          })
          .catch(() => {});
      }
    }, 120000);

    return () => {
      if (monitor1Ref.current) {
        clearInterval(monitor1Ref.current);
        monitor1Ref.current = null;
      }
    };
  }, [activeTrip]);

  // ── Monitor 2: detección de desvío si >100m de geometría por >60s ─────
  // Usa geometría (polyline) como referencia primaria; cae a paradas si no hay geometría.
  // Chequea cada 15s. Dispara alerta tras 60s continuos fuera de ruta.
  useEffect(() => {
    if (!activeTrip?.route_id) return;

    routeGeometryRef.current = null;
    routeStopsRef.current = [];

    routesApi.getById(activeTrip.route_id)
      .then((r) => {
        const geom = r.data.route?.geometry as [number, number][] | null | undefined;
        if (geom && geom.length >= 2) {
          routeGeometryRef.current = geom;
        }
        const stops = (r.data.stops ?? []) as { latitude: number; longitude: number }[];
        routeStopsRef.current = stops.map((s) => ({
          lat: parseFloat(String(s.latitude)),
          lng: parseFloat(String(s.longitude)),
        }));
      })
      .catch(() => {});

    outOfRouteSecondsRef.current = 0;

    monitor2Ref.current = setInterval(() => {
      const pos = userPositionRef.current;
      if (!pos || Date.now() <= ignoreDeviationUntilRef.current) return;

      const geom = routeGeometryRef.current;
      const stops = routeStopsRef.current;

      // Sin datos de ruta aún — esperar
      if (!geom && stops.length === 0) return;

      let minDist = Infinity;

      if (geom && geom.length >= 2) {
        // Distancia mínima al segmento más cercano de la polyline
        for (let i = 0; i < geom.length - 1; i++) {
          const d = distToSegmentMeters(pos[0], pos[1], geom[i][0], geom[i][1], geom[i + 1][0], geom[i + 1][1]);
          if (d < minDist) minDist = d;
        }
      } else {
        // Fallback: distancia a parada más cercana
        minDist = stops.reduce((best, s) => {
          const d = haversineMeters(pos[0], pos[1], s.lat, s.lng);
          return d < best ? d : best;
        }, Infinity);
      }

      if (minDist > 100) {
        outOfRouteSecondsRef.current += 15;
        if (outOfRouteSecondsRef.current >= 60) {
          setDeviationAlert(true);
        }
      } else {
        outOfRouteSecondsRef.current = 0;
      }
    }, 15000);

    return () => {
      if (monitor2Ref.current) {
        clearInterval(monitor2Ref.current);
        monitor2Ref.current = null;
      }
    };
  }, [activeTrip]);

  // ── Monitor 3: inactividad — 10 min → aviso, 30 min → alerta sospechosa ──
  useEffect(() => {
    if (!activeTrip) return;

    lastPositionRef.current = null;
    inactiveSecondsRef.current = 0;

    const doAutoClose = (suspicious: boolean) => {
      if (autoCloseTimerRef.current) return;
      autoCloseTimerRef.current = setTimeout(() => {
        autoCloseTimerRef.current = null;
        tripsApi.end(suspicious ? { suspicious_minutes: 30 } : undefined)
          .catch(() => {})
          .finally(() => {
            setSummaryData((prev) => prev
              ? { ...prev, note: suspicious ? 'Viaje cerrado — inactividad prolongada' : 'Viaje cerrado automáticamente' }
              : { routeName: '', routeCode: '', elapsedSecs: inactiveSecondsRef.current, credits: 0,
                  note: suspicious ? 'Viaje cerrado — inactividad prolongada' : 'Viaje cerrado automáticamente' }
            );
            setInactiveAlert(false);
            setSuspiciousAlert(false);
            setActiveTrip(null);
            onTripChange(false);
            setView('summary');
          });
      }, 120000);
    };

    monitor3Ref.current = setInterval(() => {
      const pos = userPositionRef.current;
      if (!pos) return;

      if (lastPositionRef.current) {
        const dist = haversineMeters(lastPositionRef.current.lat, lastPositionRef.current.lng, pos[0], pos[1]);
        if (dist < 50) {
          inactiveSecondsRef.current += 60;
        } else {
          inactiveSecondsRef.current = 0;
        }
      }
      lastPositionRef.current = { lat: pos[0], lng: pos[1], timestamp: Date.now() };

      if (inactiveSecondsRef.current >= 1800) {
        // 30 min sin moverse → alerta sospechosa
        setInactiveAlert(false);
        setSuspiciousAlert(true);
        doAutoClose(true);
      } else if (inactiveSecondsRef.current >= 600) {
        if (hasBeenWarnedRef.current) {
          // Segunda vez sin moverse → alerta sospechosa
          setInactiveAlert(false);
          setSuspiciousAlert(true);
          doAutoClose(true);
        } else {
          setInactiveAlert(true);
          doAutoClose(false);
        }
      }
    }, 60000);

    return () => {
      if (monitor3Ref.current) { clearInterval(monitor3Ref.current); monitor3Ref.current = null; }
      if (autoCloseTimerRef.current) { clearTimeout(autoCloseTimerRef.current); autoCloseTimerRef.current = null; }
    };
  }, [activeTrip]);

  // ── Monitor 4: alertas de bajada ───────────────────────────────────────
  useEffect(() => {
    if (!activeTrip?.destination_lat || !activeTrip?.destination_lng || !activeTrip?.destination_stop_name) return;

    alertActivatedRef.current = false;
    alertDeclinedRef.current = false;
    prevDistToDestRef.current = null;

    // Activar automáticamente para premium/admin; mostrar prompt para free
    if (user?.role === 'premium' || user?.role === 'admin') {
      alertActivatedRef.current = true;
    } else {
      setDropoffPrompt(true);
    }

    const destLat = activeTrip.destination_lat;
    const destLng = activeTrip.destination_lng;

    monitor4Ref.current = setInterval(() => {
      if (!alertActivatedRef.current) return;
      const pos = userPositionRef.current;
      if (!pos) return;

      const stops = routeStopsRef.current;

      // Calcular destIdx aquí (dentro del intervalo) para que las paradas ya estén cargadas
      const destIdx = stops.findIndex(
        (s) => haversineMeters(s.lat, s.lng, destLat, destLng) < 80
      );

      // Calcular distancia a lo largo de la ruta si tenemos paradas y destino indexado
      let dist: number;
      if (stops.length > 1 && destIdx !== -1) {
        // Parada más cercana al usuario = posición actual en la ruta
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i <= destIdx; i++) {
          const d = haversineMeters(pos[0], pos[1], stops[i].lat, stops[i].lng);
          if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
        }

        if (nearestIdx >= destIdx) {
          // El usuario está en la parada destino o muy cerca — distancia directa
          dist = nearestDist;
        } else {
          // Distancia acumulada: usuario → parada cercana → ... → destino
          dist = nearestDist;
          for (let i = nearestIdx; i < destIdx; i++) {
            dist += haversineMeters(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
          }
        }
      } else {
        // Fallback: línea recta
        dist = haversineMeters(pos[0], pos[1], destLat, destLng);
      }

      const prev = prevDistToDestRef.current;

      if (prev !== null && prev <= 200 && dist > 200) {
        setDropoffBanner('missed');
      } else if (dist <= 200) {
        setDropoffBanner('now');
        navigator.vibrate?.([200, 100, 200]);
      } else if (dist <= 400) {
        setDropoffBanner('prepare');
      } else {
        setDropoffBanner(null);
      }

      prevDistToDestRef.current = dist;
    }, 15000);

    return () => {
      if (monitor4Ref.current) {
        clearInterval(monitor4Ref.current);
        monitor4Ref.current = null;
      }
    };
  }, [activeTrip, user?.role]);

  // ── Helpers ───────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    const id = Date.now();
    setToast({ msg, id });
    setTimeout(() => setToast((prev) => (prev?.id === id ? null : prev)), 3000);
  };

  const clearAllIntervals = useCallback(() => {
    if (locationIntervalRef.current) { clearInterval(locationIntervalRef.current); locationIntervalRef.current = null; }
    if (clockIntervalRef.current)    { clearInterval(clockIntervalRef.current);    clockIntervalRef.current = null; }
    if (gpsCheckRef.current)         { clearInterval(gpsCheckRef.current);         gpsCheckRef.current = null; }
  }, []);

  const startActiveIntervals = useCallback((startedAt: string) => {
    clearAllIntervals();

    // Location update every 30s (backend awards +1 credit/min)
    // Capturar posición inicial inmediatamente al arrancar el viaje
    gpsTrackRef.current = userPositionRef.current ? [userPositionRef.current] : [];
    locationIntervalRef.current = setInterval(() => {
      const pos = userPositionRef.current;
      if (!pos) return;
      // Acumular track GPS (máx 300 puntos ≈ 2.5h de viaje)
      if (gpsTrackRef.current.length < 300) {
        gpsTrackRef.current.push(pos);
      }
      tripsApi.updateLocation({ latitude: pos[0], longitude: pos[1] })
        .then((r) => { if (r.data.credits_pending !== undefined) setCreditsThisTrip(r.data.credits_pending); })
        .catch(() => {});
    }, 30000);

    // Cronómetro: tick every second
    clockIntervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);

    // GPS-lost detection: check every 5s
    gpsCheckRef.current = setInterval(() => {
      setGpsLost(Date.now() - lastGpsRef.current > 60_000);
    }, 5000);
  }, [clearAllIntervals]);

  // ── Init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      routesApi.list()
        .then((r) => setRoutes(r.data.routes))
        .catch(() => {}),
      usersApi.getFavorites()
        .then((r) => {
          const ids = new Set<number>((r.data.favorites as { id: number }[]).map((f) => f.id));
          setFavorites(ids);
        })
        .catch(() => {}),
      // Use /trips/current to recover active trip with destination info
      tripsApi.getCurrent()
        .then((r) => {
          if (r.data.trip) {
            const trip = r.data.trip as ActiveTripFull;
            setActiveTrip(trip);
            setCreditsThisTrip(trip.credits_earned ?? 0);
            setElapsed(Math.floor((Date.now() - new Date(trip.started_at).getTime()) / 1000));
            onTripChange(true);
            startActiveIntervals(trip.started_at);
            setView('active');
          }
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));

    return () => clearAllIntervals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Socket: reportes en tiempo real de la ruta ────────────────────────
  useEffect(() => {
    if (!activeTrip?.route_id) return;
    const routeId = activeTrip.route_id;
    const socket = getSocket();

    socket.emit('join:route', routeId);

    // Cargar reportes existentes de la ruta
    reportsApi.getRouteReports(routeId)
      .then((r) => setRouteReports(r.data.reports ?? []))
      .catch(() => {});

    const onNewReport = (data: { report: RouteReport }) => {
      if (data.report.user_id === user?.id) return; // skip own reports
      setRouteReports((prev) => [data.report, ...prev]);
      showToast('📋 Nuevo reporte en tu ruta');
    };

    const onReportConfirmed = (data: {
      reportId: number;
      confirmations: number;
      is_valid: boolean;
      needed_confirmations: number;
    }) => {
      setRouteReports((prev) =>
        prev.map((r) =>
          r.id === data.reportId
            ? { ...r, confirmations: data.confirmations, is_valid: data.is_valid, needed_confirmations: data.needed_confirmations }
            : r
        )
      );
    };

    const onReportResolved = (data: { reportId: number; type: string; duration_minutes: number }) => {
      setRouteReports((prev) => prev.filter((r) => r.id !== data.reportId));
      if (data.type === 'trancon') {
        showToast(data.duration_minutes > 0
          ? `✅ Trancón resuelto — duró ~${data.duration_minutes} min`
          : '✅ El trancón en esta ruta fue resuelto'
        );
      }
    };

    socket.on('route:new_report', onNewReport);
    socket.on('route:report_confirmed', onReportConfirmed);
    socket.on('route:report_resolved', onReportResolved);

    return () => {
      socket.emit('leave:route', routeId);
      socket.off('route:new_report', onNewReport);
      socket.off('route:report_confirmed', onReportConfirmed);
      socket.off('route:report_resolved', onReportResolved);
      setRouteReports([]);
      setConfirmCreditsEarned(0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.route_id]);

  // ── Socket: notificaciones mientras espera el bus ─────────────────────
  useEffect(() => {
    if (view !== 'waiting' || !selectedRoute) return;
    const socket = getSocket();
    socket.emit('join:route', selectedRoute.id);

    const onReportResolved = (data: { type: string; duration_minutes: number }) => {
      if (data.type === 'trancon') {
        showToast(data.duration_minutes > 0
          ? `✅ El trancón en esta ruta se resolvió — duró ~${data.duration_minutes} min`
          : '✅ El trancón en esta ruta fue resuelto'
        );
      }
    };

    socket.on('route:report_resolved', onReportResolved);

    return () => {
      socket.emit('leave:route', selectedRoute.id);
      socket.off('route:report_resolved', onReportResolved);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedRoute?.id]);

  // ── Favorites toggle ──────────────────────────────────────────────────
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

  // ── Select route: show geometry + nearest boarding stop ──────────────
  const handleSelectRoute = useCallback((route: Route) => {
    setSelectedRoute(route);
    setShowBoardConfirm(false);
    setView('waiting');
    setRouteActivity(null);
    onRouteGeometry?.(route.geometry ?? null); // emit inmediato (puede ser null)
    const pos = userPositionRef.current;

    routesApi.getActivity(route.id)
      .then((r) => setRouteActivity(r.data))
      .catch(() => {});

    routesApi.getById(route.id).then((r) => {
      const fullRoute = r.data.route as {
        geometry?: [number, number][] | null;
        stops?: { latitude: number; longitude: number; name: string }[];
      };

      // re-emit geometry from full route (overrides null from list)
      if (fullRoute.geometry && fullRoute.geometry.length >= 2) {
        onRouteGeometry?.(fullRoute.geometry);
      }

      const stops = fullRoute.stops ?? [];
      if (stops.length === 0 || !pos) return;
      const nearest = stops.reduce((best, s) => {
        const d = haversineMeters(pos[0], pos[1], parseFloat(String(s.latitude)), parseFloat(String(s.longitude)));
        const bd = haversineMeters(pos[0], pos[1], parseFloat(String(best.latitude)), parseFloat(String(best.longitude)));
        return d < bd ? s : best;
      });
      const stop = {
        latitude: parseFloat(String(nearest.latitude)),
        longitude: parseFloat(String(nearest.longitude)),
        name: nearest.name,
      };
      setBoardingStop(stop);
      onBoardingStop?.(stop);
    }).catch(() => {});
  }, [onRouteGeometry, onBoardingStop]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-select route from planner if initialRouteId provided ─────────
  // Only runs from 'list' view — never overrides an active trip detection
  const initialRouteIdRef = useRef(initialRouteId);
  useEffect(() => {
    if (!initialRouteIdRef.current || loading || routes.length === 0 || view !== 'list') return;
    const route = routes.find((r) => r.id === initialRouteIdRef.current);
    if (route) {
      initialRouteIdRef.current = undefined;
      handleSelectRoute(route);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, loading, view]);

  // ── Trip start ────────────────────────────────────────────────────────
  const handleStart = async (forceStart = false) => {
    if (!selectedRoute) return;
    const pos = userPositionRef.current;
    if (!pos) { showToast('Esperando ubicación GPS...'); return; }

    // Layer 2: advertencia si el usuario está lejos de la geometría de la ruta
    if (!forceStart) {
      const geom = selectedRoute.geometry;
      if (geom && geom.length >= 2) {
        let minDist = Infinity;
        for (let i = 0; i < geom.length - 1; i++) {
          const d = distToSegmentMeters(pos[0], pos[1], geom[i][0], geom[i][1], geom[i + 1][0], geom[i + 1][1]);
          if (d < minDist) minDist = d;
        }
        if (minDist > 800) {
          setBoardingDistanceWarning(Math.round(minDist));
          return; // esperar confirmación del usuario
        }
      }
    }

    setBoardingDistanceWarning(null);
    setTripLoading(true);
    try {
      const res = await tripsApi.start({
        route_id: selectedRoute.id,
        latitude: pos[0],
        longitude: pos[1],
        destination_stop_id: initialDestinationStopId,
      });
      const trip = res.data.trip as ActiveTripFull;
      setActiveTrip(trip);
      setCreditsThisTrip(0);
      setElapsed(0);
      occupancyCreditedRef.current = new Set();
      hasBeenWarnedRef.current = false;
      setSuspiciousAlert(false);
      onTripChange(true);
      onRouteGeometry?.(selectedRoute?.geometry ?? null);
      onBoardingStop?.(null);
      setBoardingStop(null);
      startActiveIntervals(trip.started_at ?? new Date().toISOString());
      setShowBoardConfirm(false);
      setSelectedRoute(null);
      setView('active');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setShowBoardConfirm(false);
      showToast(e?.response?.data?.message ?? 'Error al iniciar el viaje');
    } finally {
      setTripLoading(false);
    }
  };

  // ── Trip end ──────────────────────────────────────────────────────────
  const handleEnd = async (suspiciousMinutes?: number) => {
    setTripLoading(true);
    try {
      const res = await tripsApi.end(suspiciousMinutes ? { suspicious_minutes: suspiciousMinutes } : undefined);
      setSummaryData({
        routeName: activeTrip?.route_name ?? 'Bus',
        routeCode: activeTrip?.route_code ?? '',
        elapsedSecs: elapsed,
        credits: res.data.totalCreditsEarned ?? creditsThisTrip,
        distanceMeters: res.data.distance_meters,
        completionBonusEarned: res.data.completion_bonus_earned,
      });
      clearAllIntervals();
      if (monitor1Ref.current) { clearInterval(monitor1Ref.current); monitor1Ref.current = null; }
      if (monitor2Ref.current) { clearInterval(monitor2Ref.current); monitor2Ref.current = null; }
      if (monitor3Ref.current) { clearInterval(monitor3Ref.current); monitor3Ref.current = null; }
      if (autoCloseTimerRef.current) { clearTimeout(autoCloseTimerRef.current); autoCloseTimerRef.current = null; }
      if (monitor4Ref.current) { clearInterval(monitor4Ref.current); monitor4Ref.current = null; }
      setDeviationAlert(false);
      setInactiveAlert(false);
      setSuspiciousAlert(false);
      hasBeenWarnedRef.current = false;
      setDropoffPrompt(false);
      setDropoffBanner(null);
      setShowEndConfirm(false);
      setActiveTrip(null);
      // Auto-resolver reportes activos al bajarse del bus
      if (trafficReportRef.current) {
        reportsApi.resolve(trafficReportRef.current.reportId).catch(() => {});
        trafficReportRef.current = null;
      }
      occupancyCreditedRef.current = new Set();
      if (occupancyReportRef.current) {
        reportsApi.resolve(occupancyReportRef.current).catch(() => {});
        occupancyReportRef.current = null;
      }
      onTripChange(false);
      onRouteGeometry?.(null);
      setView('summary');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      showToast(e?.response?.data?.message ?? 'Error al finalizar el viaje');
    } finally {
      setTripLoading(false);
    }
  };

  // ── Quick reports (active trip) ───────────────────────────────────────
  const handleQuickReport = async (type: ReportType, credits: number) => {
    const pos = userPositionRef.current;
    if (!pos) { showToast('Sin GPS para reportar'); return; }

    // Cooldown client-side para tipos de ocupación
    const isOccupancy = ['lleno', 'bus_disponible'].includes(type);
    const effectiveCredits = isOccupancy && occupancyCreditedRef.current.has(type) ? 0 : credits;
    if (isOccupancy && occupancyCooldownEnd && Date.now() < occupancyCooldownEnd) {
      const remaining = Math.ceil((occupancyCooldownEnd - Date.now()) / 60000);
      showToast(`Espera ${remaining} min antes de reportar ocupación de nuevo`);
      return;
    }

    try {
      const res = await reportsApi.create({
        route_id: activeTrip?.route_id ?? undefined,
        type,
        latitude: pos[0],
        longitude: pos[1],
      });
      setFlashedBtn(type);
      setTimeout(() => setFlashedBtn(null), 2000);

      if (isOccupancy) {
        setUserLastOccupancy(type as 'lleno' | 'bus_disponible');
        setOccupancyCooldownEnd(Date.now() + 10 * 60 * 1000);
        if (!occupancyCreditedRef.current.has(type)) {
          occupancyCreditedRef.current.add(type);
        }
        // Actualizar estado global inmediatamente
        reportsApi.getOccupancy(activeTrip!.route_id!)
          .then((r) => setOccupancyState(r.data.state))
          .catch(() => {});
        showToast(effectiveCredits > 0 ? `⚡ +${effectiveCredits} créditos` : '✅ Estado actualizado');
      } else {
        showToast(`⚡ +${credits} créditos`);
      }

      // Store traffic jam report for background monitor (Monitor 1)
      if (type === 'trancon') {
        trafficReportRef.current = {
          reportId: (res.data.report as { id: number })?.id ?? 0,
          lat: pos[0],
          lng: pos[1],
        };
      }

      // Store occupancy report ID to auto-resolve on trip end
      if (type === 'lleno') {
        occupancyReportRef.current = (res.data.report as { id: number })?.id ?? null;
      }
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { message?: string; retry_in_minutes?: number } } };
      if (e?.response?.status === 429) {
        showToast(REPORT_RATE_LIMIT_TOAST);
        return;
      }
      const msg = e?.response?.data?.message;
      const retryIn = e?.response?.data?.retry_in_minutes;
      if (retryIn) {
        setOccupancyCooldownEnd(Date.now() + retryIn * 60 * 1000);
        showToast(msg ?? `Espera ${retryIn} min antes de reportar de nuevo`);
      } else {
        showToast(msg ?? 'Error al enviar el reporte');
      }
    }
  };

  // ── Confirmar reporte de otro usuario ────────────────────────────────
  const handleConfirmReport = async (reportId: number) => {
    try {
      await reportsApi.confirm(reportId);
      setRouteReports((prev) =>
        prev.map((r) => r.id === reportId ? { ...r, confirmed_by_me: true, confirmations: r.confirmations + 1 } : r)
      );
      setConfirmCreditsEarned((n) => n + 1);
      showToast('✅ Confirmado · ⚡ +1 crédito');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      showToast(e?.response?.data?.message ?? 'Error al confirmar');
    }
  };

  // ── Wait reports (waiting view) ───────────────────────────────────────
  const handleWaitReport = async (type: 'sin_parar' | 'espera', credits: number) => {
    const pos = userPositionRef.current;
    if (!pos) { showToast('Sin GPS para reportar'); return; }
    try {
      await reportsApi.create({
        route_id: selectedRoute?.id ?? undefined,
        type,
        latitude: pos[0],
        longitude: pos[1],
      });
      showToast(`⚡ +${credits} créditos`);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (e?.response?.status === 429) {
        showToast(REPORT_RATE_LIMIT_TOAST);
        return;
      }
      showToast('Error al enviar el reporte');
    }
  };

  const handleShareBus = async () => {
    if (!activeTrip?.route_id) return;

    const routeCode = activeTrip.route_code ?? '—';
    const routeName = activeTrip.route_name ?? 'MiBus';
    const shareUrl = `https://mibus.co/bus/${activeTrip.route_id}`;
    const shareText = `🚌 Voy en el bus ${routeCode} (${routeName}). Súbete en mibus.co`;
    const fullShareText = `${shareText} ${shareUrl}`;
    const copyShareText = async (): Promise<boolean> => {
      if (typeof window === 'undefined' || !window.navigator?.clipboard) return false;
      await window.navigator.clipboard.writeText(fullShareText);
      return true;
    };

    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        await (navigator as Navigator & { share: (data: { title: string; text: string; url: string }) => Promise<void> }).share({
          title: 'MiBus',
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      if (await copyShareText()) {
        showToast('¡Enlace copiado!');
        return;
      }
    } catch {
      try {
        if (await copyShareText()) {
          showToast('¡Enlace copiado!');
          return;
        }
      } catch {
        // noop
      }
    }

    showToast('No se pudo compartir en este dispositivo');
  };

  // ── ETA calculation ───────────────────────────────────────────────────
  const computeEta = (): number | null => {
    const pos = userPositionRef.current;
    if (!activeTrip?.destination_lat || !activeTrip?.destination_lng || !pos) return null;
    const km = haversineKm(pos[0], pos[1], activeTrip.destination_lat, activeTrip.destination_lng);
    return Math.max(1, Math.ceil((km * 1000) / 333)); // 333 m/min ≈ 20 km/h
  };

  // ── Route filtering + grouping ────────────────────────────────────────
  const filtered = routes.filter((r) => {
    const q = search.toLowerCase();
    const matchesSearch = r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.company_name ?? '').toLowerCase().includes(q);
    const isTransmetro = r.type === 'transmetro' || r.type === 'alimentadora';
    const matchesType =
      typeFilter === 'all' ||
      (typeFilter === 'transmetro' && isTransmetro) ||
      (typeFilter === 'bus' && !isTransmetro);
    return matchesSearch && matchesType;
  });
  const favRoutes    = filtered.filter((r) => favorites.has(r.id));
  const nonFavRoutes = filtered.filter((r) => !favorites.has(r.id));

  const transmetroRoutes = nonFavRoutes
    .filter((r) => r.type === 'transmetro' || r.type === 'alimentadora')
    .sort((a, b) => a.name.localeCompare(b.name));

  const busRoutes = nonFavRoutes
    .filter((r) => r.type !== 'transmetro' && r.type !== 'alimentadora')
    .sort((a, b) => (a.company_name ?? a.name).localeCompare(b.company_name ?? b.name));

  const busRoutesByCompany = busRoutes.reduce<Record<string, Route[]>>((acc, r) => {
    const key = r.company_name ?? 'Sin empresa';
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const activeTripCompany = activeTrip?.route_id
    ? (routes.find((r) => r.id === activeTrip.route_id)?.company_name ?? null)
    : null;

  // ─────────────────────────────────────────────────────────────────────
  // VIEWS
  // ─────────────────────────────────────────────────────────────────────

  // ── Summary view ──────────────────────────────────────────────────────
  if (view === 'summary' && summaryData) {
    return (
      <div className="space-y-4">
        <div className={`border rounded-2xl p-5 text-center space-y-2 ${summaryData.note ? 'bg-amber-50 border-amber-100' : 'bg-green-50 border-green-100'}`}>
          <p className="text-4xl">{summaryData.note ? '⏹️' : '🎉'}</p>
          <p className="font-bold text-gray-900 text-base">
            {summaryData.note ?? '¡Llegaste!'}
          </p>
          {summaryData.routeCode && (
            <span className="inline-block bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md">
              {summaryData.routeCode}
            </span>
          )}
          <p className="text-sm text-gray-600">{summaryData.routeName}</p>
          <div className="flex justify-center gap-6 pt-1 text-sm">
            <span className="text-gray-500">⏱ {fmtTime(summaryData.elapsedSecs)}</span>
            {summaryData.distanceMeters !== undefined && (
              <span className="text-gray-500">
                📍 {summaryData.distanceMeters >= 1000
                  ? `${(summaryData.distanceMeters / 1000).toFixed(1)} km`
                  : `${summaryData.distanceMeters} m`}
              </span>
            )}
            <span className="text-green-600 font-semibold">⚡ +{summaryData.credits} créditos</span>
          </div>
          {summaryData.completionBonusEarned === false && (
            <p className="text-xs text-gray-400 pt-1">
              Recorre al menos 2 km para ganar el bono de completación (+5)
            </p>
          )}
        </div>
        <p className="text-sm text-gray-500 text-center">¿Cómo estuvo el servicio?</p>
        <div className="flex gap-2">
          {(['😊 Bien', '😐 Regular', '😞 Mal'] as const).map((label) => (
            <button
              key={label}
              onClick={() => { setSummaryData(null); setSearch(''); setView('list'); onTripEnd?.(); }}
              className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Active trip view ──────────────────────────────────────────────────
  if (view === 'active' && activeTrip) {
    const eta = computeEta();
    return (
      <CatchBusActive
        toastMessage={toast?.msg ?? null}
        activeTrip={activeTrip}
        activeTripCompany={activeTripCompany}
        eta={eta}
        elapsedLabel={fmtTime(elapsed)}
        creditsThisTrip={creditsThisTrip}
        gpsLost={gpsLost}
        deviationAlert={deviationAlert}
        dropoffPrompt={dropoffPrompt}
        dropoffBanner={dropoffBanner}
        occupancyState={occupancyState}
        routeReports={routeReports}
        confirmCreditsEarned={confirmCreditsEarned}
        flashedBtn={flashedBtn}
        userLastOccupancy={userLastOccupancy}
        inactiveAlert={inactiveAlert}
        suspiciousAlert={suspiciousAlert}
        showEndConfirm={showEndConfirm}
        tripLoading={tripLoading}
        onReportDeviation={async () => {
          const pos = userPositionRef.current;
          const routeId = activeTrip.route_id;
          if (pos && routeId) {
            await reportsApi.create({
              route_id: routeId,
              type: 'desvio',
              latitude: pos[0],
              longitude: pos[1],
            }).then(() => {
              showToast('⚡ +1 crédito — Desvío reportado');
            }).catch((err: unknown) => {
              const e = err as { response?: { status?: number } };
              if (e?.response?.status === 429) {
                showToast(REPORT_RATE_LIMIT_TOAST);
              }
            });
            // Voto ruta_real + track GPS → admin puede ver la ruta que hizo el bus
            const track = gpsTrackRef.current.length >= 2 ? gpsTrackRef.current : undefined;
            routesApi.reportUpdate(routeId, 'ruta_real', track).catch(() => {});
          }
          // El usuario confirmó que la ruta cambió — no tiene sentido seguir
          // comparando contra la geometría del mapa por el resto del viaje
          ignoreDeviationUntilRef.current = Date.now() + 7200000; // 2 horas
          outOfRouteSecondsRef.current = 0;
          setDeviationAlert(false);
        }}
        onDeviationExit={() => { setDeviationAlert(false); setShowEndConfirm(true); }}
        onIgnoreDeviation={() => {
          ignoreDeviationUntilRef.current = Date.now() + 300000;
          outOfRouteSecondsRef.current = 0;
          setDeviationAlert(false);
        }}
        onActivateDropoff={async () => {
          try {
            await creditsApi.spend({ amount: 5, feature: 'bajada', description: 'Alerta de bajada' });
            alertActivatedRef.current = true;
            setDropoffPrompt(false);
          } catch {
            showToast('Sin créditos suficientes. Reporta para ganar más.');
          }
        }}
        onDeclineDropoff={() => { alertDeclinedRef.current = true; setDropoffPrompt(false); }}
        onConfirmReport={handleConfirmReport}
        onQuickReport={handleQuickReport}
        onShareBus={handleShareBus}
        onRequestEnd={() => setShowEndConfirm(true)}
        onInactiveContinue={() => {
          inactiveSecondsRef.current = 0;
          hasBeenWarnedRef.current = true;
          setInactiveAlert(false);
          if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
          }
        }}
        onInactiveEnd={() => {
          setInactiveAlert(false);
          if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
          }
          setShowEndConfirm(true);
        }}
        onSuspiciousTraffic={() => {
          inactiveSecondsRef.current = 0;
          setSuspiciousAlert(false);
          if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
          }
        }}
        onSuspiciousEnd={() => {
          setSuspiciousAlert(false);
          if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
          }
          handleEnd(30);
        }}
        onCancelEndConfirm={() => setShowEndConfirm(false)}
        onConfirmEnd={() => handleEnd()}
      />
    );
  }

  // ── Waiting view ──────────────────────────────────────────────────────
  if (view === 'waiting' && selectedRoute) {
    const boardingDistanceMeters = userPosition && boardingStop
      ? Math.round(haversineMeters(userPosition[0], userPosition[1], boardingStop.latitude, boardingStop.longitude))
      : null;

    return (
      <CatchBusWaiting
        toastMessage={toast?.msg ?? null}
        selectedRoute={selectedRoute}
        routeActivity={routeActivity}
        boardingStop={boardingStop}
        boardingDistanceMeters={boardingDistanceMeters}
        showBoardConfirm={showBoardConfirm}
        tripLoading={tripLoading}
        onWaitReportNoStop={() => handleWaitReport('sin_parar', 4)}
        onWaitReportCrowded={() => handleWaitReport('espera', 3)}
        onRequestBoardConfirm={() => setShowBoardConfirm(true)}
        onCancelWaiting={() => { setBoardingDistanceWarning(null); setShowBoardConfirm(false); setSelectedRoute(null); setView('list'); onRouteGeometry?.(null); onBoardingStop?.(null); setBoardingStop(null); }}
        onConfirmDifferentBus={() => { setBoardingDistanceWarning(null); setShowBoardConfirm(false); setSelectedRoute(null); setView('list'); onRouteGeometry?.(null); onBoardingStop?.(null); setBoardingStop(null); }}
        onStartTrip={handleStart}
      >
        {/* Modal: usuario está lejos de la ruta */}
        {boardingDistanceWarning !== null && (
          <div className="fixed inset-0 z-[2000] bg-black/50 flex items-end justify-center px-4 pb-6">
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl">
              <p className="font-semibold text-gray-900 text-center">
                ⚠️ Estás lejos de esta ruta
              </p>
              <p className="text-sm text-gray-500 text-center">
                Tu ubicación está a <span className="font-bold text-orange-600">{boardingDistanceWarning} m</span> del recorrido registrado de <span className="font-semibold">{selectedRoute.code}</span>.
              </p>
              <p className="text-xs text-gray-400 text-center">
                Puede que la ruta esté desactualizada. ¿Confirmás que estás en este bus?
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setBoardingDistanceWarning(null)}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleStart(true)}
                  disabled={tripLoading}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {tripLoading ? 'Iniciando...' : 'Sí, estoy en él'}
                </button>
              </div>
            </div>
          </div>
        )}
      </CatchBusWaiting>
    );
  }

  // ── Route list ────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {toast && (
        <div className="bg-gray-900 text-white text-sm rounded-xl px-3 py-2 text-center">
          {toast.msg}
        </div>
      )}

      <CatchBusNearby
        nearbyLoading={nearbyLoading}
        nearbyRoutes={nearbyRoutes}
        routeOccupancy={routeOccupancy}
        onRefresh={() => { if (userPositionRef.current) fetchNearbyRoutes(userPositionRef.current); }}
        onSelectRoute={(route) => handleSelectRoute(route as Route)}
      />

      <CatchBusList
        typeFilter={typeFilter}
        search={search}
        loading={loading}
        favRoutes={favRoutes}
        transmetroRoutes={transmetroRoutes}
        busRoutesByCompany={busRoutesByCompany}
        filteredCount={filtered.length}
        routeOccupancy={routeOccupancy}
        onTypeFilterChange={setTypeFilter}
        onSearchChange={setSearch}
        onSelectRoute={(route) => handleSelectRoute(route as Route)}
        onToggleFavorite={toggleFavorite}
      />
    </div>
  );
}
