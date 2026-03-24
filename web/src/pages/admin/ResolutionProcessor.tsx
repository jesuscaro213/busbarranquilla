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
