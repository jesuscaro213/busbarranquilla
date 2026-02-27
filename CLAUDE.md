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
- `routes` → bus route CRUD + search by origin/destination + nearby + recommend
- `stops` → stops per route (CRUD)
- `reports` → create report, list nearby (geolocation), confirm
- `credits` → balance, history, spend
- `trips` → start trip, update location, end trip
- `admin` → users CRUD + companies CRUD (requires `role = 'admin'`)

**Middleware chain for protected routes:**
- Public: no middleware
- Authenticated: `authMiddleware` (JWT → attaches `req.userId` + `req.userRole`)
- Admin only: `authMiddleware` + `requireRole('admin')` (from `middlewares/roleMiddleware.ts`)

**DB init** — `config/database.ts` holds the pg Pool; `config/schema.ts` runs `CREATE TABLE IF NOT EXISTS` on startup, then runs safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations for new fields, then auto-seeds routes if the routes table is empty.

**Credit flow** — creating or confirming a report triggers `credit_transactions` via `awardCredits()` in `creditController.ts`. Premium users skip credit checks.

**Reports** expire in 30 minutes (`expires_at`). `/api/reports/nearby` filters by radius using Haversine formula.

**Socket.io** — configured in `config/socket.ts`. Real-time bus location tracking via `bus:location`, `bus:joined`, `bus:left`, `route:nearby` channels.

**Seed** — `scripts/seedRoutes.ts` auto-runs on startup if `routes` table is empty. Seeds real Barranquilla bus routes with stops.

**Note**: In all route files, named routes (`/nearby`, `/search`, `/balance`) must stay above param routes (`/:id`) to avoid Express conflicts.

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
│   ├── reportController.ts  # create, nearby, confirm
│   ├── routeController.ts   # CRUD + search + nearby
│   ├── stopController.ts    # CRUD per route
│   └── tripController.ts    # start, updateLocation, end, active buses
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
│   └── tripRoutes.ts
└── scripts/
    └── seedRoutes.ts        # Barranquilla routes + stops seed data
```

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
│   ├── CreditBalance.tsx
│   ├── MapView.tsx
│   ├── Navbar.tsx                 # Shows ⚙️ Administración for admin role
│   ├── NearbyRoutes.tsx
│   ├── ReportButton.tsx
│   ├── RoutePlanner.tsx
│   └── TripPanel.tsx
└── pages/
    ├── Home.tsx
    ├── Login.tsx
    ├── Map.tsx
    ├── Register.tsx
    └── admin/
        ├── AdminLayout.tsx        # Sidebar (gray-900) + Outlet — NO Navbar
        ├── AdminRoutes.tsx        # Bus routes CRUD table
        ├── AdminUsers.tsx         # Users table + role/active/delete actions
        └── AdminCompanies.tsx     # Companies table + CRUD + routes viewer
```

#### Admin panel routes

| Path | Component | Description |
|------|-----------|-------------|
| `/admin` | — | Redirects to `/admin/users` |
| `/admin/users` | `AdminUsers` | Users table: change role, toggle active, delete |
| `/admin/routes` | `AdminRoutes` | Bus routes CRUD |
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
**Migration added:** `company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`

### stops
`id, route_id, name, latitude, longitude, stop_order, created_at`

### reports
`id, user_id, route_id, type, latitude, longitude, description, is_active, confirmations, created_at, expires_at (NOW() + 30 min)`

### credit_transactions
`id, user_id, amount, type, description, created_at`

### active_trips
`id, user_id, route_id, current_latitude, current_longitude, destination_stop_id, started_at, last_location_at, ended_at, credits_earned, is_active`

---

## WebSocket Channels

| Channel | Description |
|---------|-------------|
| `bus:location` | Transmits active bus locations |
| `bus:joined` | User boarded a bus |
| `bus:left` | User got off a bus |
| `route:nearby` | Nearby routes for a location |

---

## Main App Flow (Core UX)

### 1. Open the app
- Show user's current location on the map (GPS)
- Show nearby routes within 500 meters
- Show active buses reported by other users in real time

### 2. Trip planner
- User types destination
- Start point = current GPS location
- App finds routes connecting origin → destination
- Shows multiple options ordered by proximity
- User takes whichever bus arrives first

### 3. "I boarded" flow
- User taps "Me subí" (I boarded)
- Selects which route/bus it is
- Optionally sets drop-off stop
- Phone transmits bus location in real time via WebSocket
- Other users see the bus moving on the map
- User earns +1 credit per minute transmitting

### 4. "I got off" flow
- User taps "Me bajé" (I got off)
- Stops transmitting location
- Shows trip summary with credits earned
- Option to rate the trip

### 5. Drop-off alerts
- App monitors GPS during trip
- At 2 stops before destination → soft notification
- At 1 stop before destination → strong alert

---

## Business Rules

- New users get **50 credits** and a **14-day premium trial** on registration.
- Reports expire after **30 minutes**.
- Premium users skip all credit checks.
- Premium plans: $4,900 COP/month or $39,900 COP/year (Wompi).
- Credit packages: 100/$1,900 | 300/$4,900 | 700/$9,900 | 1,500/$17,900 COP.

### Credits earned
| Action | Credits |
|--------|---------|
| Report bus location | +5 |
| Report traffic jam | +4 |
| Report bus full/empty | +3 |
| Confirm another user's report | +2 |
| Report no service | +4 |
| Invite a friend | +25 |
| 7-day reporting streak | +30 |
| Welcome bonus (registration) | +50 |
| Per minute transmitting bus location | +1 |
| Complete full trip | +10 |

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

### Phase 2 ✅ Complete (Admin panel) / In Progress (real-time)
**Admin panel — done:**
- Role-based access control (`requireRole` middleware + `AdminRoute` guard)
- Admin layout with sidebar (no Navbar)
- `/admin/users` — full users table with role change, toggle active, delete
- `/admin/routes` — bus routes CRUD
- `/admin/companies` — companies CRUD with routes viewer
- Navbar link "⚙️ Administración" visible only to admins

**Still in progress:**
- User GPS location on map
- Nearby routes by current location
- Trip planner (origin → destination)
- "I boarded / I got off" flow
- Real-time bus tracking via WebSocket
- Drop-off alerts

### Phase 3 — Upcoming
- Wompi payments integration
- Active premium plans
- Deploy to Vercel + Railway
- Connect mibus.co domain

### Phase 4 — Future
- React Native mobile app
- Firebase push notifications
- Google Play + App Store
- Alliance with AMB and SIBUS Barranquilla
