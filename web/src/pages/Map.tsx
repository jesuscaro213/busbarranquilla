import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import MapView from '../components/MapView';
import ReportButton from '../components/ReportButton';
import BottomSheet, { type SheetState } from '../components/BottomSheet';
import type { RouteRecommendation } from '../components/RoutePlanner';
import CatchBusMode from '../components/CatchBusMode';
import PlanTripMode from '../components/PlanTripMode';
import Onboarding from '../components/Onboarding';
import { routesApi, stopsApi, tripsApi, reportsApi } from '../services/api';

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
  occupancy?: 'lleno' | 'disponible' | null;
}

const OCCUPANCY_BADGE: Record<string, string> = {
  lleno:      '🔴 Bus lleno',
  disponible: '🟢 Hay sillas',
};

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
  const sheetModeRef = useRef(sheetMode);
  useEffect(() => { sheetModeRef.current = sheetMode; }, [sheetMode]);

  // Activity feed
  const [feedRoutes, setFeedRoutes] = useState<FeedRoute[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedSelectedStops, setFeedSelectedStops] = useState<FeedStop[]>([]);

  // CatchBusMode: boarding stop marker
  const [catchBusBoardingStop, setCatchBusBoardingStop] = useState<{
    latitude: number; longitude: number; name: string;
  } | null>(null);

  // Route ID + destination stop to auto-board from planner
  const [pendingBoardRouteId, setPendingBoardRouteId] = useState<number | undefined>(undefined);
  const [pendingDestinationStopId, setPendingDestinationStopId] = useState<number | undefined>(undefined);
  // Incrementar este key fuerza remount de CatchBusMode (limpia selección al volver)
  const [catchBusModeKey, setCatchBusModeKey] = useState(0);

  // Plan mode map state
  const [planOrigin, setPlanOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [planDest, setPlanDest] = useState<{ lat: number; lng: number } | null>(null);
  const [planRouteStops, setPlanRouteStops] = useState<{ latitude: number; longitude: number }[]>([]);
  const [planDropoffStop, setPlanDropoffStop] = useState<{ latitude: number; longitude: number; name: string } | null>(null);
  const [routeActivityPositions, setRouteActivityPositions] = useState<{ lat: number; lng: number; minutes_ago: number }[]>([]);

  // Map pick mode for planner
  const [mapPickMode, setMapPickMode] = useState<'none' | 'origin' | 'dest'>('none');
  const [mapPickedOrigin, setMapPickedOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [mapPickedDest, setMapPickedDest] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 10.9685, lng: -74.7813 });
  const [onboardingDone, setOnboardingDone] = useState(true);

  useEffect(() => {
    if (!user) {
      setOnboardingDone(true);
      return;
    }
    setOnboardingDone(localStorage.getItem('onboarding_done') !== null);
  }, [user]);

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

  // ── On mount: open trip view if active trip, else show guide if no GPS ───
  useEffect(() => {
    if (!user) return;
    tripsApi.getCurrent()
      .then((r) => {
        if (r.data.trip) {
          setSheetMode('trip');
          setSheetState('middle');
        } else if (gpsState !== 'granted') {
          setSheetState('middle');
        }
      })
      .catch(() => {
        if (gpsState !== 'granted') setSheetState('middle');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clear map click when sheet opens ──────────────────────────────────────
  useEffect(() => {
    if (sheetState !== 'collapsed') setClickedPos(null);
  }, [sheetState]);

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
      const routes = res.data.routes as FeedRoute[];
      // Enriquecer rutas activas con estado de ocupación
      const enriched = await Promise.all(
        routes.map(async (r) => {
          if (!r.has_active_users) return r;
          try {
            const occRes = await reportsApi.getOccupancy(r.id);
            return { ...r, occupancy: occRes.data.state };
          } catch {
            return r;
          }
        })
      );
      setFeedRoutes(enriched);
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
    setShowCreditsPopup(false);

    // Planner map pick mode intercepts the click
    if (mapPickMode !== 'none') {
      if (mapPickMode === 'dest') {
        setMapPickedDest({ lat, lng });
        setMapPickedOrigin(null);
      } else {
        setMapPickedOrigin({ lat, lng });
        setMapPickedDest(null);
      }
      setMapPickMode('none');
      setSheetState('middle');
      return;
    }

    setClickedPos({ lat, lng });
  }

  function handleReported() {
    setRefreshTrigger((v) => v + 1);
    setClickedPos(null);
  }

  // ── Sheet actions bar ──────────────────────────────────────────────────────
  const tripSheetOpen = isOnTrip && sheetMode === 'trip' && sheetState !== 'collapsed';
  const plannerActive = sheetMode === 'planner';

  const actionsBar = isOnTrip ? (
    <button
      onClick={() => {
        if (tripSheetOpen) {
          setSheetState('collapsed');
        } else {
          setSheetMode('trip');
          setSheetState('middle');
        }
      }}
      className="w-full h-10 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors"
    >
      {tripSheetOpen ? '🗺️ Ver mapa' : '🚌 Viaje en curso →'}
    </button>
  ) : plannerActive && sheetState === 'collapsed' ? (
    <button
      onClick={() => setSheetState('middle')}
      className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
    >
      🗺️ Continuar planeando
    </button>
  ) : sheetMode === 'feed' ? (
    <div className="flex gap-2">
      <button
        onClick={() => { setSheetMode('trip'); setSheetState('middle'); setClickedPos(null); }}
        className="flex-1 h-10 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        🚌 Coger un bus
      </button>
      <button
        onClick={() => { setSheetMode('planner'); setSheetState('middle'); setClickedPos(null); }}
        className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        🗺️ Planear viaje
      </button>
    </div>
  ) : null;

  // ── Activity feed JSX ──────────────────────────────────────────────────────
  const liveRoutes = feedRoutes.filter((r) => r.has_active_users);
  const recentRoutes = feedRoutes.filter((r) => !r.has_active_users);

  const feedContent = (
    <div className="p-4 space-y-5 pb-4">

      {/* ── Guía contextual cuando GPS no está activo ── */}
      {gpsState !== 'granted' && (
        <div className="space-y-2">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-900">
              👋 Bienvenido a MiBus
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Activa tu ubicación para ver rutas cercanas y reportar buses en tiempo real. Tu GPS solo se comparte mientras viajas.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-start gap-2 text-xs text-gray-600">
                <span className="shrink-0">🚌</span>
                <span><strong>Coger un bus</strong> — reporta dónde va el bus y gana créditos</span>
              </div>
              <div className="flex items-start gap-2 text-xs text-gray-600">
                <span className="shrink-0">🗺️</span>
                <span><strong>Planear viaje</strong> — encuentra qué ruta te lleva a tu destino</span>
              </div>
            </div>
          </div>
          {gpsState === 'denied' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              📍 Sin GPS algunas funciones estarán limitadas, pero puedes explorar rutas y planear viajes.
            </p>
          )}
        </div>
      )}

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
                    <div className="flex items-center gap-2 pl-4 flex-wrap">
                      <p className="text-xs text-green-700">
                        {route.active_users_count > 0
                          ? `${route.active_users_count} persona${route.active_users_count !== 1 ? 's' : ''} en este bus`
                          : 'Activo en tiempo real'}
                      </p>
                      {route.occupancy && (
                        <span className="text-xs font-semibold">
                          {OCCUPANCY_BADGE[route.occupancy]}
                        </span>
                      )}
                    </div>
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
            {!isOnTrip && (
              <button
                onClick={() => {
                  setSheetMode('feed');
                  setActiveTripGeometry(null);
                  setCatchBusBoardingStop(null);
                  setClickedPos(null);
                  setPendingBoardRouteId(undefined);
                  setCatchBusModeKey((k) => k + 1);
                }}
                className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 mb-1"
              >
                ← Volver
              </button>
            )}
            <CatchBusMode
              key={catchBusModeKey}
              userPosition={userPosition}
              onTripChange={setIsOnTrip}
              onRouteGeometry={setActiveTripGeometry}
              onBoardingStop={setCatchBusBoardingStop}
              initialRouteId={pendingBoardRouteId}
              initialDestinationStopId={pendingDestinationStopId}
              onTripEnd={() => {
                setSheetMode('feed');
                setActiveTripGeometry(null);
                setCatchBusBoardingStop(null);
                setCatchBusModeKey((k) => k + 1);
              }}
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
                setMapPickMode('none');
                setMapPickedOrigin(null);
                setMapPickedDest(null);
                setClickedPos(null);
              }}
              className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 mb-3"
            >
              ← Volver
            </button>
            <PlanTripMode
              userPosition={userPosition}
              mapPickedOrigin={mapPickedOrigin}
              mapPickedDest={mapPickedDest}
              onRequestMapPick={(field) => {
                setMapPickedOrigin(null);
                setMapPickedDest(null);
                setMapPickMode(field);
                setSheetState('collapsed');
              }}
              onPlanUpdate={({ origin, dest, routeStops, dropoffStop }) => {
                if (sheetModeRef.current !== 'planner') return;
                setPlanOrigin(origin);
                setPlanDest(dest);
                setPlanRouteStops(routeStops);
                setPlanDropoffStop(dropoffStop);
              }}
              onBoardRoute={(routeId, destinationStopId) => {
                setPendingBoardRouteId(routeId);
                setPendingDestinationStopId(destinationStopId);
                setCatchBusModeKey((k) => k + 1);
                setSheetMode('trip');
                setSheetState('middle');
              }}
              onActivityPositions={setRouteActivityPositions}
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
        onCenterChange={(lat, lng) => setMapCenter({ lat, lng })}
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
        catchBusBoardingStop={catchBusBoardingStop}
        catchBusUserPosition={userPosition}
        routeActivityPositions={routeActivityPositions}
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

      {/* ── Map pick mode overlay ─────────────────────────────────────────── */}
      {mapPickMode !== 'none' && (
        <>
          {/* Crosshair fijo en el centro del mapa */}
          <div className="absolute inset-0 z-[1050] pointer-events-none flex items-center justify-center">
            <div className="relative flex items-center justify-center">
              {/* Sombra / halo */}
              <div className="absolute w-10 h-10 rounded-full bg-blue-500/20 animate-ping" />
              {/* Pin */}
              <div className="relative z-10 flex flex-col items-center" style={{ marginBottom: 28 }}>
                <div className="w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-white" />
                </div>
                {/* Cola del pin */}
                <div className="w-0.5 h-5 bg-blue-600" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600/40" />
              </div>
            </div>
          </div>

          {/* Instrucción arriba */}
          <div className="absolute top-16 left-4 right-4 z-[1100] flex justify-center pointer-events-none">
            <div className="bg-gray-900/85 backdrop-blur-sm text-white rounded-2xl px-4 py-2.5 shadow-xl flex items-center gap-2">
              <span className="text-sm font-medium">
                Mueve el mapa para posicionar el {mapPickMode === 'dest' ? 'destino' : 'origen'}
              </span>
            </div>
          </div>

          {/* Botones Confirmar + Cancelar abajo */}
          <div className="absolute bottom-6 left-4 right-4 z-[1100] flex gap-3">
            <button
              onClick={() => { setMapPickMode('none'); setSheetState('middle'); }}
              className="flex-1 h-12 bg-white border border-gray-200 text-gray-700 font-semibold rounded-2xl text-sm shadow-lg"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (mapPickMode === 'dest') {
                  setMapPickedDest(mapCenter);
                  setMapPickedOrigin(null);
                } else {
                  setMapPickedOrigin(mapCenter);
                  setMapPickedDest(null);
                }
                setMapPickMode('none');
                setSheetState('middle');
              }}
              className="flex-[2] h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl text-sm shadow-lg"
            >
              Confirmar ubicación
            </button>
          </div>
        </>
      )}

      {/* ── Report button (above sheet) ────────────────────────────────────── */}
      {user && clickedPos && !isOnTrip && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[1060] flex flex-col items-center gap-2">
          <ReportButton lat={clickedPos.lat} lng={clickedPos.lng} onReported={handleReported} />
          <button
            onClick={() => setClickedPos(null)}
            className="bg-white/90 backdrop-blur-sm text-gray-500 hover:text-gray-800 text-xs px-3 py-1 rounded-full shadow border border-gray-200"
          >
            ✕ Cerrar
          </button>
        </div>
      )}

      {/* ── Bottom sheet (auth only) ───────────────────────────────────────── */}
      {/* Hidden via CSS during map pick to preserve PlanTripMode state */}
      {user && (
        <div className={mapPickMode !== 'none' ? 'hidden' : ''}>
          <BottomSheet state={sheetState} onStateChange={setSheetState} actions={actionsBar}>
            {renderSheetContent()}
          </BottomSheet>
        </div>
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

      <Onboarding
        open={Boolean(user) && !onboardingDone}
        onFinish={() => {
          localStorage.setItem('onboarding_done', '1');
          setOnboardingDone(true);
        }}
      />
    </div>
  );
}
