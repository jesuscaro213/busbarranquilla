import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';

export default function Register() {
  const { register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onGoogleClick = useGoogleLogin({
    scope: 'openid email profile',
    onSuccess: async (tokenResponse) => {
      setError('');
      setLoading(true);
      try {
        await googleLogin(tokenResponse.access_token);
        navigate('/');
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setError(msg || 'No se pudo continuar con Google');
      } finally {
        setLoading(false);
      }
    },
    onError: () => {
      setError('No se pudo continuar con Google');
    },
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(name, email, password, phone || undefined, referralCode || undefined);
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'Error al crear la cuenta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-900 to-blue-700 px-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🚌</div>
          <h1 className="text-2xl font-bold text-gray-900">Crear cuenta</h1>
          <p className="text-gray-500 text-sm mt-1">14 días premium gratis + 50 créditos</p>
        </div>

        {/* Beneficios */}
        <div className="bg-blue-50 rounded-lg px-4 py-3 mb-5 text-sm text-blue-700 space-y-1">
          <p>✅ 50 créditos de bienvenida</p>
          <p>✅ 14 días premium gratis</p>
          <p>✅ Gana créditos reportando</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Tu nombre"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="tu@correo.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teléfono <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="3001234567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Código de referido <span className="text-gray-400">(opcional)</span>
            </label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="MB3X9K"
              maxLength={10}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Creando cuenta…' : 'Crear cuenta gratis'}
          </button>

          <button
            type="button"
            disabled={loading || !googleEnabled}
            onClick={() => onGoogleClick()}
            className="w-full border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 font-semibold py-2.5 rounded-lg transition-colors"
          >
            Continuar con Google
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-blue-600 font-medium hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
