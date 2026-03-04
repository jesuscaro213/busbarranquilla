/**
 * legService.ts
 *
 * Detecta el tramo (ida / regreso) de cada parada en una ruta circular.
 * La geometría almacenada contiene el recorrido completo: ida + regreso.
 *
 * Algoritmo:
 *   turnaround_idx = punto geográficamente más lejano de geometry[0]
 *   Para cada parada: encuentra el punto de geometría más cercano.
 *     Si ese índice ≤ turnaround_idx → leg = 'ida'
 *     Si ese índice >  turnaround_idx → leg = 'regreso'
 */

import pool from '../config/database';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function computeLegsForRoute(routeId: number): Promise<void> {
  const routeResult = await pool.query(
    `SELECT geometry FROM routes WHERE id = $1`,
    [routeId]
  );

  if (routeResult.rows.length === 0) return;

  const geometry: [number, number][] = routeResult.rows[0].geometry;
  if (!Array.isArray(geometry) || geometry.length < 2) return;

  const [startLat, startLng] = geometry[0];

  // Encontrar punto de giro
  let turnaroundIdx = 0;
  let maxDist = 0;
  for (let i = 1; i < geometry.length; i++) {
    const d = haversineKm(startLat, startLng, geometry[i][0], geometry[i][1]);
    if (d > maxDist) {
      maxDist = d;
      turnaroundIdx = i;
    }
  }

  await pool.query(`UPDATE routes SET turnaround_idx = $1 WHERE id = $2`, [turnaroundIdx, routeId]);

  // Asignar leg a cada parada
  const stopsResult = await pool.query(
    `SELECT id, latitude, longitude FROM stops WHERE route_id = $1`,
    [routeId]
  );

  for (const stop of stopsResult.rows) {
    const sLat = parseFloat(stop.latitude);
    const sLng = parseFloat(stop.longitude);

    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < geometry.length; i++) {
      const d = haversineKm(sLat, sLng, geometry[i][0], geometry[i][1]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }

    const leg = nearestIdx <= turnaroundIdx ? 'ida' : 'regreso';
    await pool.query(`UPDATE stops SET leg = $1 WHERE id = $2`, [leg, stop.id]);
  }
}
