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
| Geocodificación | Nominatim (primario) + Google Maps (secundario) + Geoapify (fallback web) |
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

**Prompt de alertas de bajada para usuarios free (Spec 43):**
- `_startMonitors()` ya **NO** dispara `dropoffPrompt` ni `dropoffAutoPickDestination` automáticamente cuando `destinationStopId == null`. El bloque `else if (!isPremium)` fue eliminado.
- El FAB `where_to_vote` en `ActiveTripScreen` pulsa con `ScaleTransition` (1.0→1.22, 900ms) y muestra una etiqueta "Añadir destino" mientras no haya destino seleccionado. Guía al usuario visualmente sin interrupciones.
- Si hay destino pre-seleccionado al montar: al aceptar → `activateDropoffAlerts()` cobra 5 créditos y arranca el monitor.
- Si NO hay destino: el usuario toca el FAB → `_changeDestination()` → `MapPickScreen` para elegir punto en mapa.

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
GET  /api/routes/update-alerts — rutas con ≥3 reportes ruta_real en 30 días, con geometry + reporters + reporter_positions (admin)
GET  /api/routes/update-alerts/count — cantidad de alertas pendientes para badge del sidebar (admin)
PATCH /api/routes/:id/dismiss-alert — marcar alerta como revisada (admin)
PATCH /api/routes/:id/apply-reported-geometry — reemplaza geometry con track GPS de un usuario (admin)
GET  /api/admin/routes/ruta-real-reports — TODOS los reportes ruta_real individuales sin filtro de umbral, con reported_geometry + route_geometry (admin, máx 200)
DELETE /api/admin/routes/ruta-real-reports/:id — eliminar un reporte ruta_real individual (admin)
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
- `_autoFollow = true` por defecto — mapa sigue GPS automáticamente (`_followUser`)
- `onPositionChanged(hasGesture)` → pan manual → `_autoFollow = false` → deja de jalonear al usuario
- Botón re-centrar cambia color: blanco (auto-follow activo) / azul sólido (manual, indica que hay que tocar)
- Al tocar re-centrar: `_autoFollow = true` + mueve mapa a `center` (posición GPS actual del viaje)
- El marcador del bus **siempre** se actualiza en tiempo real, independiente de `_autoFollow`
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

**Flujo completo de alertas de bajada (usuarios free — post Spec 43):**
1. `startTrip()` finaliza → sin prompt automático. FAB animado en `ActiveTripScreen` guía al usuario.
2. Si usuario toca el FAB → `_changeDestination()` → `MapPickScreen` → elige punto → `setDestinationByLatLng()` cobra 5 cr, crea `Stop` sintético (`id: -1`), arranca `DropoffMonitor`.
3. Si tiene destino pre-seleccionado y acepta el `dropoffPrompt` → `activateDropoffAlerts()` cobra 5 cr, arranca `DropoffMonitor`.
4. `DropoffMonitor` verifica posición cada 15s:
   - ≤400 m → banner amarillo "Prepárate para bajar"
   - ≤200 m → banner rojo "¡Bájate ya!" + 3 vibraciones fuertes
   - Pasó la parada → banner "Perdiste la parada"

**Timer de nudge sin destino (Spec 44 — `_noDestTimer`):**
- Arranca en `startTrip()` si `destinationStopId == null`. Dispara una sola vez a los 4 minutos.
- Antes de disparar verifica: destino ya elegido → cancela. `boardingAlerts == false` → cancela.
- Si `user.isPremium || role=='admin' || credits >= 5` → push "¿A dónde vas? Selecciona tu parada" (`payload: 'no_destination'`)
- Si `free && credits < 5` → push "Activa alertas de bajada → hazte premium" (mismo payload)
- Se cancela también en `setDestinationStop()`, `setDestinationByLatLng()`, `updateDestinationByLatLng()`, y `_disposeMonitorsAndTimers()`.

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

**Marcadores de bus — colores y widgets (NO usar `en_transito.png`):**
- `UserMarkerLayer` sin viaje: punto azul (`AppColors.primary`) con borde blanco
- `UserMarkerLayer` en viaje (`isOnTrip=true`): círculo verde (`AppColors.success`) + `Icons.directions_bus_filled` blanco, 44×44
- `BusMarkerLayer` (otros usuarios): círculo ámbar (`AppColors.accent`) + `Icons.directions_bus_filled` blanco, 44×44
- Posiciones activas en `map_screen.dart` (planificador/waiting): círculo ámbar (`AppColors.accent`) + `Icons.directions_bus_filled` blanco, 40×40
- Splash screen bus animado: círculo verde (`AppColors.success`) + `Icons.directions_bus_filled` blanco, 80×80

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
Cuando el `DesvioMonitor` detecta que el bus está fuera de ruta (ver umbrales en sección Spec 39 abajo), muestra un `AlertDialog` con:
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
- Web admin panel: users, routes (editor geometría OSRM), companies, route alerts, stats dashboard, GPS reports (todos los ruta_real individuales)
- Flutter app completa: auth (email + Google), onboarding, mapa, boarding flow, viaje activo (4 monitores), planificador, perfil, créditos, favoritos, premium
- Sistema anti-fraude: cooldown 5 min entre viajes, bono completar ≥2 km, `suspicious_minutes` (inactividad 30min → cierre automático descontando minutos sospechosos)
- **DesvíoMonitor unificado**: umbral 100m / 60s en ambas ramas (geometría y paradas fallback)
- **Planner nearby auto-refresh**: `Timer.periodic(2 min)` en `PlannerNotifier` cuando origen es GPS, cancelado al cambiar a dirección tipificada o al hacer `reset()`
- **Firebase Cloud Messaging (push notifications)**: `firebase_core ^3.6.0` + `firebase_messaging ^15.1.3` en Flutter; `firebase-admin ^12.7.0` en backend; `NotificationService` en `core/notifications/`; token FCM guardado en `users.fcm_token`; `PATCH /api/auth/fcm-token` (auth); push en: reporte creado (→ pasajeros activos en la ruta con `routeReports !== false`), trancón resuelto (→ pasajeros activos con `routeReports !== false`), viaje finalizado (→ usuario con `boardingAlerts !== false`), reporte confirmado (→ reportante original con `routeReports !== false`), alerta de bajada 400m/200m desde backend (→ usuario con `boardingAlerts !== false`); tap en notif navega a `/trip` o `/profile/trips` según tipo; todas las pushes respetan `notification_prefs` del usuario (Spec 42)
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
- **Pantalla de ayuda in-app (`HelpScreen`)**: accesible desde Perfil → "Ayuda y guía"; ruta `/profile/help`; 5 secciones expandibles (Mapa, Mis Rutas, Me subí, Créditos, Premium) con preguntas frecuentes tipo FAQ; diseño con `CustomScrollBar` + `SliverAppBar` + cards con borde izquierdo de color por sección; `ExpansionTile` por cada pregunta; strings en `AppStrings` (helpTitle, helpMenuLabel, helpMapTitle, helpPlannerTitle, helpTripTitle, helpCreditsTitle, helpPremiumTitle)
- **Tarjeta "Novedades" en HelpScreen**: `_ChangelogSection` (`ConsumerWidget`) se inserta al tope de `HelpScreen`; muestra 4 bullets (modo espera + auto-boarding, alertas M4/M5, desvío con trayecto, GPS en segundo plano); empieza expandida si el usuario nunca la ha abierto (key `help_changelog_seen_v2` en `SharedPreferences`); al expandir llama `markHelpChangelogSeen()` + `ref.invalidate(helpChangelogSeenProvider)`. Badge rojo en el tile "Ayuda y guía" del Perfil mientras `helpChangelogSeen == false`. `helpChangelogSeenProvider` vive en `onboarding_storage.dart`.
- **Sistema de preferencias de notificaciones (spec 34)**: columna `notification_prefs JSONB DEFAULT '{}'` en `users`; endpoint `PATCH /api/auth/notification-prefs` (auth); modelo `NotificationPrefs` en Flutter con campos nullable (`busNearby`, `boardingAlerts`, `routeReports`) — `null` = nunca configurado, `true/false` = preferencia guardada; diálogo opt-in primera vez por tipo (`notification_opt_in_dialog.dart`); sección "Notificaciones" en `ProfileScreen` con 3 toggles; alerta "bus cercano" cobra **3 créditos** a usuarios free (premium/admin gratis); lógica en `_handleBusNearbyNotification()` en `map_screen.dart`
- **Auto-boarding inteligente (spec 35)**: 5 mecanismos en modo espera (`MapScreen`): M1 socket co-movimiento (3 muestras Haversine <200m mismo sentido → auto-board con undo 8s), M2 GPS on-route rápido (>3 m/s <100m de ruta → auto-board), M3 GPS off-route (>500m de espera → cancela modo espera), M4 on-route lento (<1 m/s ≥90s → dialog "¿Ya te subiste?"), M5 off-route lento + >1 km (→ dialog "¿Sigues esperando?"); background location en waiting: `_startPositionStream(background: true)` usa `LocationService.backgroundPositionStream` (ForegroundService) para que los timers funcionen con pantalla bloqueada; WaitingBanner chip verde "Monitoreando tu posición" cuando monitor activo; QuickBoardSheet: `_error = true` al fallar carga + botón Reintentar
- **Alertas inteligentes modo espera (spec 36)**: dialog M4 "¿Ya te subiste?" (Sí ya estoy / No todavía) y M5 "¿Sigues esperando?" (Sí sigo / Cogí otro bus); "Cogí otro bus" abre `QuickBoardSheet` para cambiar a otra ruta sin perder contexto
- **Episodios de desvío completos (specs 23+35)**: al elegir "Ruta diferente al mapa" Flutter crea `reports.type='desvio'` (registra `created_at`/`resolved_at` del episodio); `endTrip()` cierra el segmento GPS en `route_update_reports.reported_geometry` (`[[start],[end]]`) vía `updateDeviationReEntry`; `getRouteUpdateAlerts` devuelve `desvio_episodes[]` (lat, lng, duración, estado) desde `reports`; `AdminRouteAlerts.tsx` muestra tabla de episodios + marcadores morados pulsantes en mini-mapa + badge de conteo

### Pendiente 🚧
- Publicación en Google Play (requiere SHA-1 Firebase + signing config en release build)
- Flujo de pago Wompi in-app (actualmente abre navegador)
- Alianza con AMB y SIBUS Barranquilla

### Push notifications completas desde backend (Spec 42)

**DB:** Dos nuevas columnas en `active_trips`: `boarding_alert_prepare_sent BOOLEAN DEFAULT FALSE` y `boarding_alert_now_sent BOOLEAN DEFAULT FALSE` — evitan enviar la misma alerta de bajada dos veces aunque lleguen múltiples actualizaciones de posición.

**Boarding alerts desde backend (`updateLocation`):**
- Tras actualizar posición, si `destination_stop_id` está seteado y `boarding_alert_now_sent = false`, calcula distancia al stop destino con `haversineMeters()`
- ≤200 m: marca `boarding_alert_now_sent = true` + envía push "🚨 Bájate ya"
- ≤400 m y `boarding_alert_prepare_sent = false`: marca flag + envía push "⏱ Prepárate para bajar"
- Todo el bloque corre en un `try/catch` interno después de `res.json()` — si falla, no afecta la respuesta al cliente
- Solo se ejecuta si `notification_prefs.boardingAlerts !== false` (null = opt-in por defecto)

**Enforcement de `notification_prefs` en todos los push existentes:**
- `createReport`: filtra tokens por `routeReports !== false` antes de `sendPushToUsers`
- `resolveReport`: ídem
- `confirmReport`: nueva push al reportante original respetando `routeReports !== false`
- `endTrip`: verifica `boardingAlerts !== false` antes del push de viaje finalizado

**Archivos modificados:** `backend/src/config/schema.ts`, `backend/src/controllers/tripController.ts`, `backend/src/controllers/reportController.ts`

---

## Assets Flutter

| Asset | Descripción |
|-------|-------------|
| `assets/icon/icon.png` | Icono de app (launcher) |
| `assets/icon/logo.png` | Logo circular MiBus (500×500, fondo transparente) — usado en login screen |
| `assets/splash/bus.png` | Bus MiBus ilustración (500×500, fondo transparente) — logo central del splash screen |
| `assets/splash/en_transito.png` | ~~Ya no se usa~~ — reemplazado por widgets Flutter con `Icons.directions_bus_filled` |

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

### Flutter — Animación de créditos ganados (viaje activo)

Badge `+N 🔥` flotante en `ActiveTripScreen`. Aparece en la esquina superior derecha (junto al badge de créditos), sube suavemente y se desvanece en 1.6 s.

- `SingleTickerProviderStateMixin` + `AnimationController(1600ms)`
- `SlideTransition`: `Offset(0,0) → Offset(0,-3)` con `Curves.easeOut`
- `FadeTransition`: `1→0` con `Interval(0.45, 1.0)` — visible la primera mitad, desvanece la segunda
- Trigger: `ref.listen` detecta `next.creditsEarned > prev.creditsEarned` → `forward(from:0)`
- `IgnorePointer` + `Positioned.fill` para no bloquear interacciones con el mapa

---

### Flutter — Modo "Esperando el bus" con ETA en tiempo real

Cuando el usuario está en `BoardingScreen` y toca `RoutePreviewSheet`, puede elegir:
- **"Me monté en este bus"** → empieza viaje normalmente
- **"Esperar este bus"** → activa modo espera: regresa al mapa, muestra buses en vivo de esa ruta y calcula ETA

**Componentes:**

| Archivo | Rol |
|---------|-----|
| `map/providers/waiting_route_provider.dart` | `selectedWaitingRouteProvider = StateProvider<BusRoute?>` |
| `map/providers/waiting_bus_positions_provider.dart` | `waitingBusPositionsProvider = StateProvider<List<LatLng>>` — separado de `mapActivePositionsProvider` |
| `trip/widgets/route_preview_sheet.dart` | Param `onWait: (List<LatLng> geometry)?` → botón "Esperar este bus" |
| `trip/screens/boarding_screen.dart` | `onWait` callback: guarda ruta con geometría + navega a `/map` |
| `map/screens/map_screen.dart` | Polling Timer.periodic(15s) + ETA + `_WaitingBanner` (overlay ETA) |
| `shell/main_shell.dart` | `_WaitingActiveBar` — bloquea tabs, muestra ruta + cancel |

**Flujo completo:**
1. Usuario toca "Esperar este bus" en `RoutePreviewSheet`
2. Sheet pasa `_geometry` (ya cargada) al callback `onWait`
3. `BoardingScreen` guarda `BusRoute.copyWith(geometry: loadedGeometry)` en `selectedWaitingRouteProvider` + `context.go('/map')`
4. `MainShell.ref.listen` detecta cambio → fuerza navegación a `/map` si no está ahí
5. `MainShell` reemplaza `NavigationBar` con `_WaitingActiveBar` → tabs bloqueados
6. `MapScreen.ref.listen` detecta cambio → `_startWaiting(route)` → poll inmediato + `Timer.periodic(15s)`
7. `_pollWaitingRoute` → `getActivity(routeId)` → actualiza `waitingBusPositionsProvider` (buses en mapa) y calcula ETA

**Layout durante modo espera:**
```
┌──────────────────────────────────────┐
│  MAPA full size (arriba del bar)     │
│  polilínea azul de ruta esperada     │
│  buses en tiempo real (iconos 🚌)   │
│ ┌────────────────────────────────┐   │  ← _WaitingBanner (overlay, bottom:12)
│ │ [D8] El Campito  ⏱ ~4 min    │   │    solo ETA, sin botón cancel
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐  ← _WaitingActiveBar (shell bottomNavigationBar)
│ 🔔 Esperando bus                     │    único botón "Dejar de esperar"
│ D8 · El Campito  [Dejar de esperar] │
└──────────────────────────────────────┘
```

**ETA — algoritmo frontend-only:**
- `_nearestVertex(point, geometry)` → índice del vértice más cercano en la polilínea
- `_polylineDistance(geometry, from, to)` → distancia acumulada entre dos índices
- `_calculateEta(buses, user, geometry)` → bus con `busIdx <= userIdx` (aún no alcanza al usuario) con menor distancia; ETA = distancia / 25 km/h → minutos
- Si todos los buses ya pasaron al usuario → `null` → "Sin buses activos"

**Providers de posición — sin conflicto:**
- `mapActivePositionsProvider` — escrito por PlannerScreen, leído en mapa cuando `waitingRoute == null`
- `waitingBusPositionsProvider` — escrito por `_pollWaitingRoute`, leído en mapa cuando `waitingRoute != null`

**Auto-limpieza:**
- `MapScreen.ref.listen(tripNotifierProvider)` → `TripActive` → limpia `selectedWaitingRouteProvider` → `_stopWaiting()` → limpia `waitingBusPositionsProvider`
- `MainShell.ref.listen(tripNotifierProvider)` → `TripActive` → `context.go('/trip')`
- `_WaitingActiveBar` "Dejar de esperar" → `selectedWaitingRouteProvider = null` → todo se limpia en cadena
- Guard post-await en `_pollWaitingRoute`: `ref.read(selectedWaitingRouteProvider)?.id != route.id` → aborta si ruta cambió

**Modo espera desde PlannerScreen:**
- `PlanResultCard` tiene `onWait: VoidCallback?` opcional — muestra botón "Esperar este bus" (outlined) debajo de la card
- El tap en la card sigue siendo boarding (no duplicado) — solo se agrega el botón secundario de espera
- Nearby routes expandidas en planner: dos botones — "Esperar este bus" (outlined) + "Subir a este bus" (filled)
- `_startWaiting(BusRoute)` en `PlannerScreen`: construye `BusRoute` desde `PlanResult` → setea provider → `context.go('/map')`

**Bug crítico corregido — bootstrap de waiting mode:**
- `ref.listen` solo dispara cambios futuros. Si `MapScreen` se monta DESPUÉS de que `selectedWaitingRouteProvider` fue seteado (desde PlannerScreen o BoardingScreen), el listener no dispara y `_startWaiting` nunca se llama
- Fix: en `MapScreen.initState`, después de `initialize()`, se lee `selectedWaitingRouteProvider` y se llama `_startWaiting` si ya tiene valor

**Bugs corregidos durante implementación:**
- Race condition: poll en vuelo podía re-llenar posiciones después de cancelar → guard de `route.id`
- `ref.listen<dynamic>` → corregido a `ref.listen<BusRoute?>`
- Dos botones cancel visibles → cancel solo en shell bar, banner solo muestra ETA

**Vibración — fix:**
- `Vibration.vibrate()` silenciosamente fallaba en algunos dispositivos sin vibrador
- Fix: helper estático `_vibrate({pattern, intensities})` en `TripNotifier` — llama `Vibration.hasVibrator()` primero, si retorna `false` no vibra
- Los 3 call sites (prepare/alight/desvío) usan `_vibrate` en vez de `Vibration.vibrate` directo

---

### Web Admin — Editor de trazado (AdminRoutes.tsx)

**Herramienta borrado por segmento (segment erase) — actualizada 2026-03-15:**
- Reemplaza el antiguo borrador freehand por un modo intuitivo: `isSegEraseMode` state + `isSegEraseModeRef` + `segEraseLayersRef`
- Botón `🗑️ Borrar tramo — clic en la ruta` visible solo en modo `isEditingGeometry`, disabled si < 2 waypoints
- Al activarlo: cursor cambia a `pointer`; un `useEffect` crea polilíneas invisibles (weight 10, opacity 0) sobre cada segmento entre waypoints consecutivos
- Hover sobre segmento → se pone rojo (opacity 0.65) + tooltip "🗑️ Click para borrar este tramo"
- Click en segmento → elimina los dos waypoints del segmento (respetando primer/último waypoint) → `snapAndUpdate(newWpts)`
- En modo erase activo: instrucción descriptiva + botón `← Volver a dibujar` para salir sin borrar
- El modo se limpia en `closeModal`, en `cancelar`, y en `previsualizar cambios`

**Revert de segmento en diff de IA — añadido 2026-03-15:**
- Los segmentos verdes (nuevos) del diff de IA ahora tienen tooltip `🟢 Tramo nuevo — click para revertir al original`
- Al hacer click en un segmento verde → `revertSegment(segIdx)`: reemplaza ese tramo en la nueva geometría con el fragmento correspondiente de la geometría original, recalcula los segmentos y actualiza el estado `aiDiff`

**Parser IA de descripción de rutas (routeDescriptionController.ts) — mejorado 2026-03-15:**
- El prompt de Claude ahora pide municipio en cada punto: `"Carrera 5 con Calle 37, Barranquilla"` o `"Carrera 15 con Calle 30, Soledad"`
- La función `parseRouteDescription` parsea `lastIndexOf(', ')` para separar `intersection` de `city`
- Geocodificación en 3 pasos: 1) Overpass en paralelo, 2) Google Maps para los fallidos (paralelo, usa `VITE_GOOGLE_MAPS_KEY`), 3) Nominatim secuencial con `city` param
- `geocodeViaNominatim` acepta `city` param y lo usa en todas las queries (ya no hardcodea Barranquilla)
- `geocodeViaGoogle`: valida bbox BQ metro (lat 10.7–11.2, lng -75.1–-74.5); intenta query con `city` y fallback `Barranquilla`

---

### Flutter — Auto-boarding inteligente (Spec 35, 36, 40)

**Auto-boarding — 2 mecanismos activos en `map_screen.dart`:**
- **M1 (socket co-movimiento):** detecta co-movimiento <40m con otro pasajero durante ≥3 min + ambos movidos ≥100m → dispara `_triggerAutoBoarding()`
- **M2/M4 eliminados (Spec 40):** reemplazados por check de 100 m (ver abajo)
- **M3 (GPS off-route → auto-cancelar espera):** timer 15s — si >300m de geometría + velocidad ≥10 km/h por ≥4 min → cancela modo espera con snackbar
- **M5 (GPS off-route lento + >1km):** si >1km de inicio + velocidad <10 km/h + off-route por ≥5 min → dialog "¿Sigues esperando?"
- `_triggerAutoBoarding()` muestra SnackBar con SnackBarAction "Deshacer" (8s), luego llama `startTrip()` → `context.go('/trip')`

**Check "¿Cogiste otro bus?" — 100 m (Spec 40):**
- Timer cada **15 s**: si `distFromWaitingStart ≥ 100 m` → `_showCogiotroDialog(route, currentPos)`
- "No, sigo esperando" → `_waitingStartPosition = currentPos` (reset de ancla) + `_cogiOtroShown = false`
- "Sí, cogí otro" → cancela modo espera + abre `QuickBoardSheet`
- Tap fuera del dialog → trata como "No" (reset ancla)
- Reemplaza M2 (velocidad) y M4 (on-route lento) — captura buses lentos y rápidos sin depender de velocidad

**Waiting mode — mejoras de robustez:**
- **Background location:** `_startWaiting()` llama `_startPositionStream(background: true)` → usa `LocationService.backgroundPositionStream` (ForegroundService Android, background updates iOS). `_stopWaiting()` revierte con `_startPositionStream()`.
- **Indicador visual en banner:** `_WaitingBanner` recibe `monitoringActive` → muestra chip verde "Monitoreando tu posición" bajo la ETA cuando el GPS timer está activo.
- **QuickBoardSheet error state:** si `list()` falla → muestra ícono wifi_off + texto + botón "Reintentar" que relanza `_loadRoutes()`.

**Campos de estado en `_MapScreenState`:**
```
_autoboardProximityStart, _autoboardUserPosAtStart, _autoboardBusPosAtStart, _autoboardAnchorTripId
_waitingStartPosition, _offRouteStart, _gpsMovementTimer
_userPosAtOffRouteStart, _farAlertShown, _cogiOtroShown
_autoboardPending, _autoboardUndoTimer
```

**Strings en `AppStrings`:**
`autoboardDetected`, `autoboardUndo`, `autoboardCancelled`, `waitingAutoCancelled`, `waitingFarOffRoute*`, `waitingCogiotroTitle`, `waitingCogiotroBody`, `waitingCogiotroYes`, `waitingCogiotroNo`, `quickBoardTitle`, `quickBoardSearchHint`, `quickBoardLoadError`, `quickBoardRetry`, `waitingMonitorLabel`

---

### Flutter — DesvioMonitor mejorado (Spec 39)

**Detección por zona:**
- `rawDist ≤ 20 m` → en ruta, sin acción
- `20–100 m` (zona gris) → llama OSRM `/nearest/v1/driving/{lng},{lat}` (timeout 5s) → snapea GPS a calle real → si `snapDist ≤ 20 m` a polilínea: en ruta. Si `snapDist > 20 m`: fuera de ruta. Red error → trata como fuera de ruta (conservador)
- `> 100 m` → fuera de ruta directo, sin llamada OSRM
- Umbral sostenido: **15 s** (antes 30 s). Detecta calle paralela a ~80 m en 15–30 s.

**Confirmación periódica post-`ruta_real` (Spec 39, paso 3–7):**
- Tras confirmar "ruta diferente al mapa": `onDesvio` y push notification quedan suprimidos
- Cada **10 min** → `onConfirmDeviating` → bottom sheet "¿Sigues en ruta diferente?" (sin push)
  - "Sí, sigue" → `acknowledgeConfirmation()` → reinicia intervalo 10 min
  - "No, ya regresó" → `resetEpisode()` → cierra episodio
  - Sin respuesta en 60 s → auto-acknowledge (conservador)
- `_deviationReEntryTimer` (15 s) sigue activo → si GPS re-entra a ruta → `onReturnToRoute` → cierra episodio automáticamente
- Nuevos campos en `TripActive`: `desvioConfirmPending`
- Nuevo método `TripNotifier`: `acknowledgeDesvioConfirm()`, `resetDesvioConfirm()`

**Ícono destino activo trip:** `Icons.where_to_vote` (antes `flag_outlined`) — más reconocible como "confirmar destino"

---

### Episodios de desvío completos — "Ruta diferente al mapa"

**Problema corregido:** Al elegir "Ruta diferente al mapa" en el diálogo de desvío, no se creaba reporte `desvio` → `_desvioReportId = null` → sin `resolved_at` → sin duración del episodio. Tampoco se cerraba el segmento GPS en `route_update_reports`.

**Cambios:**
1. **`active_trip_screen.dart`** — `onTap` de "Ruta diferente": llama `createReport('desvio')` antes de `dismissDesvio('ruta_real')`. `ScaffoldMessenger.of(context)` capturado antes del `await` para evitar lint de BuildContext across async gaps.
2. **`trip_notifier.dart` `endTrip()`** — si `_deviationRouteId != null` al finalizar viaje, llama `updateDeviationReEntry` con GPS actual para cerrar el segmento `[start → bajada]` en `route_update_reports.reported_geometry`.
3. **`routeUpdateController.ts` `getRouteUpdateAlerts`** — añade query a tabla `reports` para `type = 'desvio'` de los últimos 30 días. Devuelve `desvio_episodes[]` con `{id, lat, lng, created_at, resolved_at, duration_minutes, reporter_name}`.
4. **`AdminRouteAlerts.tsx`** — nueva interfaz `DesvioEpisode`; badge morado "N episodios de desvío" en cabecera; tabla "Episodios de desvío registrados" con pasajero/inicio/duración/estado; marcadores morados en mini-mapa con tooltip.

**FAB mapa:** `AppStrings.mapBoardFab = 'Tomar bus'` (antes `boardedButton = 'Me subí'`). `boardedButton` se conserva para el botón de confirmación en `BoardingConfirmScreen`. `helpTripTitle` actualizado a `'Cómo funciona "Tomar bus"'`.

---

### Auto-reporte de ruta diferente al finalizar viaje (Spec 41)

**Backend — acumulación de traza GPS:**
- Nueva columna `active_trips.gps_trace JSONB DEFAULT '[]'` — acumula los puntos GPS del viaje
- `updateLocation` hace append de `[lat, lng]` a `gps_trace` en cada actualización (máx 500 puntos)
- Constraint `UNIQUE(route_id, user_id)` eliminada de `route_update_reports` — permite múltiples tramos por usuario por ruta

**Backend — detección al cerrar viaje (`endTrip`):**
- Helpers añadidos: `minDistToGeometryKm`, `centroid`, `findOffRouteClusters`
- `findOffRouteClusters` divide la traza en clústeres de puntos consecutivos >200 m de la ruta (mínimo 3 puntos)
- Por cada clúster: calcula centroide, compara contra centroides de reportes manuales del usuario durante ese viaje (tolerancia 500 m). Si no hay overlap → inserta nuevo `route_update_reports` (tipo `ruta_real`) para ese tramo
- `endTrip` response incluye `deviation_detected: bool` (el `gps_trace` ya no se retorna al cliente)

**Flutter — resumen de viaje:**
- `TripEndResult`: campo `deviationDetected: bool`
- `TripEnded`: campo `deviationDetected: bool`
- `_TripSummaryScreen`: si `deviationDetected`, muestra card naranja con texto `deviationReportBody` e ícono `alt_route`. Sin mapa — el usuario solo necesita saber que se registró, no ver el trazado técnico
- String: `AppStrings.deviationReportBody`

---

### Bug crítico resuelto: Flutter app congelada en splash (startup + post-login)

**Síntoma:** App instalada desde cero (o con datos limpios) quedaba infinitamente en el splash screen ("Cargando..."). Después del login también se congelaba en splash.

**Causa raíz:** `flutter_secure_storage` usa el Keystore de Android para cifrar el token JWT. En ciertos dispositivos/versiones de Android, las operaciones del Keystore (read, write) se cuelgan indefinidamente cuando el estado interno del Keystore es inconsistente — especialmente en instalaciones limpias donde los datos de SharedPreferences se borran pero las claves del Keystore persisten (o se crean nuevas). Cuando `readToken()` o `writeToken()` se colgaba, el interceptor Dio nunca llamaba `handler.next()` y el timeout de Dio nunca iniciaba → app bloqueada en `AuthLoading` → splash eterno.

**Solución:** Reemplazar `flutter_secure_storage` con `SharedPreferences` para almacenar el JWT en `lib/core/storage/secure_storage.dart`. `SharedPreferences` nunca toca el Keystore de Android → cero riesgo de cuelgue. El impacto de seguridad es mínimo para este caso de uso (JWT validado server-side, expira en 30 días).

**Cambios asociados:**
- `lib/core/storage/secure_storage.dart` — `SecureStorageImpl` ahora usa `SharedPreferences.getInstance()` en lugar de `FlutterSecureStorage`; interfaz `SecureStorage` sin cambios (rest of app unaffected)
- `lib/core/api/interceptors/auth_interceptor.dart` — `readToken().timeout(5s)` añadido como guardia adicional
- `lib/features/auth/providers/auth_notifier.dart` — guardia `if (state is! AuthLoading) return` en `_refreshFromProfile()` para evitar race conditions
- `lib/main.dart` — `NotificationService.initialize()` es fire-and-forget (no bloquea `runApp()`)

**Nota para futuros cambios:** NO volver a `flutter_secure_storage` sin resolver el Keystore deadlock. Si se necesita cifrado real en el futuro, usar `encryptedSharedPreferences: true` con manejo de errores robusto.

---

## Deep-link de notificaciones locales (Spec 44)

**`NotificationService`** (`lib/core/notifications/notification_service.dart`):
- `static void Function(String? payload)? onNotificationTap` — callback registrado en `app.dart`
- `onDidReceiveNotificationResponse` wired en `initialize()` → llama `onNotificationTap`
- `_onBackgroundNotificationResponse` — función top-level `@pragma('vm:entry-point')` para taps en background
- `getLaunchPayload()` — recupera el payload de la notificación que lanzó el app desde estado terminado

**`app.dart` — `_handleLocalNotificationTap(String? payload)`:**
| Payload | Acción |
|---|---|
| `inactivity_check` | `router.go('/trip')` — `ActiveTripScreen.initState` muestra el modal si `showInactivityModal == true` |
| `no_destination` | `router.go('/trip')` + `requestMapPick()` → `ActiveTripScreen` abre `_pickDestinationOnMap()` (crosshair, NO lista de paradas) |
| `boarding_alert_prepare` / `boarding_alert_now` | `router.go('/trip')`, sin modal |

**`TripActive.noMapPickRequested`** (`trip_state.dart`): flag que señala a `ActiveTripScreen` que debe abrir el map picker. Seteado por `requestMapPick()`, limpiado por `clearMapPickRequest()`.

**Payloads de alertas existentes** (agregados en Spec 44):
- Inactividad → `payload: 'inactivity_check'`
- Alerta prepararse → `payload: 'boarding_alert_prepare'`
- Alerta bajarse → `payload: 'boarding_alert_now'`

---

## Firebase Crashlytics

**Paquete:** `firebase_crashlytics ^4.1.3` (agregado a `pubspec.yaml`)

**Configuración en `lib/main.dart`:**
- `FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError` — captura errores del framework Flutter (build failures, rendering errors)
- `PlatformDispatcher.instance.onError` — captura errores async fuera del framework (platform channel failures, isolate errors)
- Ambos handlers solo activos en `!kDebugMode` — en debug la pantalla roja sigue funcionando normalmente

**Identificador de usuario en `lib/app.dart`:**
- `ref.listen<AuthState>(authNotifierProvider, ...)` en `_MiBusAppState.initState`
- Cuando `Authenticated` → `FirebaseCrashlytics.instance.setUserIdentifier(user.id.toString())`
- Cuando logout → `setUserIdentifier('')` para no contaminar sesiones cruzadas

**Para ver crashes:** Firebase Console → proyecto mibus_flutter → Crashlytics. Se activa automáticamente con la primera build de release instalada en un dispositivo.

---

## Release signing (Spec 45)

**Estado:** ✅ Configurado y verificado — APK de release generado correctamente (67.3 MB).

**Archivos:**
- `flutter_app/android/mibus-release.jks` — keystore de producción (en `.gitignore`, nunca al repo)
- `flutter_app/android/key.properties` — credenciales del keystore (en `.gitignore`, nunca al repo)
  - `keyAlias=mibus`, `storeFile=../mibus-release.jks`
- `flutter_app/android/app/build.gradle.kts` — carga `key.properties` con `FileInputStream`, `signingConfigs.create("release")`, `buildTypes.release` usa `signingConfigs.getByName("release")`

**Builds de producción:**
```bash
# APK (instalación directa / sideload)
~/development/flutter/bin/flutter build apk --release
# → build/app/outputs/flutter-apk/app-release.apk

# AAB (Google Play — recomendado, menor descarga)
~/development/flutter/bin/flutter build appbundle --release
# → build/app/outputs/bundle/release/app-release.aab
```

**Para CI/CD futuro:** inyectar las credenciales del keystore como variables de entorno y escribir `key.properties` antes de compilar.

---

## Map tile caching (Spec 46)

**Paquete:** `flutter_map_tile_caching: ^9.1.0`

**Inicialización en `lib/main.dart`** (antes de `runApp`):
```dart
await FMTCObjectBoxBackend().initialise();
const store = FMTCStore('mapTiles');
if (!await store.manage.ready) await store.manage.create();
```

**Comportamiento:**
- Tiles se guardan en disco la primera vez que se cargan (ObjectBox, directorio privado de la app)
- En visitas posteriores a la misma zona se sirven desde disco — sin red, instantáneo
- Expiración: 30 días — tras ese plazo se re-descargan automáticamente al visualizarse
- Sin señal: el mapa muestra todos los tiles previamente cacheados
- El caché persiste entre reinicios y actualizaciones de la app

**Archivos con `TileLayer` actualizados** (los 5 idénticos):
- `lib/features/map/screens/map_screen.dart`
- `lib/features/trip/screens/active_trip_screen.dart`
- `lib/features/trip/screens/boarding_confirm_screen.dart`
- `lib/features/map/screens/map_pick_screen.dart`
- `lib/features/trip/widgets/route_preview_sheet.dart`

---

## Unit tests (Spec 47)

**Dev dependencies agregadas:** `fake_async: ^1.3.1`, `clock` (para `clock.now()` en `InactivityMonitor` — necesario para que `fake_async` avance el tiempo correctamente).

**Cambios en monitores para testabilidad:**
- `InactivityMonitor` — constructor acepta `positionGetter` opcional; usa `clock.now()` en vez de `DateTime.now()`
- `DropoffMonitor` — constructor acepta `positionGetter` opcional; `_routeDistanceMeters` renombrado a `routeDistanceMeters` (package-visible)

**Test files:**
- `test/location_service_test.dart` — 4 tests para `distanceMeters()` (Haversine)
- `test/inactivity_monitor_test.dart` — 5 tests: onAsk a 600s, sin disparo si hay movimiento, onAutoEnd a 120s, markResponded cancela timer, onSuspicious a 1800s
- `test/dropoff_monitor_test.dart` — tests para `routeDistanceMeters`: direct distance con 1 stop, cumulative con 3 stops, usuario pasado del destino

**Estado:** todos los tests pasan, 0 analyze issues.

## Socket reconnection (Spec 48) ✅ Implementado

**`lib/core/socket/socket_service.dart`:**
- Campo `void Function()? onReconnect` — setter público
- `_socket?.on('reconnect', (_) { _connected = true; onReconnect?.call(); })` en `connect()`
- `onReconnect = null` en `disconnect()` y `dispose()` — sin handlers huérfanos

**`lib/features/trip/providers/trip_notifier.dart`:**
- En `startTrip()`, tras `_startLocationBroadcast()`: registra `onReconnect` que emite `join:route` con el `routeId` activo
- En `_disposeMonitorsAndTimers()`: limpia `onReconnect = null`

**Comportamiento:** señal perdida → socket_io_client reconecta automáticamente → evento `'reconnect'` → re-join de la sala de ruta → reportes y confirmaciones en tiempo real continúan sin reiniciar la app.

## Firebase Analytics (Spec 49) ✅ Implementado

**Paquete:** `firebase_analytics: ^11.3.3` en `pubspec.yaml`.

**`lib/core/analytics/analytics_service.dart`** — servicio estático centralizado con 10 métodos:

| Método | Evento Firebase | Parámetros |
|--------|----------------|-----------|
| `boardingFlowStarted()` | `boarding_flow_started` | — |
| `routeSelected(id, code)` | `route_selected` | `route_id`, `route_code` |
| `tripStarted(id, code)` | `trip_started` | `route_id`, `route_code` |
| `tripEnded(...)` | `trip_ended` | `duration_minutes`, `credits_earned`, `distance_meters` |
| `reportCreated(type)` | `report_created` | `type` |
| `destinationSet(method)` | `destination_set` | `method` ('map_pick'\|'stop_list') |
| `dropoffAlertActivated()` | `dropoff_alert_activated` | — |
| `plannerSearched()` | `planner_searched` | — |
| `premiumCheckoutStarted()` | `premium_checkout_started` | — |
| `noDestinationNudgeSent(variant)` | `no_destination_nudge_sent` | `variant` ('regular'\|'premium_upsell') |

**Puntos de instrumentación:**
- `map_screen.dart` — FAB "Me subí": `boardingFlowStarted`
- `boarding_confirm_screen.dart` — `initState`: `routeSelected`
- `trip_notifier.dart` — `startTrip()`: `tripStarted`; `endTrip()`: `tripEnded`; `createReport()` success: `reportCreated`; `_noDestTimer` ambas ramas: `noDestinationNudgeSent`
- `active_trip_screen.dart` — `_pickDestinationOnMap()` y `_changeDestination()`: `destinationSet` + `dropoffAlertActivated`
- `planner_screen.dart` — `_onSearch()`: `plannerSearched`
- `premium_card.dart` — tap: `premiumCheckoutStarted`

Todos los calls usan `unawaited(AnalyticsService.method())` — nunca bloquean el hilo principal.

## Waiting mode bus counter + alerta de llegada (Spec 50) ✅ Implementado

**Backend — nuevos elementos:**
- Tabla `waiting_alerts` (`user_id, route_id, user_lat, user_lng, is_active, expires_at 30min`) con índice en `route_id WHERE is_active=true`
- Cleanup de alertas expiradas en startup junto al zombie-trip cleanup
- `GET /api/routes/:id/nearby-buses?userLat&userLng&radiusKm=2` — cuenta buses activos dentro del radio que van en dirección correcta (`busIdx < userIdx` en la polyline)
- `findNearestIdx(geometry, lat, lng)` — proyecta un punto sobre la polyline y devuelve el índice más cercano (exportado de `routeController.ts`)
- `POST /api/routes/:id/waiting-alert` — registra alerta; cobra 3 créditos a usuarios free; gratis para premium/admin; retorna 402 si créditos insuficientes
- `DELETE /api/routes/:id/waiting-alert` — cancela alerta activa
- En `updateLocation`: tras boarding alerts block, chequea `waiting_alerts` activas para la ruta; si bus ≤300m Y `busIdx < userIdx` → push "¡Tu bus está llegando!" + desactiva alerta

**Flutter — `map_screen.dart`:**
- Estado `_nearbyBusCount`, `_alertActive`, `_alertLoading`, `_busCountTimer`
- `_startBusCountPolling(routeId)` — fetch inmediato + `Timer.periodic(30s)`
- `_stopBusCountPolling()` — cancela timer, limpia estado
- `_activateWaitingAlert(routeId)` — llama al endpoint, maneja error 402 con snackbar
- Polling arranca al entrar en waiting mode, se cancela al salir (incluyendo cuando el usuario inicia viaje)
- `_WaitingBanner` muestra contador con color verde/gris según `_nearbyBusCount` y botón de alerta que cambia a estado "Te avisaremos" cuando está activa

**Strings nuevos:** `waitingBusCount0/1/N`, `waitingAlertButton`, `waitingAlertActive`, `waitingAlertActivating`, `waitingAlertInsufficientCredits`, `waitingAlertCost`

## FCM token refresh (Spec 51) ✅ Implementado

**Problema resuelto:** Android rota el FCM token periódicamente. Sin listener, el backend quedaba con el token viejo y las pushes llegaban a un token inválido (silenciado en `pushNotificationService.ts`).

**`lib/core/notifications/notification_service.dart`:** método estático `listenTokenRefresh(void Function(String) onRefresh)` — suscribe a `FirebaseMessaging.instance.onTokenRefresh`.

**`lib/app.dart`:** `_MiBusAppState.initState()` llama `NotificationService.listenTokenRefresh()` con callback que invoca `ref.read(authRepositoryProvider).updateFcmToken(newToken)`.

**Sistema de pushes completo:**
- Token guardado en backend al login vía `AuthNotifier._registerFcmToken()` ✅
- Token actualizado cuando Android lo rota vía `onTokenRefresh` ✅
- Backend envía pushes con `notification + data` → Android muestra nativamente con app cerrada ✅
- `getInitialMessage()` + `onMessageOpenedApp` en `app.dart` routean al destino correcto ✅
- **Prerequisito producción:** variable `FIREBASE_SERVICE_ACCOUNT` debe estar configurada en Railway con el JSON de la service account de Firebase Admin SDK

## Performance fixes (Specs 52 + 53) ✅ Implementado

**Problema:** App lenta en login→mapa, apertura del planificador, creación de reportes. Causa raíz: `getCurrentPosition()` bloqueaba UI hasta 15s; listeners re-registrados en cada rebuild.

**`getBestEffortPosition()` — `lib/core/location/location_service.dart`:**
- Primero intenta `Geolocator.getLastKnownPosition()` (caché del OS, retorna en ms)
- Solo si no hay caché hace `getCurrentPosition()` con timeout de 5s
- Reemplaza a `getCurrentPosition()` en: `map_provider.dart`, `planner_screen.dart`, `planner_notifier.dart`, `trip_notifier.dart`

**Rebuilds — listeners movidos de `build()` a `initState()`:**
- `map_screen.dart`: `_waitingRouteSub = ref.listenManual(selectedWaitingRouteProvider, ...)` — evita re-registrar en cada rebuild del mapa
- `active_trip_screen.dart`: `_tripStateSub` + `_desvioConfirmSub` = dos `ref.listenManual(tripNotifierProvider, ...)` — evita re-registrar los listeners más pesados (GPS follow, animaciones, diálogos) en cada actualización GPS (~30s durante viaje)
- Ambas subscripciones se cierran en `dispose()`

**`select` para rebuilds parciales** — en lugar de `ref.watch(tripNotifierProvider)` completo:
- `map_screen.dart`, `boarding_confirm_screen.dart`, `stop_select_screen.dart`, `map_pick_screen.dart`, `main_shell.dart`

**Cache Nominatim — `planner_notifier.dart`:**
- `_searchCache: Map<String, List<NominatimResult>>` en memoria
- `searchAddress()` consulta caché antes de hacer request; guarda resultado tras recibirlo
- Evita peticiones duplicadas cuando el usuario tipea la misma dirección dos veces

**Timeout Nominatim:** `connectTimeout` + `receiveTimeout` reducidos de 10s → **5s**

## Vibración — fix HapticFeedback (2026-03-23) ✅

**Problema:** `vibration` package llama directamente al motor vibratorio del hardware — emuladores no tienen motor físico, la llamada se ignora silenciosamente.

**Fix:** `_vibrate()` en `trip_notifier.dart` ahora usa **dos capas**:
1. `HapticFeedback.heavyImpact()` (primaria) — funciona en emuladores Android API 26+ y todos los dispositivos reales
2. `Vibration.vibrate(pattern: [...])` (secundaria) — solo si `_canVibrate`, añade vibración con duración real en dispositivos físicos

**`_hapticPulses(int count)`** — nuevo método en `TripNotifier`: dispara `count` impulsos `heavyImpact` con 200ms de pausa entre ellos. Usado por `_vibrate()` para replicar el patrón de pulsos.

**`_vibrateWaitingAlert()`** en `map_screen.dart` — mismo patrón: 2x `HapticFeedback.heavyImpact()` + `Vibration.vibrate()` condicional.

**Import añadido:** `package:flutter/services.dart` en `trip_notifier.dart` y `map_screen.dart`.

## UI — espaciado en confirmaciones de viaje (2026-03-23) ✅

**Problema:** Botones de confirmar ruta/parada quedaban muy pegados al borde inferior en pantallas con barra de navegación.

**Fix:**
- `boarding_confirm_screen.dart`: se añade un **extra de 16 px** al cálculo de `bottomPadding` para levantar el panel inferior y elementos flotantes.
- `stop_select_screen.dart`: padding inferior aumentado (`EdgeInsets.fromLTRB(12, 12, 12, 24)`).
- `active_trip_screen.dart` (`_TripSummaryScreen`): `SafeArea(bottom: false)` + header con padding superior fijo para reducir riesgo de overflow en pantallas pequeñas.

## UI — MapPick button spacing (2026-03-23) ✅

**Problema:** el botón "Confirmar punto" quedaba oculto por la barra inferior (gestos/nav).

**Fix:** `map_pick_screen.dart` calcula `bottomPad = MediaQuery.of(context).padding.bottom` y posiciona el botón en `bottomPad + 24` para respetar el área segura.

## UI — Selección de parada solo por mapa (2026-03-23) ✅

**Problema:** la lista de paradas no aportaba dirección/nombre útil y el botón "Cambiar" resultaba confuso.

**Fix:** en `boarding_confirm_screen.dart` se eliminó la lista modal; la selección de parada se hace **solo** desde el mapa. El texto **"Cambiar"** permanece y abre el mapa (igual que el ícono).

## UI — Waiting mode bars (2026-03-23) ✅

**Problema:** los botones principales de "Esperando bus" quedaban abajo y podían pasar desapercibidos.

**Fix:**
- `map_screen.dart`: nuevo **bar superior** con "Esperando bus", ruta y botones "¡Ya me subí!" / "Dejar de esperar".
- `main_shell.dart`: el bar inferior en modo espera ahora solo muestra **"Monitoreando tu posición"**.
 - `map_screen.dart`: el banner inferior ya no repite **"Monitoreando tu posición"** (evita duplicado).

*Última actualización: 2026-03-23 (v51)*
