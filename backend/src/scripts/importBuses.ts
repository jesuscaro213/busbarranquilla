/**
 * importBuses.ts
 *
 * Downloads official KMZ route files from the AMBQ website
 * (Área Metropolitana de Barranquilla y sus municipios) and
 * imports them into the routes + stops tables.
 *
 * KMZ source: https://www.ambq.gov.co/ruta-de-buses/{COMPANY}/{CODE}.kmz
 * KMZ format: ZIP → doc.kml → <coordinates> as "lng,lat,0 lng,lat,0 …"
 * Geometry stored as [lat, lng][] (consistent with OSRM-imported routes).
 * Stops:  sampled every ~500 m along the route (KMZ has no stop placemarks).
 */

import axios from 'axios';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import pool from '../config/database';
import { computeLegsForRoute } from '../services/legService';

// ── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.ambq.gov.co/ruta-de-buses';
const STOP_INTERVAL_M = 500; // metres between sampled stops

// ── Route catalogue (85 routes, 26 companies) ──────────────────────────────

const ROUTES: { company: string; code: string }[] = [
  // COOCHOFAL
  { company: 'COOCHOFAL', code: 'A15-4159' },
  { company: 'COOCHOFAL', code: 'C18-4141' },
  { company: 'COOCHOFAL', code: 'C2-4133' },
  { company: 'COOCHOFAL', code: 'C4-4135' },
  { company: 'COOCHOFAL', code: 'C9-4140' },
  { company: 'COOCHOFAL', code: 'D20-4185' },
  // COOASOATLAN
  { company: 'COOASOATLAN', code: 'C1-4132' },
  { company: 'COOASOATLAN', code: 'C20-4181' },
  // COOLITORAL
  { company: 'COOLITORAL', code: 'A1-4106' },
  { company: 'COOLITORAL', code: 'A2-4107' },
  { company: 'COOLITORAL', code: 'A3-4108' },
  { company: 'COOLITORAL', code: 'A4-4109' },
  { company: 'COOLITORAL', code: 'B1-4117' },
  { company: 'COOLITORAL', code: 'B17-4163' },
  { company: 'COOLITORAL', code: 'B2A-4177' },
  { company: 'COOLITORAL', code: 'B3-4119' },
  { company: 'COOLITORAL', code: 'C19-4178' },
  { company: 'COOLITORAL', code: 'PT1-4101' },
  { company: 'COOLITORAL', code: 'PT2-4102' },
  { company: 'COOLITORAL', code: 'PT3-4103' },
  { company: 'COOLITORAL', code: 'PT4-4104' },
  { company: 'COOLITORAL', code: 'PT5-4105' },
  // COOTRAB
  { company: 'COOTRAB', code: 'C5-4136' },
  { company: 'COOTRAB', code: 'C6-4137' },
  // COOTRANTICO
  { company: 'COOTRANTICO', code: 'A18-4183' },
  { company: 'COOTRANTICO', code: 'B20-4180' },
  { company: 'COOTRANTICO', code: 'B4-4120' },
  { company: 'COOTRANTICO', code: 'B5-4121' },
  { company: 'COOTRANTICO', code: 'B6-4122' },
  { company: 'COOTRANTICO', code: 'B7-4123' },
  // COOTRANSCO
  { company: 'COOTRANSCO', code: 'C7-4138' },
  // COOTRANSPORCAR
  { company: 'COOTRANSPORCAR', code: 'C8-4139' },
  // COOTRANSNORTE
  { company: 'COOTRANSNORTE', code: 'A5-4110' },
  { company: 'COOTRANSNORTE', code: 'A6-4111' },
  // COOTRASOL
  { company: 'COOTRASOL', code: 'D3-4147' },
  { company: 'COOTRASOL', code: 'D4-4148' },
  { company: 'COOTRASOL', code: 'D5-4149' },
  // COOTRATLANTICO
  { company: 'COOTRATLANTICO', code: 'C10-4142' },
  { company: 'COOTRATLANTICO', code: 'C15-4144' },
  // EMBUSA
  { company: 'EMBUSA', code: 'B9-4125' },
  // FLOTA-ANGULO
  { company: 'FLOTA-ANGULO', code: 'A7-4112' },
  // FLOTA-ROJA
  { company: 'FLOTA-ROJA', code: 'A8-4113' },
  // LA-CAROLINA
  { company: 'LA-CAROLINA', code: 'A16-4161' },
  { company: 'LA-CAROLINA', code: 'D6-4150' },
  { company: 'LA-CAROLINA', code: 'D7-4151' },
  // LOLAYA
  { company: 'LOLAYA', code: 'B10-4126' },
  { company: 'LOLAYA', code: 'D8-4165' },
  // MONTERREY
  { company: 'MONTERREY', code: 'B11-4166' },
  { company: 'MONTERREY', code: 'B12-4127' },
  { company: 'MONTERREY', code: 'B8-4124' },
  // SOBUSA
  { company: 'SOBUSA', code: 'B18-4175' },
  { company: 'SOBUSA', code: 'C11-4168' },
  { company: 'SOBUSA', code: 'C12-4169' },
  { company: 'SOBUSA', code: 'C13-4143' },
  { company: 'SOBUSA', code: 'C14-4170' },
  { company: 'SOBUSA', code: 'C16-4167' },
  // SODETRANS
  { company: 'SODETRANS', code: 'B13-4128' },
  { company: 'SODETRANS', code: 'B14-4174' },
  { company: 'SODETRANS', code: 'B15-4129' },
  { company: 'SODETRANS', code: 'C21-4182' },
  // T_ATLANTICO
  { company: 'T_ATLANTICO', code: 'A13-4162' },
  // TRANSOLEDAD
  { company: 'TRANSOLEDAD', code: 'D13-4155' },
  // TRASALIANCO
  { company: 'TRASALIANCO', code: 'B19-4176' },
  { company: 'TRASALIANCO', code: 'D12-4154' },
  { company: 'TRASALIANCO', code: 'D17-4158' },
  { company: 'TRASALIANCO', code: 'D18-4179' },
  // TRASALFA
  { company: 'TRASALFA', code: 'B2B-4118' },
  { company: 'TRASALFA', code: 'D14-4156' },
  { company: 'TRASALFA', code: 'D15-4157' },
  // TRANSDIAZ
  { company: 'TRANSDIAZ', code: 'A10-4114' },
  { company: 'TRANSDIAZ', code: 'A11-4115' },
  { company: 'TRANSDIAZ', code: 'B16-4130' },
  // TRANSMECAR
  { company: 'TRANSMECAR', code: 'C17-4160' },
  { company: 'TRANSMECAR', code: 'D10-4172' },
  { company: 'TRANSMECAR', code: 'D11-4153' },
  { company: 'TRANSMECAR', code: 'D9-4152' },
  // TRANSURBAR
  { company: 'TRANSURBAR', code: 'A14-4116' },
  { company: 'TRANSURBAR', code: 'D16-4173' },
  { company: 'TRANSURBAR', code: 'D19-4184' },
];

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImportBusesResult {
  imported: number;
  updated: number;
  errors: number;
  skipped: number;
}

// ── Geometry helpers ───────────────────────────────────────────────────────

/** Haversine distance in metres between two [lat, lng] points */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Sample one point every `intervalM` metres along a polyline.
 * Always includes the first and last point.
 */
function sampleStops(
  geometry: [number, number][],
  intervalM: number
): { lat: number; lon: number }[] {
  if (geometry.length === 0) return [];

  const result: { lat: number; lon: number }[] = [
    { lat: geometry[0][0], lon: geometry[0][1] },
  ];

  let accumulated = 0;

  for (let i = 1; i < geometry.length; i++) {
    accumulated += haversineM(geometry[i - 1], geometry[i]);
    if (accumulated >= intervalM) {
      result.push({ lat: geometry[i][0], lon: geometry[i][1] });
      accumulated = 0;
    }
  }

  const last = geometry[geometry.length - 1];
  const prev = result[result.length - 1];
  if (prev.lat !== last[0] || prev.lon !== last[1]) {
    result.push({ lat: last[0], lon: last[1] });
  }

  return result;
}

// ── KMZ parsing ────────────────────────────────────────────────────────────

/**
 * Download a KMZ URL and return the decoded geometry as [lat, lng][].
 * Returns null if the file can't be fetched or parsed.
 */
async function fetchKmzGeometry(
  url: string
): Promise<[number, number][] | null> {
  let buffer: ArrayBuffer;
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      headers: { 'User-Agent': 'MiBus-Importer/1.0' },
    });
    buffer = response.data;
  } catch {
    return null;
  }

  let kmlText: string;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const kmlFile = zip.file('doc.kml');
    if (!kmlFile) return null;
    kmlText = await kmlFile.async('text');
  } catch {
    return null;
  }

  // Cheerio in XML mode to parse KML
  const $ = cheerio.load(kmlText, { xmlMode: true });
  const coordsText = $('coordinates').first().text().trim();
  if (!coordsText) return null;

  // Each triplet is "lng,lat,alt" separated by whitespace
  const points: [number, number][] = [];
  for (const token of coordsText.split(/\s+/)) {
    const parts = token.split(',');
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push([lat, lng]); // store as [lat, lng]
    }
  }

  return points.length > 0 ? points : null;
}

// ── DB helpers ─────────────────────────────────────────────────────────────

/**
 * Upsert a company by name (unique index on companies.name).
 * Returns the company's id.
 */
async function upsertCompany(name: string): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO companies (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  return result.rows[0].id;
}

async function upsertRoute(
  code: string,
  name: string,
  company: string,
  companyId: number,
  geometry: [number, number][]
): Promise<{ routeId: number; isNew: boolean }> {
  const existing = await pool.query<{ id: number }>(
    'SELECT id FROM routes WHERE code = $1',
    [code]
  );

  if (existing.rows.length === 0) {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO routes
         (name, code, company, company_id, color, type, is_active, status, geometry)
       VALUES ($1, $2, $3, $4, '#1d4ed8', 'bus', true, 'active', $5)
       RETURNING id`,
      [name, code, company, companyId, JSON.stringify(geometry)]
    );
    return { routeId: ins.rows[0].id, isNew: true };
  }

  await pool.query(
    `UPDATE routes
     SET name=$1, company=$2, company_id=$3, type='bus', geometry=$4
     WHERE id=$5`,
    [name, company, companyId, JSON.stringify(geometry), existing.rows[0].id]
  );
  return { routeId: existing.rows[0].id, isNew: false };
}

async function replaceStops(
  routeId: number,
  stops: { lat: number; lon: number }[]
): Promise<void> {
  await pool.query('DELETE FROM stops WHERE route_id = $1', [routeId]);
  for (let i = 0; i < stops.length; i++) {
    await pool.query(
      `INSERT INTO stops (route_id, name, latitude, longitude, stop_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [routeId, `Parada ${i + 1}`, stops[i].lat, stops[i].lon, i + 1]
    );
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function importBuses(): Promise<ImportBusesResult> {
  const result: ImportBusesResult = {
    imported: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  console.log(`🚌 Importando ${ROUTES.length} rutas de buses desde AMBQ…\n`);

  // Pre-create all 26 companies so company_id is always available
  const companyIds = new Map<string, number>();
  const uniqueCompanies = [...new Set(ROUTES.map((r) => r.company))];
  for (const companyName of uniqueCompanies) {
    const id = await upsertCompany(companyName);
    companyIds.set(companyName, id);
  }
  console.log(`🏢 ${uniqueCompanies.length} empresas listas en BD\n`);

  for (const { company, code } of ROUTES) {
    const url = `${BASE_URL}/${company}/${code}.kmz`;
    process.stdout.write(`  ⬇  ${company}/${code} … `);

    const geometry = await fetchKmzGeometry(url);

    if (!geometry) {
      console.log('❌  sin geometría (KMZ no disponible)');
      result.skipped++;
      continue;
    }

    const stops = sampleStops(geometry, STOP_INTERVAL_M);
    const name = `Ruta ${code}`;
    const companyId = companyIds.get(company)!;

    try {
      const { routeId, isNew } = await upsertRoute(code, name, company, companyId, geometry);
      await replaceStops(routeId, stops);
      await computeLegsForRoute(routeId);

      console.log(
        `${isNew ? '✅  nueva' : '🔄  actualizada'} — ${geometry.length} pts, ${stops.length} paradas`
      );
      if (isNew) result.imported++;
      else result.updated++;
    } catch (err) {
      console.log('❌  error DB');
      console.error(err);
      result.errors++;
    }
  }

  console.log(
    `\n🎉 Buses — nuevas: ${result.imported}, actualizadas: ${result.updated}, ` +
      `omitidas: ${result.skipped}, errores: ${result.errors}`
  );

  return result;
}
