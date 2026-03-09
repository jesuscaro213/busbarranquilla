import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import pool from '../config/database';
import { awardCredits } from './creditController';

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(googleClientId);

interface AuthUserRow {
  id: number;
  name: string;
  email: string;
  credits: number;
  role: 'admin' | 'premium' | 'free';
  is_premium: boolean;
  trial_expires_at: Date | null;
  premium_expires_at: Date | null;
  is_active?: boolean;
  password?: string | null;
}

function signAuthToken(user: Pick<AuthUserRow, 'id' | 'email' | 'role'>): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET as string,
    { expiresIn: '30d' }
  );
}

function buildAuthUser(user: AuthUserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    credits: user.credits,
    role: user.role,
    is_premium: user.is_premium,
    trial_expires_at: user.trial_expires_at,
    premium_expires_at: user.premium_expires_at,
  };
}

async function normalizePremiumState(user: AuthUserRow): Promise<AuthUserRow> {
  if (user.trial_expires_at && user.trial_expires_at < new Date() && user.is_premium && !user.premium_expires_at) {
    await pool.query('UPDATE users SET is_premium = false WHERE id = $1', [user.id]);
    return { ...user, is_premium: false };
  }
  return user;
}

const REFERRAL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERRAL_CODE_LENGTH = 6;

function randomReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * REFERRAL_ALPHABET.length);
    code += REFERRAL_ALPHABET[idx];
  }
  return code;
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = randomReferralCode();
    const exists = await pool.query('SELECT id FROM users WHERE referral_code = $1 LIMIT 1', [code]);
    if (exists.rows.length === 0) return code;
  }
  throw new Error('No se pudo generar código de referido único');
}

// Registro de usuario
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, phone, referralCode } = req.body as {
    name: string;
    email: string;
    password: string;
    phone?: string;
    referralCode?: string;
  };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name?.trim() || !email?.trim() || !password) {
    res.status(400).json({ message: 'Nombre, correo y contraseña son obligatorios' });
    return;
  }
  if (!emailRegex.test(email.trim())) {
    res.status(400).json({ message: 'El correo electrónico no es válido' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
    return;
  }

  try {
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.trim()]
    );

    if (userExists.rows.length > 0) {
      res.status(400).json({ message: 'El correo ya está registrado' });
      return;
    }

    const normalizedReferral = (referralCode ?? '').trim().toUpperCase();
    let referrerId: number | null = null;
    if (normalizedReferral) {
      const referrerRes = await pool.query(
        'SELECT id FROM users WHERE referral_code = $1 LIMIT 1',
        [normalizedReferral]
      );
      if (referrerRes.rows.length === 0) {
        res.status(400).json({ message: 'Código de referido inválido' });
        return;
      }
      referrerId = Number(referrerRes.rows[0].id);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralCodeForUser = await generateUniqueReferralCode();
    const welcomeCredits = 50 + (referrerId ? 10 : 0);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, phone, credits, role, is_premium, trial_expires_at, referral_code, referred_by)
       VALUES ($1, $2, $3, $4, $5, 'free', true, NOW() + INTERVAL '14 days', $6, $7)
       RETURNING id, name, email, credits, role, is_premium, trial_expires_at`,
      [name.trim(), email.trim(), hashedPassword, phone?.trim(), welcomeCredits, referralCodeForUser, referrerId]
    );

    const user = result.rows[0];

    await pool.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, 50, 'bonus', 'Créditos de bienvenida')`,
      [user.id]
    );

    if (referrerId) {
      await pool.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, 10, 'referral', 'Bono por registro con código de referido')`,
        [user.id]
      );
      await awardCredits(referrerId, 25, 'referral', 'Amigo registrado con tu código');
    }

    const token = signAuthToken(user);

    res.status(201).json({
      message: '¡Bienvenido a BusBarranquilla! Tienes 14 días premium gratis',
      token,
      user: {
        ...buildAuthUser(user),
      },
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Login de usuario
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ message: 'Correo o contraseña incorrectos' });
      return;
    }

    let user = result.rows[0] as AuthUserRow;

    if (user.is_active === false) {
      res.status(403).json({ message: 'Esta cuenta ha sido desactivada' });
      return;
    }

    if (!user.password) {
      res.status(400).json({ message: 'Esta cuenta usa Google. Continúa con Google para ingresar.' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json({ message: 'Correo o contraseña incorrectos' });
      return;
    }

    user = await normalizePremiumState(user);
    const token = signAuthToken(user);

    res.json({
      message: 'Bienvenido de vuelta',
      token,
      user: {
        ...buildAuthUser(user),
      },
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

async function getGoogleProfile(token: string): Promise<{ email: string; name: string; picture?: string | null } | null> {
  if (!googleClientId) return null;

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: token, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email) return null;
    return {
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      picture: payload.picture || null,
    };
  } catch {
    // Fallback: token recibido desde useGoogleLogin suele ser access_token.
  }

  try {
    const tokenInfo = await googleClient.getTokenInfo(token);
    const aud = tokenInfo.aud;
    const validAudience = Array.isArray(aud) ? aud.includes(googleClientId) : aud === googleClientId;
    if (!validAudience || !tokenInfo.email) return null;

    const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userInfo = userInfoRes.data as { email?: string; name?: string; picture?: string };
    if (!userInfo.email) return null;

    return {
      email: userInfo.email,
      name: userInfo.name || userInfo.email.split('@')[0],
      picture: userInfo.picture || null,
    };
  } catch {
    return null;
  }
}

export const googleLogin = async (req: Request, res: Response): Promise<void> => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    res.status(400).json({ message: 'idToken es obligatorio' });
    return;
  }

  if (!googleClientId) {
    res.status(500).json({ message: 'GOOGLE_CLIENT_ID no configurado' });
    return;
  }

  try {
    const googleProfile = await getGoogleProfile(idToken);
    if (!googleProfile) {
      res.status(401).json({ message: 'Token de Google inválido' });
      return;
    }

    const existingRes = await pool.query(
      `SELECT id, name, email, credits, role, is_premium, trial_expires_at, premium_expires_at, is_active
       FROM users WHERE email = $1`,
      [googleProfile.email]
    );

    let user: AuthUserRow;

    if (existingRes.rows.length > 0) {
      user = existingRes.rows[0] as AuthUserRow;
      if (user.is_active === false) {
        res.status(403).json({ message: 'Esta cuenta ha sido desactivada' });
        return;
      }
      user = await normalizePremiumState(user);
    } else {
      const createdRes = await pool.query(
        `INSERT INTO users (name, email, password, credits, role, is_premium, trial_expires_at, referral_code)
         VALUES ($1, $2, $3, 50, 'free', true, NOW() + INTERVAL '14 days', $4)
         RETURNING id, name, email, credits, role, is_premium, trial_expires_at, premium_expires_at`,
        [googleProfile.name, googleProfile.email, null, await generateUniqueReferralCode()]
      );
      user = createdRes.rows[0] as AuthUserRow;

      await pool.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, 50, 'bonus', 'Créditos de bienvenida')`,
        [user.id]
      );
    }

    const token = signAuthToken(user);
    res.json({
      message: 'Bienvenido',
      token,
      user: buildAuthUser(user),
    });
  } catch (error) {
    console.error('Error en login con Google:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener perfil del usuario autenticado
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, credits, role, is_premium, is_active,
              trial_expires_at, premium_expires_at, reputation, created_at
       FROM users WHERE id = $1`,
      [(req as any).userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Actualizar perfil básico del usuario autenticado
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  const userId = (req as any).userId as number;

  const trimmedName = (name ?? '').trim();
  if (!trimmedName) {
    res.status(400).json({ message: 'El nombre es obligatorio' });
    return;
  }

  try {
    const updated = await pool.query(
      `UPDATE users
       SET name = $1
       WHERE id = $2
       RETURNING id, name, email, phone, credits, role, is_premium, is_active,
                 trial_expires_at, premium_expires_at, reputation, created_at`,
      [trimmedName, userId]
    );

    if (updated.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    res.json({
      message: 'Perfil actualizado',
      user: updated.rows[0],
    });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
