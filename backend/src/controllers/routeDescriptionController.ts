import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { geocodeViaOverpass, geocodeViaGoogle, geocodeViaNominatim } from '../services/geocodingService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build municipality context from existing geometry key points
function buildGeometryContext(geometry: [number, number][]): string {
  if (!geometry || geometry.length < 2) return '';
  // Extract 6 evenly-spaced key points
  const count = Math.min(6, geometry.length);
  const pts: [number, number][] = [];
  const step = (geometry.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    pts.push(geometry[Math.round(i * step)]);
  }
  // Simple heuristic: Soledad is roughly lat 10.87–10.96, Barranquilla lat 10.95–11.05 (overlap in between)
  const labeled = pts.map((p, i) => {
    const muni = p[0] < 10.93 ? 'Soledad' : p[0] > 10.98 ? 'Barranquilla' : 'zona límite Barranquilla/Soledad';
    return `  ${i + 1}. lat=${p[0].toFixed(4)}, lng=${p[1].toFixed(4)} → aprox. ${muni}`;
  });
  return `\nContexto geográfico — la ruta ACTUAL pasa por estos puntos en orden:\n${labeled.join('\n')}\nUsa estas coordenadas para determinar el municipio correcto de cada intersección.\n`;
}

export async function parseRouteDescription(req: Request, res: Response): Promise<void> {
  const { text, existingGeometry } = req.body as { text?: string; existingGeometry?: [number, number][] };
  if (!text || text.trim().length < 20) {
    res.status(400).json({ error: 'Texto demasiado corto' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' });
    return;
  }

  const geometryContext = existingGeometry && existingGeometry.length >= 2
    ? buildGeometryContext(existingGeometry)
    : '';

  // ── Step 1: Claude extracts 5-8 key turning points only ────────────────────
  // Fewer points = faster geocoding, OSRM fills the road-following path between them
  let intersections: string[] = [];
  let claudeRaw = '';
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: 'Eres un asistente de geocodificación. Responde ÚNICAMENTE con un array JSON válido de strings. Sin texto adicional, sin markdown, sin prefijos, sin explicaciones. Solo el array JSON puro empezando con [ y terminando con ].',
      messages: [
        {
          role: 'user',
          content: `Extrae los PUNTOS DE GIRO PRINCIPALES de esta descripción de ruta de bus en el Área Metropolitana de Barranquilla, Colombia (puede incluir Barranquilla, Soledad, Malambo o Puerto Colombia).
${geometryContext}
REGLAS:
- Entre 3 y 8 puntos (solo giros principales, no cada intersección)
- Incluye punto de inicio y punto final
- Formato de cada elemento: "Carrera 5 con Calle 37, Barranquilla" (intersection, Municipio)
- Usa el municipio correcto según el contexto geográfico de arriba
- NO inventes calles — usa los nombres exactos del texto

Descripción:
${text}`,
        },
      ],
    });

    claudeRaw = message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    // Extract JSON array from response — handles markdown fences, leading text, etc.
    const cleaned = claudeRaw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as unknown[];
        intersections = parsed.filter((x): x is string => typeof x === 'string' && x.length > 3);
      } catch {
        // Fallback: extract all quoted strings
        const strings = cleaned.match(/"([^"]+)"/g);
        if (strings) intersections = strings.map(s => s.replace(/"/g, '')).filter(s => s.length > 3);
      }
    } else {
      // Last resort: extract all quoted strings from raw response
      const strings = claudeRaw.match(/"([^"]+)"/g);
      if (strings) intersections = strings.map(s => s.replace(/"/g, '')).filter(s => s.length > 3);
    }
  } catch (err) {
    res.status(500).json({ error: 'Error al llamar a la IA.', detail: String(err) });
    return;
  }

  if (intersections.length === 0) {
    res.status(422).json({
      error: 'La IA no pudo extraer puntos de la descripción.',
      debug: claudeRaw.slice(0, 500), // show first 500 chars of Claude response for debugging
    });
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
