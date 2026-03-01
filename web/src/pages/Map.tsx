import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import MapView from '../components/MapView';
import ReportButton from '../components/ReportButton';
import BottomSheet, { type SheetState } from '../components/BottomSheet';
import type { RouteRecommendation } from '../components/RoutePlanner';
import CatchBusMode from '../components/CatchBusMode';
import PlanTripMode from '../components/PlanTripMode';
import { routesApi, stopsApi } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedRoute {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  last_report_at: string | null;
  last_report_type: string | null;
  minutes_ago: number | null;
  active_users_count: number;
  has_active_users: boolean;
  has_recent_report: boolean;
}

interface FeedStop {
  latitude: number;
  longitude: number;
}

const REPORT_LABEL: Record<string, string> = {
  bus_location: 'ubicación de bus',
  traffic: 'trancón',
  bus_full: 'bus lleno',
  no_service: 'sin servicio',
  detour: 'desvío',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Map() {
  const { user } = useAuth();

  // GPS
  const [gpsState, setGpsState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);

  // Map interactions
  const [clickedPos, setClickedPos] = useState<{ lat: number; lng: number } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [destinationCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [recommendedRoutes] = useState<RouteRecommendation[]>([]);
  const [selectedRecommendation] = useState<RouteRecommendation | null>(null);

  // Trip
  const [isOnTrip, setIsOnTrip] = useState(false);
  const [activeTripGeometry, setActiveTripGeometry] = useState<[number, number][] | null>(null);

  // Feed route geometry
  const [feedRouteGeometry, setFeedRouteGeometry] = useState<[number, number][] | null>(null);

  // Credits popup
  const [showCreditsPopup, setShowCreditsPopup] = useState(false);
  const creditsPopupRef = useRef<HTMLDivElement>(null);

  // Bottom sheet
  const [sheetState, setSheetState] = useState<SheetState>('collapsed');
  const [sheetMode, setSheetMode] = useState<'feed' | 'trip' | 'planner'>('feed');

  // Activity feed
  const [feedRoutes, setFeedRoutes] = useState<FeedRoute[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedSelectedStops, setFeedSelectedStops] = useState<FeedStop[]>([]);

  // Plan mode map state
  const [planOrigin, setPlanOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [planDest, setPlanDest] = useState<{ lat: number; lng: number } | null>(null);
  const [planRouteStops, setPlanRouteStops] = useState<{ latitude: number; longitude: number }[]>([]);
  const [planDropoffStop, setPlanDropoffStop] = useState<{ latitude: number; longitude: number; name: string } | null>(null);

  // ── Credits popup: close on outside click ─────────────────────────────────
  useEffect(() => {
    if (!showCreditsPopup) return;
    const handler = (e: MouseEvent) => {
      if (creditsPopupRef.current && !creditsPopupRef.current.contains(e.target as Node)) {
        setShowCreditsPopup(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCreditsPopup]);

  // ── Load feed when sheet opens in feed mode ────────────────────────────────
  useEffect(() => {
    if (sheetMode !== 'feed' || sheetState === 'collapsed') return;
    loadFeed();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetState, sheetMode]);

  async function loadFeed() {
    setFeedLoading(true);
    try {
      const res = await routesApi.activeFeed();
      setFeedRoutes(res.data.routes as FeedRoute[]);
    } catch {
      setFeedRoutes([]);
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleFeedRouteClick(routeId: number) {
    try {
      const [stopsRes, routeRes] = await Promise.all([
        stopsApi.listByRoute(routeId),
        routesApi.getById(routeId),
      ]);
      setFeedSelectedStops(stopsRes.data.stops as FeedStop[]);
      const geom = (routeRes.data.route as { geometry?: [number, number][] | null }).geometry ?? null;
      setFeedRouteGeometry(geom);
      setSheetState('collapsed');
    } catch {
      // noop
    }
  }

  // ── Map handlers ───────────────────────────────────────────────────────────
  function handleMapClick(lat: number, lng: number) {
    if (!user || isOnTrip) return;
    setClickedPos({ lat, lng });
    setShowCreditsPopup(false);
  }

  function handleReported() {
    setRefreshTrigger((v) => v + 1);
    setClickedPos(null);
  }

  // ── Sheet actions bar ──────────────────────────────────────────────────────
  const actionsBar = isOnTrip ? (
    <button
      onClick={() => { setSheetMode('trip'); setSheetState('middle'); }}
      className="w-full h-10 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
    >
      🚌 Viaje en curso →
    </button>
  ) : (
    <div className="flex gap-2">
      <button
        onClick={() => { setSheetMode('trip'); setSheetState('middle'); }}
        className="flex-1 h-10 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        🚌 Coger un bus
      </button>
      <button
        onClick={() => { setSheetMode('planner'); setSheetState('middle'); }}
        className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        🗺️ Planear viaje
      </button>
    </div>
  );

  // ── Activity feed JSX ──────────────────────────────────────────────────────
  const liveRoutes = feedRoutes.filter((r) => r.has_active_users);
  const recentRoutes = feedRoutes.filter((r) => !r.has_active_users);

  const feedContent = (
    <div className="p-4 space-y-5 pb-4">
      {feedLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : feedRoutes.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-gray-400 text-sm">Sin actividad reciente.</p>
          <p className="text-gray-400 text-xs mt-1">Sé el primero en reportar.</p>
        </div>
      ) : (
        <>
          {liveRoutes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                🟢 En vivo ahora
              </h3>
              <div className="space-y-2">
                {liveRoutes.map((route) => (
                  <button
                    key={route.id}
                    onClick={() => handleFeedRouteClick(route.id)}
                    className="w-full text-left bg-green-50 border border-green-100 rounded-xl p-3 hover:bg-green-100 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
                      <span className="text-xs font-bold bg-green-600 text-white px-2 py-0.5 rounded-md">
                        {route.code}
                      </span>
                      <span className="text-sm font-medium text-gray-800 truncate">{route.name}</span>
                    </div>
                    <p className="text-xs text-green-700 pl-4">
                      {route.active_users_count > 0
                        ? `${route.active_users_count} persona${route.active_users_count !== 1 ? 's' : ''} en este bus`
                        : 'Activo en tiempo real'}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}

          {recentRoutes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                🕐 Reportes recientes
              </h3>
              <div className="space-y-2">
                {recentRoutes.map((route) => (
                  <button
                    key={route.id}
                    onClick={() => handleFeedRouteClick(route.id)}
                    className="w-full text-left bg-gray-50 border border-gray-100 rounded-xl p-3 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-md">
                        {route.code}
                      </span>
                      <span className="text-sm font-medium text-gray-800 truncate">{route.name}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Último reporte hace {route.minutes_ago ?? '?'} min
                      {route.last_report_type
                        ? ` · ${REPORT_LABEL[route.last_report_type] ?? route.last_report_type}`
                        : ''}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <button
        onClick={() => { setSheetMode('trip'); setSheetState('middle'); }}
        className="w-full text-blue-600 text-sm font-medium py-2 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors"
      >
        Ver todas las rutas →
      </button>

      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
        ⚠️ La actividad depende de reportes de otros usuarios.
      </p>
    </div>
  );

  // ── Sheet content by mode ──────────────────────────────────────────────────
  function renderSheetContent() {
    switch (sheetMode) {
      case 'feed':
        return feedContent;

      case 'trip':
        return (
          <div className="p-4 space-y-3">
            <button
              onClick={() => setSheetMode('feed')}
              className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 mb-1"
            >
              ← Volver
            </button>
            <CatchBusMode
              userPosition={userPosition}
              onTripChange={setIsOnTrip}
              onRouteGeometry={setActiveTripGeometry}
            />
          </div>
        );

      case 'planner':
        return (
          <div className="p-4">
            <button
              onClick={() => {
                setSheetMode('feed');
                setPlanOrigin(null);
                setPlanDest(null);
                setPlanRouteStops([]);
                setPlanDropoffStop(null);
              }}
              className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 mb-3"
            >
              ← Volver
            </button>
            <PlanTripMode
              userPosition={userPosition}
              onPlanUpdate={({ origin, dest, routeStops, dropoffStop }) => {
                setPlanOrigin(origin);
                setPlanDest(dest);
                setPlanRouteStops(routeStops);
                setPlanDropoffStop(dropoffStop);
              }}
            />
          </div>
        );
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative h-[calc(100vh-56px)] overflow-hidden">

      {/* Map — full size */}
      <MapView
        onMapClick={handleMapClick}
        refreshTrigger={refreshTrigger}
        onUserLocation={(lat, lng) => setUserPosition([lat, lng])}
        destinationCenter={destinationCenter}
        recommendedRoutes={recommendedRoutes}
        selectedRoute={selectedRecommendation}
        gpsEnabled={gpsState === 'granted'}
        feedRouteStops={feedSelectedStops}
        feedRouteGeometry={feedRouteGeometry}
        activeTripGeometry={activeTripGeometry}
        planOrigin={planOrigin}
        planDest={planDest}
        planRouteStops={planRouteStops}
        planDropoffStop={planDropoffStop}
      />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      {user && (
        <div className="absolute top-0 left-0 right-0 z-[1100] bg-white/90 backdrop-blur-sm shadow-sm px-4 py-2.5 flex items-center justify-between">
          <span className="font-semibold text-gray-900 text-sm">
            Hola, {user.name.split(' ')[0]} 👋
          </span>

          <div className="relative" ref={creditsPopupRef}>
            <button
              onClick={() => setShowCreditsPopup((p) => !p)}
              className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-yellow-100 transition-colors"
            >
              ⚡ {user.credits}
            </button>

            {showCreditsPopup && (
              <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 w-52 z-10">
                <p className="text-xs text-gray-500 mb-0.5">Tu saldo</p>
                <p className="text-2xl font-bold text-gray-900 mb-3">
                  ⚡ {user.credits}{' '}
                  <span className="text-sm font-normal text-gray-500">créditos</span>
                </p>
                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-xl text-sm transition-colors">
                  Recargar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── GPS consent overlay ───────────────────────────────────────────── */}
      {gpsState === 'pending' && user && (
        <div className="absolute inset-0 z-[1200] bg-black/40 flex items-end justify-center pb-32 px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="text-3xl text-center mb-3">📍</p>
            <p className="font-semibold text-gray-900 text-center mb-2">
              Tu ubicación ayuda a la comunidad
            </p>
            <p className="text-sm text-gray-500 text-center leading-relaxed mb-5">
              Tu ubicación ayuda a otros usuarios a saber dónde está el bus.
              Solo se comparte mientras viajas activamente.
            </p>
            <button
              onClick={() => setGpsState('granted')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors mb-2"
            >
              Entendido, activar GPS
            </button>
            <button
              onClick={() => setGpsState('denied')}
              className="w-full text-gray-400 hover:text-gray-600 text-sm py-2 transition-colors"
            >
              No por ahora
            </button>
          </div>
        </div>
      )}

      {/* ── Report button (above sheet) ────────────────────────────────────── */}
      {user && clickedPos && !isOnTrip && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[1060]">
          <ReportButton lat={clickedPos.lat} lng={clickedPos.lng} onReported={handleReported} />
        </div>
      )}

      {/* ── Bottom sheet (auth only) ───────────────────────────────────────── */}
      {user && (
        <BottomSheet state={sheetState} onStateChange={setSheetState} actions={actionsBar}>
          {renderSheetContent()}
        </BottomSheet>
      )}

      {/* ── CTA for non-auth ──────────────────────────────────────────────── */}
      {!user && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-full shadow-xl px-6 py-3 flex items-center gap-3">
          <span className="text-sm text-gray-700">¿Quieres reportar?</span>
          <a
            href="/login"
            className="bg-blue-600 text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-blue-700 transition-colors"
          >
            Iniciar sesión
          </a>
        </div>
      )}
    </div>
  );
}
