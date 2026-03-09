import type { ReportType } from '../services/api';

interface ActiveTrip {
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

interface Props {
  toastMessage: string | null;
  activeTrip: ActiveTrip;
  activeTripCompany: string | null;
  eta: number | null;
  elapsedLabel: string;
  creditsThisTrip: number;
  gpsLost: boolean;
  deviationAlert: boolean;
  dropoffPrompt: boolean;
  dropoffBanner: 'prepare' | 'now' | 'missed' | null;
  occupancyState: 'lleno' | 'disponible' | null;
  routeReports: RouteReport[];
  confirmCreditsEarned: number;
  flashedBtn: ReportType | null;
  userLastOccupancy: 'lleno' | 'bus_disponible' | null;
  inactiveAlert: boolean;
  suspiciousAlert: boolean;
  showEndConfirm: boolean;
  tripLoading: boolean;
  onReportDeviation: () => void;
  onDeviationExit: () => void;
  onIgnoreDeviation: () => void;
  onActivateDropoff: () => void;
  onDeclineDropoff: () => void;
  onConfirmReport: (reportId: number) => void;
  onQuickReport: (type: ReportType, credits: number) => void;
  onShareBus: () => void;
  onRequestEnd: () => void;
  onInactiveContinue: () => void;
  onInactiveEnd: () => void;
  onSuspiciousTraffic: () => void;
  onSuspiciousEnd: () => void;
  onCancelEndConfirm: () => void;
  onConfirmEnd: () => void;
}

const REPORT_TYPE_LABEL: Record<string, { emoji: string; label: string }> = {
  desvio: { emoji: '🔀', label: 'Desvío' },
  trancon: { emoji: '🚦', label: 'Trancón' },
  lleno: { emoji: '🔴', label: 'Bus lleno' },
  bus_disponible: { emoji: '🟢', label: 'Hay sillas' },
  sin_parar: { emoji: '🚫', label: 'No paró' },
  espera: { emoji: '⏱️', label: 'Larga espera' },
};

const QUICK_REPORTS: { type: ReportType; emoji: string; label: string; credits: number }[] = [
  { type: 'desvio', emoji: '🔀', label: 'Desvío', credits: 4 },
  { type: 'trancon', emoji: '🚦', label: 'Trancón', credits: 4 },
];

const OCCUPANCY_REPORTS: { type: ReportType; emoji: string; label: string; credits: number }[] = [
  { type: 'lleno', emoji: '🔴', label: 'Bus lleno', credits: 3 },
  { type: 'bus_disponible', emoji: '🟢', label: 'Hay sillas', credits: 3 },
];

const OCCUPANCY_STATE_LABEL: Record<'lleno' | 'disponible', { emoji: string; label: string; color: string }> = {
  lleno: { emoji: '🔴', label: 'Bus lleno', color: 'bg-red-100 text-red-700 border-red-200' },
  disponible: { emoji: '🟢', label: 'Hay sillas', color: 'bg-green-100 text-green-700 border-green-200' },
};

export default function CatchBusActive({
  toastMessage,
  activeTrip,
  activeTripCompany,
  eta,
  elapsedLabel,
  creditsThisTrip,
  gpsLost,
  deviationAlert,
  dropoffPrompt,
  dropoffBanner,
  occupancyState,
  routeReports,
  confirmCreditsEarned,
  flashedBtn,
  userLastOccupancy,
  inactiveAlert,
  suspiciousAlert,
  showEndConfirm,
  tripLoading,
  onReportDeviation,
  onDeviationExit,
  onIgnoreDeviation,
  onActivateDropoff,
  onDeclineDropoff,
  onConfirmReport,
  onQuickReport,
  onShareBus,
  onRequestEnd,
  onInactiveContinue,
  onInactiveEnd,
  onSuspiciousTraffic,
  onSuspiciousEnd,
  onCancelEndConfirm,
  onConfirmEnd,
}: Props) {
  return (
    <div className="space-y-3">
      {toastMessage && (
        <div className="bg-gray-900 text-white text-sm rounded-xl px-3 py-2 text-center">
          {toastMessage}
        </div>
      )}

      <div className="bg-green-50 border border-green-100 rounded-2xl p-4 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
          <span className="text-xs text-green-700 font-semibold uppercase tracking-wide">En ruta</span>
        </div>

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

        <div className="flex items-end justify-between border-t border-green-100 pt-2">
          <div>
            {activeTrip.destination_stop_name && eta !== null ? (
              <>
                <p className="text-sm font-semibold text-blue-700">⏱ ~{eta} min restantes</p>
                <p className="text-xs text-gray-400 mt-0.5">→ {activeTrip.destination_stop_name}</p>
              </>
            ) : (
              <p className="text-sm font-semibold text-gray-700">
                ⏱ Viajando: {elapsedLabel}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-600 leading-none">+{creditsThisTrip}</p>
            <p className="text-xs text-gray-400">⚡ créditos</p>
          </div>
        </div>

        {gpsLost && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center">
            <p className="text-xs text-amber-700">📡 Sin señal GPS — pausado</p>
          </div>
        )}
      </div>

      {deviationAlert && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3.5 space-y-2.5">
          <p className="text-sm font-semibold text-orange-800">
            🔀 El bus parece estar fuera de su ruta habitual
          </p>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={onReportDeviation}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
            >
              🔀 Reportar desvío
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={onDeviationExit}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Me bajé
              </button>
              <button
                onClick={onIgnoreDeviation}
                className="flex-1 border border-gray-200 text-gray-500 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                Ignorar (5 min)
              </button>
            </div>
          </div>
        </div>
      )}

      {dropoffPrompt && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 space-y-2.5">
          <p className="text-sm font-semibold text-blue-800">
            🔔 Activar alerta de bajada · 5 créditos
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={onActivateDropoff}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-xl text-sm transition-colors"
            >
              Activar (5 créditos)
            </button>
            <button
              onClick={onDeclineDropoff}
              className="flex-1 border border-gray-200 text-gray-500 font-medium py-2 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              No activar
            </button>
          </div>
        </div>
      )}

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

      {occupancyState && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${OCCUPANCY_STATE_LABEL[occupancyState].color}`}>
          <span>{OCCUPANCY_STATE_LABEL[occupancyState].emoji}</span>
          <span>Estado actual: {OCCUPANCY_STATE_LABEL[occupancyState].label}</span>
        </div>
      )}

      {routeReports.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-gray-400">Reportes en tu bus</p>
            {confirmCreditsEarned > 0 && (
              <span className="text-xs text-green-600 font-semibold">⚡ +{confirmCreditsEarned} confirmados</span>
            )}
          </div>
          <div className="space-y-2">
            {routeReports.map((report) => {
              const label = REPORT_TYPE_LABEL[report.type] ?? { emoji: '📍', label: report.type };
              const validityText = report.is_valid
                ? '✅ Válido'
                : `${report.confirmations}/${report.needed_confirmations} confirmaciones`;
              return (
                <div key={report.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <span className="text-xl leading-none">{label.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 leading-tight">{label.label}</p>
                    <p className={`text-xs leading-tight ${report.is_valid ? 'text-green-600' : 'text-gray-400'}`}>
                      {validityText}
                    </p>
                  </div>
                  {!report.confirmed_by_me && confirmCreditsEarned < 3 ? (
                    <button
                      onClick={() => onConfirmReport(report.id)}
                      className="shrink-0 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Confirmar
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-400">
                      {report.confirmed_by_me ? '✓ Confirmado' : '🔒 Límite'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs text-gray-400 mb-1.5">Reportar incidencia</p>
        <div className="grid grid-cols-4 gap-1.5">
          {QUICK_REPORTS.map(({ type, emoji, label, credits }) => (
            <button
              key={type}
              onClick={() => onQuickReport(type, credits)}
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

          {OCCUPANCY_REPORTS.map(({ type, emoji, label, credits }) => (
            <button
              key={type}
              onClick={() => onQuickReport(type, credits)}
              className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                flashedBtn === type
                  ? 'bg-green-500 text-white scale-95'
                  : userLastOccupancy === type
                  ? type === 'lleno'
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <span className="text-xl leading-none">{emoji}</span>
              <span className="leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onShareBus}
        className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-2.5 rounded-xl text-sm transition-colors"
      >
        📤 Compartir este bus
      </button>

      <button
        onClick={onRequestEnd}
        className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl text-sm transition-colors"
      >
        🛑 Me bajé — Finalizar viaje
      </button>

      {inactiveAlert && (
        <div className="fixed inset-0 z-[2100] bg-black/50 flex items-end justify-center px-4 pb-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <p className="text-2xl text-center">🤔</p>
            <p className="font-semibold text-gray-900 text-center">¿Sigues en el bus?</p>
            <p className="text-sm text-gray-500 text-center">Llevas un rato sin moverte.</p>
            <div className="flex gap-2">
              <button
                onClick={onInactiveContinue}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
              >
                Sí, sigo viajando
              </button>
              <button
                onClick={onInactiveEnd}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                No, ya me bajé
              </button>
            </div>
          </div>
        </div>
      )}

      {suspiciousAlert && (
        <div className="fixed inset-0 z-[2200] bg-black/60 flex items-end justify-center px-4 pb-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <p className="text-2xl text-center">⚠️</p>
            <p className="font-semibold text-gray-900 text-center">Llevas 30 minutos sin moverte</p>
            <p className="text-sm text-gray-500 text-center">
              ¿Qué está pasando? Si ya te bajaste del bus se descontarán 30 minutos del bonus acumulado.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onSuspiciousTraffic}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
              >
                🚦 Estoy en un trancón
              </button>
              <button
                onClick={onSuspiciousEnd}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
              >
                🛑 Ya me bajé — Finalizar
              </button>
            </div>
          </div>
        </div>
      )}

      {showEndConfirm && (
        <div className="fixed inset-0 z-[2000] bg-black/50 flex items-end justify-center px-4 pb-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4 shadow-2xl">
            <p className="font-semibold text-gray-900 text-center">¿Confirmás que te bajaste?</p>
            <div className="flex gap-2">
              <button
                onClick={onCancelEndConfirm}
                className="flex-1 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
              >
                No, sigo en el bus
              </button>
              <button
                onClick={onConfirmEnd}
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
