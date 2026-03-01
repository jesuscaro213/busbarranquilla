import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';
import { getIo } from '../config/socket';

// Iniciar viaje (Me subí)
export const startTrip = async (req: Request, res: Response): Promise<void> => {
  const { route_id, latitude, longitude } = req.body;
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

    const result = await pool.query(
      `INSERT INTO active_trips (user_id, route_id, current_latitude, current_longitude)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, route_id || null, latitude, longitude]
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

    // Determinar si se otorga +1 crédito por minuto
    const shouldAwardCredit =
      trip.last_location_at === null ||
      new Date().getTime() - new Date(trip.last_location_at).getTime() >= 60000;

    let creditsEarned = trip.credits_earned;

    if (shouldAwardCredit) {
      await awardCredits(userId, 1, 'earn', 'Transmisión de ubicación en bus');
      creditsEarned += 1;
    }

    const updated = await pool.query(
      `UPDATE active_trips
       SET current_latitude = $1,
           current_longitude = $2,
           last_location_at = NOW(),
           credits_earned = $3
       WHERE id = $4
       RETURNING *`,
      [latitude, longitude, creditsEarned, trip.id]
    );

    getIo().emit('bus:location', {
      tripId: trip.id,
      routeId: trip.route_id,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    });

    res.json({
      credited: shouldAwardCredit,
      creditsEarned: updated.rows[0].credits_earned,
    });

  } catch (error) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Finalizar viaje (Me bajé)
export const endTrip = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId;

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

    await awardCredits(userId, 10, 'earn', 'Viaje completado');

    const updated = await pool.query(
      `UPDATE active_trips
       SET is_active = false, ended_at = NOW(), credits_earned = credits_earned + 10
       WHERE id = $1
       RETURNING *`,
      [trip.id]
    );

    getIo().emit('bus:left', {
      tripId: trip.id,
      routeId: trip.route_id,
    });

    res.json({
      trip: updated.rows[0],
      totalCreditsEarned: updated.rows[0].credits_earned,
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
        r.name AS route_name,
        r.code AS route_code,
        at.started_at,
        at.current_latitude,
        at.current_longitude,
        at.credits_earned,
        s.latitude AS destination_lat,
        s.longitude AS destination_lng,
        s.name AS destination_stop_name
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
