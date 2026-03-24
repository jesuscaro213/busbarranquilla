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
