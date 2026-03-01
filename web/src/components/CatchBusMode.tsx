import { useEffect, useState, useRef, useCallback } from 'react';
import { routesApi, tripsApi, reportsApi, usersApi, creditsApi } from '../services/api';
import type { ReportType } from '../services/api';
import { useAuth } from '../context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Route {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  frequency_minutes: number | null;
  first_departure: string | null;
  last_departure: string | null;
  is_active: boolean;
  geometry: [number, number][] | null;
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
  note?: string;
}

type View = 'list' | 'waiting' | 'active' | 'summary';

interface Props {
  userPosition: [number, number] | null;
  onTripChange: (active: boolean) => void;
  onRouteGeometry?: (geom: [number, number][] | null) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_REPORTS: { type: ReportType; emoji: string; label: string; credits: number }[] = [
  { type: 'desvio',     emoji: '🔀', label: 'Desvío',     credits: 4 },
  { type: 'trancon',    emoji: '🚦', label: 'Trancón',    credits: 4 },
  { type: 'casi_lleno', emoji: '🟡', label: 'Casi lleno', credits: 3 },
  { type: 'lleno',      emoji: '🔴', label: 'Bus lleno',  credits: 3 },
];

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

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CatchBusMode({ userPosition, onTripChange, onRouteGeometry }: Props) {
  const { user } = useAuth();

  // Route list
  const [routes, setRoutes] = useState<Route[]>([]);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Navigation state machine
  const [view, setView] = useState<View>('list');
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);

  // Modals
  const [showBoardConfirm, setShowBoardConfirm] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // Active trip
  const [activeTrip, setActiveTrip] = useState<ActiveTripFull | null>(null);
  const [creditsThisTrip, setCreditsThisTrip] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [tripLoading, setTripLoading] = useState(false);
  const [gpsLost, setGpsLost] = useState(false);
  const [flashedBtn, setFlashedBtn] = useState<ReportType | null>(null);
  const [deviationAlert, setDeviationAlert] = useState(false);
  const [inactiveAlert, setInactiveAlert] = useState(false);
  const [dropoffPrompt, setDropoffPrompt] = useState(false);
  const [dropoffBanner, setDropoffBanner] = useState<'prepare' | 'now' | 'missed' | null>(null);

  // Post-trip summary
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);

  // Toast: keyed to auto-dismiss the correct one
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);

  // Refs — stable across renders, safe to use inside intervals
  const userPositionRef = useRef<[number, number] | null>(null);
  const lastGpsRef = useRef<number>(Date.now());
  const trafficReportRef = useRef<{ reportId: number; lat: number; lng: number } | null>(null);
  const monitor1Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitor2Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const outOfRouteSecondsRef = useRef<number>(0);
  const ignoreDeviationUntilRef = useRef<number>(0);
  const routeStopsRef = useRef<{ lat: number; lng: number }[]>([]);
  const monitor3Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null);
  const inactiveSecondsRef = useRef<number>(0);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitor4Ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertActivatedRef = useRef<boolean>(false);
  const alertDeclinedRef = useRef<boolean>(false);
  const prevDistToDestRef = useRef<number | null>(null);

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsCheckRef         = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Emitir geometry de la ruta activa al mapa ──────────────────────────
  useEffect(() => {
    if (!activeTrip?.route_id || routes.length === 0) return;
    const route = routes.find((r) => r.id === activeTrip.route_id);
    onRouteGeometry?.(route?.geometry ?? null);
  }, [activeTrip, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keep userPositionRef in sync ───────────────────────────────────────
  useEffect(() => {
    userPositionRef.current = userPosition;
    if (userPosition) {
      lastGpsRef.current = Date.now();
      setGpsLost(false);
    }
  }, [userPosition]);

  // ── Monitor 1: auto-resolver trancón si el bus se movió >200m ─────────
  useEffect(() => {
    if (!activeTrip) return;

    monitor1Ref.current = setInterval(() => {
      const report = trafficReportRef.current;
      const pos = userPositionRef.current;
      if (!report || !pos) return;

      const dist = haversineMeters(report.lat, report.lng, pos[0], pos[1]);
      if (dist > 200) {
        reportsApi.resolve(report.reportId)
          .then(() => {
            showToast('✅ Trancón resuelto automáticamente');
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

  // ── Monitor 2: detección de desvío si >250m de ruta por >90s ──────────
  useEffect(() => {
    if (!activeTrip?.route_id) return;

    // Cargar paradas de la ruta al inicio
    routesApi.getById(activeTrip.route_id)
      .then((r) => {
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
      const stops = routeStopsRef.current;
      if (!pos || stops.length === 0) return;

      const minDist = stops.reduce((best, s) => {
        const d = haversineMeters(pos[0], pos[1], s.lat, s.lng);
        return d < best ? d : best;
      }, Infinity);

      if (minDist > 250) {
        outOfRouteSecondsRef.current += 30;
        if (
          outOfRouteSecondsRef.current >= 90 &&
          Date.now() > ignoreDeviationUntilRef.current
        ) {
          setDeviationAlert(true);
        }
      } else {
        outOfRouteSecondsRef.current = 0;
      }
    }, 30000);

    return () => {
      if (monitor2Ref.current) {
        clearInterval(monitor2Ref.current);
        monitor2Ref.current = null;
      }
    };
  }, [activeTrip]);

  // ── Monitor 3: auto-cierre si sin movimiento por 10 min ───────────────
  useEffect(() => {
    if (!activeTrip) return;

    lastPositionRef.current = null;
    inactiveSecondsRef.current = 0;

    monitor3Ref.current = setInterval(() => {
      const pos = userPositionRef.current;
      if (!pos) return;

      if (lastPositionRef.current) {
        const dist = haversineMeters(
          lastPositionRef.current.lat,
          lastPositionRef.current.lng,
          pos[0],
          pos[1],
        );
        if (dist < 50) {
          inactiveSecondsRef.current += 60;
        } else {
          inactiveSecondsRef.current = 0;
        }
      }

      lastPositionRef.current = { lat: pos[0], lng: pos[1], timestamp: Date.now() };

      if (inactiveSecondsRef.current >= 600) {
        setInactiveAlert(true);
        if (!autoCloseTimerRef.current) {
          autoCloseTimerRef.current = setTimeout(() => {
            autoCloseTimerRef.current = null;
            // Auto-close: end trip silently with note
            tripsApi.end().catch(() => {}).finally(() => {
              setSummaryData((prev) => prev
                ? { ...prev, note: 'Viaje cerrado automáticamente' }
                : {
                    routeName: '',
                    routeCode: '',
                    elapsedSecs: inactiveSecondsRef.current,
                    credits: 0,
                    note: 'Viaje cerrado automáticamente',
                  }
              );
              setInactiveAlert(false);
              setActiveTrip(null);
              onTripChange(false);
              setView('summary');
            });
          }, 120000);
        }
      }
    }, 60000);

    return () => {
      if (monitor3Ref.current) {
        clearInterval(monitor3Ref.current);
        monitor3Ref.current = null;
      }
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
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

      const dist = haversineMeters(pos[0], pos[1], destLat, destLng);
      const prev = prevDistToDestRef.current;

      if (prev !== null && prev <= 200 && dist > 200) {
        // Pasó la parada
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
    locationIntervalRef.current = setInterval(() => {
      const pos = userPositionRef.current;
      if (!pos) return;
      tripsApi.updateLocation({ latitude: pos[0], longitude: pos[1] })
        .then((r) => { if (r.data.credited) setCreditsThisTrip(r.data.creditsEarned); })
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

  // ── Trip start ────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedRoute) return;
    const pos = userPositionRef.current;
    if (!pos) { showToast('Esperando ubicación GPS...'); return; }
    setTripLoading(true);
    try {
      const res = await tripsApi.start({
        route_id: selectedRoute.id,
        latitude: pos[0],
        longitude: pos[1],
      });
      const trip = res.data.trip as ActiveTripFull;
      setActiveTrip(trip);
      setCreditsThisTrip(0);
      setElapsed(0);
      onTripChange(true);
      onRouteGeometry?.(selectedRoute?.geometry ?? null);
      startActiveIntervals(trip.started_at ?? new Date().toISOString());
      setShowBoardConfirm(false);
      setSelectedRoute(null);
      setView('active');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      showToast(e?.response?.data?.message ?? 'Error al iniciar el viaje');
    } finally {
      setTripLoading(false);
    }
  };

  // ── Trip end ──────────────────────────────────────────────────────────
  const handleEnd = async () => {
    setTripLoading(true);
    try {
      const res = await tripsApi.end();
      setSummaryData({
        routeName: activeTrip?.route_name ?? 'Bus',
        routeCode: activeTrip?.route_code ?? '',
        elapsedSecs: elapsed,
        credits: res.data.totalCreditsEarned ?? creditsThisTrip,
      });
      clearAllIntervals();
      if (monitor1Ref.current) { clearInterval(monitor1Ref.current); monitor1Ref.current = null; }
      if (monitor2Ref.current) { clearInterval(monitor2Ref.current); monitor2Ref.current = null; }
      if (monitor3Ref.current) { clearInterval(monitor3Ref.current); monitor3Ref.current = null; }
      if (autoCloseTimerRef.current) { clearTimeout(autoCloseTimerRef.current); autoCloseTimerRef.current = null; }
      if (monitor4Ref.current) { clearInterval(monitor4Ref.current); monitor4Ref.current = null; }
      setDeviationAlert(false);
      setInactiveAlert(false);
      setDropoffPrompt(false);
      setDropoffBanner(null);
      setShowEndConfirm(false);
      setActiveTrip(null);
      trafficReportRef.current = null;
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
    try {
      const res = await reportsApi.create({
        route_id: activeTrip?.route_id ?? undefined,
        type,
        latitude: pos[0],
        longitude: pos[1],
      });
      // Flash button green for 2s
      setFlashedBtn(type);
      setTimeout(() => setFlashedBtn(null), 2000);
      showToast(`⚡ +${credits} créditos`);
      // Store traffic jam report for background monitor (Monitor 1)
      if (type === 'trancon') {
        trafficReportRef.current = {
          reportId: (res.data.report as { id: number })?.id ?? 0,
          lat: pos[0],
          lng: pos[1],
        };
      }
    } catch {
      showToast('Error al enviar el reporte');
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
    } catch {
      showToast('Error al enviar el reporte');
    }
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
    return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
  });
  const favRoutes   = filtered.filter((r) => favorites.has(r.id));
  const otherRoutes = filtered.filter((r) => !favorites.has(r.id));
  const grouped: Record<string, Route[]> = {};
  for (const r of otherRoutes) {
    const key = r.company_name ?? 'Sin empresa';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }
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
        <div className="bg-green-50 border border-green-100 rounded-2xl p-5 text-center space-y-2">
          <p className="text-4xl">🎉</p>
          <p className="font-bold text-gray-900 text-base">¡Llegaste!</p>
          {summaryData.routeCode && (
            <span className="inline-block bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md">
              {summaryData.routeCode}
            </span>
          )}
          <p className="text-sm text-gray-600">{summaryData.routeName}</p>
          <div className="flex justify-center gap-6 pt-1 text-sm">
            <span className="text-gray-500">⏱ {fmtTime(summaryData.elapsedSecs)}</span>
            <span className="text-green-600 font-semibold">⚡ +{summaryData.credits} créditos</span>
          </div>
        </div>
        <p className="text-sm text-gray-500 text-center">¿Cómo estuvo el servicio?</p>
        <div className="flex gap-2">
          {(['😊 Bien', '😐 Regular', '😞 Mal'] as const).map((label) => (
            <button
              key={label}
              onClick={() => { setSummaryData(null); setSearch(''); setView('list'); }}
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
      <div className="space-y-3">
        {toast && (
          <div className="bg-gray-900 text-white text-sm rounded-xl px-3 py-2 text-center">
            {toast.msg}
          </div>
        )}

        {/* ── Header card ── */}
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-2.5">
          {/* Live badge */}
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
            <span className="text-xs text-green-700 font-semibold uppercase tracking-wide">En ruta</span>
          </div>

          {/* Route name + code + company */}
          <div className="flex items-start gap-2">
            {activeTrip.route_code && (
              <span className="bg-blue-600 text-white text-sm font-bold px-2 py-0.5 rounded-md shrink-0 mt-0.5">
                {activeTrip.route_code}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-bold text-gray-900 leading-tight">
                {activeTrip.route_name ?? 'Bus activo'}
              </p>
              {activeTripCompany && (
                <p className="text-xs text-gray-500 mt-0.5">{activeTripCompany}</p>
              )}
            </div>
          </div>

          {/* Time + credits */}
          <div className="flex items-end justify-between border-t border-green-100 pt-2">
            <div>
              {activeTrip.destination_stop_name && eta !== null ? (
                <>
                  <p className="text-sm font-semibold text-blue-700">⏱ ~{eta} min restantes</p>
                  <p className="text-xs text-gray-400 mt-0.5">→ {activeTrip.destination_stop_name}</p>
                </>
              ) : (
                <p className="text-sm font-semibold text-gray-700">
                  ⏱ Viajando: {fmtTime(elapsed)}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-green-600 leading-none">+{creditsThisTrip}</p>
              <p className="text-xs text-gray-400">⚡ créditos</p>
            </div>
          </div>

          {/* GPS lost badge */}
          {gpsLost && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
              <p className="text-xs text-amber-700">📡 Sin señal GPS — pausado</p>
            </div>
          )}
        </div>

        {/* ── Deviation alert banner ── */}
        {deviationAlert && (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3.5 space-y-2.5">
            <p className="text-sm font-semibold text-orange-800">
              🔀 El bus parece estar fuera de su ruta habitual
            </p>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={async () => {
                  const pos = userPositionRef.current;
                  if (pos) {
                    await reportsApi.create({
                      route_id: activeTrip.route_id ?? undefined,
                      type: 'desvio',
                      latitude: pos[0],
                      longitude: pos[1],
                    }).catch(() => {});
                    showToast('⚡ +4 créditos — Desvío reportado');
                  }
                  setDeviationAlert(false);
                }}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
              >
                🔀 Reportar desvío
              </button>
              <div className="flex gap-1.5">
                <button
                  onClick={() => { setDeviationAlert(false); setShowEndConfirm(true); }}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Me bajé
                </button>
                <button
                  onClick={() => {
                    ignoreDeviationUntilRef.current = Date.now() + 300000;
                    setDeviationAlert(false);
                  }}
                  className="flex-1 border border-gray-200 text-gray-500 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Ignorar (5 min)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Dropoff activation prompt (free users) ── */}
        {dropoffPrompt && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 space-y-2.5">
            <p className="text-sm font-semibold text-blue-800">
              🔔 Activar alerta de bajada · 12 créditos
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={async () => {
                  try {
                    await creditsApi.spend({ amount: 12, feature: 'bajada', description: 'Alerta de bajada' });
                    alertActivatedRef.current = true;
                    setDropoffPrompt(false);
                  } catch {
                    showToast('Sin créditos suficientes. Reporta para ganar más.');
                  }
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
              >
                Activar (12 créditos)
              </button>
              <button
                onClick={() => { alertDeclinedRef.current = true; setDropoffPrompt(false); }}
                className="flex-1 border border-gray-200 text-gray-500 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                No activar
              </button>
            </div>
          </div>
        )}

        {/* ── Dropoff proximity banners ── */}
        {dropoffBanner === 'prepare' && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-3 py-2.5 text-center">
            <p className="text-sm font-semibold text-yellow-800">⚠️ Prepárate, tu parada se acerca</p>
          </div>
        )}
        {dropoffBanner === 'now' && (
          <div className="bg-orange-100 border border-orange-400 rounded-xl px-3 py-2.5 text-center animate-pulse">
            <p className="text-sm font-bold text-orange-900">
              🔔 ¡Próxima parada es la tuya! — {activeTrip.destination_stop_name}
            </p>
          </div>
        )}
        {dropoffBanner === 'missed' && (
          <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2.5 text-center">
            <p className="text-sm font-semibold text-red-700">Parece que pasaste tu parada</p>
          </div>
        )}

        {/* ── Quick report grid (4 icons) ── */}
        <div>
          <p className="text-xs text-gray-400 mb-1.5">Reportar incidencia</p>
          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_REPORTS.map(({ type, emoji, label, credits }) => (
              <button
                key={type}
                onClick={() => handleQuickReport(type, credits)}
                className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                  flashedBtn === type
                    ? 'bg-green-500 text-white scale-95'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                <span className="text-xl leading-none">{emoji}</span>
                <span className="leading-tight text-center">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── End trip ── */}
        <button
          onClick={() => setShowEndConfirm(true)}
          className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
        >
          🛑 Me bajé — Finalizar viaje
        </button>

        {/* Inactivity alert modal */}
        {inactiveAlert && (
          <div className="fixed inset-0 z-[2100] bg-black/50 flex items-end justify-center px-4 pb-6">
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
              <p className="text-2xl text-center">🤔</p>
              <p className="font-semibold text-gray-900 text-center">¿Sigues en el bus?</p>
              <p className="text-sm text-gray-500 text-center">Llevas un rato sin moverte.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    inactiveSecondsRef.current = 0;
                    setInactiveAlert(false);
                    if (autoCloseTimerRef.current) {
                      clearTimeout(autoCloseTimerRef.current);
                      autoCloseTimerRef.current = null;
                    }
                  }}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  Sí, sigo viajando
                </button>
                <button
                  onClick={() => {
                    setInactiveAlert(false);
                    if (autoCloseTimerRef.current) {
                      clearTimeout(autoCloseTimerRef.current);
                      autoCloseTimerRef.current = null;
                    }
                    setShowEndConfirm(true);
                  }}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  No, ya me bajé
                </button>
              </div>
            </div>
          </div>
        )}

        {/* End confirm modal */}
        {showEndConfirm && (
          <div className="fixed inset-0 z-[2000] bg-black/50 flex items-end justify-center px-4 pb-6">
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
              <p className="font-semibold text-gray-900 text-center">¿Confirmás que te bajaste?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEndConfirm(false)}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  No, sigo en el bus
                </button>
                <button
                  onClick={handleEnd}
                  disabled={tripLoading}
                  className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {tripLoading ? 'Finalizando...' : '✅ Sí, me bajé'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Waiting view ──────────────────────────────────────────────────────
  if (view === 'waiting' && selectedRoute) {
    return (
      <div className="space-y-3">
        {toast && (
          <div className="bg-gray-900 text-white text-sm rounded-xl px-3 py-2 text-center">
            {toast.msg}
          </div>
        )}

        {/* Route info */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="bg-blue-600 text-white text-sm font-bold px-2 py-0.5 rounded-md shrink-0">
              {selectedRoute.code}
            </span>
            <p className="font-semibold text-gray-900 truncate">{selectedRoute.name}</p>
          </div>
          {selectedRoute.company_name && (
            <p className="text-xs text-gray-400">{selectedRoute.company_name}</p>
          )}
          {selectedRoute.frequency_minutes && (
            <p className="text-xs text-gray-400">🕐 Cada {selectedRoute.frequency_minutes} min</p>
          )}
        </div>

        {/* Waiting indicator */}
        <div className="flex items-center justify-center gap-2 py-1">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <p className="text-sm font-medium text-gray-600">Esperando el bus...</p>
        </div>

        {/* Wait quick reports */}
        <div className="flex gap-2">
          <button
            onClick={() => handleWaitReport('sin_parar', 4)}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2.5 rounded-xl transition-colors"
          >
            🚫 El bus pasó sin parar
          </button>
          <button
            onClick={() => handleWaitReport('espera', 3)}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2.5 rounded-xl transition-colors"
          >
            👥 Mucha gente esperando
          </button>
        </div>

        {/* Confirm board */}
        <button
          onClick={() => setShowBoardConfirm(true)}
          className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
        >
          🚌 Ya me monté — Confirmar
        </button>

        {/* Cancel */}
        <button
          onClick={() => { setSelectedRoute(null); setView('list'); }}
          className="w-full text-gray-400 hover:text-gray-600 text-sm py-1.5 transition-colors"
        >
          El bus no llegó — cancelar
        </button>

        {/* Board confirm modal */}
        {showBoardConfirm && (
          <div className="fixed inset-0 z-[2000] bg-black/50 flex items-end justify-center px-4 pb-6">
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl">
              <p className="font-semibold text-gray-900 text-center">
                ¿Confirmás que estás en el bus{' '}
                <span className="text-blue-600 font-bold">{selectedRoute.code}</span>?
              </p>
              <p className="text-sm text-gray-500 text-center">{selectedRoute.name}</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowBoardConfirm(false); setSelectedRoute(null); setView('list'); }}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  No, cogí otro
                </button>
                <button
                  onClick={handleStart}
                  disabled={tripLoading}
                  className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                >
                  {tripLoading ? 'Iniciando...' : '✅ Sí, estoy en él'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
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

      {/* Search */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar ruta..."
          className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4 max-h-[52vh] overflow-y-auto pb-2">
          {favRoutes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                ⭐ Favoritas
              </h3>
              <div className="space-y-1">
                {favRoutes.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    isFav={true}
                    onSelect={(route) => { setSelectedRoute(route); setShowBoardConfirm(false); setView('waiting'); }}
                    onToggleFav={toggleFavorite}
                  />
                ))}
              </div>
            </section>
          )}

          {Object.entries(grouped).map(([company, compRoutes]) => (
            <section key={company}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {company}
              </h3>
              <div className="space-y-1">
                {compRoutes.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    isFav={false}
                    onSelect={(route) => { setSelectedRoute(route); setShowBoardConfirm(false); setView('waiting'); }}
                    onToggleFav={toggleFavorite}
                  />
                ))}
              </div>
            </section>
          ))}

          {filtered.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">Sin resultados</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RouteRow subcomponent ────────────────────────────────────────────────────

function RouteRow({
  route,
  isFav,
  onSelect,
  onToggleFav,
}: {
  route: Route;
  isFav: boolean;
  onSelect: (r: Route) => void;
  onToggleFav: (e: React.MouseEvent, id: number) => void;
}) {
  return (
    <div
      onClick={() => onSelect(route)}
      className="w-full flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-100 rounded-xl hover:bg-blue-50 hover:border-blue-100 transition-colors text-left cursor-pointer"
    >
      <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0">
        {route.code}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{route.name}</p>
        {route.frequency_minutes && (
          <p className="text-xs text-gray-400">Cada {route.frequency_minutes} min</p>
        )}
      </div>
      <button
        onClick={(e) => onToggleFav(e, route.id)}
        className="shrink-0 text-lg leading-none"
      >
        {isFav ? '⭐' : '☆'}
      </button>
    </div>
  );
}
