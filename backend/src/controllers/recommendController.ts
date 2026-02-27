import { Request, Response } from 'express';
import pool from '../config/database';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface StopRow {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  stop_order: number;
}

interface RouteRow {
  id: number;
  name: string;
  code: string;
  company: string | null;
  frequency_minutes: number | null;
  stops: StopRow[];
}

const AVG_SPEED_KMH = 20;
const MAX_BOARDING_DIST_KM = 1;

export const recommendRoutes = async (req: Request, res: Response): Promise<void> => {
  const { originLat, originLng, destLat, destLng } = req.body;

  if (originLat == null || originLng == null || destLat == null || destLng == null) {
    res.status(400).json({ message: 'originLat, originLng, destLat y destLng son obligatorios' });
    return;
  }

  const oLat = parseFloat(String(originLat));
  const oLng = parseFloat(String(originLng));
  const dLat_f = parseFloat(String(destLat));
  const dLng_f = parseFloat(String(destLng));

  try {
    // 1. Todas las rutas activas con sus paradas
    const routesResult = await pool.query(`
      SELECT r.id, r.name, r.code, r.company, r.frequency_minutes,
             s.id AS stop_id, s.name AS stop_name,
             CAST(s.latitude  AS FLOAT) AS latitude,
             CAST(s.longitude AS FLOAT) AS longitude,
             s.stop_order
      FROM routes r
      JOIN stops s ON s.route_id = r.id
      WHERE r.is_active = true
      ORDER BY r.id, s.stop_order ASC
    `);

    // 2. Buses activos en este momento
    const busesResult = await pool.query(`
      SELECT t.id AS trip_id, t.route_id,
             CAST(t.current_latitude  AS FLOAT) AS latitude,
             CAST(t.current_longitude AS FLOAT) AS longitude
      FROM active_trips t
      WHERE t.is_active = true
        AND t.current_latitude  IS NOT NULL
        AND t.current_longitude IS NOT NULL
    `);

    // Agrupar paradas por ruta
    const routeMap = new Map<number, RouteRow>();
    for (const row of routesResult.rows) {
      if (!routeMap.has(row.id)) {
        routeMap.set(row.id, {
          id: row.id,
          name: row.name,
          code: row.code,
          company: row.company,
          frequency_minutes: row.frequency_minutes,
          stops: [],
        });
      }
      routeMap.get(row.id)!.stops.push({
        id: row.stop_id,
        name: row.stop_name,
        latitude: row.latitude,
        longitude: row.longitude,
        stop_order: row.stop_order,
      });
    }

    const recommendations = [];

    for (const route of routeMap.values()) {
      if (route.stops.length < 2) continue;

      // Parada de abordaje: la más cercana al origen
      let boardingStop = route.stops[0];
      let boardingDist = haversineKm(oLat, oLng, boardingStop.latitude, boardingStop.longitude);
      for (const stop of route.stops.slice(1)) {
        const d = haversineKm(oLat, oLng, stop.latitude, stop.longitude);
        if (d < boardingDist) { boardingDist = d; boardingStop = stop; }
      }

      // Descartar si la parada más cercana está a más de MAX_BOARDING_DIST_KM
      if (boardingDist > MAX_BOARDING_DIST_KM) continue;

      // Parada de bajada: la más cercana al destino
      let alightingStop = route.stops[route.stops.length - 1];
      let alightingDist = haversineKm(dLat_f, dLng_f, alightingStop.latitude, alightingStop.longitude);
      for (const stop of route.stops) {
        const d = haversineKm(dLat_f, dLng_f, stop.latitude, stop.longitude);
        if (d < alightingDist) { alightingDist = d; alightingStop = stop; }
      }

      // Validar dirección: abordaje debe estar antes que bajada
      if (boardingStop.stop_order >= alightingStop.stop_order) continue;

      // Segmento de ruta entre abordaje y bajada
      const routeSegment = route.stops.filter(
        (s) => s.stop_order >= boardingStop.stop_order && s.stop_order <= alightingStop.stop_order
      );

      // Bus activo más cercano a la parada de abordaje
      const activeBuses = busesResult.rows.filter((b: any) => b.route_id === route.id);
      let activeBusResult: { tripId: number; latitude: number; longitude: number; minutesAway: number } | null = null;
      let estimatedArrivalMinutes: number;

      if (activeBuses.length > 0) {
        let closest = activeBuses[0];
        let closestDist = haversineKm(boardingStop.latitude, boardingStop.longitude, closest.latitude, closest.longitude);
        for (const bus of activeBuses.slice(1)) {
          const d = haversineKm(boardingStop.latitude, boardingStop.longitude, bus.latitude, bus.longitude);
          if (d < closestDist) { closestDist = d; closest = bus; }
        }
        const minutesAway = Math.max(1, Math.round((closestDist / AVG_SPEED_KMH) * 60));
        activeBusResult = { tripId: closest.trip_id, latitude: closest.latitude, longitude: closest.longitude, minutesAway };
        estimatedArrivalMinutes = minutesAway;
      } else {
        estimatedArrivalMinutes = route.frequency_minutes ?? 15;
      }

      const recommendation = activeBusResult
        ? activeBusResult.minutesAway <= 2
          ? '¡El bus está llegando!'
          : `Bus en camino, aprox. ${activeBusResult.minutesAway} min`
        : `Próximo bus en aprox. ${estimatedArrivalMinutes} min (frecuencia)`;

      recommendations.push({
        route: {
          id: route.id,
          name: route.name,
          code: route.code,
          company: route.company,
          frequency_minutes: route.frequency_minutes,
        },
        boardingStop: {
          id: boardingStop.id,
          name: boardingStop.name,
          latitude: boardingStop.latitude,
          longitude: boardingStop.longitude,
          distanceMeters: Math.round(boardingDist * 1000),
        },
        alightingStop: {
          id: alightingStop.id,
          name: alightingStop.name,
          latitude: alightingStop.latitude,
          longitude: alightingStop.longitude,
          distanceMeters: Math.round(alightingDist * 1000),
        },
        routeSegment: routeSegment.map((s) => ({
          latitude: s.latitude,
          longitude: s.longitude,
          name: s.name,
        })),
        activeBus: activeBusResult,
        hasLiveTracking: activeBusResult !== null,
        estimatedArrivalMinutes,
        recommendation,
      });
    }

    // Ordenar por tiempo estimado de llegada
    recommendations.sort((a, b) => a.estimatedArrivalMinutes - b.estimatedArrivalMinutes);

    res.json({ recommendations });
  } catch (error) {
    console.error('Error en recomendación de rutas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
