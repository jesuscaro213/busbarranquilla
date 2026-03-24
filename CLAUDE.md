# CLAUDE.md

Guía de comportamiento para Claude Code en este repositorio.

---

## REGLA #0 — CONSULTA DOCS ANTES DE OPINAR O SUGERIR

**ANTES de proponer ideas, listar opciones, evaluar el estado de una feature, o responder "/idea.reviewer":**

1. Lee `AI_CONTEXT.md` — para saber qué ya está implementado
2. Lee `docs/changelog.md` — para saber qué se hizo en cada fase
3. Lee `MEMORY.md` — para recordar decisiones de diseño y bugs resueltos

**Si sugieres algo que ya está implementado, fallaste esta regla.**
No hay excusa: siempre hay que leer antes de opinar.

---

## REGLA #1 — ACTUALIZA DOCS ANTES DE TERMINAR

**NUNCA termines una tarea sin haber actualizado `AI_CONTEXT.md` y `MEMORY.md`.**

### Orden obligatorio al finalizar CUALQUIER tarea:

1. Implementa el cambio
2. Ejecuta `flutter analyze` (Flutter) o verifica que compila
3. **Actualiza `AI_CONTEXT.md`** — nuevos endpoints, cambios en DB, patrones, features
4. **Actualiza `MEMORY.md`** — bugs no obvios, decisiones de diseño, thresholds
5. Si se completa una fase → actualiza `docs/changelog.md` y la tabla de fases en `CLAUDE.md`
6. Responde al usuario

**Si saltaste el paso 3 o 4, NO has terminado.**

### Qué actualizar en `AI_CONTEXT.md`:
- Nuevos endpoints → sección "API endpoints principales"
- Cambios en DB → sección "Esquema de base de datos"
- Nuevos patrones o bugs corregidos → sección "Patrones de código importantes"
- Features completadas → sección "Estado del proyecto"
- **SIEMPRE** actualizar `*Ultima actualización: YYYY-MM-DD (vN)*` al final

### Qué actualizar en `docs/changelog.md`:
- Solo cuando se completa una fase entera — agregar la sección con el detalle de lo que se hizo

### Qué actualizar en `CLAUDE.md`:
- Nuevas fases completadas → tabla "Estado de fases"
- Cambios en reglas de negocio clave o restricciones de arquitectura

---

## Qué es esto

**MiBus** (mibus.co) — app colaborativa de transporte público en tiempo real para Barranquilla, Colombia. El pasajero ES el GPS. Economía de créditos para incentivar participación. Suscripción premium via Wompi.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express 5 + TypeScript |
| Base de datos | PostgreSQL 15 + Redis 7 |
| Tiempo real | Socket.io 4 |
| Auth | JWT (30 días) + bcryptjs (salt 10) |
| Web frontend | React + Vite + TailwindCSS + Leaflet |
| Mobile | Flutter 3 + Dart (`flutter_app/`) |
| Pagos | Wompi (Colombia) |
| Geocodificación | Nominatim (primario) + Geoapify (fallback) |

---

## Correr el proyecto

**Solo via Docker.** No usar `npm run dev` directamente — PostgreSQL y Redis solo existen como contenedores.

```bash
docker-compose up --build   # Primera vez o tras cambios en Dockerfile
docker-compose up           # Inicio normal
docker-compose down
docker-compose logs -f backend
docker-compose logs -f web
```

| Servicio | Puerto |
|----------|--------|
| backend  | 3000   |
| web      | 5173   |
| postgres | 5432   |
| redis    | 6379   |

Variables de entorno en `docker-compose.yml` (no en `.env`).

### Comandos Flutter
```bash
~/development/flutter/bin/flutter run
~/development/flutter/bin/flutter build apk --release
~/development/flutter/bin/flutter analyze      # Debe retornar 0 issues
~/development/flutter/bin/flutter pub get
```

---

## Arquitectura

> Para file maps detallados, endpoints y schema ver `AI_CONTEXT.md`.

### Backend (`backend/src/`)
Express routes → controllers → pg Pool directo (sin ORM). Entry point: `index.ts`.
Grupos de rutas (todas bajo `/api/`): `auth`, `routes`, `stops`, `reports`, `credits`, `trips`, `users`, `payments`, `admin`.
Middleware: public → `authMiddleware` (JWT) → `requireRole('admin')`.
DB init: `config/schema.ts` corre `CREATE TABLE IF NOT EXISTS` + migrations `ALTER TABLE ADD COLUMN IF NOT EXISTS` + auto-seed.

**Restriccion critica:** Rutas con nombre (`/nearby`, `/search`, `/plan`, `/current`) SIEMPRE antes de rutas con parametro (`/:id`) en el mismo archivo de Express.

### Web (`web/src/`)
React Router v6. Layout publico (`PublicLayout`) + layout admin (`AdminRoute` guard + `AdminLayout` con sidebar). Auth en `context/AuthContext.tsx`, JWT en `localStorage`. Vite proxea `/api/*` → backend.

### Flutter (`flutter_app/lib/`)
MVVM + Repository. Riverpod 2 (sealed states + Notifiers). GoRouter 14 con ShellRoute (4 tabs). Todos los strings en `lib/core/l10n/strings.dart` como `AppStrings` — nunca hardcodear strings en widgets.

---

## Reglas de negocio clave

- Nuevos usuarios: **50 creditos** + **14 dias trial premium**
- Reportes expiran en **30 minutos**
- Usuarios premium saltan todos los checks de creditos
- Plan premium: **$4,900 COP/mes** (Wompi, single-use, renovacion manual)
- Cooldown entre viajes: **5 minutos**
- Bono completar viaje: **+5 creditos** solo si `total_distance_meters >= 2000`

### Creditos ganados
| Accion | Creditos |
|--------|----------|
| Registro | +50 |
| Reporte (fuera del viaje) | +3–5 |
| Por minuto transmitiendo | +1 (max 15/viaje) |
| Confirmar reporte de otro | +1 (max 2/viaje) |
| Completar viaje (≥2 km) | +5 |
| Invitar amigo | +25 |
| Bono premium (pago aprobado) | +50 |

### Creditos gastados
| Feature | Costo |
|---------|-------|
| Alerta de bajada (usuarios free) | -5 (gratis para premium/admin) |

---

## Escribir specs para Flutter (`flutter_specs/`)

Archivos numerados que describen implementaciones de features:

- Referenciar rutas de archivo y nombres de clase/widget exactos
- Mostrar diffs `old_string` → `new_string` para modificaciones
- Siempre terminar con paso de verificacion `flutter analyze`
- Una feature por archivo

---

## Estado de fases

| Fase | Estado | Descripcion |
|------|--------|-------------|
| Phase 1 | Complete | Backend base + auth + rutas + seed |
| Phase 2 | Complete | Admin panel + flujo real-time web |
| Phase 2.5 | Complete | "Cerca de ti" + "Buses en tu zona" |
| Phase 3 | Complete | Deploy + pagos Wompi |
| Phase 3.5 | Complete | Confirmacion inteligente de reportes |
| Phase 3.6 | Complete | Geocodificacion Nominatim + UX |
| Phase 3.7 | Complete | Actividad de ruta + alertas admin |
| Phase 3.8 | Complete | Editor de trazado + proteccion imports |
| Phase 3.9 | Complete | Anti-fraude + rate limiting + stats |
| Phase 4 | In Progress | Flutter mobile |

Ver historial detallado de cada fase en `docs/changelog.md`.

---

## Referencias rapidas

| Que | Donde |
|-----|-------|
| Arquitectura detallada + file maps | `AI_CONTEXT.md` |
| API endpoints completos | `AI_CONTEXT.md` — sección "API endpoints principales" |
| Schema de DB | `AI_CONTEXT.md` — sección "Esquema de base de datos" |
| Flujos clave | `AI_CONTEXT.md` — sección "Flujos clave" |
| Historial de fases | `docs/changelog.md` |
| Specs Flutter | `flutter_specs/` |
| Memoria persistente | `MEMORY.md` + `.claude/projects/.../memory/` |
