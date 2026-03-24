# Spec: Procesador de Resoluciones AMB

## Contexto

- **Proyecto:** MiBus (mibus.co) — tracker colaborativo de buses en tiempo real, Barranquilla, Colombia
- **Feature:** Tool interna del admin panel. El admin sube un PDF de Resolución Metropolitana del AMB, Claude lo interpreta, identifica todas las rutas TPC afectadas, las compara contra la DB, y el admin decide qué actualizar ruta por ruta.
- **Stack:** Express + TypeScript (backend), React + Vite + TailwindCSS + Leaflet (web)
- **Auth:** JWT en `Authorization: Bearer <token>`. Middleware `authMiddleware` + `requireRole('admin')` en todas las rutas de este feature.
- **DB:** PostgreSQL via `pg` pool desde `../config/database`
- **IA:** `@anthropic-ai/sdk` ya instalado en backend. Requiere env var `ANTHROPIC_API_KEY`.
- **PDF parsing:** `pdfjs-dist` — agregar a backend (`npm install pdfjs-dist`)
- **Upload:** `multer` con `memoryStorage()` — agregar a backend (`npm install multer @types/multer`)
- **Geometry en DB:** `routes.geometry` es JSONB con formato `[lat, lng][]` (arrays de 2 elementos)
- **Rutas a ignorar:** TODO lo de Transmetro (troncal, SITM, alimentadoras). Solo procesar TPC.

---

## Cuadrícula Barranquilla (referencia para Claude)

- Calles van E-O; numeración aumenta hacia el sur (costa Norte ≈ 11.02, Soledad ≈ 10.88)
- Carreras van N-S; numeración aumenta hacia el oeste (río Magdalena ≈ -74.76, límite oeste ≈ -74.92)
- Coordenadas bbox AMB: lat 10.82–11.08, lng -74.98–-74.62

---

## 1. Dependencias nuevas (backend)

```bash
npm install pdfjs-dist multer @types/multer
```

Agregar al `docker-compose.yml` si no existe:
```yaml
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

---

## 2. DB Migration (`backend/src/config/schema.ts`)

Agregar al final de `createTables()`, antes del cierre:

```typescript
await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS last_resolution VARCHAR(50)`);
await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS last_resolution_date DATE`);
```

---

## 3. Backend — Nuevos archivos

### 3a. `backend/src/controllers/resolutionController.ts`

```typescript
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
```

---

### 3b. `backend/src/routes/resolutionRoutes.ts`

```typescript
import { Router } from 'express';
import multer from 'multer';
import { parseResolution, applyResolution } from '../controllers/resolutionController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/roleMiddleware';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se aceptan archivos PDF'));
  },
});

router.post(
  '/parse',
  authMiddleware,
  requireRole('admin'),
  upload.single('file'),
  parseResolution
);

router.post(
  '/apply',
  authMiddleware,
  requireRole('admin'),
  applyResolution
);

export default router;
```

---

### 3c. Modificar `backend/src/index.ts`

Agregar import y registro de la nueva ruta (junto a los demás imports/registros):

```typescript
// old_string → new_string (import)
import paymentRoutes from './routes/paymentRoutes';
// →
import paymentRoutes from './routes/paymentRoutes';
import resolutionRoutes from './routes/resolutionRoutes';
```

```typescript
// old_string → new_string (registro)
app.use('/api/payments', paymentRoutes);
// →
app.use('/api/payments', paymentRoutes);
app.use('/api/resolutions', resolutionRoutes);
```

---

## 4. Web — Nuevos archivos

### 4a. `web/src/components/admin/RutaCard.tsx`

```tsx
import { useState } from 'react';
import RouteCompareMap from './RouteCompareMap';

export type RutaDecision = 'pending' | 'approved' | 'rejected';

interface Waypoint { lat: number; lon: number; label?: string }
interface Itinerario { nombre: string; waypoints: Waypoint[]; longitud_km: number }
interface DatosTecnicos {
  longitud_km: number;
  frecuencia_pico_min: number;
  frecuencia_valle_min: number;
  capacidad_min: number;
  capacidad_max: number;
  horario: string;
}

export interface RutaData {
  codigo: string;
  nombre: string;
  es_nueva: boolean;
  itinerarios: Itinerario[];
  datos_tecnicos: DatosTecnicos;
  exists: boolean;
  dbData: { id: number; name: string; geometry: [number, number][] | null } | null;
}

interface Props {
  ruta: RutaData;
  decision: RutaDecision;
  onDecisionChange: (codigo: string, decision: RutaDecision) => void;
}

export default function RutaCard({ ruta, decision, onDecisionChange }: Props) {
  const [showMap, setShowMap] = useState(false);

  const badgeClass = ruta.es_nueva
    ? 'bg-green-100 text-green-800 border border-green-300'
    : 'bg-yellow-100 text-yellow-800 border border-yellow-300';

  const badgeLabel = ruta.es_nueva ? 'RUTA NUEVA' : 'MODIFICACION';

  const decisionBg =
    decision === 'approved' ? 'border-green-500 bg-green-50' :
    decision === 'rejected' ? 'border-red-400 bg-red-50' :
    'border-gray-200 bg-white';

  return (
    <>
      <div className={`rounded-lg border-2 p-4 transition-colors ${decisionBg}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-900 text-sm">{ruta.codigo}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
            <p className="text-gray-600 text-sm mt-0.5">{ruta.nombre}</p>
          </div>
          <button
            onClick={() => setShowMap(true)}
            className="shrink-0 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 transition-colors"
          >
            Ver en mapa
          </button>
        </div>

        {/* Technical data summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600 mb-4">
          <span><strong>Longitud:</strong> {ruta.datos_tecnicos.longitud_km} km</span>
          <span><strong>Pico:</strong> {ruta.datos_tecnicos.frecuencia_pico_min} min</span>
          <span><strong>Valle:</strong> {ruta.datos_tecnicos.frecuencia_valle_min} min</span>
          <span><strong>Capacidad:</strong> {ruta.datos_tecnicos.capacidad_min}–{ruta.datos_tecnicos.capacidad_max} pas.</span>
          <span><strong>Horario:</strong> {ruta.datos_tecnicos.horario}</span>
          <span><strong>Itinerarios:</strong> {ruta.itinerarios.map(i => i.nombre).join(', ')}</span>
        </div>

        {/* Decision buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => onDecisionChange(ruta.codigo, decision === 'approved' ? 'pending' : 'approved')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              decision === 'approved'
                ? 'bg-green-600 text-white border-green-600'
                : 'text-green-700 border-green-400 hover:bg-green-50'
            }`}
          >
            Aprobar
          </button>
          <button
            onClick={() => onDecisionChange(ruta.codigo, decision === 'rejected' ? 'pending' : 'rejected')}
            className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors border ${
              decision === 'rejected'
                ? 'bg-red-600 text-white border-red-600'
                : 'text-red-700 border-red-400 hover:bg-red-50'
            }`}
          >
            Rechazar
          </button>
        </div>
      </div>

      {showMap && (
        <RouteCompareMap
          ruta={ruta}
          onClose={() => setShowMap(false)}
        />
      )}
    </>
  );
}
```

---

### 4b. `web/src/components/admin/RouteCompareMap.tsx`

```tsx
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RutaData } from './RutaCard';

interface Props {
  ruta: RutaData;
  onClose: () => void;
}

export default function RouteCompareMap({ ruta, onClose }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true });
    mapRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const allLatLngs: L.LatLng[] = [];

    // Green polyline: new geometry from PDF (itinerary A)
    const newItinerary = ruta.itinerarios[0];
    if (newItinerary?.waypoints.length) {
      const newLatLngs = newItinerary.waypoints.map(w => L.latLng(w.lat, w.lon));
      L.polyline(newLatLngs, { color: '#16a34a', weight: 4, opacity: 0.85 })
        .bindTooltip('Nuevo (PDF)', { sticky: true })
        .addTo(map);
      allLatLngs.push(...newLatLngs);
    }

    // Blue polyline: current DB geometry (only for modifications)
    if (!ruta.es_nueva && ruta.dbData?.geometry?.length) {
      const dbLatLngs = ruta.dbData.geometry.map(([lat, lng]) => L.latLng(lat, lng));
      L.polyline(dbLatLngs, { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '8 4' })
        .bindTooltip('Actual (DB)', { sticky: true })
        .addTo(map);
      allLatLngs.push(...dbLatLngs);
    }

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] });
    } else {
      // Default: center on Barranquilla
      map.setView([10.96, -74.80], 12);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [ruta]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <span className="font-bold text-gray-900">{ruta.codigo}</span>
            <span className="ml-2 text-sm text-gray-500">{ruta.nombre}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
          >
            x
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 px-5 py-2 text-xs border-b bg-gray-50">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-6 h-1 bg-green-600 rounded" />
            Nuevo trazado (PDF)
          </span>
          {!ruta.es_nueva && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-1 bg-blue-600 rounded border-t-2 border-dashed" />
              Trazado actual (DB)
            </span>
          )}
          {ruta.es_nueva && (
            <span className="text-green-700 font-medium">Ruta nueva — no existe en DB</span>
          )}
        </div>

        {/* Map */}
        <div ref={containerRef} className="flex-1" style={{ minHeight: '400px' }} />
      </div>
    </div>
  );
}
```

---

### 4c. `web/src/pages/admin/ResolutionProcessor.tsx`

```tsx
import { useState, useRef } from 'react';
import api from '../../services/api';
import RutaCard, { type RutaData, type RutaDecision } from '../../components/admin/RutaCard';

interface ResolutionData {
  resolucion: string;
  fecha: string;
  empresa: string;
  rutas: RutaData[];
}

export default function ResolutionProcessor() {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResolutionData | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RutaDecision>>({});
  const [applyResult, setApplyResult] = useState<{ applied: number; results: { codigo: string; action: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.pdf')) {
      setError('Solo se aceptan archivos PDF');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setApplyResult(null);
    setDecisions({});

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await api.post<ResolutionData>('/resolutions/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000, // Claude puede tardar hasta 2 min
      });
      setResult(res.data);
      // Init all decisions as pending
      const initial: Record<string, RutaDecision> = {};
      res.data.rutas.forEach(r => { initial[r.codigo] = 'pending'; });
      setDecisions(initial);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Error procesando el PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleDecisionChange = (codigo: string, decision: RutaDecision) => {
    setDecisions(prev => ({ ...prev, [codigo]: decision }));
  };

  const approvedCount = Object.values(decisions).filter(d => d === 'approved').length;

  const handleApply = async () => {
    if (!result || approvedCount === 0) return;
    setApplying(true);
    setError(null);
    try {
      const rutasWithDecisions = result.rutas.map(r => ({
        ...r,
        approved: decisions[r.codigo] === 'approved',
      }));
      const res = await api.post('/resolutions/apply', {
        resolucion: result.resolucion,
        fecha: result.fecha,
        empresa: result.empresa,
        rutas: rutasWithDecisions,
      });
      setApplyResult(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Error aplicando cambios');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Procesador de Resoluciones AMB</h1>
      <p className="text-gray-500 text-sm mb-6">
        Sube un PDF de resolución metropolitana. Claude extrae las rutas TPC, las compara contra la DB
        y muestra las diferencias. Aprueba o rechaza cada ruta individualmente antes de aplicar.
      </p>

      {/* Upload zone */}
      {!result && !loading && (
        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
          }`}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-4xl mb-3">PDF</div>
          <p className="text-gray-700 font-medium">Arrastra el PDF aquí o haz clic para seleccionar</p>
          <p className="text-gray-400 text-sm mt-1">Máx. 20 MB</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="border-2 border-dashed border-blue-300 rounded-xl p-12 text-center bg-blue-50">
          <div className="text-gray-700 font-medium mb-2">Procesando resolución con Claude...</div>
          <div className="text-gray-500 text-sm">Esto puede tardar hasta 2 minutos dependiendo del PDF</div>
          <div className="mt-4 flex justify-center">
            <div className="h-2 w-48 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse w-3/4" />
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div className="mt-4 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm">
          <strong>Cambios aplicados: {applyResult.applied} rutas.</strong>
          <ul className="mt-1 space-y-0.5">
            {applyResult.results.map(r => (
              <li key={r.codigo}>
                {r.codigo} — {r.action === 'inserted' ? 'Ruta creada' : r.action === 'updated' ? 'Ruta actualizada' : `Error: ${r.action}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resolution result */}
      {result && !applyResult && (
        <div className="space-y-6">
          {/* Metadata card */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-3 text-lg">Resolución procesada</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Número</span>
                <span className="font-semibold">{result.resolucion}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Fecha</span>
                <span className="font-semibold">{result.fecha}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Empresa</span>
                <span className="font-semibold">{result.empresa}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Total rutas</span>
                <span className="font-semibold">{result.rutas.length}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Rutas nuevas</span>
                <span className="font-semibold text-green-700">{result.rutas.filter(r => r.es_nueva).length}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Modificaciones</span>
                <span className="font-semibold text-yellow-700">{result.rutas.filter(r => !r.es_nueva).length}</span>
              </div>
            </div>
          </div>

          {/* Ruta cards */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-3">Rutas afectadas ({result.rutas.length})</h3>
            <div className="space-y-3">
              {result.rutas.map(ruta => (
                <RutaCard
                  key={ruta.codigo}
                  ruta={ruta}
                  decision={decisions[ruta.codigo] ?? 'pending'}
                  onDecisionChange={handleDecisionChange}
                />
              ))}
            </div>
          </div>

          {/* Apply button */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 py-4 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-600">
              {approvedCount === 0
                ? 'Aprueba al menos una ruta para continuar'
                : `${approvedCount} ruta${approvedCount > 1 ? 's' : ''} aprobada${approvedCount > 1 ? 's' : ''}`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setResult(null); setDecisions({}); setError(null); }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Subir otro PDF
              </button>
              <button
                onClick={handleApply}
                disabled={approvedCount === 0 || applying}
                className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {applying ? 'Aplicando...' : `Aplicar cambios aprobados (${approvedCount})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 5. Modificar archivos existentes

### 5a. `web/src/pages/admin/AdminLayout.tsx`

Agregar la entrada al array `navItems`:

```typescript
// old_string
  { to: '/admin/gps-reports', label: 'Reportes GPS', emoji: '📍' },
];

// new_string
  { to: '/admin/gps-reports', label: 'Reportes GPS', emoji: '📍' },
  { to: '/admin/resolutions', label: 'Resoluciones AMB', emoji: '📄' },
];
```

---

### 5b. `web/src/App.tsx`

Agregar import y ruta:

```typescript
// old_string (imports)
import AdminGpsReports from './pages/admin/AdminGpsReports';

// new_string
import AdminGpsReports from './pages/admin/AdminGpsReports';
import ResolutionProcessor from './pages/admin/ResolutionProcessor';
```

```typescript
// old_string (rutas JSX)
          <Route path="/admin/gps-reports" element={<AdminGpsReports />} />

// new_string
          <Route path="/admin/gps-reports" element={<AdminGpsReports />} />
          <Route path="/admin/resolutions" element={<ResolutionProcessor />} />
```

---

## 6. Verificación

```bash
# Backend — compila sin errores
cd backend && npx tsc --noEmit

# Web — compila sin errores
cd web && npx tsc --noEmit

# Flujo manual:
# 1. docker-compose up
# 2. Ir a /admin/resolutions
# 3. Subir un PDF de resolución AMB
# 4. Verificar que aparecen tarjetas por ruta con badges MODIFICACION/RUTA NUEVA
# 5. Abrir mapa — verificar polilíneas verde (PDF) y azul (DB si existe)
# 6. Aprobar una ruta, rechazar otra
# 7. Clic en "Aplicar cambios aprobados"
# 8. Verificar en AdminRoutes que el trazado fue actualizado
```

---

## 7. Notas de implementación

- **Claude model:** `claude-opus-4-6` — necesario para el contexto largo de PDFs (hasta 200 KB de texto)
- **Timeout en frontend:** 120 segundos. PDFs largos (>20 páginas) pueden tardar 60-90s en Claude.
- **Geometría primaria:** Al aplicar, se usa `itinerarios[0]` (itinerario A) como `routes.geometry`. Los demás itinerarios del JSON se descartan (no hay campo multi-itinerario en DB).
- **Multer file size:** 20 MB. Las resoluciones AMB suelen ser <5 MB pero se deja margen.
- **pdfjs-dist en Node:** Usar el build legacy (`pdfjs-dist/legacy/build/pdf.js`) para compatibilidad con CommonJS/Node sin canvas.
- **ANTHROPIC_API_KEY:** Verificar que está en `docker-compose.yml` y en Railway (variables de entorno del servicio backend).
- **Rutas Transmetro:** El system prompt de Claude ya instruye ignorarlas. Si igual aparecen en el resultado, el admin puede rechazarlas manualmente.

---

## 8. Updates de docs al completar

- `AI_CONTEXT.md` → agregar endpoints `/api/resolutions/parse` y `/api/resolutions/apply` en sección "API endpoints principales"; agregar `last_resolution` y `last_resolution_date` en tabla `routes` del schema
- `MEMORY.md` → decisión: itinerary A como geometría primaria; lógica de detección nueva ruta vs modificación; pdfjs-dist usa build legacy en Node
- `docs/changelog.md` → al completar Phase 4.1
- `CLAUDE.md` → tabla fases: `Phase 4.1 | Complete | Procesador Resoluciones AMB`
