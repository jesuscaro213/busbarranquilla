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

// Overpass: finds the actual OSM intersection node
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

// Nominatim fallback for Overpass misses
async function geocodeViaNominatim(street1: string, street2: string): Promise<[number, number] | null> {
  const numMatch = street2.match(/[\dA-Za-z]+$/);
  const num = numMatch ? numMatch[0] : '';

  const queries = [
    `${street1} #${num}, Barranquilla, Colombia`,
    `${street1} #${num}, Soledad, Colombia`,
    `${street1} y ${street2}, Barranquilla, Colombia`,
    `${street1}, Barranquilla, Colombia`,
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
- Formato exacto: "Carrera 5 con Calle 37" — usa el nombre real de la calle según el municipio donde esté
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

  // ── Step 2: Geocode anchor points — ALL in parallel via Overpass (~2s total) ──
  const parts = intersections.map(i => {
    const p = i.split(/\s+con\s+/i);
    return p.length === 2 ? [p[0].trim(), p[1].trim()] as [string, string] : null;
  });

  // All Overpass queries fire simultaneously
  const overpassResults = await Promise.all(
    parts.map(p => p ? geocodeViaOverpass(p[0], p[1]) : Promise.resolve(null))
  );

  // Nominatim fallback for misses (sequential, rate-limited, only for few failures)
  const waypoints: [number, number][] = [];
  const labels: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < intersections.length; i++) {
    let coords = overpassResults[i];
    if (!coords && parts[i]) {
      coords = await geocodeViaNominatim(parts[i]![0], parts[i]![1]);
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
