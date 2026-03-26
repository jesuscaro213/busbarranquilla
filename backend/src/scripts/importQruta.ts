/**
 * importQruta.ts
 *
 * Importa rutas con geometría GPS real desde el Parse Server de qruta.
 * Fuente: https://qruta-main.up.railway.app/parse/classes/Route
 *
 * Modos:
 *   --dry-run   Solo muestra el reporte, no toca la DB
 *   --apply     Aplica sin confirmación interactiva (respeta umbral 3 km)
 *   --force     Junto con --apply, ignora el umbral 3 km (reemplaza conflictos)
 *   (sin flags) Muestra reporte y pide [y/N] antes de aplicar
 *
 * Unicidad: (empresa + código). Mismo código en diferente empresa = ruta distinta.
 * IDA/VUELTA: mismo (empresa + código) x2 → CODE y CODE-R (retorno).
 */

import axios from 'axios';
import * as readline from 'readline';
import pool from '../config/database';
import { computeLegsForRoute } from '../services/legService';

// ── Constants ──────────────────────────────────────────────────────────────

const PARSE_URL  = 'https://qruta-main.up.railway.app/parse/classes/Route';
const PARSE_APPID = '7S389pHCOfe0ZRH7Dd3598YOpOr9AaJ63r9VdV49';
const PAGE_SIZE  = 100;
const STOP_INTERVAL_M = 500;

// Barranquilla AMB bbox (ampliada levemente para inter-municipales)
const BBOX = { latMin: 10.60, latMax: 11.20, lngMin: -75.10, lngMax: -74.50 };

const EXCLUDED_COMPANIES = ['transmetro', 'mio', 'a. prueba'];

// Umbral de centroide para clasificar conflicto
const THRESHOLD_MEJORA_M   =  800;
const THRESHOLD_CONFLICTO_M = 3000;

// ── Types ──────────────────────────────────────────────────────────────────

interface QrutaRoute {
  objectId: string;
  name: string;           // código de ruta: "A1", "B4", etc.
  details?: string;       // descripción / terminal
  path: [number, number][]; // [[lat, lng], ...]
  company?: { name: string };
  status: boolean;
}

export interface ImportQrutaResult {
  matched: number;
  inserted: number;
  skipped: number;
  conflicts: number;
  pairs: number;
  errors: number;
}

type GeomClass = 'MEJORA' | 'CAMBIO' | 'CONFLICTO' | 'NUEVA' | 'NO_GEOM';

interface RouteEntry {
  code: string;           // código final (con sufijo -R si es retorno)
  companyName: string;
  details: string;
  path: [number, number][];
  isReturn: boolean;
}

interface MatchResult {
  dbId:      number | null;
  dbCode:    string | null;
  dbCompany: string | null;
  dbGeom:    [number, number][] | null;
  companyMismatch: boolean;
  geomClass:  GeomClass;
  centroidDelta: number; // metros
}

// ── Geometry helpers ───────────────────────────────────────────────────────

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLng ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function centroid(pts: [number, number][]): [number, number] {
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [lat, lng];
}

function inBbox(pt: [number, number]): boolean {
  return pt[0] >= BBOX.latMin && pt[0] <= BBOX.latMax
      && pt[1] >= BBOX.lngMin && pt[1] <= BBOX.lngMax;
}

function sampleStops(geometry: [number, number][], intervalM: number) {
  if (geometry.length === 0) return [];
  const result: { lat: number; lon: number }[] = [{ lat: geometry[0][0], lon: geometry[0][1] }];
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

// ── Normalization ──────────────────────────────────────────────────────────

function normalizeCompany(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[-_]/g, ' ')
    .trim();
}

/** Canonical display name: "TRASALFA" → "Trasalfa", "cootrasol ltda" → "Cootrasol Ltda" */
function toTitleCase(name: string): string {
  return name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ── Fetch from Parse Server ────────────────────────────────────────────────

async function fetchAllQrutaRoutes(): Promise<QrutaRoute[]> {
  const all: QrutaRoute[] = [];
  let skip = 0;

  while (true) {
    const res = await axios.get<{ results: QrutaRoute[] }>(PARSE_URL, {
      headers: { 'X-Parse-Application-Id': PARSE_APPID },
      params: {
        keys: 'name,details,path,company,status',
        include: 'company',
        limit: PAGE_SIZE,
        skip,
      },
      timeout: 30_000,
    });
    const batch = res.data.results ?? [];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  return all;
}

// ── Filter & deduplicate qruta-side ───────────────────────────────────────

interface FilterResult {
  entries: RouteEntry[];
  skipped: { code: string; company: string; reason: string }[];
  pairs: number;
}

function filterAndDeduplicate(raw: QrutaRoute[]): FilterResult {
  const skipped: { code: string; company: string; reason: string }[] = [];
  let pairs = 0;

  // 1. Apply basic filters
  const valid: QrutaRoute[] = [];
  for (const r of raw) {
    const code = (r.name ?? '').trim();
    const companyName = r.company?.name ?? '';

    if (code.toLowerCase() === 'borrar') {
      skipped.push({ code, company: companyName, reason: 'nombre "Borrar"' });
      continue;
    }
    if (!r.status) {
      skipped.push({ code, company: companyName, reason: 'inactiva' });
      continue;
    }
    if (!r.path || r.path.length < 3) {
      skipped.push({ code, company: companyName, reason: 'sin geometría' });
      continue;
    }
    if (EXCLUDED_COMPANIES.includes(normalizeCompany(companyName))) {
      skipped.push({ code, company: companyName, reason: `empresa excluida (${companyName})` });
      continue;
    }
    valid.push(r);
  }

  // 2. Group by (company, code) — key = "COMPANY||CODE"
  const groups = new Map<string, QrutaRoute[]>();
  for (const r of valid) {
    const key = `${normalizeCompany(r.company?.name ?? '')}||${r.name.trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  // 3. Resolve each group
  const entries: RouteEntry[] = [];

  for (const [, group] of groups) {
    const code        = group[0].name.trim();
    const companyName = group[0].company?.name ?? '';

    const canonicalCompany = toTitleCase(companyName);

    if (group.length === 1) {
      // Unique route
      entries.push({
        code,
        companyName: canonicalCompany,
        details: (group[0].details ?? '').trim(),
        path: group[0].path,
        isReturn: false,
      });
    } else if (group.length === 2) {
      // IDA / VUELTA pair → sort by path length desc
      pairs++;
      const [main, ret] = group.sort((a, b) => b.path.length - a.path.length);
      entries.push({
        code,
        companyName: canonicalCompany,
        details: (main.details ?? '').trim(),
        path: main.path,
        isReturn: false,
      });
      entries.push({
        code: `${code}-R`,
        companyName: canonicalCompany,
        details: (ret.details ?? '').trim(),
        path: ret.path,
        isReturn: true,
      });
    } else {
      // > 2 entries for same (company, code) — unexpected, skip all
      for (const r of group) {
        skipped.push({ code, company: companyName, reason: `${group.length} entradas duplicadas (no es par IDA/VUELTA)` });
      }
    }
  }

  return { entries, skipped, pairs };
}

// ── DB helpers ─────────────────────────────────────────────────────────────

async function upsertCompany(name: string): Promise<number> {
  const canonical = toTitleCase(name);
  // Use case-insensitive lookup to avoid "TRASALFA" vs "Trasalfa" duplicates
  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [canonical],
  );
  if (existing.rows.length) return existing.rows[0].id;
  const res = await pool.query<{ id: number }>(
    `INSERT INTO companies (name) VALUES ($1) RETURNING id`,
    [canonical],
  );
  return res.rows[0].id;
}

async function findInDb(entry: RouteEntry): Promise<MatchResult> {
  const { code, companyName } = entry;
  const normCo = normalizeCompany(companyName);

  type Row = { id: number; code: string; company: string; geometry: string | null };

  // Helper to parse geometry JSON from DB
  const parseGeom = (raw: string | null): [number, number][] | null => {
    if (!raw) return null;
    try {
      const g = JSON.parse(raw);
      return Array.isArray(g) && g.length > 0 ? g : null;
    } catch { return null; }
  };

  const buildMatch = (row: Row, companyMismatch: boolean): MatchResult => {
    const dbGeom = parseGeom(row.geometry);
    let geomClass: GeomClass = 'NOVA' as any;
    let centroidDelta = 0;

    if (!dbGeom) {
      geomClass = 'NO_GEOM';
    } else {
      const cDb = centroid(dbGeom);
      const cQr = centroid(entry.path);
      centroidDelta = haversineM(cDb, cQr);
      if (centroidDelta <= THRESHOLD_MEJORA_M)    geomClass = 'MEJORA';
      else if (centroidDelta <= THRESHOLD_CONFLICTO_M) geomClass = 'CAMBIO';
      else                                         geomClass = 'CONFLICTO';
    }

    return {
      dbId: row.id,
      dbCode: row.code,
      dbCompany: row.company,
      dbGeom,
      companyMismatch,
      geomClass,
      centroidDelta,
    };
  };

  // 1. Empresa + código exacto
  {
    const r = await pool.query<Row>(
      `SELECT id, code, company, geometry::text FROM routes
       WHERE LOWER(company) = $1 AND code = $2 AND type = 'bus' LIMIT 1`,
      [normCo, code],
    );
    if (r.rows.length) return buildMatch(r.rows[0], false);
  }

  // 2. Empresa + prefijo de código (code LIKE 'A1-%')
  {
    const r = await pool.query<Row>(
      `SELECT id, code, company, geometry::text FROM routes
       WHERE LOWER(company) = $1 AND code LIKE $2 AND type = 'bus' LIMIT 1`,
      [normCo, `${code}-%`],
    );
    if (r.rows.length) return buildMatch(r.rows[0], false);
  }

  // 3. Solo código exacto (empresa diferente)
  {
    const r = await pool.query<Row>(
      `SELECT id, code, company, geometry::text FROM routes
       WHERE code = $1 AND type = 'bus' LIMIT 1`,
      [code],
    );
    if (r.rows.length) return buildMatch(r.rows[0], true);
  }

  // 4. Solo prefijo (empresa diferente)
  {
    const r = await pool.query<Row>(
      `SELECT id, code, company, geometry::text FROM routes
       WHERE code LIKE $1 AND type = 'bus' LIMIT 1`,
      [`${code}-%`],
    );
    if (r.rows.length) return buildMatch(r.rows[0], true);
  }

  // 5. Sin match
  return {
    dbId: null, dbCode: null, dbCompany: null, dbGeom: null,
    companyMismatch: false, geomClass: 'NUEVA', centroidDelta: 0,
  };
}

async function applyRoute(
  entry: RouteEntry,
  match: MatchResult,
  companyId: number,
): Promise<void> {
  const geomJson = JSON.stringify(entry.path);
  const name = entry.details || `Ruta ${entry.code}`;

  let routeId: number;

  if (match.dbId) {
    // Update existing
    await pool.query(
      `UPDATE routes
       SET geometry = $1, company = $2, company_id = $3, name = COALESCE(NULLIF(name,''), $4)
       WHERE id = $5`,
      [geomJson, entry.companyName, companyId, name, match.dbId],
    );
    routeId = match.dbId;
  } else {
    // Anti-duplicado before INSERT
    const check = await pool.query<{ id: number }>(
      `SELECT id FROM routes
       WHERE LOWER(company) = LOWER($1) AND LOWER(code) = LOWER($2) LIMIT 1`,
      [entry.companyName, entry.code],
    );
    if (check.rows.length) {
      throw new Error(`DUPLICADO EVITADO: ${entry.code} / ${entry.companyName}`);
    }

    const ins = await pool.query<{ id: number }>(
      `INSERT INTO routes
         (name, code, company, company_id, color, type, is_active, status, geometry)
       VALUES ($1,$2,$3,$4,'#1d4ed8','bus',true,'active',$5)
       RETURNING id`,
      [name, entry.code, entry.companyName, companyId, geomJson],
    );
    routeId = ins.rows[0].id;
  }

  const stops = sampleStops(entry.path, STOP_INTERVAL_M);
  await pool.query('DELETE FROM stops WHERE route_id = $1', [routeId]);
  for (let i = 0; i < stops.length; i++) {
    await pool.query(
      `INSERT INTO stops (route_id, name, latitude, longitude, stop_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [routeId, `Parada ${i + 1}`, stops[i].lat, stops[i].lon, i + 1],
    );
  }

  await computeLegsForRoute(routeId);
}

// ── Prompt helper ──────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// ── Main export ────────────────────────────────────────────────────────────

export async function importQruta(opts: {
  dryRun?: boolean;
  apply?: boolean;
  force?: boolean;
} = {}): Promise<ImportQrutaResult> {
  const { dryRun = false, apply = false, force = false } = opts;

  const result: ImportQrutaResult = {
    matched: 0, inserted: 0, skipped: 0, conflicts: 0, pairs: 0, errors: 0,
  };

  console.log('\n🌐 Descargando rutas desde qruta…');
  const raw = await fetchAllQrutaRoutes();
  console.log(`   ${raw.length} entradas recibidas\n`);

  // ── Filter & deduplicate ─────────────────────────────────────────────────
  const { entries, skipped, pairs } = filterAndDeduplicate(raw);
  result.skipped = skipped.length;
  result.pairs   = pairs;

  console.log(`📋 Después de filtrar: ${entries.length} rutas válidas (${pairs} pares IDA/VUELTA → ${pairs} retornos adicionales)\n`);

  // ── Cross-reference against DB ───────────────────────────────────────────
  type Classified = {
    entry: RouteEntry;
    match: MatchResult;
  };

  const mejoras:    Classified[] = [];
  const cambios:    Classified[] = [];
  const conflictos: Classified[] = [];
  const nuevas:     Classified[] = [];
  const bboxFail:   RouteEntry[] = [];

  for (const entry of entries) {
    // Bbox check first
    const cQr = centroid(entry.path);
    if (!inBbox(cQr)) {
      bboxFail.push(entry);
      result.skipped++;
      continue;
    }

    const match = await findInDb(entry);

    if (match.dbId === null) {
      nuevas.push({ entry, match });
    } else if (match.geomClass === 'NO_GEOM') {
      mejoras.push({ entry, match }); // treat no-geom as a mejora
    } else if (match.geomClass === 'MEJORA') {
      mejoras.push({ entry, match });
    } else if (match.geomClass === 'CAMBIO') {
      cambios.push({ entry, match });
    } else {
      // CONFLICTO
      conflictos.push({ entry, match });
    }
  }

  // ── Print report ─────────────────────────────────────────────────────────

  const pad = (s: string, n: number) => s.padEnd(n);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  REPORTE QRUTA' + (dryRun ? ' (dry-run)' : ''));
  console.log('═══════════════════════════════════════════════════════════\n');

  if (mejoras.length) {
    console.log(`✅ MEJORA (Δ ≤ ${THRESHOLD_MEJORA_M}m) — ${mejoras.length} rutas → se reemplazan`);
    for (const { entry, match } of mejoras) {
      const dbPts  = match.dbGeom?.length ?? 0;
      const status = match.geomClass === 'NO_GEOM' ? 'sin geom' : `DB:${dbPts}pts`;
      const co     = match.companyMismatch ? ` ⚠️ empresa DB: ${match.dbCompany}` : '';
      console.log(`   ${pad(entry.code, 10)} [${pad(entry.companyName, 20)}]  ${status} → qruta:${entry.path.length}pts  Δ${Math.round(match.centroidDelta)}m${co}`);
    }
    console.log();
  }

  if (cambios.length) {
    console.log(`⚠️  CAMBIO (${THRESHOLD_MEJORA_M}m–${THRESHOLD_CONFLICTO_M}m) — ${cambios.length} rutas → se reemplazan con advertencia`);
    for (const { entry, match } of cambios) {
      const dbPts = match.dbGeom?.length ?? 0;
      const co    = match.companyMismatch ? ` ⚠️ empresa DB: ${match.dbCompany}` : '';
      console.log(`   ${pad(entry.code, 10)} [${pad(entry.companyName, 20)}]  DB:${dbPts}pts → qruta:${entry.path.length}pts  Δ${Math.round(match.centroidDelta)}m${co}`);
    }
    console.log();
  }

  if (conflictos.length) {
    console.log(`🔴 CONFLICTO (Δ > ${THRESHOLD_CONFLICTO_M}m) — ${conflictos.length} rutas → ${force ? 'SE REEMPLAZAN (--force)' : 'NO se reemplazan (usar editor)'}`);
    for (const { entry, match } of conflictos) {
      const dbPts = match.dbGeom?.length ?? 0;
      console.log(`   ${pad(entry.code, 10)} [${pad(entry.companyName, 20)}]  DB:${dbPts}pts → qruta:${entry.path.length}pts  Δ${Math.round(match.centroidDelta)}m`);
    }
    console.log();
  }

  if (bboxFail.length) {
    console.log(`❌ FUERA DE BBOX — ${bboxFail.length} rutas → rechazadas`);
    for (const entry of bboxFail) {
      console.log(`   ${entry.code} [${entry.companyName}]`);
    }
    console.log();
  }

  if (nuevas.length) {
    const pairsLabel = pairs > 0 ? ` (incluye ${pairs} retornos -R)` : '';
    console.log(`➕ NUEVAS — ${nuevas.length} rutas → se insertan${pairsLabel}`);
    for (const { entry } of nuevas) {
      const retTag = entry.isReturn ? ' [RETORNO]' : '';
      console.log(`   ${pad(entry.code, 10)} [${pad(entry.companyName, 20)}]  ${entry.path.length}pts${retTag}`);
    }
    console.log();
  }

  if (skipped.length) {
    console.log(`⏭  SALTADAS — ${skipped.length} entradas`);
    for (const s of skipped.slice(0, 20)) {
      console.log(`   ${s.code} [${s.company}] — ${s.reason}`);
    }
    if (skipped.length > 20) console.log(`   … y ${skipped.length - 20} más`);
    console.log();
  }

  // Pairs summary
  if (pairs > 0) {
    const pairEntries = entries.filter(e => e.isReturn).map(e => ({
      retCode: e.code,
      mainCode: e.code.replace(/-R$/, ''),
      company: e.companyName,
      pts: e.path.length,
    }));
    console.log(`↔  IDA/VUELTA — ${pairs} pares (${pairs * 2} rutas)`);
    for (const p of pairEntries) {
      const main = entries.find(e => e.code === p.mainCode && !e.isReturn);
      console.log(`   ${p.mainCode} / ${p.retCode}  [${p.company}]  ${main?.path.length ?? '?'}pts / ${p.pts}pts`);
    }
    console.log();
  }

  const toApply = [...mejoras, ...cambios, ...(force ? conflictos : []), ...nuevas];
  result.conflicts = conflictos.length;

  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Total a procesar: ${toApply.length} rutas`);
  console.log(`  Conflictos saltados: ${force ? 0 : conflictos.length}`);
  console.log('───────────────────────────────────────────────────────────\n');

  // ── Dry-run: stop here ───────────────────────────────────────────────────
  if (dryRun) {
    console.log('ℹ️  Modo dry-run — no se escribió nada en la DB.\n');
    return result;
  }

  // ── Interactive confirmation ─────────────────────────────────────────────
  if (!apply) {
    const ans = await prompt('¿Aplicar cambios? [y/N] ');
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('Cancelado.');
      return result;
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  console.log('\n🚀 Aplicando…\n');

  // Pre-cache company ids
  const companyIds = new Map<string, number>();
  const uniqueCompanies = [...new Set(toApply.map(c => c.entry.companyName))];
  for (const name of uniqueCompanies) {
    companyIds.set(name, await upsertCompany(name));
  }

  for (const { entry, match } of toApply) {
    const label = match.dbId ? '🔄' : '✅';
    process.stdout.write(`  ${label} ${entry.code} [${entry.companyName}] … `);

    try {
      await applyRoute(entry, match, companyIds.get(entry.companyName)!);
      console.log(`ok (${entry.path.length} pts)`);
      if (match.dbId) result.matched++;
      else            result.inserted++;
    } catch (err: any) {
      if (err.message?.startsWith('DUPLICADO EVITADO')) {
        console.log(`⚠️  ${err.message}`);
      } else {
        console.log(`❌ error: ${err.message}`);
        result.errors++;
      }
    }
  }

  if (!force && conflictos.length) {
    console.log(`\n🔴 ${conflictos.length} conflicto(s) no aplicado(s) — revisalos con el editor de trazado:`);
    for (const { entry } of conflictos) {
      console.log(`   ${entry.code} [${entry.companyName}]  Δ${Math.round(entry.path.length)}pts`);
    }
  }

  console.log(`\n🎉 Qruta — actualizadas: ${result.matched}, nuevas: ${result.inserted}, ` +
    `conflictos: ${result.conflicts}, saltadas: ${result.skipped}, errores: ${result.errors}\n`);

  return result;
}
