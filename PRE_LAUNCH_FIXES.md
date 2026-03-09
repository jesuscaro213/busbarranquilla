# MiBus — Pre-Launch Fixes

> Problemas detectados en audit de código antes del lanzamiento. Implementar en orden. Cada ítem es independiente.

## Stack de referencia
- Backend: Node.js + Express 5 + TypeScript, PostgreSQL 15, Redis 7
- Web: React + Vite + TailwindCSS
- Auth: JWT 30 días en localStorage, `req.userId` inyectado por `authMiddleware`
- Docker: `docker-compose up` levanta todo
- Ver CLAUDE.md para arquitectura completa

---

## Fix 1 — Navbar no refleja nombre actualizado tras editar perfil

**Problema:** En `Profile.tsx`, al guardar el nombre se llama `refreshProfile()` del AuthContext, que hace `GET /api/auth/profile` y actualiza `user`. Sin embargo, el Navbar muestra `user.name` del contexto y sí debería actualizarse — pero si no lo hace visualmente es porque `Navbar.tsx` no re-renderiza. Verificar y corregir.

**Raíz probable:** `Navbar.tsx` usa `const { user } = useAuth()` correctamente, pero puede haber un problema de referencia si `refreshProfile` no actualiza el objeto `user` sino que lo reemplaza con shallow copy. La solución es garantizar que `refreshProfile` en `AuthContext.tsx` llama `setUser({ ...res.data.user })` con un nuevo objeto (no mutar el existente).

**Archivos a modificar:**

**`web/src/context/AuthContext.tsx`** — función `refreshProfile`:
```typescript
const refreshProfile = async () => {
  const res = await authApi.getProfile();
  setUser({ ...res.data.user }); // spread para forzar re-render
};
```
Verificar que ya hace esto. Si ya lo hace, el bug no existe y este fix puede ignorarse.

**`web/src/pages/Profile.tsx`** — función `handleSaveName`:
- Después de `await refreshProfile()`, también hacer `setNameInput(trimmed)` para que el input local quede sincronizado.
- Ya debería estar haciendo esto, verificar.

---

## Fix 2 — Validación de email en backend (registro)

**Problema:** `POST /api/auth/register` acepta cualquier string como email. El `type="email"` del HTML solo valida en el browser, no en el servidor.

**Archivos a modificar:**

**`backend/src/controllers/authController.ts`** — función `register`, agregar validación antes del `try`:

```typescript
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!name?.trim() || !email?.trim() || !password) {
  res.status(400).json({ message: 'Nombre, correo y contraseña son obligatorios' });
  return;
}
if (!emailRegex.test(email.trim())) {
  res.status(400).json({ message: 'El correo electrónico no es válido' });
  return;
}
if (password.length < 6) {
  res.status(400).json({ message: 'La contraseña debe tener al menos 6 caracteres' });
  return;
}
```

Agregar esto justo después de extraer `{ name, email, password, phone, referralCode }` del body, antes del `try { ... }`.

**No tocar el frontend** — ya tiene validaciones HTML.

---

## Fix 3 — Deep-link a app móvil en BusPage

**Problema:** `web/src/pages/BusPage.tsx` cuando se abre desde WhatsApp en Android/iOS no ofrece abrir la app nativa. Agregar un banner de "Abrir en la app" usando el esquema de deep link.

**Archivos a modificar:**

**`web/src/pages/BusPage.tsx`** — agregar banner de smart app banner y deep link:

1. Agregar estado `const [showAppBanner, setShowAppBanner] = useState(true)` al componente.

2. Agregar función para detectar móvil:
```typescript
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
```

3. Renderizar banner encima del header, solo en móvil y si `showAppBanner`:
```tsx
{isMobile && showAppBanner && (
  <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between gap-3 rounded-2xl">
    <div>
      <p className="text-sm font-semibold">🚌 Abre MiBus</p>
      <p className="text-xs text-blue-200">Sigue el bus en tiempo real</p>
    </div>
    <div className="flex items-center gap-2 shrink-0">
      <a
        href={`mibus://bus/${id}`}
        className="bg-white text-blue-700 text-xs font-bold px-3 py-1.5 rounded-lg"
      >
        Abrir app
      </a>
      <button
        type="button"
        onClick={() => setShowAppBanner(false)}
        className="text-blue-200 hover:text-white text-lg leading-none"
        aria-label="Cerrar"
      >
        ×
      </button>
    </div>
  </div>
)}
```

4. El esquema `mibus://bus/:id` es el deep link de la app nativa (configurar en Expo cuando se implemente).

---

## Fix 4 — Expiración de Premium no se aplica en tiempo real

**Problema:** Si `premium_expires_at` vence, el usuario sigue con `role='premium'` e `is_premium=true` en DB hasta que vuelva a hacer login (donde `normalizePremiumState` lo corrige). Usuarios que no hacen logout nunca verán su suscripción expirar.

**Solución:** Agregar el check de expiración en `authMiddleware` para que se aplique en cada request autenticado.

**Archivos a modificar:**

**`backend/src/middlewares/authMiddleware.ts`** — después de verificar el JWT y antes del `next()`:

```typescript
// Verificar expiración de premium en cada request (silencioso)
if (decoded.role === 'premium') {
  pool.query(
    `UPDATE users
     SET is_premium = false, role = 'free'
     WHERE id = $1
       AND is_premium = true
       AND premium_expires_at IS NOT NULL
       AND premium_expires_at < NOW()
       AND trial_expires_at < NOW()`,
    [decoded.id]
  ).catch(() => {}); // fire-and-forget, no bloquear el request
}
```

Importar `pool` de `'../config/database'` si no está importado ya.

**Nota:** Este UPDATE es fire-and-forget (no bloquea el request). La próxima vez que el usuario llame `GET /api/auth/profile` recibirá el estado actualizado. No requiere cambios en frontend.

---

## Fix 5 — Refactor CatchBusMode (reducir complejidad)

**Problema:** `web/src/components/CatchBusMode.tsx` tiene ~1800 líneas. Difícil de mantener y debuggear en producción.

**No implementar ahora** — este refactor requiere pruebas extensas y puede introducir bugs en el flujo crítico de viaje. Dejarlo para post-lanzamiento cuando haya cobertura de tests.

---

## Orden de ejecución

```
Fix 2 (validación email)     — 10 min, sin riesgo
Fix 1 (refreshProfile)       — 10 min, bajo riesgo
Fix 4 (expiración premium)   — 15 min, bajo riesgo
Fix 3 (deep-link BusPage)    — 20 min, sin riesgo
Fix 5 (refactor)             — NO hacer antes del lanzamiento
```

## Validación

Después de cada fix:
- `cd backend && npm run build` — debe pasar sin errores
- `cd web && npm run build` — debe pasar sin errores
- Fix 4: verificar que `authMiddleware.ts` importa correctamente y no rompe rutas existentes

---

## Notas técnicas

- **Todas las migraciones** van en `backend/src/config/schema.ts` como `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **Nunca usar `npm run dev` directamente** — el proyecto corre con Docker
- **El pool de PostgreSQL** está en `backend/src/config/database.ts`, importar como `import pool from '../config/database'`
- **`awardCredits(userId, amount, type, description)`** en `creditController.ts` — siempre usar esta función para dar créditos, nunca UPDATE directo
