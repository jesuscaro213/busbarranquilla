# MiBus — AI Context Document

> **Para cualquier IA:** Este archivo te da todo el contexto necesario para entender y ayudar con el proyecto MiBus.
> Úsalo como system prompt o contexto inicial en Claude.ai, ChatGPT, Gemini, Cursor o cualquier asistente.
> **Se actualiza automáticamente con cada cambio relevante al proyecto.**

---

## ¿Qué es MiBus?

**MiBus** (mibus.co) es una app colaborativa de transporte público en tiempo real para Barranquilla y el Área Metropolitana (Colombia). El concepto central: **el pasajero ES el GPS**. Los usuarios reportan la ubicación del bus mientras viajan, y otros usuarios ven esos buses moviéndose en el mapa.

El sistema tiene una **economía de créditos** para incentivar la participación: reportar, confirmar reportes y transmitir ubicación dan créditos. También hay suscripción premium (Wompi) con beneficios adicionales.

**Dominio geográfico:** Barranquilla y AMB, Colombia. Coordenadas metro: lat 10.82–11.08, lng -74.98–-74.62.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express 5 + TypeScript |
| Base de datos | PostgreSQL 15 + Redis 7 |
| Tiempo real | Socket.io 4 |
| Auth | JWT (30 días) + bcryptjs (salt 10) |
| Web frontend | React + Vite + TailwindCSS + Leaflet |
| App móvil | Flutter 3 + Dart (`flutter_app/`) |
| Pagos | Wompi (pagos colombianos) |
| Geocodificación | Nominatim (primario) + Geoapify (fallback) |
| Mapas móvil | flutter_map 7 + OpenStreetMap |
| Mapas web | Leaflet |

**El proyecto corre con Docker.** Nunca usar `npm run dev` directamente — PostgreSQL y Redis solo existen como contenedores.

```bash
docker-compose up --build   # Primera vez o tras cambios en Dockerfile
docker-compose up           # Inicio normal
```

---

## Arquitectura general

### Backend (`backend/src/`)

**Patrón:** Express routes → controllers → DB (pg Pool directo, sin ORM).

**Entry point:** `index.ts` — Express app + HTTP server para Socket.io + CORS + JSON middleware + todas las rutas + init DB + seed.

**Grupos de rutas** (todas bajo `/api/`):
- `auth` — register, login, profile
- `routes` — CRUD + search + nearby + active-feed + plan (trip planner) + activity + geometry
- `stops` — CRUD por ruta
- `reports` — create, nearby, confirm, resolve
- `credits` — balance, history, spend
- `trips` — start, updateLocation, end, current, history
- `users` — favoritos (add, remove, list)
- `payments` — Wompi: plans, checkout, webhook
- `admin` — users CRUD + companies CRUD (requiere `role = 'admin'`)

**Middleware chain:**
- Público: sin middleware
- Autenticado: `authMiddleware` (JWT → `req.userId` + `req.userRole`)
- Solo admin: `authMiddleware` + `requireRole('admin')`

**Regla importante:** Rutas con nombre (`/nearby`, `/search`, `/plan`, `/current`) siempre ANTES de rutas con parámetro (`/:id`) en el mismo archivo para evitar conflictos en Express.

**Geometría de rutas:** Almacenada como JSONB `[lat, lng][]` en `routes.geometry`. Se genera via OSRM (2 intentos: ruta completa → segmento por segmento + fallback línea recta). 78 rutas tienen geometría.

**Trip planner** (`/api/routes/plan`): Basado en geometría, no en paradas. Un bus aplica si su polilínea pasa dentro de 250m del origen Y 1km del destino, con índice destino > índice origen (verificación de dirección).

### Web (`web/src/`)

**Routing:** React Router v6.
- **Layout público** (`PublicLayout`) — Navbar + `<Outlet />` — cubre `/`, `/map`, `/login`, `/register`, `/premium`, `/payment/result`
- **Layout admin** (`AdminRoute` guard + `AdminLayout`) — sidebar sin Navbar — cubre `/admin/*`

**Auth:** `context/AuthContext.tsx` — JWT en `localStorage`, axios interceptor en `services/api.ts`.

**Páginas principales:**
- `/map` — `Map.tsx` — mapa principal con todos los modos
- `CatchBusMode.tsx` — flujo "Me subí / Me bajé" + 4 monitores de fondo
- `PlanTripMode.tsx` — planificador de viaje con Nominatim + OSRM

### Flutter App (`flutter_app/lib/`)

**Patrón:** MVVM + Repository — estrictamente en capas:
1. Presentation (screens + widgets)
2. State (Notifiers con sealed state classes)
3. Domain (modelos inmutables con `fromJson` / `toJson`)
4. Data (Repositories sobre fuentes remotas Dio)
5. Core (Location, socket, storage, theme, l10n, API client)

**State management:** Riverpod 2 — sealed states + Notifiers. Ejemplo: `TripIdle | TripLoading | TripActive | TripError | TripEnded`.

**Navegación:** GoRouter 14 con ShellRoute para el BottomNavigationBar de 4 tabs.

**Strings:** TODOS los strings de UI en `lib/core/l10n/strings.dart` como constantes `AppStrings`. Nunca hardcodear strings en widgets.

---

## Rutas de navegación Flutter

```
/loading          → SplashScreen (durante AuthInitial / AuthLoading)
/onboarding       → OnboardingScreen (solo primer lanzamiento)
/login            → LoginScreen
/register         → RegisterScreen
/map-pick?lat=X&lng=Y → MapPickScreen (crosshair para seleccionar coordenadas)
/trip/confirm?routeId=X&destLat=Y&destLng=Z → BoardingConfirmScreen
/trip/stop-select?routeId=X → StopSelectScreen

ShellRoute (BottomNavigationBar 4 tabs):
  /map            → MapScreen         (tab 0)
  /planner        → PlannerScreen     (tab 1)
  /trip           → ActiveTripScreen  (tab 2)
  /trip/boarding  → BoardingScreen    (tab 2)
  /profile        → ProfileScreen     (tab 3)
```

**Regla de navegación Flutter:**
- `context.push()` para sub-pantallas (aparece botón atrás)
- `context.go()` solo para navegación a nivel de tab

---

## Flujos clave

### 1. Flujo "Me subí" (boarding)
1. FAB en MapScreen → `context.go('/trip/boarding')`
2. `BoardingScreen` — lista de rutas + cercanas (300m) → tap → `RoutePreviewSheet` (mapa 340px con geometría)
3. Confirmar en sheet → `context.push('/trip/confirm?routeId=X')`
4. `BoardingConfirmScreen` — mapa full-screen (como ActiveTripScreen) con 3 marcadores + leyenda flotante
5. "Me monté" → `tripNotifier.startTrip(routeId, destinationStopId?)` → `TripActive` → `context.go('/trip')`

### 2. Flujo de viaje activo (4 monitores en background)
| Monitor | Intervalo | Trigger | Acción |
|---------|-----------|---------|--------|
| Auto-resolve trancón | 120s | Bus movió >1 km del reporte | `PATCH /api/reports/:id/resolve` |
| Detección desvío | 15s | Fuera de ruta >100m por ≥60s | Banner: reportar / bajarse / ignorar 5min |
| Inactividad | 60s | Sin movimiento <50m por ≥600s | Modal "¿Sigues en el bus?" — auto-cierre 120s; a los 30 min cierra viaje con `suspicious_minutes: 30` |
| Alerta bajada | 15s | Destino fijado | Prepararse (400m) → Bájate ya (200m + vibración) → Perdiste |

**Posición del bus en tiempo real:**
- El GPS stream (`backgroundPositionStream`) dispara en cada movimiento (distanceFilter: 10m).
- `trip.currentLatitude/currentLongitude` se actualiza en **cada fix GPS** para que el icono se mueva en tiempo real.
- Las llamadas al backend y socket se siguen throttleando a ~30s para no sobrecargar el servidor.
- `MapScreen` y `ActiveTripScreen` usan `tripState.trip.currentLatitude/currentLongitude` como fuente de posición (no el socket).

**Prompt de alertas de bajada para usuarios free:**
- Al iniciar el viaje, si el usuario es free (no premium/admin), `_startMonitors()` muestra `dropoffPrompt: true` **siempre**, haya o no parada de destino pre-seleccionada.
- Si hay destino pre-seleccionado: al aceptar → `activateDropoffAlerts()` cobra 5 créditos y arranca el monitor.
- Si NO hay destino: al aceptar → navega a `/trip/stop-select?routeId=X&setDestination=true` → usuario elige parada → `setDestinationStop(stop)` cobra 5 créditos y arranca el monitor.
- `StopSelectScreen` tiene parámetro `setDestination: bool` — cuando es `true`, llama `setDestinationStop()` y hace pop, en vez de iniciar un viaje nuevo.

### 3. Planificador de viaje
1. `PlannerScreen` — auto-setea origen a GPS al cargar
2. Búsqueda de dirección → Nominatim (bbox BQ) + normalización colombiana ("Cr 52 N 45" → "Cr 52 #45")
3. Ícono de mapa en campo → `/map-pick?lat=X&lng=Y` → crosshair → geocodificación inversa → regresa resultado
4. "Buscar rutas" → `POST /api/routes/plan` → `PlannerResults`
5. Tap resultado → `context.push('/trip/confirm?routeId=X&destLat=Y&destLng=Z')`

**Auto-refresh de rutas cercanas (planner):**
- `PlannerNotifier` arranca un `Timer.periodic(2 min)` cuando el origen es GPS (`displayName == AppStrings.currentLocationLabel`).
- El timer llama `loadNearbyForOrigin()` solo si `state is PlannerIdle` (no interrumpe búsqueda ni resultados).
- El timer se cancela en `reset()` y en `ref.onDispose`.
- Si el origen se cambia a una dirección tipificada, el timer NO se crea (`_originIsGps = false`).

### 4. Sistema de créditos
| Acción | Créditos |
|--------|----------|
| Registrarse | +50 |
| Reporte (fuera del viaje) | +3–5 |
| Por minuto transmitiendo | +1 (máx 15/viaje) |
| Confirmar reporte de otro | +1 (máx 2/viaje) |
| Completar viaje (≥2 km) | +5 |
| Invitar amigo | +25 |
| Racha 7 días | +30 |
| Alerta de bajada (usuarios free) | -5 cr (premium: gratis) |

**Nuevos usuarios:** 50 créditos + 14 días trial premium.

---

## Esquema de base de datos (tablas principales)

```sql
users          — id, name, email, password, phone, credits(50), is_premium, role(free|premium|admin), is_active
companies      — id, name, nit, phone, email, is_active
routes         — id, name, code(UNIQUE), company, geometry(JSONB), is_active, manually_edited_at, route_alert_reviewed_at
stops          — id, route_id, name, latitude, longitude, stop_order
reports        — id, user_id, route_id, type, lat, lng, is_active, confirmations, expires_at(+30min), resolved_at
report_confirmations — report_id, user_id (UNIQUE)
credit_transactions  — user_id, amount, type, description
active_trips   — user_id, route_id, current_lat, current_lng, destination_stop_id, is_active, total_distance_meters, custom_destination_lat, custom_destination_lng, custom_destination_name
user_favorite_routes — user_id, route_id (UNIQUE)
payments       — user_id, wompi_reference, plan, amount_cents, status(pending|approved|declined)
route_update_reports — route_id, user_id, tipo(trancon|ruta_real), reported_geometry JSONB (UNIQUE por usuario+ruta)
```

**Campos clave:**
- `routes.manually_edited_at` — se pone en `PUT /routes/:id`, se limpia en `regenerate-geometry`
- `active_trips.total_distance_meters` — acumulado en cada `updateLocation` via Haversine (para bono de completar viaje ≥2 km)
- `active_trips.custom_destination_lat/lng/name` — destino mapeado (punto libre, no parada real); persiste entre reinicios de app
- `reports.expires_at` — 30 min desde creación

---

## API endpoints principales

### Auth
```
POST /api/auth/register     — { name, email, password, phone, referralCode? }
POST /api/auth/login        — { email, password }
POST /api/auth/google       — { idToken }
GET  /api/auth/profile      — (auth) perfil del usuario actual
```

### Rutas de bus
```
GET  /api/routes            — lista todas las rutas
GET  /api/routes/search?q=  — búsqueda por nombre/código
GET  /api/routes/nearby?lat=&lng=&radius= — rutas cercanas (km)
GET  /api/routes/plan?originLat=&originLng=&destLat=&destLng= — planificador (auth)
GET  /api/routes/active-feed — hasta 8 rutas con actividad en última hora (auth)
GET  /api/routes/:id/activity — actividad última hora: count, posiciones, eventos (auth)
POST /api/routes/:id/update-report — votar trancon|ruta_real con { lat, lng } para ruta_real (auth); valida GPS contra geometría, 400 on_route:true si < 200m
PATCH /api/routes/:id/update-report/reentry — registrar re-ingreso a la ruta { lat, lng } (auth); actualiza reported_geometry con tramo completo [inicio, fin]
```

### Viajes
```
GET  /api/trips/current     — viaje activo del usuario (auth)
POST /api/trips/start       — iniciar viaje { routeId, destinationStopId? } (auth)
PATCH /api/trips/update-location — { latitude, longitude } (auth)
POST  /api/trips/end         — terminar viaje (auth)
GET   /api/trips/history     — últimos 20 viajes completados (auth)
PATCH /api/trips/destination — guardar destino personalizado { latitude, longitude, name? } (auth)
```

### Reportes
```
POST /api/reports           — crear reporte { routeId, type, latitude, longitude } (auth)
GET  /api/reports/nearby?lat=&lng= — reportes cercanos (auth)
GET  /api/reports/route/:routeId — reportes activos en una ruta (auth)
POST /api/reports/:id/confirm — confirmar reporte (auth)
PATCH /api/reports/:id/resolve — auto-resolver propio reporte (auth)
```

### Créditos, favoritos, pagos
```
GET  /api/credits/balance        — saldo actual (auth)
GET  /api/credits/history        — historial de transacciones (auth)
GET  /api/users/favorites        — rutas favoritas (auth)
POST /api/users/favorites        — agregar favorito { route_id } (auth)
DELETE /api/users/favorites/:id  — eliminar favorito (auth)
GET  /api/payments/plans         — planes disponibles
POST /api/payments/checkout      — crear link de pago Wompi (auth)
POST /api/payments/webhook       — webhook Wompi (verifica SHA256)
```

---

## WebSocket channels (Socket.io)

| Canal | Dirección | Descripción |
|-------|-----------|-------------|
| `bus:location` | server → todos | Posición activa de buses |
| `bus:joined` | server → todos | Usuario abordó |
| `bus:left` | server → todos | Usuario bajó |
| `join:route` | cliente → server | Unirse a sala de ruta |
| `leave:route` | cliente → server | Salir de sala de ruta |
| `route:new_report` | server → sala | Nuevo reporte en la ruta |
| `route:report_confirmed` | server → sala | Confirmación de reporte |
| `route:report_resolved` | server → sala | Reporte resuelto `{ reportId, type, duration_minutes }` |

---

## Patrones de código importantes

### Flutter — NUNCA hacer esto:
```dart
// ❌ MAL — espera 5-15 segundos
final position = await LocationService.getCurrentPosition();

// ✅ BIEN — 3 niveles, siempre empieza por el mapa
final mapState = ref.read(mapNotifierProvider);
if (mapState is MapReady && mapState.userPosition != null) {
  // usar mapState.userPosition — costo cero
} else {
  final cached = await Geolocator.getLastKnownPosition(); // caché OS, instantáneo
  // fallback: getCurrentPosition(medium, timeout: 5s)
}
```

### Flutter — Rebuilds:
```dart
// ❌ MAL — reconstruye toda la shell con cada update de GPS
final tripState = ref.watch(tripNotifierProvider);

// ✅ BIEN — solo reconstruye cuando cambia el campo específico
final isOnTrip = ref.watch(tripNotifierProvider.select((s) => s is TripActive));
```

### Flutter — Timers animados:
```dart
// ❌ MAL — timer en screen principal → 60 rebuilds/min de TODA la pantalla
Timer.periodic(Duration(seconds: 1), (_) => setState(() {}));

// ✅ BIEN — widget aislado con su propio timer
class _TripDurationText extends StatefulWidget { ... }
// Solo este widget se reconstruye cada segundo
```

### Flutter — Carga paralela (no secuencial):
```dart
// ✅ Lanzar ambas llamadas a la vez
final routesFuture = repo.list();
final nearbyFuture = repo.nearby(...);
final routes = await routesFuture;  // mostrar rutas apenas lleguen
final nearby = await nearbyFuture;  // actualizar nearby después
```

### Flutter — FutureProvider.family para datos compartidos:
```dart
// Si múltiples widgets necesitan el mismo dato, compartir con family:
final routeActivityProvider =
    FutureProvider.autoDispose.family<RouteActivity?, int>((ref, routeId) async {
  final result = await ref.read(routesRepositoryProvider).getActivity(routeId);
  return result is Success<RouteActivity> ? result.data : null;
});
```

### Flutter — Ubicación en background (transmisión siempre activa)

El viaje transmite GPS aunque la app esté minimizada, pantalla bloqueada o en segundo plano.

**Permiso:** Al iniciar viaje se llama `LocationService.requestBackgroundPermission()` — pide `locationWhenInUse` primero, luego `locationAlways`. En Android 10+ abre la página de ajustes con **"Permitir todo el tiempo"** disponible. En iOS muestra el diálogo con "Siempre".

**Stream con Foreground Service (Android):** `LocationService.backgroundPositionStream` usa `AndroidSettings` con `ForegroundNotificationConfig` — esto arranca un servicio persistente en la barra de notificaciones ("MiBus — Viaje activo 🚌") que impide que Android mate el proceso.

**Stream con background updates (iOS):** Usa `AppleSettings(allowBackgroundLocationUpdates: true, pauseLocationUpdatesAutomatically: false)`.

**`trip_notifier.dart`:** `_startLocationBroadcast()` usa `StreamSubscription<Position>` al `backgroundPositionStream` en lugar de `Timer.periodic` + `getCurrentPosition()`. El stream funciona en background; las actualizaciones al backend se throttlean a ~30s.

**Permisos Android (`AndroidManifest.xml`):**
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION"/>
<service android:name="com.baseflow.geolocator.GeolocatorService"
         android:foregroundServiceType="location" android:exported="false"/>
```

**iOS (`Info.plist`):**
```xml
<key>UIBackgroundModes</key><array><string>location</string></array>
```

### Flutter — Tiles de mapa por contexto
- `AppStrings.tripTileUrl` — CartoCDN `rastertiles/voyager` (colorido, muestra nombres de calles, POIs, parques, edificios) → usado en **TODOS** los mapas de la app (MapScreen, PlannerScreen, ActiveTripScreen, BoardingConfirmScreen, RoutePreviewSheet, MapPickScreen)
- Todos los `TileLayer` usan `keepBuffer: 3, panBuffer: 1` para evitar tiles en blanco al hacer scroll

### Flutter — ActiveTripScreen: layout full-screen
El mapa ocupa toda la pantalla (`Stack` sin `AppBar`). Controles como overlays:
- **Top card** (fondo `primaryDark`): nombre ruta + duración + créditos + botón reporte
- **Banners flotantes**: GPS lost (naranja), alerta bajada (rojo/amarillo) — se apilan bajo el top card
- **Botón re-centrar** (bottom-right): mueve mapa al GPS con zoom 17
- **Panel inferior**: reportes plegables (tap para expandir) + botones "Reportar" | "Me bajé"
- `MapController` sigue automáticamente la posición GPS en cada update (`_followUser`)
- Zoom inicial: **17** (nivel de calle, muestra el entorno inmediato)
- Bus icon: 44px con sombra azul pulsante, borde blanco

### Flutter — BoardingConfirmScreen: layout full-screen con 3 marcadores
El mapa ocupa toda la pantalla (`Stack` sin `AppBar`). Layout pattern igual que `ActiveTripScreen`:
- **Top overlay**: tarjeta con nombre de ruta + botón back
- **Leyenda flotante** (bottom-left, encima del panel inferior): explica los 3 marcadores:
  - 🟢 Verde (`AppColors.success`) — tu posición GPS (donde abordas)
  - 🔴 Rojo (`AppColors.error`) — parada de bajada (donde te deja el bus, icono bus)
  - 🟣 Morado profundo (`Colors.deepPurple`) — destino final escrito (icono bandera)
- **Panel inferior**: selector de parada de bajada + botón "Me monté"
- **Lista de paradas**: `DraggableScrollableSheet` como modal bottom sheet
- **3 marcadores distintos** en el mapa con `CameraFit.bounds` ajustando todos los puntos
- `destLat/destLng` en la URL = destino real escrito por el usuario (NO la parada de abordaje)
- La parada más cercana al DESTINO se auto-selecciona como parada de bajada
- **Bug fix planner**: `planner_screen.dart` pasa `selectedDest` coords (NO `result.nearestStop`) al navegar a `/trip/confirm`

### Flutter — MapScreen: GPS en tiempo real con auto-follow
- `MapController _mapController` + `StreamSubscription<Position>` para stream GPS (distanceFilter: 10m)
- `_livePosition` se actualiza en cada fix → mapa sigue automáticamente si `_followUser = true`
- `onPositionChanged(hasGesture)` → si el usuario hace pan manual → `_followUser = false`
- Botón re-centrar (FAB pequeño, bottom-right) reaparece al hacer pan manual → re-activa auto-follow
- Zoom inicial: **15**, tiles: `tripTileUrl` (Voyager colorido)
- Prioridad de posición: `_livePosition > ready.userPosition`
- Durante viaje: `tripPosition > _livePosition > ready.userPosition`

### Flutter — Planner: marcadores en mapa se limpian al cerrar el viaje
Al cerrar el resumen del viaje (`TripSummarySheet.onClose`), `ActiveTripScreen` llama:
```dart
ref.read(plannerNotifierProvider.notifier).reset(); // limpia markers origen/destino
ref.read(mapActivePositionsProvider.notifier).state = const <LatLng>[]; // limpia buses activos
```

### Flutter — Tabs de navegación (3 tabs, sin "Mi viaje")
`MainShell` tiene 3 tabs: Mapa (`/map`), Mis Rutas (`/planner`), Perfil (`/profile`).
La tab "Mi viaje" NO existe. Durante viaje activo se muestra `_TripActiveBar` en lugar del `BottomNavigationBar`.

### Flutter — Alerta de bajada: bugs corregidos

**Bug 1 (crítico): el prompt nunca aparecía**
`ref.listen` solo captura *cambios* de estado. `startTrip()` fija `dropoffPrompt: true` antes de que
`ActiveTripScreen` se monte, así que el listener nunca capturaba la transición.
**Fix:** `initState()` de `ActiveTripScreen` verifica el estado inicial en el primer frame:
```dart
WidgetsBinding.instance.addPostFrameCallback((_) {
  final s = ref.read(tripNotifierProvider);
  if (s is TripActive && s.dropoffPrompt) _showDropoffPrompt();
});
```

**Bug 2: DropoffMonitor usaba `getCurrentPosition()` (lento/fallaba)**
El monitor llama `_check()` cada 15s. `getCurrentPosition()` hace petición GPS fresca que puede
tardar o fallar si el OS está en ahorro de batería.
**Fix:** `DropoffMonitor._check()` usa `Geolocator.getLastKnownPosition()` primero (instantáneo,
usa el cache del OS que el stream del viaje mantiene actualizado). Fallback a `getCurrentPosition()`
solo si el cache es null.

**Bug 3: sin vibración notable**
`HapticFeedback.vibrate()` daba un toque suave imperceptible.
**Fix:** Al disparar `onAlight`, se ejecutan 3 `HapticFeedback.heavyImpact()` separados por 350ms.

**Flujo completo de alertas de bajada (usuarios free):**
1. `startTrip()` finaliza → `_startMonitors()` fija `dropoffPrompt: true` (con o sin destino)
2. `ActiveTripScreen.initState` detecta el prompt → muestra `AlertDialog`
3. Usuario acepta:
   - Con destino pre-seleccionado (`destinationStopId != null`) → `activateDropoffAlerts()` cobra 5 cr, arranca `DropoffMonitor`
   - Sin destino → `_pickDestinationOnMap()` → abre `MapPickScreen` centrado en GPS actual → usuario elige punto en mapa → bottom sheet de confirmación → `setDestinationByLatLng()` cobra 5 cr, crea `Stop` sintético (`id: -1`), arranca `DropoffMonitor`
4. `DropoffMonitor` verifica posición cada 15s:
   - ≤400 m → banner amarillo "Prepárate para bajar"
   - ≤200 m → banner rojo "¡Bájate ya!" + 3 vibraciones fuertes
   - Pasó la parada → banner "Perdiste la parada"

**Cambiar destino durante viaje activo (botón 🚩 en `ActiveTripScreen`):**
`_changeDestination()` abre `MapPickScreen` centrado en el destino EXISTENTE, no en el GPS:
| Prioridad | Fuente | Cuándo aplica |
|---|---|---|
| 1 | `notifier.dropoffMonitorDestination` | Monitor activo (planner premium + mapa pick) |
| 2 | Stop por `destinationStopId` en la lista de paradas | Planner free, monitor aún no arrancado |
| 3 | GPS actual | Sin destino alguno |

`TripNotifier.dropoffMonitorDestination` → getter público que expone `_dropoffMonitor?.destination` como `LatLng?`
`TripNotifier.hasDropoffMonitor` → bool; si `true` → `updateDestinationByLatLng()` (gratis); si `false` → `setDestinationByLatLng()` (cobra 5 cr)

**Persistencia del destino entre reinicios de app:**
`active_trips` tiene columnas `custom_destination_lat/lng/name` para guardar destinos seleccionados en el mapa (puntos libres). El endpoint `PATCH /api/trips/destination` los guarda y limpia `destination_stop_id = NULL`.

`GET /api/trips/current` usa `COALESCE(s.latitude, at.custom_destination_lat)` para retornar siempre las coords correctas sin importar si el destino es parada real o punto libre.

`_recoverActiveTrip()` en `TripNotifier` distingue 3 casos al restaurar el viaje:
- `destinationStopId != null` → parada real → busca el stop y arranca `DropoffMonitor` normal
- `destinationStopId == null && destinationLat != null` → punto libre → crea `Stop` sintético (`id: -1`) y arranca `DropoffMonitor`
- Sin destino → no arranca monitor

`setDestinationByLatLng()` y `updateDestinationByLatLng()` hacen `unawaited(tripsRepository.updateDestination(...))` para persistir el destino en background (fire-and-forget silencioso).

### Flutter — Durante viaje activo: solo un icono de bus (el del usuario)

La lista `buses` del socket incluye el propio viaje del usuario. Para evitar dos iconos:
1. `BusMarkerLayer` recibe `otherBuses` (filtrando el `trip.id` propio)
2. `UserMarkerLayer` usa la posición del bus propio desde la lista (actualizada por socket), NO `ready.userPosition` (que es la posición inicial del mapa — se vuelve obsoleta)

```dart
// map_screen.dart
int? ownTripId;
LatLng? liveUserPosition;
if (tripState is TripActive) {
  ownTripId = tripState.trip.id;
  final ownBus = ready.buses.where((b) => b.id == ownTripId).firstOrNull;
  if (ownBus?.currentLatitude != null) {
    liveUserPosition = LatLng(ownBus!.currentLatitude!, ownBus.currentLongitude!);
  }
}
final otherBuses = ownTripId != null
    ? ready.buses.where((b) => b.id != ownTripId).toList()
    : ready.buses;
```

### Flutter — Durante viaje activo: bloquear navegación a otros tabs

`MainShell` muestra `_TripActiveBar` (barra azul "Viaje activo") en lugar del `BottomNavigationBar` cuando `isOnTrip = true`. Esto impide navegar a mapa, rutas o perfil. El FAB "Me subí" en `MapScreen` también se oculta con `isOnTrip ? null : FloatingActionButton(...)`.

`MainShell` usa `ref.listen<TripState>` para auto-navegar a `/trip` si el viaje inicia desde otro tab (incluyendo recuperación de viaje al reiniciar la app).

### Flutter — MapPickScreen: siempre pasar coordenadas actuales:
```dart
// Al abrir map-pick, pasar las coords actuales para que abra en el punto correcto
final query = lat != null && lng != null ? '?lat=$lat&lng=$lng' : '';
final result = await context.push<NominatimResult>('/map-pick$query');
```

### Backend — Rutas nombradas antes que params:
```typescript
// ✅ /nearby ANTES que /:id para evitar conflictos Express
router.get('/nearby', handler);
router.get('/plan', handler);
router.get('/:id', handler);  // siempre al final
```

### SnackbarType Flutter:
```dart
// Solo existen estos 3 tipos — NUNCA usar 'warning'
SnackbarType.success
SnackbarType.error
SnackbarType.info
```

### Flutter — Diálogo de desvío (4 opciones)
Cuando el `DesvioMonitor` detecta que el bus se alejó ≥100m de la ruta por ≥60s, muestra un `AlertDialog` con:
1. 🟠 **Desvío temporal (trancón)** — `createReport('desvio')` — reporte normal 30 min, no alerta admin
2. 🔴 **La ruta del bus es diferente al mapa** — `notifier.reportRutaReal()` con validación inteligente (ver abajo)
3. **Ignorar 5 min** (outlined) — pausa el monitor
4. **Me bajé** (outlined rojo) — finaliza el viaje con confirmación

### Flutter / Backend — Reporte "Ruta diferente al mapa" inteligente ✅ IMPLEMENTADO

**Flujo completo:**
1. Usuario selecciona "🗺️ Ruta diferente al mapa" en el sheet de reportes OR en el diálogo de desvío
2. **`TripNotifier.reportRutaReal(routeId, geometry)`** — retorna `'on_route'` | `'ok'` | `'error'`:
   - Obtiene GPS con `Geolocator.getLastKnownPosition()` (fast), fallback a `getCurrentPosition()`
   - Llama `POST /api/routes/:id/update-report` con `{ tipo: 'ruta_real', lat, lng }`
3. **Backend valida** GPS contra `routes.geometry` (Haversine, umbral 200m) → 400 `{ on_route: true }` si está sobre la ruta
4. **Resultados mostrados al usuario:**
   - `'on_route'` → snackbar "Estás sobre la ruta registrada, el reporte no aplica"
   - `'ok'` → snackbar "Reporte enviado. Monitoreando re-ingreso..." + activa timer
   - `'error'` → snackbar error genérico
5. **Si reporte aceptado** → `_deviationReEntryTimer` (Timer.periodic 15s) se activa:
   - Cada 15s: obtiene GPS y valida contra `geometry`; **re-chequea `state is TripActive`** después del await para evitar snackbar fantasma post-trip
   - Cuando distancia < 200m → `PATCH /api/routes/:id/update-report/reentry` (best-effort) → callback snackbar "✓ Segmento desactualizado registrado" → cancela timer
   - Se cancela automáticamente en `_disposeMonitorsAndTimers()` al finalizar el viaje

**Backend (`routeUpdateController.ts`):**
- `reportRouteUpdate`: acepta `{ tipo, lat, lng }`, valida GPS contra `routes.geometry`, guarda `reported_geometry = [[lat, lng]]` si válido
- `updateDeviationReEntry`: actualiza `reported_geometry → [[start_lat,start_lng],[end_lat,end_lng]]` (solo si actualmente tiene 1 punto)

**Flutter — archivos modificados:**
| Archivo | Cambio |
|---------|--------|
| `location_service.dart` | `static double minDistToPolyline(lat, lng, List<dynamic>)` |
| `api_paths.dart` | `static String routeUpdateReEntry(int id)` |
| `routes_remote_source.dart` | `reportRouteUpdate({lat?, lng?})` + `updateDeviationReEntry()` |
| `routes_repository.dart` | Retorna `({bool onRoute, bool ok})` record; maneja 400 `on_route: true` |
| `trip_notifier.dart` | `_deviationReEntryTimer`, `_deviationRouteId`, `_onDeviationReEntry`, `reportRutaReal()`, `setDeviationReEntryCallback()` |
| `active_trip_screen.dart` | Llama `notifier.reportRutaReal()` en report sheet y desvío dialog; pre-captura `ScaffoldMessenger` antes del await; helper `_showRutaRealResult()` |
| `route_update_sheet.dart` | Actualizado a nuevo tipo record `({bool ok, bool onRoute})` |

**Resultado para el admin:**
`reported_geometry` pasa de `null` → `[[startLat, startLng]]` (inicio desviación) → `[[startLat, startLng], [endLat, endLng]]` (tramo completo). El panel admin dibuja `reported_geometry` como polilínea → admin ve exactamente qué tramo está desactualizado.

### Flutter — Confirmación antes de "Me bajé"

`_confirmEndTrip()` en `ActiveTripScreen` muestra un `AlertDialog` antes de llamar `endTrip()`:
- Título: "¿Ya te bajaste?"
- Acciones: "Seguir en el bus" (dismiss) | "Sí, me bajé" (rojo destructivo → `endTrip()`)

### Flutter — Resumen de viaje rediseñado (`TripEnded`)

`TripEnded` tiene campos: `routeName`, `totalCreditsEarned`, `distanceMeters`, `completionBonusEarned`, `tripDuration`, `reportsCreated`, `streakDays`.

`_TripSummaryScreen` (pantalla completa dentro de `ActiveTripScreen`):
- Header oscuro (`primaryDark`): checkmark verde + "¡Viaje completado!" + nombre ruta
- Tarjeta blanca: número grande de créditos (+N), badge "Bono completar" si aplica, fila de stats (duración + distancia), card de reportes en el viaje, card de racha de días
- `endTrip()` corre `tripsRepository.end()` y `creditsRepository.getReportStreak()` en **paralelo** con `Future.wait`
- `_reportsCreatedThisTrip` se incrementa en cada `createReport()` exitoso

### Flutter — ScaffoldMessenger antes de await (patrón lint-safe)

Cuando se usa `BuildContext` después de un `await` en un callback:
```dart
// ✅ Capturar ANTES del await
final messenger = ScaffoldMessenger.of(context);
final result = await someAsyncCall();
if (!mounted) return;
messenger.showSnackBar(...); // usar messenger, no context
```

### Flutter — Vibración con paquete `vibration`

`HapticFeedback` (flutter/services) es para feedback táctil de UI y resulta imperceptible desde timers. Se reemplazó por el paquete `vibration ^2.0.0` que llama directamente al `Vibrator` de Android con intensidad y patrón explícitos.

| Momento | Patrón | Intensidad |
|---|---|---|
| `onDesvio` (ruta diferente) | 5 pulsos × 300 ms, pausa 150 ms | 255 (máxima) |
| `onPrepare` (≤700 m a parada) | 2 pulsos × 200 ms, pausa 200 ms | 180 (media) |
| `onAlight` (≤200 m a parada) | 5 pulsos × 400 ms, pausa 150 ms | 255 (máxima) |

```dart
Vibration.vibrate(
  pattern: [0, 400, 150, 400, 150, 400, 150, 400, 150, 400],
  intensities: [0, 255, 0, 255, 0, 255, 0, 255, 0, 255],
);
```

`import 'package:flutter/services.dart'` eliminado de `trip_notifier.dart`.

---

## Estado del proyecto

### Completado ✅
- Backend completo: auth, rutas, paradas, reportes, créditos, viajes, favoritos, pagos Wompi
- Web admin panel: users, routes (editor geometría OSRM), companies, route alerts, stats dashboard
- Flutter app completa: auth (email + Google), onboarding, mapa, boarding flow, viaje activo (4 monitores), planificador, perfil, créditos, favoritos, premium
- Sistema anti-fraude: cooldown 5 min entre viajes, bono completar ≥2 km, `suspicious_minutes` (inactividad 30min → cierre automático descontando minutos sospechosos)
- **DesvíoMonitor unificado**: umbral 100m / 60s en ambas ramas (geometría y paradas fallback)
- **Planner nearby auto-refresh**: `Timer.periodic(2 min)` en `PlannerNotifier` cuando origen es GPS, cancelado al cambiar a dirección tipificada o al hacer `reset()`
- **Firebase Cloud Messaging (push notifications)**: `firebase_core ^3.6.0` + `firebase_messaging ^15.1.3` en Flutter; `firebase-admin ^12.7.0` en backend; `NotificationService` en `core/notifications/`; token FCM guardado en `users.fcm_token`; `PATCH /api/auth/fcm-token` (auth); push en: reporte creado (→ pasajeros activos en la ruta), trancón resuelto (→ pasajeros activos), viaje finalizado (→ usuario); tap en notif navega a `/trip` o `/profile/trips` según tipo
- Rate limiting: auth (20/15min), reports (15/5min), general (300/1min)
- Cron zombie trips (>4h sin actualización → cerrar)
- **Alerta de bajada — vibración real**: paquete `vibration ^2.0.0` reemplaza `HapticFeedback`; `onPrepare` a 700m (antes 400m) = 2 pulsos medios + notif push; `onAlight` a 200m = 5 pulsos máximos + notif push urgente (`fullScreenIntent`)
- **Desvío — alerta urgente**: vibración 5 pulsos máximos + `NotificationService.showAlert()` al detectar desvío ≥100m por ≥60s
- **Alerta de bajada para usuarios free**: prompt en initState (no en ref.listen), GPS vía getLastKnownPosition (rápido)
- **Confirmación antes de "Me bajé"**: AlertDialog destructivo
- **Resumen de viaje rediseñado**: pantalla completa con créditos grandes, duración, distancia, reportes creados, racha de días (cargado en paralelo con endTrip)
- **Reporte "Ruta diferente al mapa" inteligente**: validación GPS doble (cliente + backend), re-entry timer 15s, guarda tramo desactualizado en reported_geometry
- **Google Sign-In fix**: `serverClientId` (web OAuth client type 3) requerido para obtener `idToken` en Android; `signOut()` antes de `signIn()` para siempre mostrar picker
- **Guardar contraseña Google (autofill)**: `AutofillGroup` + `autofillHints` en login screen; `TextInput.finishAutofillContext()` al hacer submit → activa Google Password Manager
- **Assets visuales actualizados**: logo circular MiBus con fondo transparente en login; bus ilustración en splash center; bus en tránsito animado en splash + marcadores del mapa
- **Paleta "Profesional Atardecer"**: primary `#1A5080`, primaryDark `#0B2F52`, accent `#E7B342`, error/critical `#CD1C2B`, background `#F5F7FA`; navigation bar azul oscuro con iconos dorados
- **Cards con borde izquierdo de color**: "Cerca de ti", favoritos y "Buses en tu zona" → fondo blanco + sombra + borde izquierdo 4px en color de `AppColors.forRouteCode(route.code)`
- **Alerta de bajada — selección en mapa**: cuando el usuario no tiene destino, se abre `MapPickScreen` (crosshair) en vez de lista de paradas; `setDestinationByLatLng()` crea `Stop` sintético (`id: -1`) para el monitor; premium/admin no pagan créditos
- **Cambiar destino durante viaje activo (🚩)**: `_changeDestination()` centra el mapa en el destino ya seleccionado (no en GPS); prioridad: monitor > stop por ID > GPS. `TripNotifier.dropoffMonitorDestination` getter expone destino del monitor activo
- **MapScreen durante viaje**: muestra polilínea del viaje activo + marcador de destino (bandera verde) cuando `TripActive.stops` tiene la parada destino
- **MapPickScreen durante viaje**: muestra polilínea de la ruta activa como referencia visual
- **Ruta del mapa (MapScreen)**: la feed route solo se muestra cuando NO hay viaje activo (`!isOnTrip`)
- **Perfil rediseñado**: sin AppBar, hero header con `primaryDark` + avatar circular con iniciales en `accent` + chips de rol/premium/trial; tarjeta de créditos con ícono dorado y número grande; menú de navegación con `ListTile` (íconos semánticos); código de referido integrado como tile con **copy button + share button** (`share_plus ^10.0.0`, `Share.share(text)`)
- **Historial de viajes rediseñado**: barra de resumen (viajes + créditos + tiempo) con fondo `primaryDark`; cards con borde izquierdo en color de ruta; fechas relativas ("Hoy", "Ayer", día de semana); créditos con ícono moneda dorado
- **CreditHistoryTile rediseñado**: íconos semánticos por tipo de transacción (bus/viaje, reporte, regalo/bono, alerta, referido); contenedor con color de fondo suave; monto con mayor peso tipográfico
- **PremiumCard**: lista de beneficios no-premium ahora muestra `Icons.check_circle_rounded` antes de cada feature

### Pendiente 🚧
- Publicación en Google Play (requiere SHA-1 Firebase + signing config en release build)
- Flujo de pago Wompi in-app (actualmente abre navegador)
- Alianza con AMB y SIBUS Barranquilla

---

## Assets Flutter

| Asset | Descripción |
|-------|-------------|
| `assets/icon/icon.png` | Icono de app (launcher) |
| `assets/icon/logo.png` | Logo circular MiBus (500×500, fondo transparente) — usado en login screen |
| `assets/splash/bus.png` | Bus MiBus ilustración (500×500, fondo transparente) — logo central del splash screen |
| `assets/splash/en_transito.png` | Bus MiBus en tránsito con líneas de velocidad (500×500, fondo transparente) — bus animado en splash + marcadores de buses en el mapa |

---

## Estructura de archivos clave

```
busbarranquilla/
├── backend/src/
│   ├── index.ts                     # Entry point
│   ├── config/database.ts           # pg Pool
│   ├── config/schema.ts             # CREATE TABLE + migraciones + auto-seed
│   ├── config/socket.ts             # Socket.io setup
│   ├── controllers/                 # Lógica de negocio
│   ├── routes/                      # Definición de rutas Express
│   └── middlewares/                 # auth, role, rate limit
│
├── web/src/
│   ├── App.tsx                      # Rutas React Router
│   ├── context/AuthContext.tsx      # Auth state + JWT
│   ├── services/api.ts              # axios + todos los módulos API
│   ├── components/
│   │   ├── CatchBusMode.tsx         # Flujo "Me subí/bajé" + 4 monitores
│   │   └── PlanTripMode.tsx         # Planificador
│   └── pages/admin/                 # Panel admin
│
└── flutter_app/lib/
    ├── app.dart                     # GoRouter + MiBusApp
    ├── core/
    │   ├── api/                     # Dio client + interceptores
    │   ├── data/                    # Sources + Repositories
    │   ├── domain/models/           # Modelos inmutables
    │   ├── l10n/strings.dart        # TODOS los strings de UI
    │   └── theme/app_colors.dart    # Paleta: primary #1A5080, primaryDark #0B2F52, accent #E7B342
    └── features/
        ├── auth/                    # Login, register, splash, onboarding
        ├── map/                     # MapScreen + MapPickScreen
        ├── planner/                 # PlannerScreen + Nominatim
        ├── trip/                    # Boarding + ActiveTrip + monitores
        ├── profile/                 # Profile + Credits + TripHistory
        └── shell/main_shell.dart    # BottomNavigationBar 4 tabs
```

---

*Este archivo se actualiza automáticamente con cada cambio relevante al proyecto MiBus.*
### Flutter — Parada de destino en BoardingConfirmScreen

**Causa 1:** Viniendo de "mis rutas" / "Subir a este bus" la ruta es `/trip/confirm?routeId=X` sin `destLat/destLng` → `autoSelected = null` → ningún marcador de parada en el mapa inicial.

**Causa 2:** Al elegir parada desde la lista o mapa pick, el marcador se añade al `MarkerLayer` pero `initialCameraFit` solo corre en el primer render — la cámara no se mueve para mostrar la nueva parada.

**Fix:** Método `_fitCameraToStop(Stop stop)` que llama `_mapController.fitCamera(CameraFit.bounds(...))` con la parada + posición del usuario. Llamado:
- En `_load()` → después de los dos `setState` (loading=false + userPosition) via `addPostFrameCallback` — evita que la cámara quede en zoom de ruta completa
- En `_showStopListModal` → `ListTile.onTap` → después del `Navigator.pop()` via `addPostFrameCallback`
- En `onPickFromMap` → después de `setState`

**Auto-selección solo con O+D:** La parada de destino se auto-selecciona únicamente cuando `destLat/destLng` están presentes (flujo planificador). Sin destino ("Subir a este bus"), el usuario elige la parada manualmente.

---

### Flutter — GPS real-time tracking (viaje activo)

**Problema:** `intervalDuration: 20s` en Android hacía que el marcador del bus saltara ~220 m cada 20 segundos en vez de moverse suavemente.

**Fix:** `location_service.dart` — `backgroundPositionStream` en Android:
- `distanceFilter: 10 → 5` m
- `intervalDuration: 20s → 5s`

El marcador UI se actualiza en cada fix GPS (sin throttle). El backend sigue con throttle de 28 s para no saturar el servidor. Resultado: movimiento visual fluido cada ~5 s.

---

*Última actualización: 2026-03-14 (v17)*
