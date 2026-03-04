import axios from 'axios';
import pool from '../config/database';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const QUERY = `[out:json][timeout:90];relation["route"="bus"]["network"="Transmetro"](10.6,-75.2,11.3,-74.6);out geom;`;

// ── Tipos Overpass ────────────────────────────────────────────────────────────

interface OverpassPoint {
  lat: number;
  lon: number;
}

interface OverpassMemberWay {
  type: 'way';
  ref: number;
  role: string;
  geometry?: OverpassPoint[];
}

interface OverpassMemberNode {
  type: 'node';
  ref: number;
  role: string;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

type OverpassMember = OverpassMemberWay | OverpassMemberNode;

interface OverpassRelation {
  type: 'relation';
  id: number;
  tags: Record<string, string>;
  members: OverpassMember[];
}

interface OverpassResponse {
  elements: OverpassRelation[];
}

export interface ImportResult {
  imported: number;
  updated: number;
  errors: number;
}

// ── Construye geometría desde los ways del relation ───────────────────────────

function buildGeometry(members: OverpassMember[]): [number, number][] {
  const points: [number, number][] = [];

  for (const member of members) {
    if (member.type !== 'way' || !member.geometry?.length) continue;

    const wayPoints = member.geometry.map(
      (p): [number, number] => [p.lat, p.lon]
    );

    if (points.length === 0) {
      points.push(...wayPoints);
      continue;
    }

    // Evitar duplicar el punto de unión entre ways consecutivos
    const last = points[points.length - 1];
    const first = wayPoints[0];
    const isDuplicate =
      Math.abs(last[0] - first[0]) < 0.000001 &&
      Math.abs(last[1] - first[1]) < 0.000001;

    points.push(...(isDuplicate ? wayPoints.slice(1) : wayPoints));
  }

  return points;
}

// ── Extrae paradas desde los nodes del relation ───────────────────────────────
//
// OSM distingue dos tipos de nodo en las relaciones BRT/metro:
//   • role "platform" → posición física de la estación (andén, entrada)
//   • role "stop"     → punto donde el vehículo se detiene (en el carril)
//
// Para Transmetro (BRT) lo correcto es usar los nodos "platform" porque
// representan dónde el pasajero camina hasta la estación.
// Si una ruta no tiene platforms (alimentadoras simples) se usan los "stop".

function buildStops(
  members: OverpassMember[]
): { lat: number; lon: number; name: string }[] {
  const platforms: { lat: number; lon: number; name: string }[] = [];
  const stopNodes: { lat: number; lon: number; name: string }[] = [];

  for (const member of members) {
    if (member.type !== 'node') continue;
    const entry = {
      lat: member.lat,
      lon: member.lon,
      name: member.tags?.name ?? 'Estación sin nombre',
    };
    if (member.role.includes('platform')) {
      platforms.push(entry);
    } else if (member.role.includes('stop')) {
      stopNodes.push(entry);
    }
  }

  // Preferir platforms (ubicación real de la estación para el peatón)
  return platforms.length > 0 ? platforms : stopNodes;
}

// ── Función principal exportada ───────────────────────────────────────────────

export async function importTransmetro(): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, updated: 0, errors: 0 };

  console.log('🚌 Consultando Overpass API (Transmetro)…');

  const response = await axios.post<OverpassResponse>(
    OVERPASS_URL,
    `data=${encodeURIComponent(QUERY)}`,
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
    }
  );

  const relations = response.data.elements;
  console.log(`📋 ${relations.length} relaciones encontradas`);

  for (const relation of relations) {
    try {
      const tags = relation.tags ?? {};

      const name    = tags.name ?? `Transmetro ${relation.id}`;
      const code    = tags.ref ?? relation.id.toString();
      const company = tags.operator ?? 'Transmetro S.A.S.';
      const color   = tags.colour ?? '#e60000';
      const type    =
        tags.ref?.startsWith('A') || tags.ref?.startsWith('U')
          ? 'alimentadora'
          : 'transmetro';

      const geometry = buildGeometry(relation.members);
      const stops    = buildStops(relation.members);

      const existing = await pool.query<{ id: number }>(
        'SELECT id FROM routes WHERE code = $1',
        [code]
      );

      let routeId: number;

      if (existing.rows.length === 0) {
        const ins = await pool.query<{ id: number }>(
          `INSERT INTO routes
             (name, code, company, color, type, is_active, status, geometry)
           VALUES ($1, $2, $3, $4, $5, true, 'active', $6)
           RETURNING id`,
          [name, code, company, color, type, JSON.stringify(geometry)]
        );
        routeId = ins.rows[0].id;
        result.imported++;
      } else {
        routeId = existing.rows[0].id;
        await pool.query(
          `UPDATE routes
           SET name=$1, company=$2, color=$3, type=$4, geometry=$5
           WHERE id=$6`,
          [name, company, color, type, JSON.stringify(geometry), routeId]
        );
        result.updated++;
      }

      // Paradas
      await pool.query('DELETE FROM stops WHERE route_id = $1', [routeId]);
      for (let i = 0; i < stops.length; i++) {
        await pool.query(
          `INSERT INTO stops (route_id, name, latitude, longitude, stop_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [routeId, stops[i].name, stops[i].lat, stops[i].lon, i + 1]
        );
      }

      console.log(
        `✅ [${type}] ${name} — ${stops.length} paradas, ${geometry.length} puntos`
      );
    } catch (err) {
      console.error(`❌ Error en relation ${relation.id}:`, err);
      result.errors++;
    }
  }

  console.log(
    `🎉 Transmetro importado — nuevas: ${result.imported}, ` +
    `actualizadas: ${result.updated}, errores: ${result.errors}`
  );

  return result;
}
