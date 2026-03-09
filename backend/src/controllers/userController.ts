import { Request, Response } from 'express';
import pool from '../config/database';

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

async function ensureUserReferralCode(userId: number): Promise<string> {
  const existing = await pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  const current = existing.rows[0]?.referral_code as string | null | undefined;
  if (current) return current;

  for (let i = 0; i < 12; i++) {
    const candidate = randomReferralCode();
    const updated = await pool.query(
      `UPDATE users
       SET referral_code = $1
       WHERE id = $2
         AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.referral_code = $1)
       RETURNING referral_code`,
      [candidate, userId]
    );
    if (updated.rows.length > 0) return updated.rows[0].referral_code as string;
  }

  throw new Error('No se pudo generar código de referido');
}

// Agregar ruta a favoritas
export const addFavorite = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const { route_id } = req.body;

  if (!route_id) {
    res.status(400).json({ message: 'route_id es obligatorio' });
    return;
  }

  try {
    const routeExists = await pool.query('SELECT id FROM routes WHERE id = $1', [route_id]);
    if (routeExists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO user_favorite_routes (user_id, route_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, route_id) DO NOTHING
       RETURNING id`,
      [userId, route_id]
    );

    if (result.rowCount && result.rowCount > 0) {
      res.status(201).json({ message: 'Ruta agregada a favoritas' });
    } else {
      res.json({ message: 'Ya está en favoritas' });
    }

  } catch (error) {
    console.error('Error agregando favorita:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Eliminar ruta de favoritas
export const removeFavorite = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const { routeId } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM user_favorite_routes WHERE user_id = $1 AND route_id = $2 RETURNING id',
      [userId, routeId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Favorita no encontrada' });
      return;
    }

    res.json({ message: 'Ruta eliminada de favoritas' });

  } catch (error) {
    console.error('Error eliminando favorita:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Listar rutas favoritas del usuario
export const listFavorites = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;

  try {
    const result = await pool.query(
      `SELECT
        r.id, r.name, r.code,
        COALESCE(c.name, r.company) AS company_name,
        r.first_departure, r.last_departure, r.frequency_minutes,
        r.is_active,
        ufr.created_at AS favorited_at
       FROM user_favorite_routes ufr
       JOIN routes r ON r.id = ufr.route_id
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE ufr.user_id = $1
       ORDER BY ufr.created_at DESC`,
      [userId]
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error listando favoritas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Resumen de referidos del usuario autenticado
export const getReferralSummary = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;

  try {
    const code = await ensureUserReferralCode(userId);
    const [referredRes, creditsRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total_referred
         FROM users
         WHERE referred_by = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::int AS credits_earned
         FROM credit_transactions
         WHERE user_id = $1 AND type = 'referral' AND amount > 0`,
        [userId]
      ),
    ]);

    res.json({
      code,
      total_referred: referredRes.rows[0]?.total_referred ?? 0,
      credits_earned: creditsRes.rows[0]?.credits_earned ?? 0,
    });
  } catch (error) {
    console.error('Error obteniendo resumen de referidos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
