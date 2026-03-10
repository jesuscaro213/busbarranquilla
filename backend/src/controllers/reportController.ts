import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';
import { getIo } from '../config/socket';
import { getRedisClient } from '../config/redis';

const VALID_TYPES = [
  'bus_location', 'traffic', 'bus_full', 'no_service', 'detour',
  'desvio', 'trancon', 'lleno', 'sin_parar', 'espera',
  'bus_disponible',
] as const;

const CREDITS_BY_TYPE: Record<string, number> = {
  bus_location: 5,
  traffic: 4,
  bus_full: 3,
  no_service: 4,
  detour: 4,
  desvio: 4,
  trancon: 4,
  lleno: 3,
  sin_parar: 4,
  espera: 3,
  bus_disponible: 3,
};

const OCCUPANCY_TYPES: string[] = ['lleno', 'bus_disponible'];
const REPORT_RATE_LIMIT_PER_HOUR = 5;
const REPORT_ROUTE_TYPE_LIMIT_PER_HOUR = 2;
const REPORT_RATE_LIMIT_TTL_SECONDS = 3600;
const REPORT_RATE_LIMIT_MESSAGE = 'Límite de reportes alcanzado. Espera antes de reportar de nuevo.';
// Distancia máxima a parada más cercana para reportes válidos
const GEO_MAX_METERS: Record<string, number> = {
  lleno: 300,
  bus_disponible: 300,
  default: 500,
};
const OCCUPANCY_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Retorna la distancia mínima (metros) del punto a cualquier parada de la ruta
async function minDistanceToRoute(routeId: number, lat: number, lng: number): Promise<number> {
  const result = await pool.query(
    'SELECT latitude, longitude FROM stops WHERE route_id = $1',
    [routeId]
  );
  if (result.rows.length === 0) return 0; // sin paradas → no validar
  let min = Infinity;
  for (const stop of result.rows) {
    const d = haversineMeters(lat, lng, parseFloat(stop.latitude), parseFloat(stop.longitude));
    if (d < min) min = d;
  }
  return min;
}

// ── Estado de ocupación de una ruta ──────────────────────────────────────────
// Lógica A+D: mayoría gana; para revertir de lleno→disponible se necesitan 2+
// con threshold dinámico según usuarios activos en la ruta.

async function computeOccupancy(routeId: number): Promise<{
  state: 'lleno' | 'disponible' | null;
  counts: Record<string, number>;
  activeUsers: number;
}> {
  // Usuarios activos en esta ruta ahora mismo
  const activeRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM active_trips
     WHERE route_id = $1 AND is_active = true`,
    [routeId]
  );
  const activeUsers = parseInt(activeRes.rows[0].cnt, 10);

  // Reportes de ocupación activos en últimos 30 min
  const repRes = await pool.query(
    `SELECT type, COUNT(*) AS cnt FROM reports
     WHERE route_id = $1
       AND type = ANY($2::text[])
       AND is_active = true
       AND created_at > NOW() - INTERVAL '30 minutes'
     GROUP BY type`,
    [routeId, OCCUPANCY_TYPES]
  );

  const counts: Record<string, number> = { lleno: 0, bus_disponible: 0 };
  for (const row of repRes.rows) counts[row.type] = parseInt(row.cnt, 10);

  // Threshold dinámico: 1 usuario activo → basta 1 reporte; 2+ → se necesitan 2
  const threshold = activeUsers <= 1 ? 1 : 2;

  if (counts.bus_disponible >= threshold) return { state: 'disponible', counts, activeUsers };
  if (counts.lleno >= threshold) return { state: 'lleno', counts, activeUsers };
  return { state: null, counts, activeUsers };
}

// ── Crear reporte (protegido) ─────────────────────────────────────────────────
export const createReport = async (req: Request, res: Response): Promise<void> => {
  const { route_id, type, latitude, longitude, description } = req.body;
  const userId = (req as any).userId;
  let globalRateKey: string | null = null;
  let routeTypeRateKey: string | null = null;
  let reportCreated = false;

  if (!type || latitude === undefined || longitude === undefined) {
    res.status(400).json({ message: 'type, latitude y longitude son obligatorios' });
    return;
  }

  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ message: 'Tipo de reporte inválido' });
    return;
  }

  try {
    // ── Validación geográfica para reportes con ruta ──────────────────────
    if (route_id) {
      const maxMeters = GEO_MAX_METERS[type] ?? GEO_MAX_METERS.default;
      const dist = await minDistanceToRoute(route_id, parseFloat(latitude), parseFloat(longitude));
      if (dist > maxMeters) {
        res.status(400).json({
          message: `Debes estar cerca del bus para reportar esto (${Math.round(dist)} m de la ruta más cercana, máximo ${maxMeters} m)`,
          distance_meters: Math.round(dist),
        });
        return;
      }
    }

    // ── Cooldown de 10 min para reportes de ocupación ────────────────────
    if (OCCUPANCY_TYPES.includes(type)) {
      const lastRes = await pool.query(
        `SELECT created_at FROM reports
         WHERE user_id = $1 AND route_id = $2
           AND type = ANY($3::text[])
           AND created_at > NOW() - INTERVAL '10 minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, route_id || null, OCCUPANCY_TYPES]
      );
      if (lastRes.rows.length > 0) {
        const lastAt = new Date(lastRes.rows[0].created_at).getTime();
        const remaining = Math.ceil((OCCUPANCY_COOLDOWN_MS - (Date.now() - lastAt)) / 60000);
        res.status(429).json({
          message: `Ya reportaste la ocupación de este bus. Espera ${remaining} min antes de reportar de nuevo.`,
          retry_in_minutes: remaining,
        });
        return;
      }
    }

    // ── Determinar si el usuario está en viaje activo en esta ruta ───────
    let userOnThisRoute = false;
    let otherActiveUsers = 0;

    if (route_id) {
      const tripCheck = await pool.query(
        `SELECT id FROM active_trips WHERE user_id = $1 AND route_id = $2 AND is_active = true LIMIT 1`,
        [userId, route_id]
      );
      userOnThisRoute = tripCheck.rows.length > 0;

      if (userOnThisRoute) {
        const othersRes = await pool.query(
          `SELECT COUNT(*) AS cnt FROM active_trips WHERE route_id = $1 AND is_active = true AND user_id != $2`,
          [route_id, userId]
        );
        otherActiveUsers = parseInt(othersRes.rows[0].cnt, 10);
      }
    }

    // ── Rate limit por usuario y por tipo/ruta usando Redis ───────────────
    const redis = await getRedisClient();
    if (redis) {
      globalRateKey = `rate:report:${userId}`;
      const globalCount = await redis.incr(globalRateKey);
      await redis.expire(globalRateKey, REPORT_RATE_LIMIT_TTL_SECONDS, 'NX');

      if (globalCount > REPORT_RATE_LIMIT_PER_HOUR) {
        await redis.decr(globalRateKey);
        res.status(429).json({ message: REPORT_RATE_LIMIT_MESSAGE });
        return;
      }

      if (route_id) {
        routeTypeRateKey = `rate:report:${userId}:${route_id}:${type}`;
        const routeTypeCount = await redis.incr(routeTypeRateKey);
        await redis.expire(routeTypeRateKey, REPORT_RATE_LIMIT_TTL_SECONDS, 'NX');

        if (routeTypeCount > REPORT_ROUTE_TYPE_LIMIT_PER_HOUR) {
          await redis.multi().decr(globalRateKey).decr(routeTypeRateKey).exec();
          res.status(429).json({ message: REPORT_RATE_LIMIT_MESSAGE });
          return;
        }
      }
    }

    // ── Calcular créditos y si se otorgan ahora ───────────────────────────
    let creditsEarned = 0;
    let creditsAwardedToReporter = false;

    if (userOnThisRoute) {
      // Sistema de créditos diferido: solo +1 si va solo en el bus
      if (otherActiveUsers === 0) {
        creditsEarned = 1;
        creditsAwardedToReporter = true;
        await awardCredits(userId, 1, 'earn', `Reporte: ${type}`);
      }
      // else: 0 ahora, +2 cuando confirmen, o +1 al terminar el viaje sin confirmación
    } else {
      // Fuera de viaje activo: sistema original de créditos
      creditsEarned = CREDITS_BY_TYPE[type] ?? 0;
      if (creditsEarned > 0) {
        await awardCredits(userId, creditsEarned, 'earn', `Reporte: ${type}`);
      }
      creditsAwardedToReporter = creditsEarned > 0;
    }

    const result = await pool.query(
      `INSERT INTO reports (user_id, route_id, type, latitude, longitude, description, credits_awarded_to_reporter)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, route_id || null, type, latitude, longitude, description || null, creditsAwardedToReporter]
    );

    const report = result.rows[0];
    reportCreated = true;

    // ── Actualizar racha de reportes diarios (P1-2) ───────────────────────
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const userRes = await pool.query(
      'SELECT last_report_date, report_streak FROM users WHERE id = $1',
      [userId]
    );

    const lastReportDateRaw = userRes.rows[0]?.last_report_date as string | Date | null | undefined;
    const lastReportDate = !lastReportDateRaw
      ? null
      : (lastReportDateRaw instanceof Date
        ? lastReportDateRaw.toISOString().split('T')[0]
        : String(lastReportDateRaw).split('T')[0]);
    const currentStreak = Number(userRes.rows[0]?.report_streak ?? 0);

    let newStreak = 1;
    if (lastReportDate === yesterday) newStreak = currentStreak + 1;
    else if (lastReportDate === today) newStreak = currentStreak;

    await pool.query(
      'UPDATE users SET last_report_date = $1, report_streak = $2 WHERE id = $3',
      [today, newStreak, userId]
    );

    // Solo premiar cuando la racha avanza respecto a ayer (evita duplicar bonus en el mismo día)
    if (lastReportDate === yesterday && newStreak > 0 && newStreak % 7 === 0) {
      await awardCredits(userId, 30, 'streak', `🔥 ¡Racha de ${newStreak} días! Bonus de créditos`);
    }

    // ── Emitir evento en tiempo real a los demás usuarios de la ruta ─────
    if (route_id) {
      const needed = otherActiveUsers > 0 ? Math.ceil(otherActiveUsers * 0.5) : 1;
      getIo().to(`route:${route_id}`).emit('route:new_report', {
        report: {
          ...report,
          confirmed_by_me: false,
          active_users: otherActiveUsers + 1,
          needed_confirmations: needed,
          is_valid: otherActiveUsers === 0,
        },
      });
    }

    res.status(201).json({
      message: 'Reporte creado exitosamente',
      report,
      credits_earned: creditsEarned,
    });

  } catch (error) {
    if (!reportCreated && globalRateKey) {
      const redis = await getRedisClient();
      if (redis) {
        await redis.decr(globalRateKey).catch(() => {});
        if (routeTypeRateKey) {
          await redis.decr(routeTypeRateKey).catch(() => {});
        }
      }
    }
    console.error('Error creando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Estado de ocupación de una ruta (público)
export const getOccupancy = async (req: Request, res: Response): Promise<void> => {
  const routeId = parseInt(req.params.routeId as string, 10);
  if (isNaN(routeId)) {
    res.status(400).json({ message: 'routeId inválido' });
    return;
  }
  try {
    const occupancy = await computeOccupancy(routeId);
    res.json(occupancy);
  } catch (error) {
    console.error('Error calculando ocupación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Listar reportes cercanos (protegido)
export const listNearbyReports = async (req: Request, res: Response): Promise<void> => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    res.status(400).json({ message: 'lat y lng son obligatorios' });
    return;
  }

  const radiusKm = parseFloat(radius as string) || 1;

  try {
    const result = await pool.query(
      `SELECT * FROM (
        SELECT *,
          (6371 * acos(
            cos(radians($1)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(latitude))
          )) AS distance
        FROM reports
        WHERE is_active = true AND expires_at > NOW()
      ) t
      WHERE t.distance < $3
      ORDER BY t.distance ASC`,
      [parseFloat(lat as string), parseFloat(lng as string), radiusKm]
    );

    res.json({ reports: result.rows });

  } catch (error) {
    console.error('Error listando reportes cercanos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Resolver reporte propio (protegido)
export const resolveReport = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = (req as any).userId as number;

  try {
    const result = await pool.query(
      `UPDATE reports
       SET is_active = false, resolved_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, type, route_id, created_at, resolved_at`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Reporte no encontrado o no tienes permiso para resolverlo' });
      return;
    }

    const report = result.rows[0];
    const durationMs = new Date(report.resolved_at).getTime() - new Date(report.created_at).getTime();
    const durationMinutes = Math.round(durationMs / 60000);

    // Notificar en tiempo real a todos en la ruta que el reporte fue resuelto
    if (report.route_id) {
      getIo().to(`route:${report.route_id}`).emit('route:report_resolved', {
        reportId: report.id,
        type: report.type,
        duration_minutes: durationMinutes,
      });
    }

    res.json({ message: 'Reporte resuelto correctamente', duration_minutes: durationMinutes });

  } catch (error) {
    console.error('Error resolviendo reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Confirmar reporte de otro usuario (protegido)
export const confirmReport = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const userId = (req as any).userId;

  try {
    const reportRes = await pool.query(
      'SELECT * FROM reports WHERE id = $1 AND is_active = true AND expires_at > NOW()',
      [id]
    );

    if (reportRes.rows.length === 0) {
      res.status(404).json({ message: 'Reporte no encontrado o expirado' });
      return;
    }

    const report = reportRes.rows[0];

    if (report.user_id === userId) {
      res.status(400).json({ message: 'No puedes confirmar tu propio reporte' });
      return;
    }

    // Verificar que el confirmador esté en viaje activo en la misma ruta
    if (report.route_id) {
      const tripCheck = await pool.query(
        `SELECT id FROM active_trips WHERE user_id = $1 AND route_id = $2 AND is_active = true LIMIT 1`,
        [userId, report.route_id]
      );
      if (tripCheck.rows.length === 0) {
        res.status(403).json({ message: 'Debes estar en esta ruta para confirmar el reporte' });
        return;
      }
    }

    // Verificar que no haya confirmado ya este reporte
    const alreadyConfirmed = await pool.query(
      `SELECT id FROM report_confirmations WHERE report_id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (alreadyConfirmed.rows.length > 0) {
      res.status(400).json({ message: 'Ya confirmaste este reporte' });
      return;
    }

    // Verificar límite de 3 créditos de confirmación por viaje
    const tripRes = await pool.query(
      `SELECT started_at FROM active_trips WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );
    if (tripRes.rows.length > 0) {
      const confirmCreditsRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM credit_transactions
         WHERE user_id = $1 AND description = 'Confirmación de reporte' AND created_at >= $2`,
        [userId, tripRes.rows[0].started_at]
      );
      if (parseInt(confirmCreditsRes.rows[0].cnt, 10) >= 2) {
        res.status(429).json({ message: 'Ya alcanzaste el límite de confirmaciones en este viaje' });
        return;
      }
    }

    // Registrar confirmación
    await pool.query(
      `INSERT INTO report_confirmations (report_id, user_id) VALUES ($1, $2)`,
      [id, userId]
    );

    // Incrementar contador de confirmaciones
    const updated = await pool.query(
      `UPDATE reports SET confirmations = confirmations + 1 WHERE id = $1
       RETURNING confirmations, credits_awarded_to_reporter`,
      [id]
    );
    const newConfirmations = updated.rows[0].confirmations;
    const alreadyPaid = updated.rows[0].credits_awarded_to_reporter;

    // Otorgar +1 al confirmador
    await awardCredits(userId, 1, 'earn', 'Confirmación de reporte');

    // Verificar si se alcanza el umbral de validez para pagar al reportador (+2)
    const activeRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM active_trips WHERE route_id = $1 AND is_active = true`,
      [report.route_id]
    );
    const activeUsers = parseInt(activeRes.rows[0].cnt, 10);
    const otherUsers = Math.max(0, activeUsers - 1);
    const needed = Math.ceil(otherUsers * 0.5) || 1;
    const isValid = activeUsers <= 1 || newConfirmations >= needed;

    let reporterPaid = false;
    if (isValid && !alreadyPaid) {
      await awardCredits(report.user_id, 2, 'earn', 'Reporte confirmado por pasajeros');
      await pool.query(
        `UPDATE reports SET credits_awarded_to_reporter = true WHERE id = $1`,
        [id]
      );
      reporterPaid = true;
    }

    // Emitir evento en tiempo real
    if (report.route_id) {
      getIo().to(`route:${report.route_id}`).emit('route:report_confirmed', {
        reportId: parseInt(id, 10),
        confirmations: newConfirmations,
        is_valid: isValid,
        needed_confirmations: needed,
        reporter_paid: reporterPaid,
      });
    }

    res.json({
      message: 'Reporte confirmado',
      confirmations: newConfirmations,
      credits_earned: 1,
      reporter_paid: reporterPaid,
      is_valid: isValid,
    });

  } catch (error) {
    console.error('Error confirmando reporte:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Reportes activos de una ruta (para pasajeros en ese bus)
export const getRouteReports = async (req: Request, res: Response): Promise<void> => {
  const routeId = parseInt(req.params.routeId as string, 10);
  const userId = (req as any).userId;

  if (isNaN(routeId)) {
    res.status(400).json({ message: 'routeId inválido' });
    return;
  }

  try {
    const activeRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM active_trips WHERE route_id = $1 AND is_active = true`,
      [routeId]
    );
    const activeUsers = parseInt(activeRes.rows[0].cnt, 10);
    const otherUsers = Math.max(0, activeUsers - 1);
    const needed = Math.ceil(otherUsers * 0.5) || 1;

    const reportsRes = await pool.query(
      `SELECT r.*,
         CASE WHEN rc.user_id IS NOT NULL THEN true ELSE false END AS confirmed_by_me
       FROM reports r
       LEFT JOIN report_confirmations rc ON rc.report_id = r.id AND rc.user_id = $2
       WHERE r.route_id = $1 AND r.is_active = true AND r.expires_at > NOW()
         AND r.user_id != $2
       ORDER BY r.created_at DESC`,
      [routeId, userId]
    );

    const reports = reportsRes.rows.map((r) => ({
      ...r,
      active_users: activeUsers,
      needed_confirmations: needed,
      is_valid: activeUsers <= 1 || r.confirmations >= needed,
    }));

    res.json({ reports, active_users: activeUsers });
  } catch (error) {
    console.error('Error obteniendo reportes de ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
