import { Request, Response } from 'express';
import pool from '../config/database';
import { awardCredits } from './creditController';
import { getIo } from '../config/socket';
import { sendPushToUser } from '../services/pushNotificationService';
import { findNearestIdx, haversineKm } from './routeController';

const MAX_TRIP_LOCATION_CREDITS = 15; // máx créditos por ubicación en un viaje (~15 min activos)

function minDistToGeometryKm(lat: number, lng: number, geometry: [number, number][]): number {
  let min = Infinity;
  for (const [gLat, gLng] of geometry) {
    const d = haversineMeters(lat, lng, gLat, gLng) / 1000;
    if (d < min) min = d;
  }
  return min;
}

function centroid(points: [number, number][]): [number, number] | null {
  if (points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lat, lng];
}

function findOffRouteClusters(
  trace: [number, number][],
  geometry: [number, number][]
): [number, number][][] {
  const clusters: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const point of trace) {
    if (minDistToGeometryKm(point[0], point[1], geometry) > 0.2) {
      current.push(point);
    } else {
      if (current.length >= 3) clusters.push(current);
      current = [];
    }
  }
  if (current.length >= 3) clusters.push(current);
  return clusters;
}

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

    await pool.query(
      `UPDATE active_trips
       SET gps_trace = CASE
         WHEN jsonb_array_length(gps_trace) >= 500 THEN gps_trace
         ELSE gps_trace || jsonb_build_array(jsonb_build_array($1::float, $2::float))
       END
       WHERE id = $3`,
      [latitude, longitude, trip.id]
    );

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

    try {
      const updatedTrip = updated.rows[0];
      if (updatedTrip.destination_stop_id && !updatedTrip.boarding_alert_now_sent) {
        const stopRes = await pool.query(
          'SELECT latitude, longitude FROM stops WHERE id = $1',
          [updatedTrip.destination_stop_id],
        );
        if (stopRes.rows.length > 0) {
          const stop = stopRes.rows[0];
          const distToStop = haversineMeters(
            parseFloat(latitude),
            parseFloat(longitude),
            parseFloat(stop.latitude),
            parseFloat(stop.longitude),
          );

          if (distToStop <= 200) {
            await pool.query(
              'UPDATE active_trips SET boarding_alert_now_sent = true WHERE id = $1',
              [updatedTrip.id],
            );
            const userRow = await pool.query(
              'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
              [userId],
            );
            const { fcm_token, notification_prefs } = userRow.rows[0] ?? {};
            const prefs: Record<string, unknown> = notification_prefs ?? {};
            if (prefs.boardingAlerts !== false) {
              void sendPushToUser(
                fcm_token as string | null,
                '🚨 Bájate ya',
                'Tu parada está a menos de 200 metros',
                { type: 'boarding_alert', level: 'now' },
              );
            }
          } else if (distToStop <= 400 && !updatedTrip.boarding_alert_prepare_sent) {
            await pool.query(
              'UPDATE active_trips SET boarding_alert_prepare_sent = true WHERE id = $1',
              [updatedTrip.id],
            );
            const userRow = await pool.query(
              'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
              [userId],
            );
            const { fcm_token, notification_prefs } = userRow.rows[0] ?? {};
            const prefs: Record<string, unknown> = notification_prefs ?? {};
            if (prefs.boardingAlerts !== false) {
              void sendPushToUser(
                fcm_token as string | null,
                '⏱ Prepárate para bajar',
                'Tu parada está a menos de 400 metros',
                { type: 'boarding_alert', level: 'prepare' },
              );
            }
          }
        }
      }
    } catch (alertErr) {
      console.error('Error en boarding alert check:', alertErr);
      // No re-throw — la respuesta ya fue enviada
    }

    // ── Waiting alerts ────────────────────────────────────────────────────
    try {
      const routeResult = await pool.query(
        'SELECT geometry FROM routes WHERE id = $1',
        [trip.route_id],
      );
      const geometry: [number, number][] | null = routeResult.rows[0]?.geometry ?? null;

      const alertsResult = await pool.query(
        `SELECT wa.id, wa.user_id, wa.user_lat, wa.user_lng, u.fcm_token
         FROM waiting_alerts wa
         JOIN users u ON u.id = wa.user_id
         WHERE wa.route_id = $1 AND wa.is_active = true AND wa.expires_at > NOW()`,
        [trip.route_id],
      );

      for (const alert of alertsResult.rows) {
        const distKm = haversineKm(
          parseFloat(alert.user_lat), parseFloat(alert.user_lng),
          latitude, longitude,
        );
        if (distKm > 0.3) continue;

        // Direction check
        if (geometry) {
          const userIdx = findNearestIdx(geometry,
            parseFloat(alert.user_lat), parseFloat(alert.user_lng));
          const busIdx = findNearestIdx(geometry, latitude, longitude);
          if (busIdx >= userIdx) continue; // wrong direction
        }

        // Fire push
        if (alert.fcm_token) {
          await sendPushToUser(alert.fcm_token, '¡Tu bus está llegando!', 'Un bus de tu ruta está a menos de 300 m. ¡Prepárate!', {
            type: 'bus_arriving',
            routeId: String(trip.route_id),
          });
        }

        // Deactivate alert so it only fires once
        await pool.query(
          'UPDATE waiting_alerts SET is_active = false WHERE id = $1',
          [alert.id],
        );
      }
    } catch (err) {
      console.error('Waiting alert check error:', err);
    }

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

    const trace: [number, number][] = Array.isArray(trip.gps_trace) ? trip.gps_trace : [];
    let deviationDetected = false;
    const gpsTrace: [number, number][] = trace;

    if (trip.route_id && trace.length >= 5) {
      const routeRes = await pool.query(
        'SELECT geometry FROM routes WHERE id = $1',
        [trip.route_id]
      );
      const geometry: [number, number][] = routeRes.rows[0]?.geometry ?? [];

      if (geometry.length >= 2) {
        const existingRes = await pool.query(
          `SELECT reported_geometry FROM route_update_reports
           WHERE user_id = $1 AND route_id = $2 AND tipo = 'ruta_real' AND created_at >= $3`,
          [userId, trip.route_id, trip.started_at]
        );

        const existingCentroids: [number, number][] = existingRes.rows
          .map((r: { reported_geometry: unknown }) => {
            const pts: [number, number][] = Array.isArray(r.reported_geometry)
              ? (r.reported_geometry as [number, number][])
              : [];
            return centroid(pts);
          })
          .filter((c): c is [number, number] => c !== null);

        if (existingCentroids.length > 0) deviationDetected = true;

        const clusters = findOffRouteClusters(trace, geometry);

        for (const cluster of clusters) {
          const clusterCenter = centroid(cluster);
          if (!clusterCenter) continue;

          const alreadyReported = existingCentroids.some(
            (c) => haversineMeters(clusterCenter[0], clusterCenter[1], c[0], c[1]) < 500
          );
          if (alreadyReported) continue;

          deviationDetected = true;
          await pool.query(
            `INSERT INTO route_update_reports (route_id, user_id, tipo, reported_geometry)
             VALUES ($1, $2, 'ruta_real', $3)`,
            [trip.route_id, userId, JSON.stringify(cluster)]
          );
        }
      }
    }

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

    // Push al usuario con resumen del viaje (útil si cerró la app mientras viajaba)
    if (totalEarned > 0) {
      const userTokenRes = await pool.query(
        'SELECT fcm_token, notification_prefs FROM users WHERE id = $1',
        [userId],
      );
      const fcmToken: string | null = userTokenRes.rows[0]?.fcm_token ?? null;
      const endPrefs: Record<string, unknown> = userTokenRes.rows[0]?.notification_prefs ?? {};
      const creditWord = totalEarned === 1 ? 'crédito' : 'créditos';
      if (endPrefs.boardingAlerts !== false) {
        void sendPushToUser(
          fcmToken,
          '🎉 Viaje finalizado',
          `Ganaste ${totalEarned} ${creditWord} por este viaje`,
          { type: 'trip_ended', credits: String(totalEarned) },
        );
      }
    }

    res.json({
      trip: updated.rows[0],
      totalCreditsEarned: updated.rows[0].credits_earned,
      distance_meters: Math.round(tripDistanceMeters),
      completion_bonus_earned: completionBonus > 0,
      deviation_detected: deviationDetected,
      gps_trace: deviationDetected ? gpsTrace : [],
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
