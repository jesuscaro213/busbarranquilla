import { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import pool from '../config/database';
import { geocodeIntersectionList } from '../services/geocodingService';
import { fetchOSRMGeometry } from '../services/osrmService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ──────────────────────────────────────────────────────────────────

interface Waypoint {
  lat: number;
  lon: number;
  label?: string;
}

interface ItinerarioRaw {
  nombre: string;
  intersecciones: string[]; // "Carrera X con Calle Y, Municipio" — extraídas del texto
  longitud_km: number;
}

interface Itinerario {
  nombre: string;
  waypoints: Waypoint[];       // ruta OSRM-snapeada
  anchorPoints?: Waypoint[];   // intersecciones geocodificadas (antes de OSRM) — para validación visual
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

type RutaResultRaw = Omit<RutaResult, 'itinerarios'> & { itinerarios: ItinerarioRaw[] };

interface ResolutionResultRaw {
  resolucion: string;
  fecha: string;
  empresa: string;
  rutas: RutaResultRaw[];
}

interface ResolutionResult {
  resolucion: string;
  fecha: string;
  empresa: string;
  rutas: RutaResult[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function parseResolutionWithClaude(pdfBuffer: Buffer): Promise<ResolutionResultRaw> {
  const systemPrompt = `Eres un experto en resoluciones del AMB (Área Metropolitana de Barranquilla) para Transporte Público Colectivo (TPC).

REGLAS:
- IGNORA Transmetro, SITM, troncales, alimentadoras, estaciones BRT. Solo rutas TPC (buses colectivos).
- Lee TODAS las páginas del documento, especialmente las tablas de itinerarios.

EXTRACCIÓN DE INTERSECCIONES (crítico para la calidad del trazado):
- Por cada itinerario extrae entre 10 y 20 intersecciones DE INICIO A FIN del recorrido, EN ORDEN.
- Cubre TODO el recorrido: inicio, giros intermedios Y punto final. No dejes tramos sin cubrir.
- Formato de cada elemento: "Carrera X con Calle Y, Municipio"
  - Municipio correcto: Barranquilla, Soledad, Malambo o Puerto Colombia.
  - Usa nombres exactos del documento — nunca inventes calles.
  - Para avenidas con nombre: "Avenida El Bosque con Calle 80, Barranquilla"
- Si el recorrido es largo (>10 km) usa los 20 puntos. Si es corto usa 10.

Retorna ÚNICAMENTE JSON válido (sin markdown, sin explicaciones):
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
          "intersecciones": [
            "Carrera 51B con Calle 79, Barranquilla",
            "Carrera 46 con Calle 72, Barranquilla",
            "Carrera 44 con Calle 45, Barranquilla",
            "Carrera 38 con Calle 30, Barranquilla"
          ],
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

"es_nueva" siempre false — el sistema lo verifica.`;

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBuffer.toString('base64'),
            },
          } as any,
          {
            type: 'text',
            text: 'Procesa esta resolución del AMB y extrae todas las rutas TPC.',
          },
        ],
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude no retornó texto');

  const raw = content.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(raw) as ResolutionResultRaw;
}

async function geocodeItinerarios(rutasRaw: ResolutionResultRaw['rutas']): Promise<RutaResult['itinerarios'][]> {
  return Promise.all(
    rutasRaw.map(async ruta => {
      const itinerarios: Itinerario[] = [];
      for (const it of ruta.itinerarios) {
        // Geocodificar intersecciones del texto
        const { waypoints: anchors } = await geocodeIntersectionList(it.intersecciones);

        // OSRM: trazar ruta sobre calles reales usando los anchors geocodificados
        let gpsPoints: [number, number][] = anchors;
        if (anchors.length >= 2) {
          const osrmResult = await fetchOSRMGeometry(
            anchors.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
          );
          if (osrmResult) gpsPoints = osrmResult.points;
        }

        itinerarios.push({
          nombre: it.nombre,
          longitud_km: it.longitud_km,
          waypoints: gpsPoints.map(([lat, lon]) => ({ lat, lon })),
          // Anchors visibles en el mapa para que el admin valide la cobertura del recorrido
          anchorPoints: anchors.map(([lat, lon]) => ({ lat, lon })),
        });
      }
      return itinerarios;
    })
  );
}

// ── Job store (in-memory — admin tool, no persistence needed) ──────────────

type JobState =
  | { status: 'processing' }
  | { status: 'done'; result: ResolutionResult }
  | { status: 'error'; message: string };

const jobs = new Map<string, JobState>();

// ── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/resolutions/parse
 * Retorna { jobId } inmediatamente. El procesamiento ocurre en background.
 * Auth: admin
 */
export const parseResolution = (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ message: 'Se requiere un archivo PDF (campo "file")' });
    return;
  }

  const jobId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, { status: 'processing' });

  // Respond immediately — processing happens in background
  res.json({ jobId });

  const buffer = req.file.buffer;

  parseResolutionWithClaude(buffer)
    .then(async (raw) => {
      // Geocodificar + OSRM para todas las rutas en paralelo
      const allItinerarios = await geocodeItinerarios(raw.rutas);

      const result: ResolutionResult = {
        resolucion: raw.resolucion,
        fecha: raw.fecha,
        empresa: raw.empresa,
        rutas: raw.rutas.map((ruta, i) => ({
          codigo: ruta.codigo,
          nombre: ruta.nombre,
          es_nueva: ruta.es_nueva,
          datos_tecnicos: ruta.datos_tecnicos,
          itinerarios: allItinerarios[i],
        })) as RutaResult[],
      };

      for (const ruta of result.rutas) {
        const dbResult = await pool.query(
          'SELECT id, name, geometry FROM routes WHERE code = $1',
          [ruta.codigo]
        );
        ruta.exists = dbResult.rows.length > 0;
        ruta.es_nueva = !ruta.exists;
        ruta.dbData = dbResult.rows[0] ?? null;
      }
      jobs.set(jobId, { status: 'done', result });
    })
    .catch((err: any) => {
      console.error('[resolutionController] background parse error:', err);
      const message = err instanceof SyntaxError
        ? 'Claude no pudo generar un JSON válido. Intenta de nuevo.'
        : 'Error procesando la resolución';
      jobs.set(jobId, { status: 'error', message });
    });
};

/**
 * GET /api/resolutions/status/:jobId
 * Polling endpoint. Retorna { status, result? } o { status, message }.
 * Auth: admin
 */
export const getResolutionJob = (req: Request, res: Response): void => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) {
    res.status(404).json({ message: 'Job no encontrado o expirado' });
    return;
  }
  res.json(job);
  // Clean up once delivered
  if (job.status !== 'processing') jobs.delete(jobId);
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
