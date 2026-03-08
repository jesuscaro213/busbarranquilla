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
| Mobile | React Native 0.81 + Expo 54 (early stage) |
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

### Mobile (`mobile/`)
```bash
npm start         # Expo dev server
npm run android
npm run ios
npm run web
```

---

## Architecture

### Backend (`backend/src/`)

**Entry point** — `index.ts` creates the Express app, wraps it in an HTTP server for Socket.io, registers CORS + JSON middleware, mounts all route groups, initializes DB + schema, then starts listening.

**Route groups** (all prefixed `/api/`):
- `auth` → register, login, profile
- `routes` → bus route CRUD + search + nearby + active feed + trip planner + geometry
- `stops` → stops per route (CRUD)
- `reports` → create report, list nearby (geolocation), confirm, resolve
- `credits` → balance, history, spend
- `trips` → start trip, update location, end trip, current trip
- `users` → favorites (add, remove, list)
- `admin` → users CRUD + companies CRUD (requires `role = 'admin'`)

**Middleware chain for protected routes:**
- Public: no middleware
- Authenticated: `authMiddleware` (JWT → attaches `req.userId` + `req.userRole`)
- Admin only: `authMiddleware` + `requireRole('admin')` (from `middlewares/roleMiddleware.ts`)

**DB init** — `config/database.ts` holds the pg Pool; `config/schema.ts` runs `CREATE TABLE IF NOT EXISTS` on startup, then runs safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for new fields, then auto-seeds routes if the routes table is empty.

**Credit flow** — creating or confirming a report triggers `credit_transactions` via `awardCredits()` in `creditController.ts`. Premium users skip credit checks.

**Reports** expire in 30 minutes (`expires_at`). `/api/reports/nearby` filters by radius using Haversine formula. Reports can be self-resolved via `PATCH /api/reports/:id/resolve` (sets `is_active = false`, `resolved_at = NOW()`).

**Route geometry** — stored as JSONB in `routes.geometry`. On create/update, the backend calls OSRM (two-attempt strategy: full route first, then segment-by-segment with straight-line fallback). Geometry can be regenerated on demand via `POST /api/routes/:id/regenerate-geometry`. The `pg` library auto-parses JSONB to `[number, number][]` — no manual JSON.parse needed in frontend.

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
├── controllers/
│   ├── adminController.ts   # Users CRUD + Companies CRUD
│   ├── authController.ts    # register, login, profile
│   ├── creditController.ts  # balance, history, spend, awardCredits()
│   ├── recommendController.ts # Route recommendations
│   ├── reportController.ts  # create, nearby, confirm, resolveReport
│   ├── routeController.ts   # CRUD + search + nearby + activeFeed + getPlanRoutes + regenerateGeometry
│   ├── stopController.ts    # CRUD per route
│   ├── tripController.ts    # start, updateLocation, end, active buses, getTripCurrent
│   └── userController.ts    # listFavorites, addFavorite, removeFavorite
├── middlewares/
│   ├── authMiddleware.ts    # JWT verify → req.userId, req.userRole
│   ├── creditMiddleware.ts  # Credit check for premium features
│   └── roleMiddleware.ts    # requireRole(...roles) factory
├── routes/
│   ├── adminRoutes.ts
│   ├── authRoutes.ts
│   ├── creditRoutes.ts
│   ├── reportRoutes.ts
│   ├── routeRoutes.ts
│   ├── stopRoutes.ts
│   ├── tripRoutes.ts
│   └── userRoutes.ts        # /api/users/favorites
└── scripts/
    └── seedRoutes.ts        # Barranquilla routes + stops seed data
```

#### New API endpoints (added in Phase 3.5)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reports/route/:routeId` | ✅ | Active reports for a route with `confirmed_by_me`, `is_valid`, `needed_confirmations` — only returns reports from other users |

#### New API endpoints (added in Phase 2)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/routes/active-feed` | ✅ | Up to 8 routes with reports in last 60 min |
| GET | `/api/routes/plan?destLat=X&destLng=Y` | ✅ | Routes with stops ≤1 km from destination |
| POST | `/api/routes/:id/regenerate-geometry` | admin | Re-fetch OSRM geometry for a route |
| GET | `/api/trips/current` | ✅ | Active trip for current user (`{ trip: null }` if none) |
| PATCH | `/api/reports/:id/resolve` | ✅ | Self-resolve own report |
| GET | `/api/users/favorites` | ✅ | List favorite routes |
| POST | `/api/users/favorites` | ✅ | Add route to favorites `{ route_id }` |
| DELETE | `/api/users/favorites/:routeId` | ✅ | Remove route from favorites |

---

### Web (`web/src/`)

**Routing** — `App.tsx` uses React Router v6 with two nested route groups:
- **Public layout** (`PublicLayout`) — renders `<Navbar />` + `<Outlet />`. Covers `/`, `/map`, `/login`, `/register`.
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
│   ├── api.ts                     # axios instance + all API modules
│   ├── adminService.ts            # Admin-specific API (users + companies)
│   └── socket.ts                  # Socket.io client
├── components/
│   ├── AdminRoute.tsx             # Layout route guard (role check → Outlet)
│   ├── CatchBusMode.tsx           # "Me subí/bajé" flow + 4 background monitors
│   ├── CreditBalance.tsx
│   ├── MapView.tsx                # Leaflet map: stops, feed routes, active trip geometry
│   ├── Navbar.tsx                 # Shows ⚙️ Administración for admin role
│   ├── NearbyRoutes.tsx
│   ├── PlanTripMode.tsx           # Trip planner: Nominatim autocomplete + /plan endpoint
│   ├── ReportButton.tsx
│   ├── RoutePlanner.tsx
│   └── TripPanel.tsx
└── pages/
    ├── Home.tsx
    ├── Login.tsx
    ├── Map.tsx                    # Main map page: wires all modes + geometry state
    ├── Register.tsx
    └── admin/
        ├── AdminLayout.tsx        # Sidebar (gray-900) + Outlet — NO Navbar
        ├── AdminRoutes.tsx        # Bus routes CRUD + geometry editor + Regenerar
        ├── AdminUsers.tsx         # Users table + role/active/delete actions
        └── AdminCompanies.tsx     # Companies table + CRUD + routes viewer
```

#### CatchBusMode — "Cerca de ti" section

Above the filter tabs and search, CatchBusMode shows a **horizontal scroll of nearby route cards** fetched from `/api/routes/nearby?lat=X&lng=Y&radius=0.5` when `userPosition` is available.

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
| 4 — Alertas de bajada | 15 s | Destination set; premium/admin auto-activate, free pays 12 cr | Prepare (400 m), Now (200 m + vibrate), Missed banners |

#### `api.ts` modules

| Export | Endpoints |
|--------|-----------|
| `authApi` | register, login, getProfile |
| `routesApi` | list, getById, search, nearby, create, update, delete, recommend, activeFeed, plan, regenerateGeometry |
| `stopsApi` | listByRoute, add, delete, deleteByRoute |
| `adminApi` | getCompanies |
| `reportsApi` | getNearby, create, confirm, resolve, getOccupancy, getRouteReports |
| `creditsApi` | getBalance, getHistory, spend |
| `tripsApi` | getActive, getCurrent, getActiveBuses, start, updateLocation, end |
| `usersApi` | getFavorites, addFavorite, removeFavorite |

#### Admin panel routes

| Path | Component | Description |
|------|-----------|-------------|
| `/admin` | — | Redirects to `/admin/users` |
| `/admin/users` | `AdminUsers` | Users table: change role, toggle active, delete |
| `/admin/routes` | `AdminRoutes` | Bus routes CRUD + geometry editor + Regenerar per row |
| `/admin/companies` | `AdminCompanies` | Companies CRUD + view associated routes |

#### Admin API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users?role=X` | List users (optional role filter) |
| GET | `/api/admin/users/:id` | Get user by ID |
| PATCH | `/api/admin/users/:id/role` | Change user role |
| PATCH | `/api/admin/users/:id/toggle-active` | Toggle user active state |
| DELETE | `/api/admin/users/:id` | Delete user |
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

## Database Schema

### users
`id, name, email, password, phone, credits (default 50), is_premium, trial_expires_at, premium_expires_at, reputation, created_at`
**Migrations added:** `role VARCHAR(20) DEFAULT 'free' CHECK (role IN ('admin','premium','free'))`, `is_active BOOLEAN DEFAULT TRUE`

### companies
`id, name, nit, phone, email, is_active (default true), created_at`

### routes
`id, name, code (UNIQUE), company, first_departure, last_departure, frequency_minutes, is_active, created_at`
**Migrations added:** `company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`, `geometry JSONB DEFAULT NULL`

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

### user_favorite_routes
`id, user_id (→ users), route_id (→ routes), created_at` — `UNIQUE(user_id, route_id)`

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

---

## Main App Flow (Core UX)

### 1. Open the app
- Show user's current location on the map (GPS)
- Show nearby routes within 500 meters
- Show active buses reported by other users in real time

### 2. Trip planner
- User types destination (or picks on map)
- Start point = current GPS location, or typed address (geocoded via Nominatim + Overpass API for Colombian addresses)
- Before entering destination: **"Buses en tu zona"** panel shows routes ≤500 m from origin — tap any to preview its full geometry on the map; tapping again deselects; switching routes clears the previous one immediately
- App finds routes connecting origin → destination via `/api/routes/plan`
- Shows multiple options ordered by proximity to destination stop
- Selecting a result clips the route geometry between boarding stop and dropoff stop and draws it on the map (blue polyline); if clipping fails, falls back to full route geometry, then all stops

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
- Auto-activated for premium/admin; costs 12 credits for free users
- Prepare banner at 400 m from destination
- "Bájate ya" alert + vibration at 200 m
- Missed alert if bus passes destination

---

## Business Rules

- New users get **50 credits** and a **14-day premium trial** on registration.
- Reports expire after **30 minutes**.
- Premium users skip all credit checks.
- Premium plans: $4,900 COP/month or $39,900 COP/year (Wompi).
- Credit packages: 100/$1,900 | 300/$4,900 | 700/$9,900 | 1,500/$17,900 COP.

### Credits earned
| Action | Credits | Notes |
|--------|---------|-------|
| Report (outside active trip) | +3–5 | Immediate, per `CREDITS_BY_TYPE` |
| Report during trip, alone on bus | +1 | Immediate |
| Report during trip, others on bus | 0 → +2 | +2 when report reaches 50%+ confirmations; +1 auto on trip end if no confirmation |
| Confirm another user's report | +1 | Max 3 per trip; confirmer must have active trip on same route |
| Report no service | +4 | |
| Invite a friend | +25 | |
| 7-day reporting streak | +30 | |
| Welcome bonus (registration) | +50 | |
| Per minute transmitting bus location | +1 | |
| Complete full trip | +10 | |

**Occupancy report rules:**
- Only two states: `lleno` (🔴 Bus lleno) and `bus_disponible` (🟢 Hay sillas)
- Per occupancy type, only the first report per trip earns credits (tracked via `occupancyCreditedRef` in frontend + `credit_transactions` check in backend)
- 10-minute cooldown between occupancy reports on the same route

### Credits spent
| Feature | Cost |
|---------|------|
| Which bus serves me? | 8 |
| See bus in real time | 10 |
| Arrival alert | 10 |
| Stop drop-off alert | 12 |
| See if bus is full | 5 |
| Alternate route (traffic) | 8 |

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

### Phase 3 ✅ Partial
- Deploy to Vercel + Railway
- Connect mibus.co domain (Vercel → mibus.co, Railway → api.mibus.co)
- Wompi payments — **pendiente** (no implementado aún)
- Premium plans — **pendiente** (depende de Wompi)

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

### Phase 4 — Future
- React Native mobile app
- Firebase push notifications
- Google Play + App Store
- Alliance with AMB and SIBUS Barranquilla
