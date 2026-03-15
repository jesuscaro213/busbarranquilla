import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DELAY_MS = 1200;
const BQ_BBOX = '10.82,-74.98,11.08,-74.62';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Normalize Colombian street names for Overpass regex matching
// "Carrera 5" → regex that matches "Carrera 5", "Cra. 5", "CRA 5", "Cr 5", etc.
function streetRegex(name: string): string {
  return name
    .replace(/^Carrera\s+/i,  '(Carrera|Cra\\.?|CRA|Cr\\.?)\\s*')
    .replace(/^Calle\s+/i,    '(Calle|Cl\\.?|CL)\\s*')
    .replace(/^Diagonal\s+/i, '(Diagonal|Diag\\.?|Dg\\.?)\\s*')
    .replace(/^Transversal\s+/i, '(Transversal|Tv\\.?|TV)\\s*')
    .replace(/^Avenida\s+/i,  '(Avenida|Av\\.?|AV)\\s*')
    .replace(/^Vía\s+/i,      '(Vía|Via)\\s*')
    // append word boundary anchor for the number portion
    + '$';
}

// Primary: Overpass API — finds the actual intersection node in OSM
async function geocodeViaOverpass(street1: string, street2: string): Promise<[number, number] | null> {
  const r1 = streetRegex(street1);
  const r2 = streetRegex(street2);
  const query = `[out:json][timeout:20][bbox:${BQ_BBOX}];
way["name"~"${r1}",i]["highway"]->.s1;
way["name"~"${r2}",i]["highway"]->.s2;
node(w.s1)(w.s2);
out 1;`;

  try {
    const res = await axios.post<{ elements: { lat: number; lon: number }[] }>(
      'https://overpass-api.de/api/interpreter',
      query,
      { headers: { 'Content-Type': 'text/plain' }, timeout: 25000 }
    );
    if (res.data.elements.length > 0) {
      const el = res.data.elements[0];
      return [el.lat, el.lon];
    }
  } catch { /* fall through */ }
  return null;
}

// Fallback: Nominatim with multiple Colombian address formats
async function geocodeViaNominatim(street1: string, street2: string): Promise<[number, number] | null> {
  // Extract number from street name (e.g. "Calle 37" → "37", "Calle 26A" → "26A")
  const numMatch = street2.match(/[\dA-Za-z]+$/);
  const num = numMatch ? numMatch[0] : '';

  // Include both Barranquilla and Soledad (buses cross both municipalities)
  const queries = [
    `${street1} #${num}, Barranquilla, Colombia`,
    `${street1} #${num}, Soledad, Colombia`,
    `${street1} ${num}, Barranquilla, Colombia`,
    `${street1} y ${street2}, Barranquilla, Colombia`,
    `${street1} y ${street2}, Soledad, Colombia`,
    `${street1}, Barranquilla, Colombia`,
  ];

  for (const q of queries) {
    try {
      await sleep(DELAY_MS);
      const res = await axios.get<{ lat: string; lon: string }[]>(
        'https://nominatim.openstreetmap.org/search',
        {
          params: { q, format: 'json', limit: 1, bounded: 1, viewbox: '-74.98,11.08,-74.62,10.82' },
          headers: { 'User-Agent': 'co.mibus.admin/1.0' },
          timeout: 10000,
        }
      );
      if (res.data.length > 0) {
        return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
      }
    } catch { /* try next format */ }
  }
  return null;
}

async function geocodeIntersection(intersection: string): Promise<[number, number] | null> {
  const parts = intersection.split(/\s+con\s+/i);
  if (parts.length !== 2) return null;
  const [street1, street2] = parts.map(s => s.trim());

  // Try Overpass first (most accurate — finds actual intersection node)
  const overpassResult = await geocodeViaOverpass(street1, street2);
  if (overpassResult) return overpassResult;

  await sleep(DELAY_MS);

  // Fallback: Nominatim with Colombian address formats
  return geocodeViaNominatim(street1, street2);
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

  // ── Step 1: Claude extracts intersections ──────────────────────────────────
  let intersections: string[] = [];
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Extrae todas las intersecciones de calles de esta descripción de ruta de bus en Barranquilla, Colombia, en orden de recorrido.

Reglas:
- Cuando dice "por la Carrera X hasta la Calle Y" → intersección es "Carrera X con Calle Y"
- Cuando dice "por esta hasta la Carrera X" → intersección es "Calle anterior con Carrera X"
- Incluye inicio y fin
- Usa formato exacto: "Carrera 5 con Calle 37" o "Calle 18 con Carrera 40"
- Responde SOLO con el array JSON, sin texto adicional, sin markdown

Descripción:
${text}

Array JSON:`,
        },
        {
          role: 'assistant',
          content: '[',
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? '[' + message.content[0].text.trim() : '';
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    // Extract JSON array
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as unknown[];
        intersections = parsed.filter((x): x is string => typeof x === 'string' && x.length > 3);
      } catch {
        // Try to extract strings manually if JSON is malformed
        const strings = cleaned.match(/"([^"]+)"/g);
        if (strings) intersections = strings.map(s => s.replace(/"/g, ''));
      }
    }
  } catch (err) {
    res.status(500).json({ error: 'Error al llamar a la IA. Intenta de nuevo.', detail: String(err) });
    return;
  }

  if (intersections.length === 0) {
    res.status(422).json({
      error: 'La IA no pudo extraer intersecciones del texto.',
      debug: process.env.NODE_ENV !== 'production' ? { raw: intersections } : undefined,
    });
    return;
  }

  // ── Step 2: Geocode each intersection via Nominatim ────────────────────────
  const waypoints: [number, number][] = [];
  const labels: string[] = [];
  const failed: string[] = [];

  for (const intersection of intersections) {
    await sleep(NOMINATIM_DELAY_MS);
    const coords = await geocodeIntersection(intersection);
    if (coords) {
      waypoints.push(coords);
      labels.push(intersection);
    } else {
      failed.push(intersection);
    }
  }

  if (waypoints.length < 2) {
    res.status(422).json({
      error: 'No se pudieron geocodificar suficientes intersecciones.',
      intersections,
      failed,
    });
    return;
  }

  res.json({ waypoints, labels, failed, total: intersections.length });
}
