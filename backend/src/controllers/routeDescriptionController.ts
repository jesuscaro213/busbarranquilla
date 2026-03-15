import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BQ_BBOX = '10.82,-74.98,11.08,-74.62';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Normalize Colombian street names for Overpass regex matching
function streetRegex(name: string): string {
  return name
    .replace(/^Carrera\s+/i,  '(Carrera|Cra\\.?|CRA|Cr\\.?)\\s*')
    .replace(/^Calle\s+/i,    '(Calle|Cl\\.?|CL)\\s*')
    .replace(/^Diagonal\s+/i, '(Diagonal|Diag\\.?|Dg\\.?)\\s*')
    .replace(/^Transversal\s+/i, '(Transversal|Tv\\.?|TV)\\s*')
    .replace(/^Avenida\s+/i,  '(Avenida|Av\\.?|AV)\\s*')
    .replace(/^Vía\s+/i,      '(Vía|Via)\\s*')
    + '$';
}

// Overpass: finds the actual OSM intersection node (city hint in comment only — bbox covers full metro)
async function geocodeViaOverpass(street1: string, street2: string): Promise<[number, number] | null> {
  const r1 = streetRegex(street1);
  const r2 = streetRegex(street2);
  const query = `[out:json][timeout:5][bbox:${BQ_BBOX}];
way["name"~"${r1}",i]["highway"]->.s1;
way["name"~"${r2}",i]["highway"]->.s2;
node(w.s1)(w.s2);
out 1;`;

  try {
    const res = await axios.post<{ elements: { lat: number; lon: number }[] }>(
      'https://overpass-api.de/api/interpreter',
      query,
      { headers: { 'Content-Type': 'text/plain' }, timeout: 6000 }
    );
    if (res.data.elements.length > 0) {
      return [res.data.elements[0].lat, res.data.elements[0].lon];
    }
  } catch { /* fall through */ }
  return null;
}

// Google Maps geocoding — uses city hint, validates result inside BQ metro bbox
async function geocodeViaGoogle(intersection: string, city: string): Promise<[number, number] | null> {
  const key = process.env.VITE_GOOGLE_MAPS_KEY;
  if (!key) return null;
  const queries = [
    `${intersection}, ${city}, Colombia`,
    `${intersection}, Barranquilla, Colombia`,
  ];
  for (const q of queries) {
    try {
      const res = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        { params: { address: q, key, region: 'co' }, timeout: 5000 }
      );
      const results = (res.data as any).results as { geometry: { location: { lat: number; lng: number } } }[];
      if (results?.length > 0) {
        const { lat, lng } = results[0].geometry.location;
        // Validate in BQ metro area bbox
        if (lat > 10.7 && lat < 11.2 && lng > -75.1 && lng < -74.5) {
          return [lat, lng];
        }
      }
    } catch { /* try next */ }
  }
  return null;
}

// Nominatim fallback — accepts city param and uses it in queries
async function geocodeViaNominatim(street1: string, street2: string, city = 'Barranquilla'): Promise<[number, number] | null> {
  const numMatch = street2.match(/[\dA-Za-z]+$/);
  const num = numMatch ? numMatch[0] : '';

  const queries = [
    `${street1} con ${street2}, ${city}, Colombia`,
    `${street1} #${num}, ${city}, Colombia`,
    `${street1} y ${street2}, ${city}, Colombia`,
    `${street1} con ${street2}, Barranquilla, Colombia`,
    `${street1}, ${city}, Colombia`,
  ];

  for (const q of queries) {
    try {
      await sleep(1000);
      const res = await axios.get<{ lat: string; lon: string }[]>(
        'https://nominatim.openstreetmap.org/search',
        {
          params: { q, format: 'json', limit: 1, bounded: 1, viewbox: '-74.98,11.08,-74.62,10.82' },
          headers: { 'User-Agent': 'co.mibus.admin/1.0' },
          timeout: 8000,
        }
      );
      if (res.data.length > 0) {
        return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
      }
    } catch { /* try next */ }
  }
  return null;
}

export async function parseRouteDescription(req: Request, res: Response): Promise<void> {
  const { text } = req.body as { text?: string };
  if (!text || text.trim().length < 20) {
    res.status(400).json({ error: 'Texto demasiado corto' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' });
    return;
  }

  // ── Step 1: Claude extracts 5-8 key turning points only ────────────────────
  // Fewer points = faster geocoding, OSRM fills the road-following path between them
  let intersections: string[] = [];
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Extrae los PUNTOS DE GIRO PRINCIPALES de esta descripción de ruta de bus en el Área Metropolitana de Barranquilla, Colombia (puede incluir Barranquilla, Soledad, Malambo o Puerto Colombia).

REGLAS ESTRICTAS:
- Máximo 8 puntos, mínimo 3
- Solo donde el bus cambia de calle o avenida principal (giros reales, no cada intersección)
- Incluye punto de inicio y punto final
- Formato exacto: "Carrera 5 con Calle 37, Barranquilla" — usa el nombre real de la calle según el municipio donde esté
- Agrega el municipio al final de cada punto: "Carrera 5 con Calle 37, Barranquilla" o "Carrera 15 con Calle 30, Soledad"
- NO corrijas ni normalices nombres de calles de Soledad a Barranquilla — mantenlos como aparecen
- Responde SOLO con el array JSON

Descripción:
${text}

Array JSON:`,
        },
        { role: 'assistant', content: '[' },
      ],
    });

    const claudeText = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const raw = claudeText.startsWith('[') ? claudeText : '[' + claudeText;
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as unknown[];
        intersections = parsed.filter((x): x is string => typeof x === 'string' && x.length > 3);
      } catch {
        const strings = cleaned.match(/"([^"]+)"/g);
        if (strings) intersections = strings.map(s => s.replace(/"/g, '')).filter(s => s.length > 3);
      }
    }
  } catch (err) {
    res.status(500).json({ error: 'Error al llamar a la IA.', detail: String(err) });
    return;
  }

  if (intersections.length === 0) {
    res.status(422).json({ error: 'La IA no pudo extraer puntos de la descripción.' });
    return;
  }

  // ── Step 2: Parse intersections — split city from intersection string ──────
  // Each string is "Carrera X con Calle Y, Municipality" (Claude adds city suffix)
  const parts = intersections.map(i => {
    const commaIdx = i.lastIndexOf(', ');
    const city = commaIdx >= 0 ? i.slice(commaIdx + 2) : 'Barranquilla';
    const intersection = commaIdx >= 0 ? i.slice(0, commaIdx) : i;
    const p = intersection.split(/\s+con\s+/i);
    return p.length === 2
      ? { street1: p[0].trim(), street2: p[1].trim(), city, label: i }
      : null;
  });

  // ── Step 3: All Overpass queries fire simultaneously (~2s total) ───────────
  const overpassResults = await Promise.all(
    parts.map(p => p ? geocodeViaOverpass(p.street1, p.street2) : Promise.resolve(null))
  );

  // ── Step 4: Google Maps for Overpass misses (parallel) ────────────────────
  const googleNeeded = parts.map((p, i) => (!overpassResults[i] && p ? i : -1)).filter(i => i >= 0);
  const googleResults: ([number, number] | null)[] = new Array(parts.length).fill(null);
  if (googleNeeded.length > 0) {
    const googleBatch = await Promise.all(
      googleNeeded.map(i => {
        const p = parts[i]!;
        return geocodeViaGoogle(`${p.street1} con ${p.street2}`, p.city);
      })
    );
    googleNeeded.forEach((idx, bi) => {
      googleResults[idx] = googleBatch[bi];
    });
  }

  // ── Step 5: Nominatim for remaining misses (sequential, rate-limited) ─────
  const waypoints: [number, number][] = [];
  const labels: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < intersections.length; i++) {
    let coords = overpassResults[i] ?? googleResults[i];
    if (!coords && parts[i]) {
      coords = await geocodeViaNominatim(parts[i]!.street1, parts[i]!.street2, parts[i]!.city);
    }
    if (coords) {
      waypoints.push(coords);
      labels.push(intersections[i]);
    } else {
      failed.push(intersections[i]);
    }
  }

  if (waypoints.length < 2) {
    res.status(422).json({
      error: 'No se pudieron geocodificar suficientes puntos.',
      intersections,
      failed,
    });
    return;
  }

  // Return anchor waypoints — frontend calls OSRM snap to get full road-following geometry
  // and computes spatial diff vs existing route geometry
  res.json({ waypoints, labels, failed, total: intersections.length });
}
