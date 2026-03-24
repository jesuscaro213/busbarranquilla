import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../config/database';

// pdfjs-dist Node usage
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ──────────────────────────────────────────────────────────────────

interface Waypoint {
  lat: number;
  lon: number;
  label?: string;
}

interface Itinerario {
  nombre: string;
  waypoints: Waypoint[];
  longitud_km: number;
}

interface DatosTecnicos {
  longitud_km: number;
  frecuencia_pico_min: number;
  frecuencia_valle_min: number;
  capacidad_min: number;
  capacidad_max: number;
  horario: string;
}

interface RutaResult {
  codigo: string;
  nombre: string;
  es_nueva: boolean;
  itinerarios: Itinerario[];
  datos_tecnicos: DatosTecnicos;
  // Enriched after DB check:
  exists?: boolean;
  dbData?: { id: number; name: string; geometry: [number, number][] | null } | null;
}

interface ResolutionResult {
  resolucion: string;
  fecha: string;
  empresa: string;
  rutas: RutaResult[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const uint8Array = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdf = await loadingTask.promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    text += pageText + '\n';
  }
  return text;
}

async function parseResolutionWithClaude(pdfText: string): Promise<ResolutionResult> {
  const systemPrompt = `Eres un experto en resoluciones del AMB (Área Metropolitana de Barranquilla) para Transporte Público Colectivo (TPC).

Reglas críticas:
- IGNORA todo lo relacionado con Transmetro, SITM, troncales, alimentadoras, estaciones. Solo procesa rutas TPC.
- Para cada ruta, genera los waypoints GPS de sus itinerarios basándote en las descripciones textuales de los recorridos y en tu conocimiento de Barranquilla.
- Cuadrícula Barranquilla: Calles van E-O (costa Norte ≈ lat 11.02, sur ≈ 10.88); Carreras van N-S (río Magdalena ≈ lng -74.76, oeste ≈ -74.92). Bbox AMB: lat 10.82–11.08, lng -74.98–-74.62.
- Mínimo 40 waypoints GPS por itinerario, distribúyelos uniformemente a lo largo del recorrido.
- Los waypoints deben seguir las calles reales de Barranquilla.

Retorna ÚNICAMENTE un JSON válido (sin markdown, sin explicaciones) con esta estructura exacta:
{
  "resolucion": "string",
  "fecha": "YYYY-MM-DD",
  "empresa": "string",
  "rutas": [
    {
      "codigo": "string",
      "nombre": "string",
      "es_nueva": false,
      "itinerarios": [
        {
          "nombre": "A",
          "waypoints": [{"lat": 10.9, "lon": -74.8, "label": "Cra 46 con Cl 72"}],
          "longitud_km": 12.5
        }
      ],
      "datos_tecnicos": {
        "longitud_km": 12.5,
        "frecuencia_pico_min": 8,
        "frecuencia_valle_min": 15,
        "capacidad_min": 20,
        "capacidad_max": 30,
        "horario": "05:00-23:00"
      }
    }
  ]
}

Nota sobre es_nueva: siempre ponlo en false — el sistema backend lo verificará contra la base de datos.`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 16000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Procesa esta resolución del AMB y extrae todas las rutas TPC:\n\n${pdfText}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude no retornó texto');

  // Strip possible markdown code fences
  const raw = content.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(raw) as ResolutionResult;
}

// ── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/resolutions/parse
 * Multipart form-data, campo "file" con el PDF.
 * Auth: admin
 */
export const parseResolution = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ message: 'Se requiere un archivo PDF (campo "file")' });
    return;
  }

  try {
    // 1. Extract text from PDF
    const pdfText = await extractTextFromPdf(req.file.buffer);
    if (!pdfText.trim()) {
      res.status(422).json({ message: 'No se pudo extraer texto del PDF. Verifica que no sea un PDF escaneado.' });
      return;
    }

    // 2. Parse with Claude
    const result = await parseResolutionWithClaude(pdfText);

    // 3. Verify each route against DB
    for (const ruta of result.rutas) {
      const dbResult = await pool.query(
        'SELECT id, name, geometry FROM routes WHERE code = $1',
        [ruta.codigo]
      );
      ruta.exists = dbResult.rows.length > 0;
      ruta.es_nueva = !ruta.exists;
      ruta.dbData = dbResult.rows[0] ?? null;
    }

    res.json(result);
  } catch (err: any) {
    console.error('[resolutionController] parseResolution error:', err);
    if (err instanceof SyntaxError) {
      res.status(422).json({ message: 'Claude no pudo generar un JSON válido. Intenta de nuevo.' });
    } else {
      res.status(500).json({ message: 'Error procesando la resolución' });
    }
  }
};

/**
 * POST /api/resolutions/apply
 * Body: { resolucion, fecha, empresa, rutas: RutaResult[] }
 * Solo procesa las rutas donde el frontend haya marcado approved: true.
 * Auth: admin
 */
export const applyResolution = async (req: Request, res: Response): Promise<void> => {
  const { resolucion, fecha, empresa, rutas } = req.body as {
    resolucion: string;
    fecha: string;
    empresa: string;
    rutas: (RutaResult & { approved: boolean })[];
  };

  if (!resolucion || !rutas || !Array.isArray(rutas)) {
    res.status(400).json({ message: 'Cuerpo inválido. Se requieren resolucion y rutas.' });
    return;
  }

  const approved = rutas.filter(r => r.approved);
  if (approved.length === 0) {
    res.status(400).json({ message: 'No hay rutas aprobadas para aplicar.' });
    return;
  }

  const results: { codigo: string; action: 'updated' | 'inserted' | 'error'; error?: string }[] = [];

  for (const ruta of approved) {
    try {
      // Use itinerary A (index 0) as primary geometry; convert {lat, lon} → [lat, lng]
      const primaryItinerary = ruta.itinerarios[0];
      const geometry = primaryItinerary?.waypoints.map(w => [w.lat, w.lon]) ?? [];

      if (ruta.es_nueva) {
        await pool.query(
          `INSERT INTO routes (name, code, company, geometry, is_active, last_resolution, last_resolution_date)
           VALUES ($1, $2, $3, $4::jsonb, true, $5, $6)`,
          [ruta.nombre, ruta.codigo, empresa, JSON.stringify(geometry), resolucion, fecha]
        );
        results.push({ codigo: ruta.codigo, action: 'inserted' });
      } else {
        await pool.query(
          `UPDATE routes
           SET name = $1, geometry = $2::jsonb, last_resolution = $3, last_resolution_date = $4
           WHERE code = $5`,
          [ruta.nombre, JSON.stringify(geometry), resolucion, fecha, ruta.codigo]
        );
        results.push({ codigo: ruta.codigo, action: 'updated' });
      }
    } catch (err: any) {
      console.error(`[resolutionController] applyResolution error for ${ruta.codigo}:`, err);
      results.push({ codigo: ruta.codigo, action: 'error', error: err.message });
    }
  }

  res.json({ applied: results.length, results });
};
