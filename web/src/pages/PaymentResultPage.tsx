import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type ResultStatus = 'success' | 'error';

export default function PaymentResultPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);

  const status = useMemo(() => (searchParams.get('status') ?? '').toUpperCase(), [searchParams]);
  const resultType: ResultStatus = status === 'APPROVED' ? 'success' : 'error';

  useEffect(() => {
    if (!status) {
      navigate('/map', { replace: true });
      return;
    }

    if (status === 'APPROVED') {
      refreshProfile().catch(() => undefined).finally(() => setLoading(false));
      return;
    }

    setLoading(false);
  }, [status, navigate, refreshProfile]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 text-center">
          <p className="text-lg font-semibold text-gray-900">Procesando resultado del pago...</p>
          <p className="text-sm text-gray-500 mt-2">Esto tarda solo unos segundos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 px-4 py-10">
      <div className="max-w-xl mx-auto">
        {resultType === 'success' ? (
          <div className="bg-white border border-emerald-200 rounded-2xl shadow-sm p-7 text-center">
            <h1 className="text-2xl font-bold text-emerald-700">Ya eres Premium</h1>
            <p className="text-gray-700 mt-3">Tu pago fue aprobado y recibiste 50 creditos de bono.</p>
            <button
              onClick={() => navigate('/map')}
              className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Ir al mapa
            </button>
          </div>
        ) : (
          <div className="bg-white border border-red-200 rounded-2xl shadow-sm p-7 text-center">
            <h1 className="text-2xl font-bold text-red-600">El pago no fue procesado</h1>
            <p className="text-gray-700 mt-3">Puedes intentarlo de nuevo desde la pagina Premium.</p>
            <button
              onClick={() => navigate('/premium')}
              className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
