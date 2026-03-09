import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi, creditsApi, usersApi } from '../services/api';

interface BalanceData {
  credits: number;
  is_premium: boolean;
  trial_expires_at: string | null;
  premium_expires_at: string | null;
}

interface Transaction {
  id: number;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

interface StatsData {
  total_trips: number;
  total_reports: number;
  credits_earned: number;
  report_streak: number;
}

interface ReferralData {
  code: string;
  total_referred: number;
  credits_earned: number;
}

function formatRelativeDate(input: string): string {
  const date = new Date(input);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  const absMinutes = Math.abs(diffMinutes);
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  if (absMinutes < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function Profile() {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [referral, setReferral] = useState<ReferralData | null>(null);

  useEffect(() => {
    if (!user) return;
    setNameInput(user.name);
  }, [user]);

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    setError(null);
    Promise.all([
      creditsApi.getBalance(),
      creditsApi.getHistory(20),
      creditsApi.getStats(),
      usersApi.getReferral(),
    ])
      .then(([balRes, histRes, statsRes, referralRes]) => {
        setBalance(balRes.data as BalanceData);
        setTransactions((histRes.data?.transactions ?? []) as Transaction[]);
        setStats(statsRes.data as StatsData);
        setReferral(referralRes.data as ReferralData);
      })
      .catch(() => {
        setError('No se pudo cargar tu perfil en este momento.');
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  const statusBadge = useMemo(() => {
    if (!balance) return null;
    const now = new Date();
    const premiumUntil = balance.premium_expires_at ? new Date(balance.premium_expires_at) : null;
    const trialUntil = balance.trial_expires_at ? new Date(balance.trial_expires_at) : null;

    if (premiumUntil && premiumUntil > now) {
      return {
        label: '🟢 Premium activo',
        sub: `Activo hasta ${formatDate(balance.premium_expires_at)}`,
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      };
    }

    if (trialUntil && trialUntil > now) {
      const msLeft = trialUntil.getTime() - now.getTime();
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86400000));
      return {
        label: `⏰ Trial (${daysLeft} día${daysLeft === 1 ? '' : 's'} restantes)`,
        sub: `Termina ${formatDate(balance.trial_expires_at)}`,
        className: 'bg-blue-50 border-blue-200 text-blue-800',
      };
    }

    if (balance.is_premium) {
      return {
        label: '🟢 Premium activo',
        sub: '',
        className: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      };
    }

    return {
      label: '🔓 Plan gratuito',
      sub: '',
      className: 'bg-gray-50 border-gray-200 text-gray-700',
    };
  }, [balance]);

  if (!user) return <Navigate to="/login" replace />;

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setError('El nombre no puede estar vacío.');
      return;
    }

    setSavingName(true);
    setError(null);
    setSuccess(null);
    try {
      await authApi.updateProfile({ name: trimmed });
      await refreshProfile();
      setNameInput(trimmed);
      setSuccess('Nombre actualizado.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'No se pudo actualizar el nombre.');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Perfil</p>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
          <Link
            to="/premium"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Obtener Premium
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 animate-pulse">
          <div className="h-4 w-1/3 bg-gray-200 rounded mb-3" />
          <div className="h-8 w-1/4 bg-gray-200 rounded" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-100 rounded-2xl p-5 md:col-span-1">
              <p className="text-sm text-gray-500">Saldo actual</p>
              <p className="text-4xl font-bold text-brand-700 mt-1">⚡ {balance?.credits ?? user.credits}</p>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl p-5 md:col-span-2">
              {statusBadge && (
                <div className={`rounded-xl border px-4 py-3 ${statusBadge.className}`}>
                  <p className="font-semibold">{statusBadge.label}</p>
                  {statusBadge.sub && <p className="text-sm mt-0.5">{statusBadge.sub}</p>}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <p className="font-semibold text-gray-900">Editar nombre</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Tu nombre"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={savingName}
                className="bg-gray-900 hover:bg-black disabled:opacity-60 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                {savingName ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">{success}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-sm text-gray-500">Total viajes</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats?.total_trips ?? 0}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-sm text-gray-500">Total reportes</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats?.total_reports ?? 0}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-sm text-gray-500">Créditos ganados</p>
              <p className="text-3xl font-bold text-green-600 mt-1">+{stats?.credits_earned ?? 0}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <p className="text-sm text-gray-500">Racha actual</p>
              <p className="text-3xl font-bold text-orange-600 mt-1">🔥 {stats?.report_streak ?? 0}</p>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <p className="font-semibold text-gray-900 mb-3">Últimas 20 transacciones</p>
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-500">Aún no tienes movimientos.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {transactions.map((tx) => (
                  <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {tx.description || tx.type}
                      </p>
                      <p className="text-xs text-gray-500">{formatRelativeDate(tx.created_at)}</p>
                    </div>
                    <p className={`text-sm font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">Historial de viajes</p>
              <p className="text-sm text-gray-500">Revisa ruta, fecha, duración y créditos ganados.</p>
            </div>
            <Link
              to="/trips/history"
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Ver historial
            </Link>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
            <p className="font-semibold text-gray-900">Referidos</p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 min-w-[180px]">
                <p className="text-xs text-blue-700 uppercase tracking-wide">Tu código</p>
                <p className="text-2xl font-bold text-blue-900 mt-0.5">{referral?.code ?? '------'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!referral?.code) return;
                    try {
                      await navigator.clipboard.writeText(referral.code);
                      setSuccess('Código copiado.');
                    } catch {
                      setError('No se pudo copiar el código.');
                    }
                  }}
                  className="bg-gray-900 hover:bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  Copiar código
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Usa mi código ${referral?.code ?? ''} en MiBus y gana créditos extra! mibus.co`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                >
                  Compartir en WhatsApp
                </a>
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Has referido {referral?.total_referred ?? 0} amigo{(referral?.total_referred ?? 0) === 1 ? '' : 's'} → ganaste {referral?.credits_earned ?? 0} créditos
            </p>
          </div>
        </>
      )}
    </div>
  );
}
