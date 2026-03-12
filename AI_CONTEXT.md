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
4. `BoardingConfirmScreen` — mapa interactivo 280px + selector de parada de destino + opción map-pick
5. "Me monté" → `tripNotifier.startTrip(routeId, destinationStopId?)` → `TripActive` → `context.go('/trip')`

### 2. Flujo de viaje activo (4 monitores en background)
| Monitor | Intervalo | Trigger | Acción |
|---------|-----------|---------|--------|
| Auto-resolve trancón | 120s | Bus movió >1 km del reporte | `PATCH /api/reports/:id/resolve` |
| Detección desvío | 30s | Fuera de ruta >250m por ≥90s | Banner: reportar / bajarse / ignorar 5min |
| Inactividad | 60s | Sin movimiento <50m por ≥600s | Modal "¿Sigues en el bus?" — auto-cierre 120s |
| Alerta bajada | 15s | Destino fijado | Prepararse (400m) → Bájate ya (200m + vibración) → Perdiste |

### 3. Planificador de viaje
1. `PlannerScreen` — auto-setea origen a GPS al cargar
2. Búsqueda de dirección → Nominatim (bbox BQ) + normalización colombiana ("Cr 52 N 45" → "Cr 52 #45")
3. Ícono de mapa en campo → `/map-pick?lat=X&lng=Y` → crosshair → geocodificación inversa → regresa resultado
4. "Buscar rutas" → `POST /api/routes/plan` → `PlannerResults`
5. Tap resultado → `context.push('/trip/confirm?routeId=X&destLat=Y&destLng=Z')`

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
active_trips   — user_id, route_id, current_lat, current_lng, destination_stop_id, is_active, total_distance_meters
user_favorite_routes — user_id, route_id (UNIQUE)
payments       — user_id, wompi_reference, plan, amount_cents, status(pending|approved|declined)
route_update_reports — route_id, user_id, tipo(trancon|ruta_real) (UNIQUE por usuario+ruta)
```

**Campos clave:**
- `routes.manually_edited_at` — se pone en `PUT /routes/:id`, se limpia en `regenerate-geometry`
- `active_trips.total_distance_meters` — acumulado en cada `updateLocation` via Haversine (para bono de completar viaje ≥2 km)
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
POST /api/routes/:id/update-report — votar trancon|ruta_real (auth)
```

### Viajes
```
GET  /api/trips/current     — viaje activo del usuario (auth)
POST /api/trips/start       — iniciar viaje { routeId, destinationStopId? } (auth)
PATCH /api/trips/update-location — { latitude, longitude } (auth)
POST /api/trips/end         — terminar viaje (auth)
GET  /api/trips/history     — últimos 20 viajes completados (auth)
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
- `AppStrings.osmTileUrl` — CartoCDN `light_all` (gris, minimalista) → usado en MapScreen y PlannerScreen
- `AppStrings.tripTileUrl` — CartoCDN `rastertiles/voyager` (colorido, muestra nombres de calles, POIs, parques, edificios) → usado SOLO en ActiveTripScreen para navegación

### Flutter — ActiveTripScreen: layout full-screen
El mapa ocupa toda la pantalla (`Stack` sin `AppBar`). Controles como overlays:
- **Top card** (fondo `primaryDark`): nombre ruta + duración + créditos + botón reporte
- **Banners flotantes**: GPS lost (naranja), alerta bajada (rojo/amarillo) — se apilan bajo el top card
- **Botón re-centrar** (bottom-right): mueve mapa al GPS con zoom 17
- **Panel inferior**: reportes plegables (tap para expandir) + botones "Reportar" | "Me bajé"
- `MapController` sigue automáticamente la posición GPS en cada update (`_followUser`)
- Zoom inicial: **17** (nivel de calle, muestra el entorno inmediato)
- Bus icon: 44px con sombra azul pulsante, borde blanco

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

---

## Estado del proyecto

### Completado ✅
- Backend completo: auth, rutas, paradas, reportes, créditos, viajes, favoritos, pagos Wompi
- Web admin panel: users, routes (editor geometría OSRM), companies, route alerts, stats dashboard
- Flutter app completa: auth (email + Google), onboarding, mapa, boarding flow, viaje activo (4 monitores), planificador, perfil, créditos, favoritos, premium
- Sistema anti-fraude: cooldown 5 min entre viajes, bono completar ≥2 km
- Rate limiting: auth (20/15min), reports (15/5min), general (300/1min)
- Cron zombie trips (>4h sin actualización → cerrar)

### Pendiente 🚧
- Firebase push notifications (flutter_local_notifications ya instalado)
- Publicación en Google Play (requiere google-services.json + SHA-1 Firebase)
- Flujo de pago Wompi in-app (actualmente abre navegador)
- Alianza con AMB y SIBUS Barranquilla

---

## Assets Flutter

| Asset | Descripción |
|-------|-------------|
| `assets/icon/icon.png` | Icono de app — logo Gemini AI (1024×1024, fondo blanco) |
| `assets/splash/bus.png` | Bus para splash screen — diseño personalizado |

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
    │   └── theme/app_colors.dart    # Paleta: primary #2563EB
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
*Última actualización: 2026-03-12*
