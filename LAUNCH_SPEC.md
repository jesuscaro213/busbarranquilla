# MiBus — Launch Spec

> Spec de lanzamiento al mercado. Cada ítem tiene suficiente contexto técnico para que Claude/Codex lo implemente sin preguntas adicionales. Ejecutar en orden de prioridad.

## Stack de referencia
- Backend: Node.js + Express 5 + TypeScript, PostgreSQL 15, Redis 7, Socket.io 4
- Web: React + Vite + TailwindCSS + Leaflet
- Mobile: React Native 0.81 + Expo 54 (rama `feature/flutter-app` tiene código Flutter — **ignorar, usar Expo**)
- Auth: JWT 30 días, bcryptjs salt 10
- Pagos: Wompi Colombia
- Docker: `docker-compose up` levanta todo (backend:3000, web:5173, postgres:5432, redis:6379)
- Ver CLAUDE.md para arquitectura completa, esquema DB y convenciones

---

## 🔴 P0 — Bloqueadores de lanzamiento

---

### P0-1: Rate limiting de reportes (anti-abuso)
**Problema:** Un usuario malicioso puede crear cientos de reportes falsos e inundar el mapa.

**Implementar en `backend/src/controllers/reportController.ts`:**
- Máximo **5 reportes por usuario por hora** (excluir confirmaciones)
- Máximo **2 reportes del mismo tipo por ruta por hora** por usuario
- Si se supera el límite → `429 Too Many Requests` con mensaje: `"Límite de reportes alcanzado. Espera antes de reportar de nuevo."`
- Implementar con Redis: key `rate:report:{userId}` con TTL 3600, INCR en cada reporte
- Key secundaria `rate:report:{userId}:{routeId}:{type}` para límite por tipo/ruta

**Frontend (`web/src/components/CatchBusMode.tsx`):**
- Capturar error 429 en el handler de reportes y mostrar toast: `"Ya reportaste mucho hoy en esta ruta 🙏"`

---

### P0-2: Login con Google (OAuth)
**Problema:** El registro con email/contraseña tiene fricción alta. En Colombia todos esperan "Continuar con Google".

**Backend — nuevo endpoint `POST /api/auth/google`:**
- Recibe `{ idToken: string }` — el token de Google del cliente
- Verificar con `google-auth-library`: `const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`
- Extraer `email`, `name`, `picture` del payload
- Si el usuario existe (por email) → devolver JWT igual que `/api/auth/login`
- Si no existe → crear usuario con `credits = 50`, `is_premium = true`, `trial_expires_at = NOW() + 14 days`, `role = 'free'`, `password = null` (columna debe ser nullable: `ALTER TABLE users ALTER COLUMN password DROP NOT NULL`)
- Devolver `{ token, user }` igual que login normal

**Web (`web/src/pages/Login.tsx` y `Register.tsx`):**
- Agregar botón "Continuar con Google" usando `@react-oauth/google`
- `<GoogleOAuthProvider clientId={...}>` en `main.tsx`
- Al hacer click → `useGoogleLogin()` → obtener `access_token` → llamar `authApi.googleLogin(idToken)`
- Añadir `googleLogin: (idToken: string) => api.post('/api/auth/google', { idToken })` en `api.ts`

**Variables de entorno necesarias en `docker-compose.yml`:**
- `GOOGLE_CLIENT_ID` (Web OAuth 2.0 client)
- `GOOGLE_CLIENT_SECRET` (si se necesita server-side)

---

### P0-3: Onboarding / tutorial de primer uso
**Problema:** Un usuario nuevo no entiende que él es el GPS. La tasa de activación será muy baja sin contexto.

**Implementar en Web (`web/src/`):**

Crear `src/components/Onboarding.tsx` — modal de 4 pasos que aparece solo la primera vez:
- **Paso 1**: "🚌 Tú eres el GPS — Cuando subes a un bus y lo compartes, todos saben dónde está"
- **Paso 2**: "📍 Planea tu viaje — Escribe tu destino y te mostramos qué bus tomar y dónde abordarlo"
- **Paso 3**: "⚡ Gana créditos — Cada minuto que transmites = +1 crédito. Reportar un trancón = +3 créditos"
- **Paso 4**: "🎁 Tienes 50 créditos de bienvenida y 14 días Premium gratis — ¡Empieza!"

Condición de aparición: `localStorage.getItem('onboarding_done') === null`
Al terminar: `localStorage.setItem('onboarding_done', '1')`

Mostrar en `Map.tsx` justo después de que el usuario inicia sesión (`user && !onboardingDone`).

---

### P0-4: Pantalla de perfil y saldo de créditos
**Problema:** Los créditos existen pero el usuario no los ve fácilmente. Sin feedback visible, la gamificación no genera hábito.

**Crear `web/src/pages/Profile.tsx`:**
- Saldo actual de créditos (grande, prominente): `GET /api/credits/balance`
- Badge de estado: 🟢 Premium activo / ⏰ Trial (X días restantes) / 🔓 Plan gratuito
- Historial de últimas 20 transacciones: `GET /api/credits/history` — mostrar tipo, descripción, cantidad (+/-), fecha relativa
- Botón "Obtener Premium" → `/premium`
- Estadísticas del usuario: total viajes, total reportes, créditos ganados (consultar `active_trips` y `credit_transactions`)
- Editar nombre: `PATCH /api/auth/profile` (crear endpoint si no existe)

**Agregar en `Navbar.tsx`:** avatar/nombre del usuario → link a `/profile`
**Agregar ruta en `App.tsx`:** `<Route path="/profile" element={<Profile />} />`

---

## 🟡 P1 — Retención (primeras 2 semanas)

---

### P1-1: Historial de viajes
**Problema:** El usuario no ve su impacto ni progreso. Sin historial no hay razón para volver.

**Backend — nuevo endpoint `GET /api/trips/history`** (auth):
```sql
SELECT id, route_id, r.name AS route_name, r.code AS route_code,
       started_at, ended_at, credits_earned,
       ROUND(EXTRACT(EPOCH FROM (ended_at - started_at))/60) AS duration_minutes
FROM active_trips at
LEFT JOIN routes r ON r.id = at.route_id
WHERE at.user_id = $1 AND at.is_active = false AND at.ended_at IS NOT NULL
ORDER BY started_at DESC
LIMIT 20
```

**Crear `web/src/pages/TripHistory.tsx`:**
- Lista de viajes pasados: ruta, fecha, duración, créditos ganados
- Vacío state: "Aún no has hecho ningún viaje. ¡Sube a un bus y empieza!"
- Accesible desde `/profile` o navbar

---

### P1-2: Racha de 7 días (streak)
**Problema:** Existe la regla de negocio (+30 créditos por racha de 7 días) pero no está implementada.

**Backend — `backend/src/config/schema.ts`** — agregar columna:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_report_date DATE DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS report_streak INTEGER DEFAULT 0;
```

**En `reportController.ts`**, después de crear un reporte exitosamente:
```typescript
// Actualizar racha
const today = new Date().toISOString().split('T')[0];
const user = await pool.query('SELECT last_report_date, report_streak FROM users WHERE id = $1', [userId]);
const lastDate = user.rows[0].last_report_date;
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

let newStreak = 1;
if (lastDate === yesterday) newStreak = (user.rows[0].report_streak ?? 0) + 1;
else if (lastDate === today) newStreak = user.rows[0].report_streak; // ya reportó hoy

await pool.query('UPDATE users SET last_report_date = $1, report_streak = $2 WHERE id = $3', [today, newStreak, userId]);

if (newStreak > 0 && newStreak % 7 === 0) {
  await awardCredits(userId, 30, 'streak', `🔥 ¡Racha de ${newStreak} días! Bonus de créditos`);
}
```

**Frontend:** mostrar racha en perfil con emoji de fuego 🔥

---

### P1-3: Sistema de referidos (+25 créditos)
**Problema:** Canal de adquisición gratuito desaprovechado. Existe la regla pero no hay implementación.

**Backend — `backend/src/config/schema.ts`:**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(10) UNIQUE DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

Generar `referral_code` en `authController.ts` al registrar: 6 caracteres aleatorios en mayúsculas (ej. `MB3X9K`)

**Endpoint `POST /api/auth/register`** — aceptar `referralCode?: string` en body:
- Si se provee y existe → `referred_by = referrerId`, `await awardCredits(referrerId, 25, 'referral', 'Amigo registrado con tu código')`
- El usuario referido también recibe +10 créditos de bienvenida extra

**Endpoint `GET /api/users/referral`** (auth) → devuelve `{ code, total_referred, credits_earned }`

**Frontend — sección en `/profile`:**
- Mostrar código de referido grande y copiable
- Botón "Compartir en WhatsApp" → `https://wa.me/?text=Usa%20mi%20código%20${code}%20en%20MiBus%20y%20gana%20créditos%20extra!%20mibus.co`
- Contador: "Has referido X amigos → ganaste X créditos"

---

### P1-4: Compartir bus por WhatsApp
**Problema:** Canal de adquisición viral no aprovechado.

**En `CatchBusMode.tsx`** (vista activa, mientras va en el bus):
- Agregar botón pequeño: "📤 Compartir este bus"
- Al hacer clic → `navigator.share()` (Web Share API, funciona en móvil)
  ```typescript
  navigator.share({
    title: 'MiBus',
    text: `🚌 Voy en el bus ${route.code} (${route.name}). Súbete en mibus.co`,
    url: `https://mibus.co/bus/${route.id}`
  })
  ```
- Fallback si Web Share no disponible → copiar al portapapeles + toast "¡Enlace copiado!"

**Backend:** crear endpoint público `GET /api/routes/:id/share` que devuelve info básica de la ruta (sin auth) para previsualización de WhatsApp (OG tags).

---

### P1-5: Favoritas accesibles en UI
**Problema:** El backend de favoritas existe pero no hay sección visible en la app web principal.

**En `web/src/components/CatchBusMode.tsx`** — agregar tab o sección "⭐ Favoritas" en la vista de lista:
- Cargar `usersApi.getFavorites()` al montar si el usuario está autenticado
- Mostrar las rutas favoritas primero, con estrella dorada ⭐
- Botón de estrella en cada fila de ruta → toggle favorite (add/remove)
- Rutas favoritas también deben aparecer destacadas en los resultados del planificador

---

## 🟠 P2 — Calidad de datos

---

### P2-1: Auditoría de rutas — completar geometría faltante
**Problema:** Rutas sin geometría caen al modo por paradas, menos preciso.

**Crear script `backend/src/scripts/auditRoutes.ts`:**
```typescript
// Encuentra rutas activas sin geometría o con menos de 2 paradas
// Intenta regenerar su geometría automáticamente
// Genera reporte: routeId, code, name, status, stops_count, has_geometry
```

**Endpoint admin `POST /api/admin/routes/audit`:**
- Ejecuta el script
- Devuelve JSON con rutas problemáticas
- Panel admin: nueva sección en `/admin/routes` — pestaña "Auditoría" con tabla de rutas sin geometría + botón "Regenerar todas"

---

### P2-2: Completar datos de horarios o limpiar UI
**Problema:** La mayoría de rutas muestran "🕐 Cada — min" porque `frequency_minutes` está vacío.

**Opción A (recomendada):** Ocultar la frecuencia si es NULL — ya parcialmente implementado, verificar que `{selectedRoute.frequency_minutes && ...}` cubra todos los lugares donde se muestra.

**Opción B:** Importar datos reales del AMB. Endpoint `POST /api/admin/routes/import-schedules` que procese un CSV con columnas `code, first_departure, last_departure, frequency_minutes`.

---

### P2-3: Feedback inmediato de créditos ganados
**Problema:** El usuario no sabe que ganó créditos. La gamificación no genera hábito sin feedback.

**En `CatchBusMode.tsx`** — mostrar animación de crédito ganado:
- Cuando se crea un reporte exitoso → toast animado "+3 créditos 💰"
- Cuando se confirma un reporte → toast "+1 crédito ✅"
- Al terminar viaje → pantalla de resumen muestra créditos ganados en ese viaje en grande

**Implementar:** capturar el campo `credits` o `amount` de la respuesta del backend en cada acción y mostrarlo en el toast existente.

---

## 🟢 P3 — Diferenciadores (post-lanzamiento)

---

### P3-1: Historial de ocupación por ruta
**Descripción:** Mostrar patrones de ocupación histórica ("este bus suele estar lleno entre 7–8am los lunes").

**Backend:** Nueva tabla `route_occupancy_stats`:
```sql
CREATE TABLE IF NOT EXISTS route_occupancy_stats (
  id SERIAL PRIMARY KEY,
  route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
  day_of_week INTEGER CHECK (0-6), -- 0=domingo
  hour_of_day INTEGER CHECK (0-23),
  lleno_count INTEGER DEFAULT 0,
  disponible_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```
Actualizar con UPSERT cada vez que se crea un reporte de ocupación.

**Frontend:** En el detalle de ruta → mini gráfico de barras por hora del día.

---

### P3-2: Modo sin internet (cache offline)
**Descripción:** Si el usuario pierde señal en el bus, la app no debe romperse.

**Implementar en `web/`:**
- Service Worker básico con Workbox
- Cachear: geometría de la ruta activa, paradas, datos del usuario
- Continuar transmitiendo GPS aunque no haya respuesta del servidor (queue de ubicaciones → enviar cuando vuelva la señal)

---

### P3-3: Notificación de racha en peligro
**Descripción:** Si el usuario no ha reportado en 23h y tiene racha activa → notificación push: "🔥 ¡Tu racha de 5 días está en peligro! Reporta algo hoy."

**Requiere:** P0-Firebase FCM implementado primero.

---

## 📋 Orden de ejecución recomendado

```
Semana 1:  P0-1 (rate limiting) + P0-4 (perfil/créditos) + P0-3 (onboarding)
Semana 2:  P0-2 (Google login)
Semana 3:  P1-5 (favoritas UI) + P1-3 (referidos) + P1-4 (compartir WhatsApp)
Semana 4:  P1-1 (historial viajes) + P1-2 (racha 7 días) + P2-3 (feedback créditos)
Semana 5:  P2-1 (auditoría rutas) + P2-2 (limpiar horarios)
Post-lanzamiento: P3-x
```

---

## 🚀 Criterios de lanzamiento (Definition of Done)

- [ ] P0-1: Ningún usuario puede crear más de 5 reportes/hora
- [ ] P0-2: Login con Google funciona en web
- [ ] P0-3: Onboarding aparece al primer login y explica los 4 conceptos clave
- [ ] P0-4: El usuario puede ver su saldo de créditos y últimas transacciones
- [ ] P1-2: La racha de 7 días otorga +30 créditos automáticamente
- [ ] P1-3: El código de referido se puede compartir y otorga +25 créditos al referidor
- [ ] P1-4: El botón "Compartir bus" funciona en móvil
- [ ] P1-5: Las rutas favoritas aparecen destacadas en la lista
- [ ] P2-1: Todas las rutas activas tienen geometría válida
- [ ] P2-3: Cada acción que gana créditos muestra un toast con la cantidad
- [ ] Ningún error 500 en las rutas críticas (login, reporte, inicio de viaje)
- [ ] Tiempo de respuesta `GET /api/routes/plan` < 500 ms

---

## 🗒️ Notas técnicas para implementación

- **Nunca usar `npm run dev` directamente** — el proyecto corre con Docker (`docker-compose up`)
- **PostgreSQL credentials**: user=`busadmin`, db=`busbarranquilla` (ver docker-compose.yml)
- **Todas las migraciones** van en `backend/src/config/schema.ts` como `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **Nuevas rutas nombradas** deben ir ANTES de `/:id` en Express para evitar conflictos
- **El frontend usa proxy de Vite**: todas las llamadas a `/api/*` van al backend automáticamente
- **Créditos**: siempre usar `awardCredits(userId, amount, type, description)` de `creditController.ts`, nunca UPDATE directo
- **Socket.io**: los eventos de progreso de importación usan `getIo().emit()` — importar desde `config/socket.ts`
- **OSRM público**: `https://router.project-osrm.org/route/v1/driving/` — tiene rate limit, usar sleep entre llamadas
