import { useState } from 'react';
import { reportsApi, ReportType } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  lat: number;
  lng: number;
  onReported?: () => void;
}

const REPORT_TYPES: { value: ReportType; label: string; emoji: string; credits: number }[] = [
  { value: 'bus_location', label: 'Ubicación del bus',   emoji: '🚌', credits: 5 },
  { value: 'traffic',      label: 'Trancón',             emoji: '🚗', credits: 4 },
  { value: 'bus_full',     label: 'Bus lleno / vacío',   emoji: '👥', credits: 3 },
  { value: 'no_service',   label: 'Bus no está pasando', emoji: '🚫', credits: 4 },
  { value: 'detour',       label: 'Desvío de ruta',      emoji: '↪️',  credits: 4 },
];

export default function ReportButton({ lat, lng, onReported }: Props) {
  const { refreshProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReport = async (type: ReportType, credits: number) => {
    setLoading(true);
    setError(null);
    try {
      await reportsApi.create({ type, latitude: lat, longitude: lng });
      setSuccess(`¡Reporte enviado! +${credits} créditos`);
      setOpen(false);
      await refreshProfile();
      onReported?.();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Error al enviar reporte');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      {/* Toast de éxito */}
      {success && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-10">
          {success}
        </div>
      )}

      {/* Toast de error */}
      {error && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-10">
          {error}
        </div>
      )}

      {/* Panel de tipos */}
      {open && (
        <div className="absolute bottom-full mb-3 right-0 bg-white rounded-xl shadow-xl border border-gray-100 w-64 overflow-hidden z-10">
          <p className="px-4 py-2 text-xs text-gray-400 uppercase tracking-wide border-b">
            ¿Qué reportas?
          </p>
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt.value}
              onClick={() => handleReport(rt.value, rt.credits)}
              disabled={loading}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left disabled:opacity-50"
            >
              <span className="text-xl">{rt.emoji}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{rt.label}</p>
              </div>
              <span className="text-xs text-green-600 font-semibold">+{rt.credits}★</span>
            </button>
          ))}
        </div>
      )}

      {/* Botón principal */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-semibold px-5 py-3 rounded-full shadow-lg transition-all"
      >
        <span className="text-lg">📍</span>
        Reportar
      </button>
    </div>
  );
}
