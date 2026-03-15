import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NOMINATIM_DELAY_MS = 1100; // Nominatim: max 1 req/s
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

async function geocodeIntersection(intersection: string): Promise<[number, number] | null> {
  try {
    const query = `${intersection}, Barranquilla, Colombia`;
    const res = await axios.get<NominatimResult[]>('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1, bounded: 1, viewbox: '-74.98,11.08,-74.62,10.82' },
      headers: { 'User-Agent': 'co.mibus.admin/1.0' },
    });
    if (res.data.length > 0) {
      return [parseFloat(res.data[0].lat), parseFloat(res.data[0].lon)];
    }
    return null;
  } catch {
    return null;
  }
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
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Eres un asistente que interpreta descripciones de rutas de bus en Barranquilla, Colombia.

Dada la siguiente descripción de recorrido, extrae TODAS las intersecciones de calles mencionadas en orden de recorrido.
Para cada intersección, escríbela como "CALLE_A con CALLE_B" usando los nombres reales (ej: "Carrera 5 con Calle 37").
Cuando el texto dice "por la Carrera X hasta la Calle Y", la intersección es "Carrera X con Calle Y".
Incluye el punto de inicio y fin también.
Responde ÚNICAMENTE con un array JSON de strings, sin explicación. Ejemplo: ["Carrera 5 con Calle 51","Carrera 5 con Calle 37"]

Descripción:
${text}`,
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    // Extract JSON array from response (Claude may wrap it in markdown)
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown[];
      intersections = parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch (err) {
    res.status(500).json({ error: 'Error al llamar a la IA. Intenta de nuevo.', detail: String(err) });
    return;
  }

  if (intersections.length === 0) {
    res.status(422).json({ error: 'La IA no pudo extraer intersecciones del texto.' });
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
