# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

**MiBus** (mibus.co) is a collaborative real-time public transport app for Barranquilla and the Metropolitan Area (Colombia). Users report bus locations in real time — the passenger IS the GPS. The system uses a credit economy to incentivize participation and offers premium subscription plans (Wompi payments).

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express 5 + TypeScript |
| Database | PostgreSQL 15 + Redis 7 |
| Real-time | Socket.io 4 |
| Auth | JWT (30-day expiry) + bcryptjs (salt 10) |
| Web frontend | React + Vite + TailwindCSS + Leaflet |
| Mobile | Flutter 3 + Dart (flutter_app/) |
| Payments | Wompi (Colombian payments) |
| Notifications | Firebase Cloud Messaging (upcoming) |

## Running the project

**The project runs via Docker. Do not use `npm run dev` directly** — PostgreSQL and Redis only exist as containers.

```bash
docker-compose up --build   # First run or after Dockerfile changes
docker-compose up           # Normal start
docker-compose down         # Stop everything
docker-compose logs -f backend
docker-compose logs -f web
```

| Service  | Port | Description |
|----------|------|-------------|
| backend  | 3000 | Node.js API |
| web      | 5173 | React + Vite frontend |
| postgres | 5432 | PostgreSQL |
| redis    | 6379 | Cache / pub-sub |

Environment variables are defined in `docker-compose.yml` (not in `.env` files).

## Commands

### Backend (`backend/`)
```bash
npm run dev    # nodemon + ts-node (hot reload)
npm run build  # tsc → ./dist
npm start      # runs ./dist/index.js
```

### Web (`web/`)
```bash
npm run dev    # Vite dev server on :5173
npm run build  # Production build → ./dist
npm run preview
```

### Flutter Mobile (`flutter_app/`)
```bash
~/development/flutter/bin/flutter run              # Run on connected device
~/development/flutter/bin/flutter build apk --release   # Build Android APK
~/development/flutter/bin/flutter analyze          # Static analysis (must return 0 issues)
~/development/flutter/bin/flutter pub get          # Install dependencies
```

---

## Architecture

### Backend (`backend/src/`)

**Entry point** — `index.ts` creates the Express app, wraps it in an HTTP server for Socket.io, registers CORS + JSON middleware, mounts all route groups, initializes DB + schema, then starts listening.

**Route groups** (all prefixed `/api/`):
- `auth` → register, login, profile
- `routes` → bus route CRUD + search + nearby + active feed + trip planner (geometry-based) + geometry
- `stops` → stops per route (CRUD)
- `reports` → create report, list nearby (geolocation), confirm, resolve
- `credits` → balance, history, spend
- `trips` → start trip, update location, end trip, current trip
- `users` → favorites (add, remove, list)
- `payments` → Wompi plans, checkout, webhook
- `admin` → users CRUD + companies CRUD (requires `role = 'admin'`)

**Middleware chain for protected routes:**
- Public: no middleware
- Authenticated: `authMiddleware` (JWT → attaches `req.userId` + `req.userRole`)
- Admin only: `authMiddleware` + `requireRole('admin')` (from `middlewares/roleMiddleware.ts`)

**DB init** — `config/database.ts` holds the pg Pool; `config/schema.ts` runs `CREATE TABLE IF NOT EXISTS` on startup, then runs safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for new fields, then auto-seeds routes if the routes table is empty.

**Credit flow** — creating or confirming a report triggers `credit_transactions` via `awardCredits()` in `creditController.ts`. Premium users skip credit checks.

**Reports** expire in 30 minutes (`expires_at`). `/api/reports/nearby` filters by radius using Haversine formula. Reports can be self-resolved via `PATCH /api/reports/:id/resolve` (sets `is_active = false`, `resolved_at = NOW()`).

**Route geometry** — stored as JSONB in `routes.geometry` as `[lat, lng][]`. On create/update, the backend calls OSRM (two-attempt strategy: full route first, then segment-by-segment with straight-line fallback). Geometry can be regenerated on demand via `POST /api/routes/:id/regenerate-geometry`. The `pg` library auto-parses JSONB to `[number, number][]` — no manual JSON.parse needed in frontend. 78 routes have geometry covering lat 10.83–11.04, lng -74.89–-74.76.

**Trip planner (`/api/routes/plan`)** — geometry-based matching, not stop-based. Uses `haversineKm()` and `minDistToGeometry()` helpers. A route matches if its polyline passes within `ORIGIN_THRESHOLD_KM = 0.25` (250 m) of origin AND within `DEST_THRESHOLD_KM = 1.0` (1 km) of destination, with dest index > origin index (direction check). Fallback to stop-based (0.8 km radius) for routes without geometry. Results sorted by `origin_distance_meters + distance_meters`.

**Socket.io** — configured in `config/socket.ts`. Real-time bus location tracking via `bus:location`, `bus:joined`, `bus:left`, `route:nearby` channels. Route-specific rooms (`route:{id}`) for real-time report events: clients emit `join:route` / `leave:route` when boarding/alighting, server emits `route:new_report` and `route:report_confirmed` to the room.

**Seed** — `scripts/seedRoutes.ts` auto-runs on startup if `routes` table is empty. Seeds real Barranquilla bus routes with stops.

**Note**: In all route files, named routes (`/nearby`, `/search`, `/balance`, `/active-feed`, `/plan`, `/current`) must stay above param routes (`/:id`) to avoid Express conflicts.

#### Backend file map

```
backend/src/
├── index.ts
├── config/
│   ├── database.ts          # pg Pool
│   ├── schema.ts            # CREATE TABLE + migrations + auto-seed
│   └── socket.ts            # Socket.io setup
├── services/
│   ├── blogScraper.ts       # scanBlog(onProgress, {skipManuallyEdited}) — scrapes WordPress blog
│   ├── routeProcessor.ts    # processImports(onProgress, {skipManuallyEdited}) — geocodes + OSRM
│   ├── osrmService.ts       # fetchOSRMGeometry(stops) — 2-attempt OSRM strategy
│   └── legService.ts        # computeLegsForRoute — post-geometry leg computation
├── controllers/
│   ├── adminController.ts       # Users CRUD + Companies CRUD + scanBlog + processImports (with skipManuallyEdited) + getAdminStats
│   ├── authController.ts        # register, login, profile
│   ├── creditController.ts      # balance, history, spend, awardCredits()
│   ├── paymentController.ts     # Wompi: getPlans, createCheckout, handleWebhook
│   ├── recommendController.ts   # Route recommendations
│   ├── reportController.ts      # create, nearby, confirm, resolveReport
│   ├── routeController.ts       # CRUD + search + nearby + activeFeed + getPlanRoutes + regenerateGeometry + getRouteActivity + snapWaypoints
│   ├── routeUpdateController.ts # reportRouteUpdate, getRouteUpdateAlerts (incl. geometry+reporters+GPS), getRouteUpdateAlertsCount, dismissRouteAlert
│   ├── stopController.ts        # CRUD per route
│   ├── tripController.ts        # start, updateLocation, end, active buses, getTripCurrent
│   └── userController.ts        # listFavorites, addFavorite, removeFavorite
├── middlewares/
│   ├── authMiddleware.ts    # JWT verify → req.userId, req.userRole
│   ├── creditMiddleware.ts  # Credit check for premium features
│   └── roleMiddleware.ts    # requireRole(...roles) factory
├── routes/
│   ├── adminRoutes.ts
│   ├── authRoutes.ts
│   ├── creditRoutes.ts
│   ├── paymentRoutes.ts     # GET /plans, POST /checkout, POST /webhook
│   ├── reportRoutes.ts
│   ├── routeRoutes.ts
│   ├── stopRoutes.ts
│   ├── tripRoutes.ts
│   └── userRoutes.ts        # /api/users/favorites
└── scripts/
    └── seedRoutes.ts        # Barranquilla routes + stops seed data
```

#### New API endpoints (added in Phase 3.9)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/trips/history` | ✅ | Last 20 completed trips for current user — `id, route_name, route_code, started_at, ended_at, credits_earned, duration_minutes` |
| GET | `/api/admin/stats` | admin | Dashboard stats: users, trips, reports, credits, active_now, top_routes (last 24h) |

#### New API endpoints (added in Phase 3.8)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/routes/snap-waypoints` | admin | Takes `{waypoints: [lat,lng][]}`, calls OSRM, returns road-snapped `{geometry, hadFallbacks}` |

#### New API endpoints (added in Phase 3.7)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/routes/:id/activity` | ✅ | Route activity last hour: `active_count`, `last_activity_minutes`, `events[]`, `active_positions[]` |
| POST | `/api/routes/:id/update-report` | ✅ | User votes `trancon` or `ruta_real` on a route (upsert, one vote per user per route) |
| GET | `/api/routes/update-alerts` | admin | Routes with ≥3 `ruta_real` votes — includes `geometry`, `reporters[]`, `reporter_positions[]` |
| GET | `/api/routes/update-alerts/count` | admin | Count of unreviewed route update alerts (for sidebar badge) |
| PATCH | `/api/routes/:id/dismiss-alert` | admin | Mark alert as reviewed (`route_alert_reviewed_at = NOW()`) |

#### New API endpoints (added in Phase 3.5)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reports/route/:routeId` | ✅ | Active reports for a route with `confirmed_by_me`, `is_valid`, `needed_confirmations` — only returns reports from other users |

#### New API endpoints (added in Phase 3 — Wompi payments)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/payments/plans` | public | Returns available plans (currently only `monthly` — $4,900 COP/30 days) |
| POST | `/api/payments/checkout` | ✅ | Creates Wompi payment link, saves pending payment, returns `checkout_url` |
| POST | `/api/payments/webhook` | public | Wompi webhook: verifies SHA256 signature, on APPROVED → sets `is_premium=true`, `role='premium'`, extends `premium_expires_at`, awards +50 bonus credits |

#### New API endpoints (added in Phase 2)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/routes/active-feed` | ✅ | Up to 8 routes with reports in last 60 min |
| GET | `/api/routes/plan?originLat=X&originLng=Y&destLat=X&destLng=Y` | ✅ | Geometry-based trip planner: routes whose polyline passes ≤250 m of origin and ≤1000 m of dest (direction-aware). Origin optional. |
| POST | `/api/routes/:id/regenerate-geometry` | admin | Re-fetch OSRM geometry for a route |
| GET | `/api/trips/current` | ✅ | Active trip for current user (`{ trip: null }` if none) |
| PATCH | `/api/reports/:id/resolve` | ✅ | Self-resolve own report |
| GET | `/api/users/favorites` | ✅ | List favorite routes |
| POST | `/api/users/favorites` | ✅ | Add route to favorites `{ route_id }` |
| DELETE | `/api/users/favorites/:routeId` | ✅ | Remove route from favorites |

---

### Web (`web/src/`)

**Routing** — `App.tsx` uses React Router v6 with two nested route groups:
- **Public layout** (`PublicLayout`) — renders `<Navbar />` + `<Outlet />`. Covers `/`, `/map`, `/login`, `/register`, `/premium`, `/payment/result`.
- **Admin layout** (`AdminRoute` guard + `AdminLayout`) — no Navbar, shows sidebar instead. Covers `/admin/*`.

**Auth state** — `context/AuthContext.tsx` stores JWT in `localStorage`, attaches via axios interceptor in `services/api.ts`. Exposes `user` (with `role: 'admin' | 'premium' | 'free'`), `token`, `loading`, `login`, `register`, `logout`, `refreshProfile`.

**API proxy** — Vite proxies `/api/*` → backend. Uses `BACKEND_URL` env var in Docker (`http://backend:3000`), `http://localhost:3000` locally.

**Admin panel** — accessible only to `role === 'admin'` users. `Navbar` shows "⚙️ Administración" link for admins. Redirects non-admins to `/map`, unauthenticated to `/login`.

#### Web file map

```
web/src/
├── App.tsx                        # Routes: PublicLayout + AdminRoute guard
├── context/
│   └── AuthContext.tsx            # Auth state + JWT + role
├── services/
│   ├── api.ts                     # axios instance + all API modules (incl. paymentsApi)
│   ├── adminService.ts            # Admin-specific API (users + companies)
│   └── socket.ts                  # Socket.io client
├── components/
│   ├── AdminRoute.tsx             # Layout route guard (role check → Outlet)
│   ├── CatchBusMode.tsx           # "Me subí/bajé" flow + 4 background monitors + activity display in waiting view
│   ├── CreditBalance.tsx
│   ├── MapView.tsx                # Leaflet map: stops, feed routes, active trip geometry + CenterTracker + bus icon on trip + activity positions
│   ├── Navbar.tsx                 # Shows ⚙️ Admin for admin, ⚡ Premium link for non-premium
│   ├── NearbyRoutes.tsx
│   ├── PlanTripMode.tsx           # Trip planner: Nominatim geocoding + /plan endpoint + activity panel in results
│   ├── ReportButton.tsx           # Has ✕ close button
│   ├── RoutePlanner.tsx
│   └── TripPanel.tsx
└── pages/
    ├── Home.tsx
    ├── Login.tsx
    ├── Map.tsx                    # Main map page: wires all modes + geometry state + map pick overlay + routeActivityPositions
    ├── PaymentResultPage.tsx      # Handles Wompi redirect: ?status=APPROVED|DECLINED
    ├── PremiumPage.tsx            # Plan listing + Wompi checkout redirect
    ├── Register.tsx               # Referral code optional field
    ├── TripHistory.tsx            # Last 20 trips: route, date, duration, credits
    └── admin/
        ├── AdminLayout.tsx        # Sidebar (gray-900) + Outlet — NO Navbar + alert badge polling
        ├── AdminStats.tsx         # Dashboard: users/trips/reports/credits/top routes
        ├── AdminRouteAlerts.tsx   # Route update alerts: ≥3 ruta_real votes → regenerar/dismiss
        ├── AdminRoutes.tsx        # Bus routes CRUD + geometry editor + Regenerar
        ├── AdminUsers.tsx         # Users table + role/active/delete actions
        └── AdminCompanies.tsx     # Companies table + CRUD + routes viewer
```

#### CatchBusMode — "Cerca de ti" section

Above the filter tabs and search, CatchBusMode shows a **horizontal scroll of nearby route cards** fetched from `/api/routes/nearby?lat=X&lng=Y&radius=0.3` (300 m) when `userPosition` is available.

- Cards show: route name (where the bus goes), company name (secondary, gray), code badge, distance in meters
- Tap → same `handleSelectRoute` flow as selecting from the main list (goes to waiting view)
- Skeleton loading placeholders while fetching
- Section hidden if no nearby routes returned

#### CatchBusMode — 4 background monitors

Active while a trip is running (`view === 'active'`). All monitors start on trip begin and are cleared on trip end.

| Monitor | Interval | Trigger | Action |
|---------|----------|---------|--------|
| 1 — Auto-resolve trancón | 120 s | Bus moved > 200 m from report location | `PATCH /api/reports/:id/resolve`, clear ref |
| 2 — Desvío detection | 30 s | Off all route stops > 250 m for ≥ 90 s | Banner with 3 options: report, get off, ignore 5 min |
| 3 — Auto-cierre inactividad | 60 s | Movement < 50 m for ≥ 600 s | Modal "¿Sigues en el bus?"; auto-close after 120 s |
| 4 — Alertas de bajada | 15 s | Destination set; premium/admin auto-activate, free pays 5 cr | Prepare (400 m), Now (200 m + vibrate), Missed banners |

#### `api.ts` modules

| Export | Endpoints |
|--------|-----------|
| `authApi` | register, login, getProfile |
| `routesApi` | list, getById, search, nearby, create, update, delete, recommend, activeFeed, plan, regenerateGeometry, getActivity, toggleActive, snapWaypoints, scanBlog(skipManuallyEdited), processImports(skipManuallyEdited) |
| `routeAlertsApi` | getAlerts, getAlertsCount, dismissAlert |
| `stopsApi` | listByRoute, add, delete, deleteByRoute |
| `adminApi` | getCompanies |
| `reportsApi` | getNearby, create, confirm, resolve, getOccupancy, getRouteReports |
| `creditsApi` | getBalance, getHistory, spend |
| `tripsApi` | getActive, getCurrent, getActiveBuses, start, updateLocation, end |
| `usersApi` | getFavorites, addFavorite, removeFavorite |
| `paymentsApi` | getPlans, createCheckout |

#### Admin panel routes

| Path | Component | Description |
|------|-----------|-------------|
| `/admin` | — | Redirects to `/admin/stats` |
| `/admin/stats` | `AdminStats` | Dashboard: users/trips/reports/credits stats + top routes |
| `/admin/users` | `AdminUsers` | Users table: change role, toggle active, delete |
| `/admin/routes` | `AdminRoutes` | Bus routes CRUD + waypoint geometry editor (OSRM road-snap) + import mode toggle |
| `/admin/companies` | `AdminCompanies` | Companies CRUD + view associated routes |
| `/admin/route-alerts` | `AdminRouteAlerts` | Routes flagged by ≥3 users — mini-map (current geometry + reporter GPS), reporters table, actions |

#### Admin API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users?role=X` | List users (optional role filter) |
| GET | `/api/admin/users/:id` | Get user by ID |
| PATCH | `/api/admin/users/:id/role` | Change user role |
| PATCH | `/api/admin/users/:id/toggle-active` | Toggle user active state |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/stats` | Dashboard stats (users/trips/reports/credits/top routes) |
| GET | `/api/admin/companies` | List companies |
| GET | `/api/admin/companies/:id` | Get company + its routes |
| POST | `/api/admin/companies` | Create company |
| PUT | `/api/admin/companies/:id` | Update company |
| PATCH | `/api/admin/companies/:id/toggle-active` | Toggle company active state |
| DELETE | `/api/admin/companies/:id` | Delete company (fails 400 if has active routes) |

#### `adminService.ts` exports

Types: `AdminUser`, `UserRole`, `Company`, `CompanyRoute`, `CompanyInput`

Functions: `getUsers`, `updateUserRole`, `toggleUserActive`, `deleteUser`, `getCompanies`, `getCompanyById`, `createCompany`, `updateCompany`, `toggleCompanyActive`, `deleteCompany`

---

### Flutter Mobile (`flutter_app/`)

The Flutter app is the **primary mobile client** for MiBus. It connects to the same backend API (`api.mibus.co`) using JWT auth stored in `flutter_secure_storage`. It is feature-complete and targets Android (APK release builds).

#### Flutter stack

| Layer | Technology |
|-------|-----------|
| Framework | Flutter 3 + Dart |
| State management | Riverpod 2 (`flutter_riverpod`, sealed state classes + Notifiers) |
| HTTP | Dio 5 with auth interceptor |
| Navigation | GoRouter 14 (declarative, auth guards, ShellRoute) |
| Maps | flutter_map 7 + latlong2 (OpenStreetMap / CartoCDN tiles) |
| Real-time | socket_io_client 3 |
| Secure storage | flutter_secure_storage 9 |
| Persistence | shared_preferences 2 (onboarding flag) |
| Location | geolocator 13 + permission_handler 11 |
| Auth (Google) | google_sign_in 6 |
| Notifications | flutter_local_notifications 17 |

#### Architecture pattern

**MVVM + Repository** — strictly layered:

1. **Presentation** — Feature screens + widgets, consume Riverpod providers
2. **State** — Notifiers with sealed state classes (e.g. `TripIdle | TripLoading | TripActive | TripError`)
3. **Domain** — Immutable model classes with `fromJson` / `toJson`
4. **Data** — Repositories wrap remote sources; all results typed as `Result<T>` (Success | Failure)
5. **Core** — Location, socket, storage, theme, l10n, API client

All UI strings are in `lib/core/l10n/strings.dart` as `AppStrings` constants. Never hardcode strings in widgets.

#### Routing (`lib/app.dart`)

```
/loading          → SplashScreen (during AuthInitial / AuthLoading)
/onboarding       → OnboardingScreen (shown once on first launch via SharedPreferences)
/login            → LoginScreen
/register         → RegisterScreen
/map-pick         → MapPickScreen (full-screen crosshair to pick lat/lng)
/trip/confirm     → BoardingConfirmScreen (routeId, destLat?, destLng?)
/trip/stop-select → StopSelectScreen (routeId)
/profile/credits  → CreditsHistoryScreen
/profile/trips    → TripHistoryScreen

ShellRoute (BottomNavigationBar — 4 tabs):
  /map            → MapScreen         (tab 0)
  /planner        → PlannerScreen     (tab 1)
  /trip           → ActiveTripScreen  (tab 2)
  /trip/boarding  → BoardingScreen    (tab 2 — inside shell so nav bar visible)
  /profile        → ProfileScreen     (tab 3)
```

**Auth redirect logic:**
- `AuthInitial | AuthLoading` → `/loading`
- `Authenticated` → `/map` (redirects away from `/loading`, `/login`, `/onboarding`)
- `Unauthenticated | AuthError` → `/login`
- First launch (`onboarding_done` not set) → `/onboarding` (checked before auth)

**Important:** Use `context.push()` for sub-screens (credits, trips history) so back button appears. Use `context.go()` for tab-level navigation only.

#### Flutter file map

```
flutter_app/lib/
├── main.dart                        # ProviderScope + MiBusApp entry
├── app.dart                         # GoRouter + onboardingDoneProvider + MiBusApp widget
│
├── core/
│   ├── api/
│   │   ├── api_paths.dart           # Base URL + endpoint path constants
│   │   ├── api_client.dart          # Dio provider with interceptors
│   │   └── interceptors/
│   │       ├── auth_interceptor.dart    # Attaches JWT to every request
│   │       └── error_interceptor.dart   # Maps HTTP errors → AppError
│   ├── data/
│   │   ├── sources/                 # Raw API calls (Dio) — one file per domain
│   │   │   ├── auth_remote_source.dart
│   │   │   ├── routes_remote_source.dart
│   │   │   ├── stops_remote_source.dart
│   │   │   ├── reports_remote_source.dart
│   │   │   ├── trips_remote_source.dart
│   │   │   ├── credits_remote_source.dart
│   │   │   ├── payments_remote_source.dart
│   │   │   └── users_remote_source.dart
│   │   └── repositories/            # Business logic wrapping sources
│   │       ├── auth_repository.dart         # login, register, logout, profile, loginWithGoogle
│   │       ├── routes_repository.dart       # list, getById, search, nearby, plan, activity
│   │       ├── stops_repository.dart        # listByRoute
│   │       ├── reports_repository.dart      # create, confirm, resolve, getRouteReports
│   │       ├── trips_repository.dart        # start, updateLocation, end, current, history
│   │       ├── credits_repository.dart      # balance, history
│   │       ├── payments_repository.dart     # getPlans, createCheckout
│   │       └── users_repository.dart        # getFavorites, addFavorite, removeFavorite
│   ├── domain/models/               # Immutable model classes
│   │   ├── user.dart                # id, name, email, credits, role, premium status, referralCode
│   │   ├── bus_route.dart           # id, name, code, company, geometry (List<LatLng>), distanceMeters
│   │   ├── stop.dart                # id, route_id, name, latitude, longitude, stop_order
│   │   ├── report.dart              # type, lat/lng, confirmations, is_valid, confirmed_by_me
│   │   ├── active_trip.dart         # user position, destination, credits_earned, distance
│   │   ├── trip_history_item.dart   # route info, started_at, duration_minutes, credits_earned
│   │   ├── trip_end_result.dart     # credits, distance_meters, completion_bonus_earned
│   │   ├── credit_transaction.dart  # amount, type, description, created_at
│   │   ├── plan_result.dart         # route + nearestStop + origin/dest distances
│   │   ├── route_activity.dart      # active_count, last_activity_minutes, events[], positions[]
│   │   └── model_parsers.dart       # asInt/asString/asLatLngList helpers
│   ├── error/
│   │   ├── app_error.dart           # AppError(message, code) + AppError.fromDio()
│   │   └── result.dart              # sealed Result<T> { Success(data) | Failure(error) }
│   ├── l10n/
│   │   └── strings.dart             # ALL UI strings as AppStrings constants (Spanish)
│   ├── location/
│   │   └── location_service.dart    # getCurrentPosition(), distanceMeters() Haversine
│   ├── socket/
│   │   └── socket_service.dart      # connect/disconnect, joinRoute/leaveRoute, on/off/emit
│   ├── storage/
│   │   ├── secure_storage.dart      # readToken() / writeToken() / deleteToken()
│   │   └── onboarding_storage.dart  # isDone() / markDone() via SharedPreferences
│   └── theme/
│       ├── app_colors.dart          # Color palette: primary #2563EB, primaryDark #1E3A5F, success, warning, error
│       ├── app_theme.dart           # AppTheme.light() — Material 3 theme
│       └── app_text_styles.dart     # Text style definitions
│
├── features/
│   ├── auth/
│   │   ├── screens/
│   │   │   ├── splash_screen.dart       # Animated bus on road, shown during auth init
│   │   │   ├── onboarding_screen.dart   # 3-slide PageView (first launch only)
│   │   │   ├── login_screen.dart        # Email/password + Google Sign-In + link to register
│   │   │   └── register_screen.dart     # Name/email/password/phone + referral code + Google
│   │   └── providers/
│   │       ├── auth_state.dart          # sealed: AuthInitial | AuthLoading | Authenticated(user) | Unauthenticated | AuthErrorState
│   │       └── auth_notifier.dart       # login(), register(), logout(), loginWithGoogle(), _refreshFromProfile()
│   │
│   ├── map/
│   │   ├── screens/
│   │   │   ├── map_screen.dart          # flutter_map with all layers, FAB "Me subí", active feed bar
│   │   │   └── map_pick_screen.dart     # Full-screen map with fixed crosshair, reverse geocodes on confirm
│   │   ├── providers/
│   │   │   ├── map_state.dart           # sealed: MapLoading | MapReady(userPosition, buses, reports, activeFeedRoutes) | MapError
│   │   │   └── map_provider.dart        # initialize(), confirmReport(), selectedFeedRouteProvider
│   │   └── widgets/
│   │       ├── user_marker_layer.dart       # Green dot normally; bus 🚌 icon when isOnTrip=true
│   │       ├── bus_marker_layer.dart        # Real-time bus positions from socket
│   │       ├── report_marker_layer.dart     # Report pins with confirm tap
│   │       ├── active_feed_bar.dart         # Horizontal scroll of routes with recent activity
│   │       ├── plan_markers_layer.dart      # Origin (green) + destination (red) markers from planner state
│   │       └── active_route_bus_layer.dart  # Amber bus markers for active trips on selected route
│   │
│   ├── planner/
│   │   ├── screens/
│   │   │   └── planner_screen.dart      # Favorites scroll + origin/dest fields + nearby routes + results list
│   │   ├── providers/
│   │   │   ├── planner_state.dart       # sealed: PlannerIdle | PlannerLoading | PlannerResults | PlannerError
│   │   │   ├── planner_notifier.dart    # setOrigin(), setDestination(), planRoute(), reset(), searchAddress() via Nominatim
│   │   │   └── favorites_provider.dart  # AsyncNotifier for favorites list
│   │   ├── models/
│   │   │   └── nominatim_result.dart    # displayName, lat, lng — fromJson + coordinate-only constructor
│   │   └── widgets/
│   │       ├── address_search_field.dart  # Debounced autocomplete with map pick icon
│   │       └── plan_result_card.dart      # Route result card with distances + activity badge
│   │
│   ├── trip/
│   │   ├── screens/
│   │   │   ├── boarding_screen.dart         # Route list + nearby cards → opens RoutePreviewSheet
│   │   │   ├── boarding_confirm_screen.dart # Map preview (280px, interactive) + stop picker + map pick + reports
│   │   │   ├── stop_select_screen.dart      # Full stop list for destination selection
│   │   │   └── active_trip_screen.dart      # Trip view: map, reports, 4 monitors, "Me bajé" button
│   │   ├── providers/
│   │   │   ├── trip_state.dart              # sealed: TripIdle | TripLoading | TripActive(trip) | TripError | TripEnded(result)
│   │   │   └── trip_notifier.dart           # startTrip(), updateLocation(), endTrip(), all 4 monitors
│   │   └── widgets/
│   │       ├── route_preview_sheet.dart     # Bottom sheet with 340px map before boarding confirm
│   │       ├── route_reports_list.dart      # Active reports on route with confirm button
│   │       ├── report_create_sheet.dart     # Form to create a new report
│   │       ├── route_update_sheet.dart      # Vote trancon/ruta_real on a route
│   │       └── trip_summary_sheet.dart      # End-of-trip credits/distance/bonus summary
│   │
│   ├── profile/
│   │   ├── screens/
│   │   │   ├── profile_screen.dart          # Name/email/role/premium chip + credits + links
│   │   │   ├── credits_history_screen.dart  # Credit transaction history list
│   │   │   └── trip_history_screen.dart     # Last 20 trips with route/date/duration/credits
│   │   ├── providers/
│   │   │   ├── profile_state.dart           # sealed: ProfileLoading | ProfileReady(user, balance) | ProfileError
│   │   │   └── profile_notifier.dart        # load() — fetches user profile + credit balance
│   │   └── widgets/
│   │       ├── premium_card.dart            # Premium subscription card with Wompi checkout link
│   │       └── credit_history_tile.dart     # Single credit transaction row
│   │
│   └── shell/
│       └── main_shell.dart          # BottomNavigationBar (4 tabs) + resets planner on map tab tap
│
└── shared/
    ├── widgets/
    │   ├── app_button.dart          # AppButton.primary / .destructive / .outlined
    │   ├── app_text_field.dart      # Labeled text input with error state
    │   ├── app_snackbar.dart        # AppSnackbar.show(context, msg, SnackbarType.info|error|success)
    │   ├── loading_indicator.dart   # Centered CircularProgressIndicator
    │   ├── error_view.dart          # Error message + retry button
    │   ├── empty_view.dart          # Icon + message for empty states
    │   ├── route_code_badge.dart    # Colored badge for route code (D8, D12...)
    │   ├── distance_chip.dart       # Distance with color: green ≤300m / amber ≤600m / red >600m
    │   ├── route_activity_badge.dart # "N usuarios activos · hace X min"
    │   └── route_polyline_layer.dart # flutter_map layer for blue route geometry polyline
    └── extensions/
        ├── datetime_extensions.dart # .formatDate(), .timeAgo()
        └── double_extensions.dart   # .toDistanceString() → "250 m" or "1.2 km"
```

#### Key flows in the Flutter app

**Onboarding (first launch):**
`main.dart` → router checks `onboardingDoneProvider` (SharedPreferences `onboarding_done`) → if false → `/onboarding` (3 slides) → on finish → marks done → `/loading` → auth check

**Auth init:**
`AuthNotifier.build()` → `AuthLoading` → `_refreshFromProfile()` → JWT in SecureStorage → `/api/auth/profile` → `Authenticated(user)` or `Unauthenticated`

**"Me subí" (boarding) flow:**
1. FAB on MapScreen → `context.go('/trip/boarding')`
2. `BoardingScreen` — shows all routes + nearby (300m) → tap route → `RoutePreviewSheet` (340px map + geometry)
3. Confirm in sheet → `context.push('/trip/confirm?routeId=X')`
4. `BoardingConfirmScreen` — shows 280px interactive map (polyline + user position + dest pin), stop picker with map-pick option
5. Tap "Me monté" → `tripNotifier.startTrip(routeId, destinationStopId?)` → `TripActive` → `context.go('/trip')`

**Active trip (`ActiveTripScreen`) — 4 monitors:**
| Monitor | Interval | Trigger | Action |
|---------|----------|---------|--------|
| Auto-resolve trancón | 120s | Bus moved >1 km from report | `PATCH /api/reports/:id/resolve` |
| Desvío detection | 30s | Off-route >250m for ≥90s | Banner: report / get off / ignore 5min |
| Inactivity | 60s | No movement <50m for ≥600s | Modal "¿Sigues en el bus?" — auto-close 120s |
| Dropoff alert | 15s | Destination set; premium=free, free=5cr | Prepare (400m) → Bájate ya (200m + vibrate) → Missed |

**Trip planner flow:**
1. `PlannerScreen` — auto-sets origin to GPS on load
2. Address search → Nominatim API (bounded BQ bbox) with `NominatimResult`
3. Map pick icon on field → `/map-pick` → crosshair → reverse geocode → back with result
4. "Buscar rutas" → `POST /api/routes/plan` → `PlannerResults`
5. Tap result → `context.push('/trip/confirm?routeId=X&destLat=Y&destLng=Z')`
6. On map tab tap → `plannerNotifier.reset()` clears markers from map

**Socket.io in Flutter:**
- `socketServiceProvider` — singleton, connects with JWT on app start
- `joinRoute(id)` / `leaveRoute(id)` — called in `BoardingConfirmScreen.initState/dispose` and `ActiveTripScreen`
- Events: `route:new_report`, `route:report_confirmed`, `route:report_resolved` → reload reports / show toast

#### Flutter specs (`flutter_specs/`)

Specs are numbered markdown files describing feature implementations for Codex:

| Spec | Title |
|------|-------|
| 00 | Overview |
| 01 | Trip history |
| 02 | Trip summary distance |
| 03 | Report resolved socket |
| 04 | Route activity |
| 05 | Referral code |
| 06 | Route update voting |
| 07 | Parity fixes |
| 08 | Boarding reports |
| 09 | Map trip visuals |
| 10 | Planner nearby boarding |
| 11 | Premium benefits |
| 12 | Map pick mode |
| 13 | Boarding map preview (280px interactive, origin/dest pins, map pick for stop) |
| 14 | Route preview bottom sheet (340px map before boarding confirm) |
| 15 | Splash screen (animated bus on road, primaryDark background) |
| 16 | Navigation fixes (boarding in ShellRoute, planner reset on map tab) |
| 17 | Back button fix (context.push for profile sub-screens) |
| 18 | Google Sign-In (google_sign_in package, POST /api/auth/google) |
| 19 | Onboarding (3-slide PageView, shown once via SharedPreferences) |

**When writing new specs for Codex:**
- Reference existing file paths and widget/class names exactly
- Show `old_string` → `new_string` diffs where modifying existing code
- Always end with `flutter analyze` verification step
- Keep specs focused — one feature per file

---

## Database Schema

### users
`id, name, email, password, phone, credits (default 50), is_premium, trial_expires_at, premium_expires_at, reputation, created_at`
**Migrations added:** `role VARCHAR(20) DEFAULT 'free' CHECK (role IN ('admin','premium','free'))`, `is_active BOOLEAN DEFAULT TRUE`

### companies
`id, name, nit, phone, email, is_active (default true), created_at`

### routes
`id, name, code (UNIQUE), company, first_departure, last_departure, frequency_minutes, is_active, created_at`
**Migrations added:** `company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`, `geometry JSONB DEFAULT NULL`, `route_alert_reviewed_at TIMESTAMPTZ DEFAULT NULL`, `manually_edited_at TIMESTAMPTZ DEFAULT NULL`

`manually_edited_at` is set to `NOW()` when admin edits a route via `PUT /api/routes/:id`. Cleared to `NULL` when `POST /api/routes/:id/regenerate-geometry` runs. Used by import system to skip manually-edited routes.

### route_update_reports
`id, route_id (→ routes CASCADE), user_id (→ users CASCADE), tipo VARCHAR(20) CHECK ('trancon'|'ruta_real'), created_at` — `UNIQUE(route_id, user_id)`
User votes that the bus route has changed or is stuck. ≥3 `ruta_real` votes trigger an admin alert.

### stops
`id, route_id, name, latitude, longitude, stop_order, created_at`

### reports
`id, user_id, route_id, type, latitude, longitude, description, is_active, confirmations, created_at, expires_at (NOW() + 30 min)`
**Migrations added:** `report_lat DECIMAL(10,8)`, `report_lng DECIMAL(11,8)`, `resolved_at TIMESTAMPTZ DEFAULT NULL`, `credits_awarded_to_reporter BOOLEAN DEFAULT FALSE`

### report_confirmations
`id, report_id (→ reports), user_id (→ users), created_at` — `UNIQUE(report_id, user_id)`

### credit_transactions
`id, user_id, amount, type, description, created_at`

### active_trips
`id, user_id, route_id, current_latitude, current_longitude, destination_stop_id, started_at, last_location_at, ended_at, credits_earned, is_active`
**Migrations added:** `total_distance_meters DECIMAL(10,2) DEFAULT 0` — accumulated on every `updateLocation` call via Haversine; used to gate the +5 completion bonus (requires ≥2 km)

### user_favorite_routes
`id, user_id (→ users), route_id (→ routes), created_at` — `UNIQUE(user_id, route_id)`

### payments
`id, user_id (→ users ON DELETE SET NULL), wompi_reference VARCHAR(100) UNIQUE, plan VARCHAR(50), amount_cents INTEGER, status VARCHAR(20) DEFAULT 'pending' CHECK (pending|approved|declined|voided|error), wompi_transaction_id VARCHAR(100), created_at, updated_at`

---

## WebSocket Channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `bus:location` | server → all | Transmits active bus locations |
| `bus:joined` | server → all | User boarded a bus |
| `bus:left` | server → all | User got off a bus |
| `route:nearby` | server → all | Nearby routes for a location |
| `join:route` | client → server | Join route room when trip starts |
| `leave:route` | client → server | Leave route room when trip ends |
| `route:new_report` | server → room | New report created on the route |
| `route:report_confirmed` | server → room | Report confirmation count updated |
| `route:report_resolved` | server → room | Report resolved — payload: `{ reportId, type, duration_minutes }` |

---

## Main App Flow (Core UX)

### 1. Open the app
- Show user's current location on the map (GPS)
- Show nearby routes within 500 meters
- Show active buses reported by other users in real time

### 2. Trip planner
- User types destination (or picks on map via crosshair overlay + Confirm button)
- Start point = current GPS location, or typed address
- Geocoding: **Nominatim** (primary, `bounded=1`, strict BQ metro bbox) + **Geoapify** fallback. Handles Colombian addresses with "N" separator (e.g. "Cr 52 N 45" → "Cr 52 #45"). Post-fetch filter `isInMetroArea()` removes results outside BQ area. Overpass API for street intersections.
- Before entering destination: **"Buses en tu zona"** panel shows routes ≤300 m from origin — tap any to preview full geometry on map; tapping again deselects
- App finds routes connecting origin → destination via `/api/routes/plan` (geometry-based, not stop-based)
- Shows multiple options ordered by `origin_distance + dest_distance`; distances color-coded (green ≤300 m, amber 300–600 m, red >600 m)
- Selecting a result clips the route geometry between boarding stop and dropoff stop and draws it on the map (blue polyline); fallback to full geometry, then all stops
- Map pick mode: fixed crosshair at screen center, instruction banner, Confirm + Cancel buttons overlay — `BottomSheet` hidden via CSS `display:none` (not unmounted) to preserve input state

### 3. "I boarded" flow
- User taps "Me subí" (I boarded)
- Selects which route/bus it is
- Optionally sets drop-off stop
- Phone transmits bus location in real time via WebSocket
- Other users see the bus moving on the map
- User earns +1 credit per minute transmitting
- 4 background monitors activate (see CatchBusMode section)

### 4. "I got off" flow
- User taps "Me bajé" (I got off)
- Stops transmitting location
- Shows trip summary with credits earned
- Option to rate the trip

### 5. Drop-off alerts (Monitor 4)
- Auto-activated for premium/admin; costs 5 credits for free users
- Prepare banner at 400 m from destination
- "Bájate ya" alert + vibration at 200 m
- Missed alert if bus passes destination

---

## Business Rules

- New users get **50 credits** and a **14-day premium trial** on registration.
- Reports expire after **30 minutes**.
- Premium users skip all credit checks.
- Premium plan: **$4,900 COP/month** (Wompi payment link, single-use, manual renewal). On approval: `is_premium=true`, `role='premium'`, `premium_expires_at` extended 30 days, +50 bonus credits. Webhook verified via SHA256 signature.
- Credit packages: 100/$1,900 | 300/$4,900 | 700/$9,900 | 1,500/$17,900 COP.

### Credits earned
| Action | Credits | Notes |
|--------|---------|-------|
| Report (outside active trip) | +3–5 | Immediate, per `CREDITS_BY_TYPE` |
| Report during trip, alone on bus | +1 | Immediate |
| Report during trip, others on bus | 0 → +2 | +2 when report reaches 50%+ confirmations; +1 auto on trip end if no confirmation |
| Confirm another user's report | +1 | Max 2 per trip; confirmer must have active trip on same route |
| Report no service | +4 | |
| Invite a friend | +25 | |
| 7-day reporting streak | +30 | |
| Welcome bonus (registration) | +50 | |
| Per minute transmitting bus location | +1 | Max 15 credits per trip from location (speed check: must move >100m/30s) |
| Complete full trip | +5 | |

**Occupancy report rules:**
- Only two states: `lleno` (🔴 Bus lleno) and `bus_disponible` (🟢 Hay sillas)
- Per occupancy type, only the first report per trip earns credits (tracked via `occupancyCreditedRef` in frontend + `credit_transactions` check in backend)
- 10-minute cooldown between occupancy reports on the same route

### Credits spent
| Feature | Cost | Notes |
|---------|------|-------|
| Stop drop-off alert | 5 | Auto-free for premium/admin; free users pay per trip |

---

## Development Phases

### Phase 1 ✅ Complete
- Express + TypeScript + Docker
- Auth with 14-day premium trial + role system (admin / premium / free)
- Routes, stops, reports, credits modules
- React web with map
- Auto-seed of Barranquilla real bus routes

### Phase 2 ✅ Complete
**Admin panel:**
- Role-based access control (`requireRole` middleware + `AdminRoute` guard)
- Admin layout with sidebar (no Navbar)
- `/admin/users` — full users table with role change, toggle active, delete
- `/admin/routes` — bus routes CRUD + geometry editor (drag points, Regenerar per row)
- `/admin/companies` — companies CRUD with routes viewer
- Navbar link "⚙️ Administración" visible only to admins

**Real-time user flow:**
- GPS location on map + nearby routes via active-feed endpoint
- Trip planner (`PlanTripMode`) — Nominatim + Overpass autocomplete + `/api/routes/plan`
- "Me subí / Me bajé" flow (`CatchBusMode`) — full state machine
- 4 background monitors: auto-resolve trancón, desvío detection, auto-cierre, drop-off alerts
- Favorites system (`/api/users/favorites` — add, remove, list)
- Self-resolve reports (`PATCH /api/reports/:id/resolve`)
- Route geometry via OSRM (2-attempt: full route → segment-by-segment + straight-line fallback)
- Geometry displayed on map: green polyline for active trip, blue for feed route selection

### Phase 2.5 ✅ Complete
**"Cerca de ti" in CatchBusMode:**
- Horizontal scroll of route cards above the filter/search, auto-fetched from `/api/routes/nearby` when GPS available
- Cards show: route name → company name → code badge → distance in meters
- Tap → direct boarding flow (same as selecting from list)

**"Buses en tu zona" in PlanTripMode:**
- Vertical list of routes ≤500 m from origin, shown before destination is entered
- Updates automatically when origin changes (GPS or typed address)
- Tap → previews route geometry on map immediately (uses `geometry` from `/nearby` response; fallback to stops fetch if null)
- Mini info bar: "¿Va a tu destino? Escríbelo arriba ↑" + ✕ to clear
- Race condition guard: `previewRouteIdRef` ensures stale async results never overwrite a newer selection
- Section disappears once plan results are shown

**Map geometry fixes:**
- "← Volver" in `Map.tsx` trip mode now clears `activeTripGeometry` + `catchBusBoardingStop`
- Route clipping in `handleSelectRoute` falls back to full geometry (then all stops) if segment indices are invalid
- Removed "Cómo llegar a pie" (Google Maps external link) from waiting view

### Phase 3 ✅ Complete
- Deploy to Vercel + Railway
- Connect mibus.co domain (Vercel → mibus.co, Railway → api.mibus.co)
- Wompi payments — `paymentController.ts`, `paymentRoutes.ts`, `PremiumPage.tsx`, `PaymentResultPage.tsx`
  - `GET /api/payments/plans` — returns monthly plan ($4,900 COP)
  - `POST /api/payments/checkout` — creates Wompi payment link (single-use)
  - `POST /api/payments/webhook` — SHA256 signature verification → activates premium + +50 credits bonus
- `payments` table in DB tracks all transactions with status
- Navbar shows "⚡ Premium" link for non-premium users; "✓ Premium" badge for active premium

### Phase 3.5 ✅ Complete
**Smart report confirmation system:**
- Removed `casi_lleno` — occupancy is now binary: `lleno` / `bus_disponible` (both worth +3 outside trips)
- Deferred credit system for trip reports: +1 if alone, 0 if others present (waits for confirmations)
- Confirmation system: confirmer earns +1 (max 3/trip), reporter earns +2 when 50%+ of other passengers confirm
- Report validity: `activeUsers <= 1` → always valid; `activeUsers >= 2` → needs `ceil((activeUsers-1) × 0.5)` confirmations
- Auto-award: reporter gets +1 on trip end for any report that never got confirmed
- Real-time via Socket.io rooms (`route:{id}`): new reports and confirmations appear instantly to all passengers on the same bus
- New table: `report_confirmations` — prevents double confirmation per user per report
- New column: `reports.credits_awarded_to_reporter` — prevents double payment to reporter

### Phase 3.6 ✅ Complete
**Geocoding & UX improvements:**
- Replaced Photon (no Spanish support) with **Nominatim** primary + **Geoapify** fallback for address autocomplete
- Colombian address normalization: `N` separator (e.g. "Cr 52 N 45" → "Cr 52 #45"); flexible Overpass regex for street queries
- Post-fetch `isInMetroArea()` filter + Nominatim `bounded=1` + strict bbox `[10.82,-74.98,11.08,-74.62]` — no results outside BQ metro
- Postal code detection (`isPostalCode()`) — filters out 080xxx codes from suggestions
- Map pick mode redesigned: fixed crosshair at screen center, instruction banner, Confirm + Cancel buttons; `BottomSheet` uses CSS `display:none` to preserve state while picking
- Nearby radius reduced 500 m → **300 m** in both CatchBusMode and PlanTripMode
- Distance color-coding in plan results: green ≤300 m, amber 300–600 m, red >600 m + "(lejos)"
- ReportButton now has ✕ close button
- `MapView.tsx`: added `CenterTracker` component (tracks map center on `moveend`/`zoomend` via `useMapEvents`)

**Geometry-based trip planner (backend rewrite):**
- `getPlanRoutes` completely rewritten — searches by route geometry proximity, not stop proximity
- `haversineKm()` and `minDistToGeometry()` helpers in `routeController.ts`
- `ORIGIN_THRESHOLD_KM = 0.25` (250 m), `DEST_THRESHOLD_KM = 0.45` (450 m)
- Direction check: destination must appear after origin index along the polyline
- Fallback to stop-based (0.8 km) for routes without geometry
- Fixes "999 m boarding distance" issue — origin distance now always ≤ 250 m for geometry-matched routes

**Docker:**
- `web/Dockerfile.dev` — Node.js 20 Alpine, runs `npm run dev` (replaces nginx multi-stage that caused `npm: not found`)
- `backend/Dockerfile.dev` — Node.js 20 Alpine, `npm install` (all deps incl. devDeps), runs `npm run dev`
- `docker-compose.yml` uses `dockerfile: Dockerfile.dev` for both web and backend services
- Production deploy (Railway) uses `backend/Dockerfile` (multi-stage, `--omit=dev`, runs compiled JS)

### Phase 3.7 ✅ Complete

**Trip planner destination threshold:**
- `DEST_THRESHOLD_KM` raised from `0.45` → `1.0` (1 km) — catches routes that drop off nearby but not right at the destination (e.g. D8 Lolaya at 618 m)

**Bus icon on active trip:**
- `MapView.tsx`: user location marker changes to a green pulsing 🚌 icon (`USER_ON_BUS_ICON`) when the user has an active trip (`activeTripGeometry` is set)
- `ACTIVITY_BUS_ICON` (amber pulsing 🚌) rendered for each active position from `routeActivityPositions` prop — shows other active buses on the selected route

**Route activity feature — "¿Hay actividad en esta ruta?"**
- New backend endpoint `GET /api/routes/:id/activity` (auth): queries `active_trips` + `reports` from last hour, returns:
  - `active_count` — users currently on this route
  - `last_activity_minutes` — minutes since last boarding/alighting/report (null if >60 min)
  - `events[]` — boarding, alighting and report events with timestamps and confirmations
  - `active_positions[]` — `[lat, lng]` of currently active trips for map rendering
- `routesApi.getActivity(id)` added to `api.ts`
- **PlanTripMode**: activity fetched on `handleSelectRoute` and `handleNearbyPreview`; shown as collapsible panel in plan result cards and inline in "Buses en tu zona" selected card
- **CatchBusMode**: activity fetched on `handleSelectRoute`; shown as summary card in the waiting view (between route info and boarding stop)
- **MapView**: `routeActivityPositions` prop renders amber 🚌 markers for active trips on the previewed route
- **Map.tsx**: `routeActivityPositions` state wires PlanTripMode → MapView

**Route update alert system:**
- Passengers can flag a route as `trancon` (stuck in traffic) or `ruta_real` (real route differs from map)
- New table `route_update_reports` — one vote per user per route (upsert)
- When ≥3 users flag `ruta_real` in 30 days → admin alert is triggered
- New admin page `/admin/route-alerts` (`AdminRouteAlerts.tsx`) — shows alert cards, two actions per route: "Regenerar geometría y marcar revisada" or "Marcar como revisada"
- `AdminLayout.tsx` sidebar shows red badge with unreviewed count (polls every 60 s)
- `routeAlertsApi` added to `api.ts`: `getAlerts`, `getAlertsCount`, `dismissAlert`
- New DB column `routes.route_alert_reviewed_at` tracks when admin last reviewed

### Phase 3.8 ✅ Complete

**Waypoint geometry editor with road snapping:**
- New endpoint `POST /api/routes/snap-waypoints` (admin): receives `{waypoints: [lat,lng][]}`, calls OSRM, returns full road-snapped geometry
- `routesApi.snapWaypoints(waypoints)` added to `api.ts`
- AdminRoutes.tsx geometry editor completely reworked:
  - "✏️ Editar trazado por calles" extracts ~12 evenly-spaced orange waypoint markers from existing geometry
  - Drag any waypoint → calls snap endpoint → polyline updates following real streets
  - Click on empty map → adds new waypoint at that position + snaps
  - Click on waypoint → removes it + snaps (min 2 waypoints)
  - "⏳ Calculando ruta por calles…" indicator while OSRM responds
  - "🔄 Resetear a OSRM" re-extracts waypoints from the OSRM geometry
- `snapAndUpdate(waypoints)` useCallback; fallback to raw waypoints if OSRM fails
- `waypointsRef` keeps waypoint state accessible inside Leaflet drag events

**AdminRouteAlerts visual comparison:**
- `getRouteUpdateAlerts` now returns per alert: `geometry` (current DB polyline), `reporters[]` ({user_name, tipo, created_at}), `reporter_positions[]` (last GPS of reporters in past 7 days)
- `AdminRouteAlerts.tsx` collapsible "Ver trazado y reportantes" panel per alert:
  - `RouteMapPreview` Leaflet sub-component: blue polyline = current DB route, red pulsing dots = reporter GPS positions, green/red dots = start/end markers, legend
  - Reporters table: name | tipo badge | relative time
- Actions: "Regenerar desde paradas" | "✏️ Editar trazado manualmente" → `/admin/routes` | "Ya revisé, marcar cerrada"

**Import protection (manually_edited_at):**
- New DB column `routes.manually_edited_at TIMESTAMPTZ` — set `NOW()` on `PUT /api/routes/:id`, cleared `NULL` on `regenerateGeometry`
- `blogScraper.ts`: `ScanOptions.skipManuallyEdited` — skips existing routes with `manually_edited_at IS NOT NULL`; `ScanResult` now includes `skipped` count
- `routeProcessor.ts`: `ProcessOptions.skipManuallyEdited` — skips pending routes with `manually_edited_at IS NOT NULL`; `ProcessResult` now includes `skipped` count
- `adminController.ts`: reads `skipManuallyEdited` from `req.body` and passes to both services
- `api.ts`: `scanBlog(skipManuallyEdited)`, `processImports(skipManuallyEdited)`
- `AdminRoutes.tsx`:
  - Toggle UI: **🔒 Solo nuevas** (default) / **🔄 Todas** — controls `importMode` state
  - Routes with `manually_edited_at` show `✏️ manual` amber badge in the table with tooltip date
  - Result messages show omitted count: "3 omitidas (editadas)"

### Phase 3.9 ✅ Complete

**Anti-fraud trip system:**
- 5-minute cooldown between trips: `startTrip` queries last `ended_at` — returns 429 with `cooldown_seconds` if < 300 s
- Completion bonus gated on distance: `+5 credits` only if `total_distance_meters >= 2000` (2 km); prevents fast re-board farming
- New DB column `active_trips.total_distance_meters` — accumulated via `haversineMeters()` on every `updateLocation`
- `endTrip` response includes `distance_meters` (rounded) and `completion_bonus_earned` (boolean)
- `CatchBusMode.tsx` summary view shows distance (km if ≥1000 m) and note if < 2 km

**Rate limiting (`express-rate-limit` v7):**
- `authLimiter` (20 req / 15 min) — applied only to `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/google` (brute-force protection)
- `reportLimiter` (15 req / 5 min) — applied to all `/api/reports` (spam prevention for credit farming)
- `generalLimiter` (300 req / 1 min) — applied to all other route groups

**Zombie trip cron:**
- `setInterval` every 30 min in `index.ts` closes trips with `is_active = true` and no location update for > 4 hours
- Also runs once at startup via `schema.ts` migration block

**Trancón resolution notifications:**
- `resolveReport` calculates `duration_minutes` from `resolved_at - created_at`
- Emits `route:report_resolved` to Socket.io room `route:{route_id}` with `{ reportId, type, duration_minutes }`
- Monitor 1 (auto-resolve) threshold raised 200 m → **1 km** — bus must move > 1 km from report location
- Active trip socket: `route:report_resolved` removes report from list + shows toast with duration
- Waiting view socket: new `useEffect` on `[view, selectedRoute?.id]` — joins/leaves route room, shows toast when trancón on the waited route is resolved

**Admin stats dashboard:**
- New page `/admin/stats` (`AdminStats.tsx`) — first page on admin login (sidebar Dashboard)
- `GET /api/admin/stats` (admin): 6 parallel queries — users (total/active/premium/new_this_week), trips (total/today/this_week/active_now), reports (total/today/this_week), credits (earned_today/earned_total), active_now, top_routes last 24h
- `adminApi.getStats()` in `api.ts`
- `/admin` redirect changed to `/admin/stats`

**Trip history page:**
- New page `/trips/history` (`TripHistory.tsx`) — linked from `/profile`
- `GET /api/trips/history`: last 20 completed trips with route info + `duration_minutes`
- Shows: route code badge, route name, date, duration, credits earned

**Referral code UI:**
- `Register.tsx` shows optional referral code field — awards +25 credits to referrer
- `Profile.tsx` shows user's own referral code with copy button

### Phase 4 — Flutter Mobile (In Progress)
**Flutter app (`flutter_app/`) — feature-complete, producing release APKs:**
- Full auth flow: email/password + Google Sign-In + onboarding
- Animated splash screen (bus traveling on road)
- Trip planner with Nominatim geocoding + map pick mode
- "Me subí" boarding flow: route list → map preview sheet → boarding confirm with interactive map
- Active trip with 4 background monitors (auto-resolve, desvío, inactivity, dropoff alerts)
- Real-time reports + Socket.io rooms per route
- Credits history + trip history (with back button navigation)
- Premium card with Wompi checkout
- Favorites system
- Route activity badges

**Pending (Flutter):**
- Firebase push notifications (flutter_local_notifications already installed)
- Google Play publishing (requires google-services.json + SHA-1 Firebase setup)
- Wompi in-app payment flow (currently opens browser)
- Alliance with AMB and SIBUS Barranquilla
