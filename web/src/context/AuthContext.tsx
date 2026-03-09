import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi, tripsApi } from '../services/api';

interface User {
  id: number;
  name: string;
  email: string;
  credits: number;
  role: 'admin' | 'premium' | 'free';
  is_premium: boolean;
  trial_expires_at: string;
  premium_expires_at: string | null;
  reputation: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  googleLogin: (idToken: string) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string, referralCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  // Al montar, cargar perfil si hay token guardado
  useEffect(() => {
    if (token) {
      authApi.getProfile()
        .then((res) => setUser(res.data.user))
        .catch(() => {
          localStorage.removeItem('token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const googleLogin = async (idToken: string) => {
    const res = await authApi.googleLogin(idToken);
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const register = async (name: string, email: string, password: string, phone?: string, referralCode?: string) => {
    const res = await authApi.register({ name, email, password, phone, referralCode });
    const { token: newToken, user: userData } = res.data;
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const logout = async () => {
    try {
      const current = await tripsApi.getCurrent();
      if (current.data.trip) {
        await tripsApi.end();
      }
    } catch { /* ignore — best effort */ }
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    const res = await authApi.getProfile();
    setUser({ ...res.data.user });
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, googleLogin, register, logout, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
};
