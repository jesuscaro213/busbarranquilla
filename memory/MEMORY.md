# MiBus — Memoria del proyecto

## Estado actual: Phase 3 completada + mejoras de reportes

### Ocupación del bus (última sesión)
- `casi_lleno` eliminado del sistema completo (backend + frontend)
- Solo existen dos estados: `lleno` (🔴) y `bus_disponible` (🟢 "Hay sillas")
- Ambos son reportes de primera clase con +3 créditos fuera de viaje
- En la UI siempre se muestran los dos botones, el activo se resalta con color

### Sistema de créditos por reportes (nueva lógica)
- **Durante viaje, solo en el bus**: reportador gana +1 inmediato
- **Durante viaje, con otros pasajeros**: reportador gana 0 al crear; +2 cuando alguien confirma (al alcanzar 50%+); o +1 auto al terminar el viaje sin confirmación (`credits_awarded_to_reporter`)
- **Fuera de viaje**: sistema original (`CREDITS_BY_TYPE`)
- Ocupación: solo se gana crédito la primera vez por tipo por viaje (`occupancyCreditedRef` en frontend + validación en backend via `credit_transactions`)

### Sistema de confirmaciones (nueva lógica)
- Confirmador gana +1 (máximo 3 por viaje, controlado en backend)
- Reportador gana +2 cuando el reporte alcanza validez (50%+ de otros usuarios en la ruta)
- Validez: `activeUsers <= 1` → válido siempre; `activeUsers >= 2` → necesita `ceil((activeUsers-1) * 0.5)` confirmaciones
- Al terminar viaje: auto-award +1 a todos los reportes sin crédito aún
- Nueva tabla: `report_confirmations(report_id, user_id)` UNIQUE
- Nueva columna: `reports.credits_awarded_to_reporter BOOLEAN DEFAULT FALSE`

### Socket rooms (nuevo)
- Backend `index.ts`: maneja `join:route` / `leave:route`
- Al iniciar viaje: frontend hace `socket.emit('join:route', routeId)`
- Al terminar viaje: frontend hace `socket.emit('leave:route', routeId)`
- Eventos: `route:new_report` (reporte creado) y `route:report_confirmed` (confirmación)
- Frontend filtra `route:new_report` para no mostrar los propios reportes del usuario

### Nuevo endpoint
- `GET /api/reports/route/:routeId` — reportes activos de una ruta con `confirmed_by_me`, `is_valid`, `needed_confirmations`

### UI activa (CatchBusMode — vista active)
- Sección "Reportes en tu bus": aparece si hay reportes de otros en la misma ruta
- Cada tarjeta: emoji + label del tipo, indicador de validez, botón "Confirmar"
- Botón desaparece si ya confirmó o llegó al límite de 3
- Contador de créditos de confirmación ganados en el viaje

## AdminRoutes — Editor de trazado: herramienta borrador (2026-03-15)

### Estados y refs añadidos
- `isEraserMode` / `isEraserModeRef` — controlan si el modo borrador está activo
- `eraserPoints` / `eraserPointsRef` — puntos trazados en el mapa como camino de borrado
- `eraserPolylineRef` / `eraserMarkersRef` — capas Leaflet del camino borrador

### Flujo de la herramienta borrador
1. Botón `🧹 Borrador` aparece en la sección "Trazado" cuando `isEditingGeometry = true`
2. Al activar: cursor = crosshair, banner informativo con contador de puntos
3. Clicks en mapa añaden puntos al path del borrador (dibujado en rojo punteado)
4. `applyEraser()`: filtra waypoints dentro de 300 m del path → llama `snapAndUpdate(remaining)`
5. Si quedan < 2 waypoints → `window.alert(...)` y aborta
6. Al confirmar o cancelar: `isEraserMode = false`, `eraserPoints = []`

### TS issue resuelto: aiDiff posiblemente null dentro de función anidada
- `revertSegment()` vive dentro de un `useEffect` donde `aiDiff` ya fue verificado como no-null
- TypeScript no estrecha el tipo dentro de funciones anidadas → solución: `const currentAiDiff = aiDiff;` antes de definir la función
- `setAiDiff` en `revertSegment` usa campos explícitos (`newWaypoints`, `newStops`, `labels`, `failed`) en vez de spread para garantizar todos los campos requeridos

## Archivos clave modificados (esta sesión)
- `backend/src/index.ts` — socket rooms
- `backend/src/config/schema.ts` — report_confirmations + credits_awarded_to_reporter
- `backend/src/controllers/reportController.ts` — createReport, confirmReport, getRouteReports
- `backend/src/controllers/tripController.ts` — auto-award al endTrip
- `backend/src/routes/reportRoutes.ts` — GET /route/:routeId
- `web/src/services/api.ts` — getRouteReports, ReportType sin casi_lleno
- `web/src/components/CatchBusMode.tsx` — socket, RouteReport, UI confirmaciones
- `web/src/pages/Map.tsx` — OCCUPANCY_BADGE sin casi_lleno
