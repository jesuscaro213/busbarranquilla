import { useEffect, useState } from 'react';
import { creditsApi } from '../services/api';

interface Transaction {
  id: number;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

interface BalanceData {
  credits: number;
  is_premium: boolean;
  trial_expires_at: string;
  premium_expires_at: string | null;
}

export default function CreditBalance() {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      creditsApi.getBalance(),
      creditsApi.getHistory(5),
    ])
      .then(([balRes, histRes]) => {
        setBalance(balRes.data);
        setTransactions(histRes.data.transactions);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-8 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  if (!balance) return null;

  const trialActive = balance.trial_expires_at && new Date(balance.trial_expires_at) > new Date();

  return (
    <div className="bg-white rounded-xl shadow p-5 space-y-4">
      {/* Saldo principal */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Tus créditos</p>
          <p className="text-3xl font-bold text-brand-700">{balance.credits}</p>
        </div>
        <div className="text-4xl">🪙</div>
      </div>

      {/* Estado premium */}
      {balance.is_premium && (
        <div className={`rounded-lg px-3 py-2 text-sm font-medium ${
          trialActive
            ? 'bg-blue-50 text-blue-700 border border-blue-200'
            : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
        }`}>
          {trialActive
            ? `✨ Trial premium activo hasta ${new Date(balance.trial_expires_at).toLocaleDateString('es-CO')}`
            : '👑 Premium activo'
          }
        </div>
      )}

      {/* Últimas transacciones */}
      {transactions.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Últimos movimientos</p>
          <ul className="space-y-1.5">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-600 truncate max-w-[180px]">{t.description}</span>
                <span className={`font-semibold ml-2 ${t.amount > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {t.amount > 0 ? '+' : ''}{t.amount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
