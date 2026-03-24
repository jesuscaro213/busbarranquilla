# MiBus — Development Changelog

Historial detallado de fases. Para el estado actual ver `CLAUDE.md` (fases) y `AI_CONTEXT.md` (arquitectura).

---

## Phase 1 — Fundación

- Express + TypeScript + Docker
- Auth con trial premium 14 días + sistema de roles (admin / premium / free)
- Módulos: routes, stops, reports, credits
- React web con mapa Leaflet
- Auto-seed de rutas reales de Barranquilla

---

## Phase 2 — Panel admin + flujo real-time

**Admin panel:**
- Control de acceso por roles (`requireRole` middleware + `AdminRoute` guard)
- Layout admin con sidebar (sin Navbar)
- `/admin/users` — tabla completa con cambio de rol, toggle activo, eliminar
- `/admin/routes` — CRUD + editor de geometría (arrastrar puntos, Regenerar por fila)
- `/admin/companies` — CRUD con visor de rutas

**Flujo usuario real-time:**
- GPS en mapa + rutas cercanas via active-feed endpoint
- Planificador (`PlanTripMode`) — Nominatim + Overpass + `/api/routes/plan`
- Flujo "Me subí / Me bajé" (`CatchBusMode`) — máquina de estados completa
- 4 monitores de fondo: auto-resolve trancón, desvío, auto-cierre, alertas bajada
- Sistema de favoritos (`/api/users/favorites`)
- Auto-resolve reportes (`PATCH /api/reports/:id/resolve`)
- Geometría de rutas via OSRM (2 intentos: ruta completa → segmento + fallback línea recta)

---

## Phase 2.5 — "Cerca de ti" + "Buses en tu zona"

- `CatchBusMode`: scroll horizontal de rutas cercanas (300 m) sobre el buscador
- `PlanTripMode`: lista vertical de rutas ≤500 m del origen antes de ingresar destino
- Guard de race condition: `previewRouteIdRef` para no sobreescribir resultados más nuevos
- Fix: "← Volver" limpia `activeTripGeometry` + `catchBusBoardingStop`
- Removido: "Cómo llegar a pie" (enlace externo Google Maps)

---

## Phase 3 — Deploy + Pagos Wompi

- Deploy: Vercel (mibus.co) + Railway (api.mibus.co)
- `GET /api/payments/plans` — plan mensual ($4,900 COP)
- `POST /api/payments/checkout` — link de pago Wompi (single-use)
- `POST /api/payments/webhook` — verificación SHA256 → activa premium + 50 créditos bonus
- Tabla `payments` en DB rastrea todas las transacciones
- Navbar: "⚡ Premium" para no-premium; "✓ Premium" badge para activos

---

## Phase 3.5 — Sistema de confirmación inteligente

- Ocupación binaria: `lleno` / `bus_disponible` (eliminado `casi_lleno`)
- Sistema diferido: +1 si solo, 0 si hay otros (espera confirmaciones)
- Confirmaciones: confirmador gana +1 (máx 3/viaje), reportante gana +2 al 50%+ confirmaciones
- Validez: `activeUsers <= 1` → siempre válido; `>= 2` → necesita `ceil((n-1) × 0.5)` confirmaciones
- Auto-award: reportante recibe +1 al fin del viaje si no hubo confirmaciones
- Socket.io rooms `route:{id}`: reportes y confirmaciones en tiempo real
- Nueva tabla: `report_confirmations` — previene doble confirmación
- Nueva columna: `reports.credits_awarded_to_reporter`

---

## Phase 3.6 — Geocodificación + UX

- Reemplazado Photon por **Nominatim** (primario) + **Geoapify** (fallback)
- Normalización de direcciones colombianas: "Cr 52 N 45" → "Cr 52 #45"
- Filtro `isInMetroArea()` + `bounded=1` + bbox `[10.82,-74.98,11.08,-74.62]`
- Detección de código postal (`isPostalCode()`) — filtra 080xxx
- Map pick mode: crosshair fijo, banner instrucción, botones Confirmar/Cancelar; `BottomSheet` con CSS `display:none`
- Radio cercanas reducido 500 m → **300 m**
- Color-coding distancias: verde ≤300 m, ámbar 300–600 m, rojo >600 m
- `MapView.tsx`: componente `CenterTracker` (rastrea centro en `moveend`/`zoomend`)

**Reescritura del planificador (backend):**
- `getPlanRoutes` basado en geometría, no en paradas
- Helpers `haversineKm()` + `minDistToGeometry()` en `routeController.ts`
- `ORIGIN_THRESHOLD_KM = 0.25`, `DEST_THRESHOLD_KM = 0.45`
- Verificación de dirección: índice destino > índice origen
- Fallback stop-based (0.8 km) para rutas sin geometría

**Docker:**
- `web/Dockerfile.dev` — Node.js 20 Alpine (reemplaza nginx multi-stage)
- `backend/Dockerfile.dev` — Node.js 20 Alpine con todos los devDeps
- Producción (Railway): `backend/Dockerfile` multi-stage, `--omit=dev`

---

## Phase 3.7 — Actividad de ruta + alertas de actualización

- `DEST_THRESHOLD_KM` subido `0.45` → `1.0` km
- Ícono 🚌 en marcador de usuario durante viaje activo
- `GET /api/routes/:id/activity`: `active_count`, `last_activity_minutes`, `events[]`, `active_positions[]`
- Actividad mostrada en: PlanTripMode (cards + "Buses en tu zona"), CatchBusMode (vista espera), MapView (marcadores ámbar)
- Sistema de alertas de ruta: votos `trancon` | `ruta_real`; ≥3 votos `ruta_real` en 30 días → alerta admin
- Nueva tabla `route_update_reports`
- Nueva página admin `/admin/route-alerts` (`AdminRouteAlerts.tsx`)
- Badge rojo en sidebar de admin con conteo sin revisar (polling 60 s)
- Nueva columna `routes.route_alert_reviewed_at`

---

## Phase 3.8 — Editor de trazado + protección de importación

**Editor de waypoints con road-snapping:**
- `POST /api/routes/snap-waypoints` (admin): waypoints → OSRM → geometría snapped
- Editor en `AdminRoutes.tsx`: extraer ~12 waypoints naranjas espaciados uniformemente
- Arrastrar waypoint → llama snap → polilínea actualiza siguiendo calles reales
- Click en mapa vacío → añade waypoint; click en waypoint → elimina

**AdminRouteAlerts visual:**
- `getRouteUpdateAlerts` retorna: `geometry`, `reporters[]`, `reporter_positions[]`
- Panel colapsable "Ver trazado y reportantes": polilínea azul = ruta actual, puntos rojos = GPS reportantes

**Protección de importación (`manually_edited_at`):**
- Columna `routes.manually_edited_at` — se pone en `PUT /routes/:id`, se limpia en `regenerate-geometry`
- `blogScraper.ts` y `routeProcessor.ts`: opción `skipManuallyEdited`
- Toggle UI en `AdminRoutes.tsx`: "Solo nuevas" / "Todas"; badge "✏️ manual" ámbar en tabla

---

## Phase 3.9 — Anti-fraude + Rate limiting + Stats

**Anti-fraude:**
- Cooldown 5 min entre viajes (HTTP 429 con `cooldown_seconds`)
- Bono completar viaje: +5 solo si `total_distance_meters >= 2000`
- Columna `active_trips.total_distance_meters` — acumulado en cada `updateLocation`
- `endTrip` retorna `distance_meters` y `completion_bonus_earned`

**Rate limiting (`express-rate-limit` v7):**
- `authLimiter` — 20 req / 15 min (login, register, google)
- `reportLimiter` — 15 req / 5 min (todos los reportes)
- `generalLimiter` — 300 req / 1 min (resto)

**Zombie trips cron:**
- `setInterval` cada 30 min — cierra viajes con `is_active = true` sin update por > 4 horas
- También corre una vez al startup

**Notificaciones resolución trancón:**
- `resolveReport` emite `route:report_resolved` con `{ reportId, type, duration_minutes }`
- Monitor 1 umbral subido 200 m → **1 km**

**Dashboard admin (`/admin/stats`):**
- 6 queries paralelas: usuarios, viajes, reportes, créditos, activos ahora, top rutas 24h
- `/admin` redirige a `/admin/stats`

**Trip history + referral:**
- `GET /api/trips/history` — últimos 20 viajes
- `Register.tsx` con campo de código de referido
- `Profile.tsx` muestra código propio con botón copiar

---

## Phase 4 — Flutter Mobile (En progreso)

App Flutter feature-complete, produciendo APKs de release. Ver `AI_CONTEXT.md` y `flutter_specs/` para detalles.

**Geocodificación dual Nominatim + Photon (2026-03-24, Spec 54):**

- Nominatim y Photon corren **en paralelo** por cada búsqueda — resultados mergeados sin duplicados
- Photon cubre POIs y lugares coloquiales que Nominatim no encuentra (conjuntos, canchas, comercios)
- Nominatim recibe abreviaturas expandidas: "Cr" → "Carrera", "Cl" → "Calle", "Dg" → "Diagonal", etc.
- Carácter `#` removido de la query Nominatim (OSM almacena "Carrera 14 45", no "Cr 14 # 45")
- Caché solo guarda resultados no vacíos (antes cacheaba `[]` bloqueando búsquedas futuras)
- Cooldown 30s en Nominatim tras 429; debounce subido a 1100ms para respetar 1 req/s
- `photonDioProvider`: baseUrl `https://photon.komoot.io`, timeouts 6s
- `_expandForNominatim()`: expande tipo de vía + quita separador `#`
- `_fetchNominatimBestEffort()`: 1 sola request Nominatim (antes hacía 2, duplicando 429s)

**UX improvements (2026-03-23):**

- **Historial de búsqueda en planner** — al enfocar campo de origen/destino vacío aparece dropdown con los 5 lugares más frecuentes (ícono reloj + barrio + tiempo relativo: hoy/ayer/hace N días). Al escribir, resultados Nominatim que ya usaste se marcan con ícono dorado. Datos en SharedPreferences (`search_history_v1`), sort por recencia 30 días + frecuencia. Nunca guarda "Ubicación actual".
- **Bug fix planner** — el panel "No encontramos ese lugar" ya no persiste después de seleccionar desde el mapa (`_lastQuery` se resetea en `didUpdateWidget`). Además se agregó botón "Mapa" directo en ese panel.
- **Boarding screen rediseñada** — nearby cards con badge + bus icon + chevron + nombre bold + operador. Lista completa reemplaza `ListTile`+`Divider` por cards individuales con sombra (mismo lenguaje visual que referencia Moovit).
- **Panel debug de vibración eliminado** — removido `_VibrationTestPanel` de la pantalla de perfil.

**Pendiente:**
- Google Play publishing (requiere google-services.json + SHA-1 Firebase)
- Flujo de pago Wompi in-app (actualmente abre browser)
- Alianza con AMB y SIBUS Barranquilla

**Push notifications — implementado (ver AI_CONTEXT.md §FCM token refresh Spec 51):**
- Firebase Admin en backend + `pushNotificationService.ts`
- FCM token guardado en DB al login, rotación automática vía `onTokenRefresh`
- Push cuando bus entra a 300m del usuario esperando
- Push en reportes, trancón despejado, bajada (400m / 200m), fin de viaje
- `notification_prefs` por usuario controla qué tipos recibe
