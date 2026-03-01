import axios from 'axios';
import pool from '../config/database';
import { fetchOSRMGeometry } from './osrmService';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'Mozilla/5.0 (compatible; MiBusBot/1.0; +https://mibus.co)';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ProcessResult {
  processed: number;
  errors: number;
}

export interface ProcessProgress {
  total: number;
  current: number;
  currentRoute: string;
  status: 'processing' | 'done';
  result?: ProcessResult;
  completedRoute?: { id: number; name: string; status: string; is_active: boolean };
}

interface NominatimResult {
  lat: string;
  lon: string;
}

// ── Geocodifica un segmento de recorrido ──────────────────────────────────────

async function geocodeSegment(
  segment: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const res = await axios.get<NominatimResult[]>(NOMINATIM, {
      params: {
        q: `${segment}, Barranquilla, Colombia`,
        format: 'json',
        limit: 1,
      },
      headers: { 'User-Agent': UA },
      timeout: 8000,
    });
    if (!res.data.length) return null;
    return {
      latitude: parseFloat(res.data[0].lat),
      longitude: parseFloat(res.data[0].lon),
    };
  } catch {
    return null;
  }
}

// ── Función principal exportada ───────────────────────────────────────────────

export async function processImports(
  onProgress?: (update: ProcessProgress) => void
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, errors: 0 };

  const { rows: pending } = await pool.query<{
    id: number;
    name: string;
    description: string;
    code: string;
  }>(
    `SELECT id, name, description, code FROM routes
     WHERE status = 'pending' ORDER BY id`
  );

  const total = pending.length;
  console.log(`⚙️  ${total} rutas pendientes de procesar`);

  onProgress?.({ total, current: 0, currentRoute: 'Iniciando...', status: 'processing' });

  for (let i = 0; i < pending.length; i++) {
    const route = pending[i];

    onProgress?.({ total, current: i + 1, currentRoute: route.name, status: 'processing' });

    try {
      await pool.query(`UPDATE routes SET status='processing' WHERE id=$1`, [route.id]);

      // Geocodificar segmentos del recorrido
      const segments = route.description
        .split(/\s+[–—\-]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const stops: { latitude: number; longitude: number; name: string }[] = [];

      for (let j = 0; j < segments.length; j++) {
        if (j > 0) await sleep(1000);
        const geo = await geocodeSegment(segments[j]);
        if (geo) {
          stops.push({ ...geo, name: segments[j] });
        }
      }

      if (stops.length < 2) {
        await pool.query(`UPDATE routes SET status='error' WHERE id=$1`, [route.id]);
        console.warn(`⚠️  Sin coordenadas suficientes: ${route.code}`);
        result.errors++;
        continue;
      }

      // Guardar paradas
      await pool.query(`DELETE FROM stops WHERE route_id=$1`, [route.id]);
      for (let j = 0; j < stops.length; j++) {
        await pool.query(
          `INSERT INTO stops (route_id, name, latitude, longitude, stop_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [route.id, stops[j].name, stops[j].latitude, stops[j].longitude, j + 1]
        );
      }

      // Obtener geometría de OSRM
      const osrm = await fetchOSRMGeometry(stops);
      if (osrm) {
        await pool.query(
          `UPDATE routes SET geometry=$1 WHERE id=$2`,
          [JSON.stringify(osrm.points), route.id]
        );
      }

      await pool.query(`UPDATE routes SET status='done' WHERE id=$1`, [route.id]);
      console.log(`✅ Procesada: ${route.code} (${stops.length} paradas)`);
      result.processed++;

      onProgress?.({
        total,
        current: i + 1,
        currentRoute: route.name,
        status: 'processing',
        completedRoute: { id: route.id, name: route.name, status: 'done', is_active: false },
      });

    } catch (err) {
      console.error(`❌ Error procesando ${route.code}:`, err);
      await pool.query(`UPDATE routes SET status='error' WHERE id=$1`, [route.id]).catch(() => null);
      result.errors++;
    }
  }

  console.log(`🎉 Procesamiento completado — ok: ${result.processed}, errores: ${result.errors}`);
  onProgress?.({ total, current: total, currentRoute: '', status: 'done', result });

  return result;
}
