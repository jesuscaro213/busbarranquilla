import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { paymentsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Plan {
  id: 'monthly';
  name: string;
  price_cop: number;
  duration_days: number;
  features: string[];
}

const formatCop = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

export default function PremiumPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPremiumUser = Boolean(user && (user.is_premium || user.role === 'premium'));

  useEffect(() => {
    let mounted = true;
    paymentsApi.getPlans()
      .then((res) => {
        if (!mounted) return;
        const plans = (res.data?.plans ?? []) as Plan[];
        setPlan(plans.find((p) => p.id === 'monthly') ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setError('No se pudieron cargar los planes en este momento.');
      })
      .finally(() => { if (mounted) setLoadingPlan(false); });
    return () => { mounted = false; };
  }, []);

  const handleCheckout = async () => {
    if (!user) { navigate('/login'); return; }
    setError(null);
    setCheckoutLoading(true);
    try {
      const res = await paymentsApi.createCheckout('monthly');
      const checkoutUrl = res.data?.checkout_url as string | undefined;
      if (!checkoutUrl) throw new Error('No se recibió URL de checkout');
      window.location.href = checkoutUrl;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'No fue posible iniciar el pago. Intenta de nuevo.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-md mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <p className="text-4xl mb-2">⚡</p>
          <h1 className="text-3xl font-bold text-gray-900">MiBus Premium</h1>
          <p className="text-gray-500 mt-2">Viaja más inteligente</p>
        </div>

        {isPremiumUser && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl px-5 py-4 text-sm">
            <p className="font-semibold">Ya eres Premium ✓</p>
            {user?.premium_expires_at && (
              <p className="mt-1 text-emerald-700">
                Activo hasta el {new Date(user.premium_expires_at).toLocaleDateString('es-CO')}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {loadingPlan ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-1/2 mb-6" />
            <div className="space-y-2 mb-6">
              <div className="h-3 bg-gray-100 rounded" />
              <div className="h-3 bg-gray-100 rounded" />
              <div className="h-3 bg-gray-100 rounded w-4/5" />
            </div>
            <div className="h-11 bg-gray-100 rounded-xl" />
          </div>
        ) : plan ? (
          <div className="bg-white border-2 border-blue-500 rounded-2xl p-6 shadow-sm">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{plan.name}</p>
            <p className="text-4xl font-bold text-gray-900 mt-2">{formatCop(plan.price_cop)}</p>
            <p className="text-sm text-gray-500 mt-1">por 30 días · se renueva manualmente</p>

            <ul className="mt-5 space-y-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-green-500 font-bold shrink-0">✓</span>
                  {feature}
                </li>
              ))}
            </ul>

            {!isPremiumUser && (
              <button
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl py-3 transition-colors"
              >
                {checkoutLoading ? 'Redirigiendo…' : 'Suscribirse — $4.900 COP'}
              </button>
            )}

            {isPremiumUser && (
              <button
                onClick={() => navigate('/map')}
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3 transition-colors"
              >
                Ir al mapa →
              </button>
            )}
          </div>
        ) : null}

        <p className="text-xs text-gray-400 text-center mt-6">
          Pagos procesados de forma segura por Wompi · Colombia
        </p>
      </div>
    </div>
  );
}
