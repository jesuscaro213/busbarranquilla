import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { paymentsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

type PlanId = 'monthly' | 'yearly';

interface Plan {
  id: PlanId;
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

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monthlyPlan = plans.find((plan) => plan.id === 'monthly');
  const yearlyPlan = plans.find((plan) => plan.id === 'yearly');

  const yearlySavingsPercent = useMemo(() => {
    if (!monthlyPlan || !yearlyPlan) return 0;
    const monthlyYearCost = monthlyPlan.price_cop * 12;
    if (monthlyYearCost <= 0) return 0;
    return Math.round((1 - yearlyPlan.price_cop / monthlyYearCost) * 100);
  }, [monthlyPlan, yearlyPlan]);

  const isPremiumUser = Boolean(user && (user.is_premium || user.role === 'premium'));

  useEffect(() => {
    let mounted = true;
    paymentsApi
      .getPlans()
      .then((res) => {
        if (!mounted) return;
        const fetchedPlans = (res.data?.plans ?? []) as Plan[];
        setPlans(fetchedPlans);
      })
      .catch(() => {
        if (!mounted) return;
        setError('No se pudieron cargar los planes en este momento.');
      })
      .finally(() => {
        if (mounted) setLoadingPlans(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleCheckout = async (plan: PlanId) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setError(null);
    setCheckoutLoading(plan);
    try {
      const res = await paymentsApi.createCheckout(plan);
      const checkoutUrl = res.data?.checkout_url as string | undefined;
      if (!checkoutUrl) {
        throw new Error('No se recibió URL de checkout');
      }
      window.location.href = checkoutUrl;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'No fue posible iniciar el pago. Intenta de nuevo.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gradient-to-b from-blue-50 to-white">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">MiBus Premium</h1>
          <p className="text-gray-600 mt-2">Viaja mas inteligente</p>
        </div>

        {isPremiumUser && (
          <div className="mb-8 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl px-5 py-4 text-sm">
            <p className="font-semibold">Ya eres Premium ✓</p>
            {user?.premium_expires_at && (
              <p className="mt-1">
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

        {loadingPlans ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-2xl p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
                <div className="h-8 bg-gray-200 rounded w-1/2 mb-6" />
                <div className="space-y-2 mb-6">
                  <div className="h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded w-4/5" />
                </div>
                <div className="h-10 bg-gray-100 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {monthlyPlan && (
              <div className="bg-white border border-blue-200 rounded-2xl p-6 shadow-sm">
                <p className="text-sm font-semibold text-blue-700">{monthlyPlan.name}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{formatCop(monthlyPlan.price_cop)}</p>
                <p className="text-sm text-gray-500 mt-1">cada 30 dias</p>
                <ul className="mt-5 space-y-2 text-sm text-gray-700">
                  {monthlyPlan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
                {!isPremiumUser && (
                  <button
                    onClick={() => handleCheckout('monthly')}
                    disabled={checkoutLoading !== null}
                    className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 transition-colors"
                  >
                    {checkoutLoading === 'monthly' ? 'Redirigiendo…' : 'Suscribirse'}
                  </button>
                )}
              </div>
            )}

            {yearlyPlan && (
              <div className="bg-white border border-emerald-300 rounded-2xl p-6 shadow-sm relative">
                <span className="absolute top-4 right-4 bg-emerald-100 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                  Mas popular
                </span>
                <p className="text-sm font-semibold text-emerald-700">{yearlyPlan.name}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{formatCop(yearlyPlan.price_cop)}</p>
                <p className="text-sm text-gray-500 mt-1">por 365 dias</p>
                {yearlySavingsPercent > 0 && (
                  <p className="mt-2 text-sm text-emerald-700 font-medium">Ahorras {yearlySavingsPercent}%</p>
                )}
                <ul className="mt-5 space-y-2 text-sm text-gray-700">
                  {yearlyPlan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
                {!isPremiumUser && (
                  <button
                    onClick={() => handleCheckout('yearly')}
                    disabled={checkoutLoading !== null}
                    className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-xl py-2.5 transition-colors"
                  >
                    {checkoutLoading === 'yearly' ? 'Redirigiendo…' : 'Suscribirse'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
