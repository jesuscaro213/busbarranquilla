interface NearbyRoute {
  id: number;
  name: string;
  code: string;
  company_name: string | null;
  min_distance?: number;
}

interface Props {
  nearbyLoading: boolean;
  nearbyRoutes: NearbyRoute[];
  routeOccupancy: Record<number, 'lleno' | 'disponible'>;
  onRefresh: () => void;
  onSelectRoute: (route: NearbyRoute) => void;
}

const OCCUPANCY_STATE_LABEL: Record<'lleno' | 'disponible', { emoji: string; label: string }> = {
  lleno: { emoji: '🔴', label: 'Bus lleno' },
  disponible: { emoji: '🟢', label: 'Hay sillas' },
};

export default function CatchBusNearby({ nearbyLoading, nearbyRoutes, routeOccupancy, onRefresh, onSelectRoute }: Props) {
  if (!nearbyLoading && nearbyRoutes.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">📍 Cerca de ti</p>
        <button
          onClick={onRefresh}
          disabled={nearbyLoading}
          className="text-xs text-blue-500 disabled:opacity-40 font-medium"
        >
          {nearbyLoading ? 'Actualizando...' : '↻ Actualizar'}
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {nearbyLoading
          ? [0, 1, 2].map((i) => (
              <div key={i} className="shrink-0 w-24 h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))
          : nearbyRoutes.map((route) => (
              <button
                key={route.id}
                onClick={() => onSelectRoute(route)}
                className="shrink-0 flex flex-col items-start gap-0.5 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 hover:bg-blue-100 transition-colors min-w-[120px] max-w-[160px]"
              >
                <span className="text-xs font-bold text-gray-900 leading-tight truncate w-full text-left">
                  {route.company_name ?? route.code}
                </span>
                <span className="text-[10px] text-gray-500 truncate w-full text-left leading-tight">
                  {route.name}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                    {route.code}
                  </span>
                  {route.min_distance !== undefined && (
                    <span className="text-[10px] text-gray-400">
                      {Math.round(route.min_distance * 1000)} m
                    </span>
                  )}
                  {routeOccupancy[route.id] && (
                    <span className="text-[10px] font-semibold">
                      {OCCUPANCY_STATE_LABEL[routeOccupancy[route.id]].emoji}
                    </span>
                  )}
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}
