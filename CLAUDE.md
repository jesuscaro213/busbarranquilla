# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

# BusBarranquilla — Contexto del Proyecto

## ¿Qué es?
App móvil colaborativa de transporte público para Barranquilla y el Área Metropolitana. Los usuarios se ayudan entre sí reportando ubicación de buses, trancones, ocupación y más en tiempo real.

## Stack Tecnológico
- **Backend:** Node.js + Express + TypeScript
- **Base de datos:** PostgreSQL + Redis
- **App móvil:** React Native + Expo
- **Tiempo real:** Socket.io
- **Autenticación:** JWT + bcryptjs
- **Mapas:** Google Maps API
- **Pagos:** Wompi (pagos colombianos)
- **Notificaciones:** Firebase Cloud Messaging

## Estructura del Proyecto
```
busbarranquilla/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.ts      → Conexión PostgreSQL
│   │   │   └── schema.ts        → Creación de tablas
│   │   ├── controllers/
│   │   │   └── authController.ts → Registro, login, perfil
│   │   ├── routes/
│   │   │   └── authRoutes.ts    → Rutas de autenticación
│   │   ├── middlewares/
│   │   │   └── authMiddleware.ts → Verificación JWT
│   │   └── index.ts             → Servidor principal
│   ├── .env
│   └── package.json
└── mobile/                      → React Native + Expo (pendiente)
```

## Base de Datos — Tablas

### users
- id, name, email, password, phone
- credits (default 50) → moneda interna de la app
- is_premium (default false)
- trial_expires_at → 14 días premium gratis al registrarse
- premium_expires_at → fecha de expiración del plan pagado
- reputation → puntos por reportar correctamente

### routes
- id, name, code, company
- first_departure, last_departure, frequency_minutes
- is_active

### stops
- id, route_id, name
- latitude, longitude, stop_order

### reports
- id, user_id, route_id
- type: 'bus_location' | 'traffic' | 'bus_full' | 'no_service' | 'detour'
- latitude, longitude, description
- is_active, confirmations
- expires_at → los reportes expiran en 30 minutos

### credit_transactions
- id, user_id, amount, type, description

## Lógica de Créditos

### Cómo se GANAN
| Acción | Créditos |
|---|---|
| Reportar ubicación del bus | +5 |
| Reportar trancón | +4 |
| Reportar bus lleno/vacío | +3 |
| Confirmar reporte de otro usuario | +2 |
| Reportar bus no pasando | +4 |
| Invitar un amigo | +25 |
| Racha de 7 días reportando | +30 |
| Bienvenida (registro) | +50 |

### Cómo se GASTAN
| Función | Costo |
|---|---|
| ¿Qué bus me sirve? | 8 créditos |
| Ver bus en tiempo real | 10 créditos |
| Alerta de llegada | 10 créditos |
| Aviso de parada de bajada | 12 créditos |
| Ver si bus viene lleno | 5 créditos |
| Ruta alterna por trancón | 8 créditos |

## Planes y Precios
- **Gratis:** funciones básicas + sistema de créditos
- **Trial:** 14 días premium gratis al registrarse
- **Premium Mensual:** $4.900 COP/mes — todo ilimitado
- **Premium Anual:** $39.900 COP/año — todo ilimitado + 32% ahorro
- **Paquetes de créditos:** 100/$1.900 | 300/$4.900 | 700/$9.900 | 1500/$17.900

## Variables de Entorno (.env)
```
PORT=3000
DATABASE_URL=postgresql://busadmin:busbarranquilla123@localhost:5432/busbarranquilla
JWT_SECRET=busbarranquilla_secret_key_2024
REDIS_URL=redis://localhost:6379
```

## Reglas importantes
- Siempre usar TypeScript estricto
- Siempre manejar errores con try/catch
- Siempre validar datos antes de guardar en base de datos
- Las contraseñas siempre se encriptan con bcryptjs (salt 10)
- Los tokens JWT expiran en 30 días
- Los reportes expiran en 30 minutos
- Nunca exponer contraseñas ni el JWT_SECRET
- Todos los endpoints protegidos usan authMiddleware

- **`backend/`** — Node.js/Express API with PostgreSQL, Redis, Socket.io, and JWT auth
- **`mobile/`** — React Native Expo app (iOS, Android, Web)

## Commands

### Backend

```bash
cd backend
npm run dev       # Start dev server with hot reload (nodemon + ts-node)
npm run build     # Compile TypeScript to ./dist
npm start         # Run compiled code from ./dist/index.js
```

### Mobile

```bash
cd mobile
npm start         # Start Expo dev server
npm run android   # Launch on Android
npm run ios       # Launch on iOS
npm run web       # Launch in browser
```

No lint or test scripts are currently configured in either project.

## Architecture

### Backend

**Entry point**: `src/index.ts` — creates the Express app, wraps it in an HTTP server for Socket.io, registers middleware (CORS), mounts routes, initializes the DB, and starts the server on `PORT` (default 3000).

**Database**: PostgreSQL, configured via `DATABASE_URL` in `.env`. Connection and schema initialization live in `src/config/database.ts` and `src/config/schema.ts`. Tables:
- `users` — accounts with credits, premium status, and a 14-day trial on registration
- `routes` — bus routes with schedule info
- `stops` — geolocation stops per route
- `reports` — user-submitted incident reports (traffic, accidents, etc.)
- `credit_transactions` — audit log for credit usage

**Auth flow** (`src/controllers/authController.ts` + `src/middlewares/authMiddleware.ts`):
- Registration hashes passwords with bcryptjs and creates a user with 50 starting credits and a 14-day premium trial; returns a JWT (30-day expiry).
- Login verifies credentials, returns a JWT.
- `authMiddleware.ts` verifies the JWT and attaches the user to `req.user` for protected routes.

**Real-time**: Socket.io server mounted on the same HTTP server; basic connect/disconnect handlers in place, ready for event-driven features.

**Environment variables** (see `backend/.env`):
```
PORT
DATABASE_URL
JWT_SECRET
REDIS_URL
```

### Mobile

Early-stage — the project is an Expo template with no screens, navigation, or API integration yet. `App.tsx` is the root component.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend runtime | Node.js + Express 5 |
| Language | TypeScript (strict, ES2020/CommonJS) |
| Database | PostgreSQL (`pg` 8) |
| Cache | Redis 5 |
| Real-time | Socket.io 4 |
| Auth | JWT + bcryptjs |
| Mobile framework | React Native 0.81 + Expo 54 |
| Mobile language | TypeScript (strict, extends Expo base config) |
