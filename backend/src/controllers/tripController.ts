import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';
import { getIo } from '../config/socket';

const MAX_TRIP_LOCATION_CREDITS = 15; // máx créditos por ubicación en un viaje (~15 min activos)

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Iniciar viaje (Me subí)
export const startTrip = async (req: Request, res: Response): Promise<void> => {
  const { route_id, latitude, longitude, destination_stop_id } = req.body;
  const userId = (req as any).userId;

  if (!latitude || !longitude) {
    res.status(400).json({ message: 'latitude y longitude son obligatorios' });
    return;
  }

  try {
    // Verificar que no haya viaje activo
    const existing = await pool.query(
      'SELECT id FROM active_trips WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (existing.rows.length > 0) {
      res.status(400).json({ message: 'Ya tienes un viaje activo. Finalízalo antes de iniciar uno nuevo.' });
      return;
    }

    // Cooldown de 5 minutos entre viajes
    const lastTrip = await pool.query(
      `SELECT ended_at FROM active_trips
       WHERE user_id = $1 AND is_active = false AND ended_at IS NOT NULL
       ORDER BY ended_at DESC LIMIT 1`,
      [userId]
    );
    if (lastTrip.rows.length > 0) {
      const secondsSinceEnd = (Date.now() - new Date(lastTrip.rows[0].ended_at).getTime()) / 1000;
      if (secondsSinceEnd < 300) {
        const remaining = Math.ceil((300 - secondsSinceEnd) / 60);
        res.status(429).json({
          message: `Espera ${remaining} min antes de iniciar otro viaje.`,
          cooldown_seconds: Math.ceil(300 - secondsSinceEnd),
        });
        return;
      }
    }

    const result = await pool.query(
      `INSERT INTO active_trips (user_id, route_id, current_latitude, current_longitude, destination_stop_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, route_id || null, latitude, longitude, destination_stop_id || null]
    );

    const trip = result.rows[0];

    getIo().emit('bus:joined', {
      tripId: trip.id,
      routeId: trip.route_id,
      latitude: parseFloat(trip.current_latitude),
      longitude: parseFloat(trip.current_longitude),
    });

    res.status(201).json({ trip });

  } catch (error) {
    console.error('Error iniciando viaje:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Actualizar ubicación (transmisión en tiempo real)
export const updateLocation = async (req: Request, res: Response): Promise<void> => {
  const { latitude, longitude } = req.body;
  const userId = (req as any).userId;

  if (!latitude || !longitude) {
    res.status(400).json({ message: 'latitude y longitude son obligatorios' });
    return;
  }

  try {
    const tripResult = await pool.query(
      'SELECT * FROM active_trips WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (tripResult.rows.length === 0) {
      res.status(404).json({ message: 'No tienes un viaje activo' });
      return;
    }

    const trip = tripResult.rows[0];

    // Verificar si hay trancón activo en la ruta → crédito cada 2 min en vez de 1 min
    let creditThresholdMs = 60000;
    if (trip.route_id) {
      const tranconRes = await pool.query(
        `SELECT id FROM reports WHERE route_id = $1 AND type = 'trancon'
         AND is_active = true AND expires_at > NOW() LIMIT 1`,
        [trip.route_id]
      );
      if (tranconRes.rows.length > 0) creditThresholdMs = 120000;
    }

    // Acumular crédito pendiente (NO se transfiere al balance hasta endTrip)
    const shouldAccumulate =
      trip.last_location_at === null ||
      new Date().getTime() - new Date(trip.last_location_at).getTime() >= creditThresholdMs;

    // Calcular distancia desde la última posición (se usa tanto para créditos como para total acumulado)
    let distanceDelta = 0;
    if (trip.current_latitude !== null && trip.current_longitude !== null) {
      distanceDelta = haversineMeters(
        parseFloat(trip.current_latitude),
        parseFloat(trip.current_longitude),
        parseFloat(latitude),
        parseFloat(longitude)
      );
    }

    // Chequeo de velocidad: si no se movió > 100m desde la última posición, no acumular crédito
    // (caminar o estar quieto no cuenta; paradas en semáforo breves sí se pierden pero es aceptable)
    const isMovingFastEnough = trip.current_latitude === null || distanceDelta >= 100;

    let creditsEarned = trip.credits_earned;
    if (shouldAccumulate && isMovingFastEnough && creditsEarned < MAX_TRIP_LOCATION_CREDITS) {
      creditsEarned += 1;
    }

    // Acumular distancia total siempre (independiente del timer de créditos)
    const totalDistance = parseFloat(trip.total_distance_meters ?? '0') + distanceDelta;

    const updated = await pool.query(
      `UPDATE active_trips
       SET current_latitude = $1,
           current_longitude = $2,
           last_location_at = NOW(),
           credits_earned = $3,
           total_distance_meters = $4
       WHERE id = $5
       RETURNING *`,
      [latitude, longitude, creditsEarned, totalDistance, trip.id]
    );

    getIo().emit('bus:location', {
      tripId: trip.id,
      routeId: trip.route_id,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    });

    res.json({
      credits_pending: updated.rows[0].credits_earned,
    });

  } catch (error) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Finalizar viaje (Me bajé)
export const endTrip = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId;
  const bodyData = typeof req.body === 'string' ? {} : (req.body ?? {});
  const suspiciousMinutes: number = bodyData?.suspicious_minutes ?? 0;

  try {
    const tripResult = await pool.query(
      'SELECT * FROM active_trips WHERE user_id = $1 AND is_active = true',
      [userId]
    );

    if (tripResult.rows.length === 0) {
      res.status(404).json({ message: 'No tienes un viaje activo' });
      return;
    }

    const trip = tripResult.rows[0];

    // Descontar minutos sospechosos del acumulado (mínimo 0)
    const finalCredits = Math.max(0, trip.credits_earned - suspiciousMinutes);

    // Auto-award +1 por reportes sin confirmación durante el viaje (máx 2)
    const uncreditedRes = await pool.query(
      `SELECT id FROM reports
       WHERE user_id = $1 AND credits_awarded_to_reporter = false
         AND created_at >= $2 AND is_active = true
       LIMIT 2`,
      [userId, trip.started_at]
    );
    for (const r of uncreditedRes.rows) {
      await awardCredits(userId, 1, 'earn', 'Reporte sin confirmar — viaje finalizado');
      await pool.query(
        `UPDATE reports SET credits_awarded_to_reporter = true WHERE id = $1`,
        [r.id]
      );
    }

    // Transferir créditos pendientes acumulados al balance del usuario
    if (finalCredits > 0) {
      await awardCredits(userId, finalCredits, 'earn', 'Créditos por transmitir ubicación en bus');
    }

    // Bonus de completación solo si el usuario recorrió ≥2 km (anti-ciclo rápido)
    const tripDistanceMeters = parseFloat(trip.total_distance_meters ?? '0');
    const completionBonus = tripDistanceMeters >= 2000 ? 5 : 0;
    if (completionBonus > 0) {
      await awardCredits(userId, completionBonus, 'earn', 'Viaje completado');
    }

    const totalEarned = finalCredits + completionBonus + uncreditedRes.rows.length;

    const updated = await pool.query(
      `UPDATE active_trips
       SET is_active = false, ended_at = NOW(), credits_earned = $2
       WHERE id = $1
       RETURNING *`,
      [trip.id, totalEarned]
    );

    getIo().emit('bus:left', {
      tripId: trip.id,
      routeId: trip.route_id,
    });

    res.json({
      trip: updated.rows[0],
      totalCreditsEarned: updated.rows[0].credits_earned,
      distance_meters: Math.round(tripDistanceMeters),
      completion_bonus_earned: completionBonus > 0,
    });

  } catch (error) {
    console.error('Error finalizando viaje:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener viaje activo del usuario (recuperación tras recarga)
export const getActiveTrip = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId;

  try {
    const result = await pool.query(
      `SELECT t.*, r.name AS route_name, r.code AS route_code
       FROM active_trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.user_id = $1 AND t.is_active = true`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({ trip: null });
      return;
    }

    res.json({ trip: result.rows[0] });

  } catch (error) {
    console.error('Error obteniendo viaje activo:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener viaje actual con parada de destino (para UI de viaje en curso)
export const getTripCurrent = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;

  try {
    const result = await pool.query(
      `SELECT
        at.id,
        at.route_id,
        at.destination_stop_id,
        r.name AS route_name,
        r.code AS route_code,
        at.started_at,
        at.current_latitude,
        at.current_longitude,
        at.credits_earned,
        COALESCE(s.latitude,  at.custom_destination_lat)  AS destination_lat,
        COALESCE(s.longitude, at.custom_destination_lng)  AS destination_lng,
        COALESCE(s.name,      at.custom_destination_name) AS destination_stop_name
       FROM active_trips at
       JOIN routes r ON r.id = at.route_id
       LEFT JOIN stops s ON s.id = at.destination_stop_id
       WHERE at.user_id = $1 AND at.is_active = true
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({ trip: null });
      return;
    }

    res.json({ trip: result.rows[0] });

  } catch (error) {
    console.error('Error obteniendo viaje actual:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Historial de viajes finalizados del usuario autenticado
export const getTripHistory = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;

  try {
    const result = await pool.query(
      `SELECT at.id, at.route_id, r.name AS route_name, r.code AS route_code,
              at.started_at, at.ended_at, at.credits_earned,
              ROUND(EXTRACT(EPOCH FROM (at.ended_at - at.started_at))/60) AS duration_minutes
       FROM active_trips at
       LEFT JOIN routes r ON r.id = at.route_id
       WHERE at.user_id = $1 AND at.is_active = false AND at.ended_at IS NOT NULL
       ORDER BY at.started_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({ trips: result.rows });
  } catch (error) {
    console.error('Error obteniendo historial de viajes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Guardar destino personalizado (punto libre en el mapa) para que sobreviva reinicios
export const updateTripDestination = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const { latitude, longitude, name } = req.body;

  if (!latitude || !longitude) {
    res.status(400).json({ message: 'latitude y longitude son obligatorios' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE active_trips
       SET custom_destination_lat  = $1,
           custom_destination_lng  = $2,
           custom_destination_name = $3,
           destination_stop_id     = NULL
       WHERE user_id = $4 AND is_active = true
       RETURNING id`,
      [latitude, longitude, name ?? null, userId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ message: 'No tienes un viaje activo' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Error guardando destino personalizado:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener todos los buses activos (para carga inicial del mapa)
export const getActiveBuses = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.route_id, r.name AS route_name, r.code AS route_code,
              t.current_latitude, t.current_longitude
       FROM active_trips t
       LEFT JOIN routes r ON r.id = t.route_id
       WHERE t.is_active = true AND t.current_latitude IS NOT NULL`
    );

    res.json({ buses: result.rows });

  } catch (error) {
    console.error('Error obteniendo buses activos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
