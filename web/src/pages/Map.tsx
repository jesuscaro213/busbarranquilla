import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MapView from '../components/MapView';
import ReportButton from '../components/ReportButton';
import TripPanel from '../components/TripPanel';
import NearbyRoutes from '../components/NearbyRoutes';
import RoutePlanner, { type RouteRecommendation } from '../components/RoutePlanner';

export default function Map() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [clickedPos, setClickedPos] = useState<{ lat: number; lng: number } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [isOnTrip, setIsOnTrip] = useState(false);
  const [preselectedRouteId, setPreselectedRouteId] = useState<number | null>(null);
  const [destinationCenter, setDestinationCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [recommendedRoutes, setRecommendedRoutes] = useState<RouteRecommendation[]>([]);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RouteRecommendation | null>(null);

  const handleMapClick = (lat: number, lng: number) => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (!isOnTrip) setClickedPos({ lat, lng });
  };

  const handleReported = () => {
    setRefreshTrigger((v) => v + 1);
    setClickedPos(null);
  };

  const handleUserLocation = (lat: number, lng: number) => {
    setUserPosition([lat, lng]);
  };

  const handleSelectRoute = (routeId: number) => {
    setPreselectedRouteId(routeId);
  };

  const handleSelectRecommendation = (rec: RouteRecommendation) => {
    setSelectedRecommendation(rec?.route ? rec : null);
    if (rec?.route) setPreselectedRouteId(rec.route.id);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Barra de instrucción */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {user
            ? isOnTrip
              ? '🚌 Transmitiendo tu ubicación en tiempo real'
              : clickedPos
              ? `📍 Posición: ${clickedPos.lat.toFixed(4)}, ${clickedPos.lng.toFixed(4)}`
              : 'Haz clic en el mapa para reportar o usa los paneles'
            : 'Inicia sesión para hacer reportes y reportar ubicaciones'}
        </p>
        {clickedPos && !isOnTrip && (
          <button
            onClick={() => setClickedPos(null)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* Mapa */}
      <div className="flex-1 relative">
        <MapView
          onMapClick={handleMapClick}
          refreshTrigger={refreshTrigger}
          onUserLocation={handleUserLocation}
          destinationCenter={destinationCenter}
          recommendedRoutes={recommendedRoutes}
          selectedRoute={selectedRecommendation}
        />

        {/* Panel izquierdo: Trip + Nearby + Planner */}
        {user && (
          <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2 w-72">
            <TripPanel
              userPosition={userPosition}
              onTripChange={setIsOnTrip}
              preselectedRouteId={preselectedRouteId}
            />
            <NearbyRoutes
              userPosition={userPosition}
              onSelectRoute={handleSelectRoute}
            />
            <RoutePlanner
              userPosition={userPosition}
              onDestinationSelected={(lat, lng) => setDestinationCenter({ lat, lng })}
              onSelectRoute={handleSelectRoute}
              onRecommendations={setRecommendedRoutes}
              onSelectRecommendation={handleSelectRecommendation}
            />
          </div>
        )}

        {/* Botón de reporte flotante (solo visible si no hay viaje activo) */}
        {user && clickedPos && !isOnTrip && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
            <ReportButton
              lat={clickedPos.lat}
              lng={clickedPos.lng}
              onReported={handleReported}
            />
          </div>
        )}

        {/* Leyenda */}
        <div className="absolute top-3 right-3 bg-white rounded-xl shadow-lg p-3 z-[1000] text-xs space-y-1">
          <p className="font-semibold text-gray-700 mb-2">Leyenda</p>
          {[
            ['🚍', 'Bus activo (tiempo real)'],
            ['🔵', 'Tu ubicación'],
            ['🚌', 'Reporte bus'],
            ['🚗', 'Trancón'],
            ['👥', 'Bus lleno'],
            ['🚫', 'Sin servicio'],
            ['↪️', 'Desvío'],
          ].map(([emoji, label]) => (
            <div key={label} className="flex items-center gap-2">
              <span>{emoji}</span>
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </div>

        {/* CTA para no autenticados */}
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
    </div>
  );
}
