interface Route {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  frequency_minutes: number | null;
}

interface ActivityEvent {
  type: string;
  minutes_ago: number;
  confirmations?: number;
}

interface ActivityData {
  active_count: number;
  last_activity_minutes: number | null;
  events: ActivityEvent[];
}

interface BoardingStop {
  latitude: number;
  longitude: number;
  name: string;
}

interface Props {
  toastMessage: string | null;
  selectedRoute: Route;
  routeActivity: ActivityData | null;
  boardingStop: BoardingStop | null;
  boardingDistanceMeters: number | null;
  showBoardConfirm: boolean;
  tripLoading: boolean;
  onWaitReportNoStop: () => void;
  onWaitReportCrowded: () => void;
  onRequestBoardConfirm: () => void;
  onCancelWaiting: () => void;
  onConfirmDifferentBus: () => void;
  onStartTrip: () => void;
}

export default function CatchBusWaiting({
  toastMessage,
  selectedRoute,
  routeActivity,
  boardingStop,
  boardingDistanceMeters,
  showBoardConfirm,
  tripLoading,
  onWaitReportNoStop,
  onWaitReportCrowded,
  onRequestBoardConfirm,
  onCancelWaiting,
  onConfirmDifferentBus,
  onStartTrip,
}: Props) {
  return (
    <div className="space-y-3">
      {toastMessage && (
        <div className="bg-gray-900 text-white text-sm rounded-xl px-3 py-2 text-center">
          {toastMessage}
        </div>
      )}

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

      {routeActivity && (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl px-3.5 py-3 text-sm text-gray-700">
          {routeActivity.active_count > 0 ? (
            <span className="font-medium text-green-700">
              🚌 {routeActivity.active_count} {routeActivity.active_count === 1 ? 'persona' : 'personas'} en el bus ahora
            </span>
          ) : routeActivity.last_activity_minutes !== null ? (
            <span className="text-gray-500">
              📡 Última actividad hace {routeActivity.last_activity_minutes} min
            </span>
          ) : (
            <span className="text-gray-400">Sin actividad reciente en esta ruta</span>
          )}
        </div>
      )}

      {boardingStop && (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-lg shrink-0">📍</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                Parada de abordaje
              </p>
              <p className="text-sm font-medium text-gray-800 truncate">
                {boardingStop.name?.trim() || 'Parada más cercana'}
              </p>
              {boardingDistanceMeters !== null && (
                <p className="text-xs text-green-700 mt-0.5">
                  🚶 {boardingDistanceMeters} m caminando
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 py-1">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm font-medium text-gray-600">Esperando el bus...</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onWaitReportNoStop}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2.5 rounded-xl transition-colors"
        >
          🚫 El bus pasó sin parar
        </button>
        <button
          onClick={onWaitReportCrowded}
          className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium py-2.5 rounded-xl transition-colors"
        >
          👥 Mucha gente esperando
        </button>
      </div>

      <button
        onClick={onRequestBoardConfirm}
        className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
      >
        🚌 Ya me monté — Confirmar
      </button>

      <button
        onClick={onCancelWaiting}
        className="w-full text-gray-400 hover:text-gray-600 text-sm py-1.5 transition-colors"
      >
        El bus no llegó — cancelar
      </button>

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
                onClick={onConfirmDifferentBus}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                No, cogí otro
              </button>
              <button
                onClick={onStartTrip}
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
