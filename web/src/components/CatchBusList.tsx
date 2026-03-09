import type { MouseEvent } from 'react';

interface Route {
  id: number;
  name: string;
  code: string;
  type: string;
  color: string | null;
  company_name: string | null;
  frequency_minutes: number | null;
}

type RouteTypeFilter = 'all' | 'transmetro' | 'bus';

interface Props {
  typeFilter: RouteTypeFilter;
  search: string;
  loading: boolean;
  favRoutes: Route[];
  transmetroRoutes: Route[];
  busRoutesByCompany: Record<string, Route[]>;
  filteredCount: number;
  routeOccupancy: Record<number, 'lleno' | 'disponible'>;
  onTypeFilterChange: (filter: RouteTypeFilter) => void;
  onSearchChange: (value: string) => void;
  onSelectRoute: (route: Route) => void;
  onToggleFavorite: (event: MouseEvent, routeId: number) => void;
}

const OCCUPANCY_STATE_LABEL: Record<'lleno' | 'disponible', { emoji: string; label: string }> = {
  lleno: { emoji: '🔴', label: 'Bus lleno' },
  disponible: { emoji: '🟢', label: 'Hay sillas' },
};

export default function CatchBusList({
  typeFilter,
  search,
  loading,
  favRoutes,
  transmetroRoutes,
  busRoutesByCompany,
  filteredCount,
  routeOccupancy,
  onTypeFilterChange,
  onSearchChange,
  onSelectRoute,
  onToggleFavorite,
}: Props) {
  return (
    <>
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(['all', 'transmetro', 'bus'] as RouteTypeFilter[]).map((filter) => (
          <button
            key={filter}
            onClick={() => onTypeFilterChange(filter)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              typeFilter === filter
                ? 'bg-white shadow-sm text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {filter === 'all' ? 'Todos' : filter === 'transmetro' ? '🚇 Transmetro' : '🚌 Bus'}
          </button>
        ))}
      </div>

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar ruta..."
          className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4 max-h-[52vh] overflow-y-auto pb-2">
          {favRoutes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                ⭐ Favoritas
              </h3>
              <div className="space-y-1">
                {favRoutes.map((route) => (
                  <RouteRow
                    key={route.id}
                    route={route}
                    isFav={true}
                    onSelect={onSelectRoute}
                    onToggleFav={onToggleFavorite}
                    occupancy={routeOccupancy[route.id]}
                  />
                ))}
              </div>
            </section>
          )}

          {transmetroRoutes.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                🚇 Transmetro
              </h3>
              <div className="space-y-1">
                {transmetroRoutes.map((route) => (
                  <RouteRow
                    key={route.id}
                    route={route}
                    isFav={false}
                    onSelect={onSelectRoute}
                    onToggleFav={onToggleFavorite}
                    occupancy={routeOccupancy[route.id]}
                  />
                ))}
              </div>
            </section>
          )}

          {Object.entries(busRoutesByCompany)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([company, companyRoutes]) => (
              <section key={company}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  🚌 {company}
                </h3>
                <div className="space-y-1">
                  {companyRoutes.map((route) => (
                    <RouteRow
                      key={route.id}
                      route={route}
                      isFav={false}
                      onSelect={onSelectRoute}
                      onToggleFav={onToggleFavorite}
                      occupancy={routeOccupancy[route.id]}
                    />
                  ))}
                </div>
              </section>
            ))}

          {filteredCount === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">Sin resultados</p>
          )}
        </div>
      )}
    </>
  );
}

function RouteRow({
  route,
  isFav,
  onSelect,
  onToggleFav,
  occupancy,
}: {
  route: Route;
  isFav: boolean;
  onSelect: (route: Route) => void;
  onToggleFav: (event: MouseEvent, routeId: number) => void;
  occupancy?: 'lleno' | 'disponible';
}) {
  const routeColor = route.color || '#1d4ed8';

  return (
    <div
      onClick={() => onSelect(route)}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-white border border-gray-100 rounded-xl hover:bg-blue-50 hover:border-blue-100 transition-colors text-left cursor-pointer"
    >
      <div
        className="w-3 h-3 rounded-full shrink-0 border border-black/10"
        style={{ backgroundColor: routeColor }}
      />
      <span
        className="text-white text-xs font-bold px-2 py-0.5 rounded-md shrink-0"
        style={{ backgroundColor: routeColor }}
      >
        {route.code}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">
          {route.company_name ?? route.name}
        </p>
        <div className="flex items-center gap-1.5">
          {route.frequency_minutes && (
            <p className="text-xs text-gray-400">Cada {route.frequency_minutes} min</p>
          )}
          {occupancy && (
            <span className="text-xs font-semibold">
              {OCCUPANCY_STATE_LABEL[occupancy].emoji} {OCCUPANCY_STATE_LABEL[occupancy].label}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={(event) => onToggleFav(event, route.id)}
        className="shrink-0 text-lg leading-none"
      >
        {isFav ? '⭐' : '☆'}
      </button>
    </div>
  );
}
