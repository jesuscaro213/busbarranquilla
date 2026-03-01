import pool from '../config/database';

interface TracePoint {
  lat: number;
  lng: number;
}

interface TraceRow {
  points: TracePoint[];
}

export async function calculateSuggestedGeometry(
  routeId: string
): Promise<[number, number][] | null> {
  try {
    const result = await pool.query<TraceRow>(
      `SELECT points FROM route_traces WHERE route_id = $1 AND status = 'pending'`,
      [routeId]
    );

    if (result.rows.length < 5) return null;

    // Flatten all points from all traces in order
    const allPoints: TracePoint[] = result.rows.flatMap(row => row.points as TracePoint[]);

    // Group by proximity: key = lat + lng rounded to 4 decimals
    const groups = new Map<
      string,
      { sumLat: number; sumLng: number; count: number; firstIndex: number }
    >();

    allPoints.forEach((point, idx) => {
      const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { sumLat: point.lat, sumLng: point.lng, count: 1, firstIndex: idx });
      } else {
        existing.sumLat += point.lat;
        existing.sumLng += point.lng;
        existing.count += 1;
      }
    });

    // Calculate centroids sorted by first appearance in the traces
    const centroids = Array.from(groups.values())
      .sort((a, b) => a.firstIndex - b.firstIndex)
      .map(g => [g.sumLat / g.count, g.sumLng / g.count] as [number, number]);

    return centroids;
  } catch (error) {
    console.error('Error calculating suggested geometry:', error);
    return null;
  }
}

export async function processPendingTraces(routeId: string): Promise<void> {
  try {
    const geometry = await calculateSuggestedGeometry(routeId);
    if (geometry === null) return;

    await pool.query(
      `UPDATE routes
       SET suggested_geometry = $1,
           has_suggestion = true,
           suggestion_trace_count = (
             SELECT COUNT(*) FROM route_traces
             WHERE route_id = $2 AND status = 'pending'
           ),
           suggestion_updated_at = NOW()
       WHERE id = $2`,
      [geometry, routeId]
    );

    await pool.query(
      `UPDATE route_traces SET status = 'processed' WHERE route_id = $1 AND status = 'pending'`,
      [routeId]
    );
  } catch (error) {
    console.error('Error processing pending traces:', error);
    throw error;
  }
}
