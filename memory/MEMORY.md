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

## AdminRoutes — Editor de trazado: borrado por segmento (2026-03-15)

### Estados y refs (borrador freehand reemplazado por segmento)
- `isSegEraseMode` / `isSegEraseModeRef` — controlan si el modo borrado por segmento está activo
- `segEraseLayersRef` — capas Leaflet invisibles (weight 10, opacity 0) sobre cada segmento entre waypoints consecutivos

### Flujo del borrado por segmento
1. Botón `🗑️ Borrar tramo — clic en la ruta` aparece cuando `isEditingGeometry = true` y hay ≥ 2 waypoints
2. Al activar: cursor = `pointer`; useEffect crea capas Leaflet invisibles sobre cada segmento entre waypoints consecutivos
3. Hover sobre segmento → color rojo (opacity 0.65) + tooltip; mouseout → invisible de nuevo
4. Click en segmento → elimina los dos waypoints del segmento (respeta primer/último waypoint) → `snapAndUpdate(newWpts)`
5. Si quedarían < 2 waypoints → `window.alert(...)` y aborta
6. Salida: botón `← Volver a dibujar`, o al cerrar modal, cancelar, previsualizar

### Cambios en map click handler
- El bloque `isEraserModeRef` eliminado; ahora la condición de "añadir waypoint" es `isEditingGeometryRef.current && !isSegEraseModeRef.current`

### TS issue resuelto: aiDiff posiblemente null dentro de función anidada
- `revertSegment()` vive dentro de un `useEffect` donde `aiDiff` ya fue verificado como no-null
- TypeScript no estrecha el tipo dentro de funciones anidadas → solución: `const currentAiDiff = aiDiff;` antes de definir la función
- `setAiDiff` en `revertSegment` usa campos explícitos (`newWaypoints`, `newStops`, `labels`, `failed`) en vez de spread para garantizar todos los campos requeridos

## Parser IA de rutas — geocodificación mejorada (2026-03-15)

### routeDescriptionController.ts — cambios
- Prompt Claude ahora pide municipio al final: `"Calle X con Carrera Y, Barranquilla"` o `"..., Soledad"`
- `parseRouteDescription` usa `lastIndexOf(', ')` para separar `intersection` de `city`
- Geocodificación en 3 pasos: Overpass (paralelo) → Google Maps (paralelo, `VITE_GOOGLE_MAPS_KEY`) → Nominatim (secuencial)
- `geocodeViaNominatim(street1, street2, city = 'Barranquilla')` — acepta `city`, ya no hardcodea Barranquilla en todas las queries; la cuarta query sigue usando `Barranquilla` como fallback explícito
- `geocodeViaGoogle(intersection, city)` — valida bbox BQ metro; intenta con `city` y fallback `Barranquilla`
- Variable de entorno requerida: `VITE_GOOGLE_MAPS_KEY` (si no está definida, `geocodeViaGoogle` retorna null silenciosamente)

## Archivos clave modificados (esta sesión)
- `backend/src/controllers/routeDescriptionController.ts` — geocodificación multimunicipio + Google Maps
- `web/src/pages/admin/AdminRoutes.tsx` — borrado por segmento (reemplaza borrador freehand)
