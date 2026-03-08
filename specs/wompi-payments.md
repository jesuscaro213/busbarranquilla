# Spec: Wompi Payments Integration

## Context

- **Project:** MiBus (mibus.co) — collaborative real-time bus tracking app for Barranquilla, Colombia
- **Stack:** Node.js + Express 5 + TypeScript (backend), React + Vite + TailwindCSS (web)
- **Auth:** JWT in `Authorization: Bearer <token>` header. Middleware `authMiddleware` attaches `req.userId` and `req.userRole`
- **DB:** PostgreSQL via `pg` pool imported from `../config/database` (or `../../config/database`)
- **Credits helper:** `awardCredits(userId, amount, type, description)` in `backend/src/controllers/creditController.ts`
- **Existing user fields:** `id, credits, is_premium BOOLEAN, premium_expires_at TIMESTAMP, role VARCHAR(20)`
- **Entry point:** `backend/src/index.ts` — register new routes here with `app.use('/api/payments', paymentRoutes)`
- **Env vars** (already in docker-compose.yml, add to Railway too):
  - `WOMPI_PUBLIC_KEY` — Wompi public key
  - `WOMPI_PRIVATE_KEY` — Wompi private key (for server-side API calls)
  - `WOMPI_EVENT_SECRET` — Wompi webhook event secret (for signature verification)
  - `APP_URL` — frontend base URL, e.g. `https://mibus.co`

---

## Plans & Pricing

| Plan | Price (COP) | Duration |
|------|-------------|----------|
| `monthly` | 4,900 | 30 days |
| `yearly` | 39,900 | 365 days |

---

## DB Migration (add to `backend/src/config/schema.ts`)

Add after existing migrations, inside `createTables()`:

```sql
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  wompi_reference VARCHAR(100) UNIQUE NOT NULL,
  wompi_transaction_id VARCHAR(100),
  plan VARCHAR(20) NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'COP',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'voided', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Backend: New Files

### `backend/src/controllers/paymentController.ts`

#### `createCheckout` — POST /api/payments/checkout

**Auth:** required (authMiddleware)

**Request body:**
```json
{ "plan": "monthly" | "yearly" }
```

**Logic:**
1. Validate `plan` is one of `['monthly', 'yearly']`. Return 400 if not.
2. Determine `amountInCents`:
   - `monthly` → `490000` (4,900 COP × 100)
   - `yearly` → `3990000` (39,900 COP × 100)
3. Generate a unique reference string: `mibus-{userId}-{plan}-{Date.now()}`
4. Call Wompi API to create an acceptance token first:
   - `GET https://sandbox.wompi.co/v1/merchants/{WOMPI_PUBLIC_KEY}` (use production URL in prod: `https://production.wompi.co/v1/merchants/{WOMPI_PUBLIC_KEY}`)
   - Extract `data.presigned_acceptance.acceptance_token`
5. Call Wompi API to create payment link:
   - `POST https://sandbox.wompi.co/v1/payment_links` with header `Authorization: Bearer {WOMPI_PRIVATE_KEY}`
   - Body:
     ```json
     {
       "name": "MiBus Premium — {plan}",
       "description": "Suscripción mensual/anual MiBus",
       "single_use": true,
       "collect_shipping": false,
       "currency": "COP",
       "amount_in_cents": amountInCents,
       "redirect_url": "{APP_URL}/payment/result",
       "reference": reference
     }
     ```
6. Insert a `payments` row with `status = 'pending'`, `wompi_reference = reference`, `plan`, `amount_cents = amountInCents`, `user_id`.
7. Return `{ checkout_url: data.data.url ?? "https://checkout.wompi.co/l/{data.data.id}" }`.

**Error handling:**
- 400 for invalid plan
- 500 if Wompi API call fails (log error, return generic message)

---

#### `handleWebhook` — POST /api/payments/webhook

**Auth:** none (public endpoint, verified by signature)

**Request:** Wompi sends a JSON body with `event`, `data`, `sent_at`, `timestamp`, `signature`

**Signature verification:**
1. Build the string: `{data.transaction.id}{timestamp}{signature.checksum_algorithm}`
   Actually Wompi signature: concatenate `properties` values in order + `WOMPI_EVENT_SECRET`, then SHA256.
   - The correct verification: `SHA256(properties[0] + properties[1] + ... + WOMPI_EVENT_SECRET)`
   - `properties` are the fields listed in `signature.properties` (e.g. `["data.transaction.id", "data.transaction.status", "data.transaction.amount_in_cents"]`)
   - Extract each property value from the body by path (e.g. `"data.transaction.id"` → `body.data.transaction.id`)
   - Concatenate their string values + the secret, then SHA256 hex
   - Compare with `signature.checksum` (case-insensitive)
2. If signature invalid → return 401.

**On valid webhook:**
1. Only process `event === 'transaction.updated'`.
2. Get `transaction` from `body.data.transaction`.
3. Find the `payments` row by `wompi_reference = transaction.reference`. If not found → return 200 (idempotent).
4. If `payments.status` is already `approved` → return 200 (idempotent, already processed).
5. Update `payments` row: `status = transaction.status`, `wompi_transaction_id = transaction.id`, `updated_at = NOW()`.
6. If `transaction.status === 'APPROVED'`:
   a. Look up `payments.user_id` and `payments.plan`.
   b. Compute new `premium_expires_at`:
      - If user already has `premium_expires_at > NOW()`, extend from there: `premium_expires_at + interval`
      - Otherwise: `NOW() + interval`
      - `monthly` → `+ INTERVAL '30 days'`, `yearly` → `+ INTERVAL '365 days'`
   c. `UPDATE users SET is_premium = true, role = 'premium', premium_expires_at = $new_date WHERE id = $user_id`
   d. Call `awardCredits(userId, 50, 'earn', 'Bono por activar Premium')` — bonus credits on subscription.
7. Return 200 `{ received: true }` regardless of outcome (Wompi expects 200).

---

#### `getPlans` — GET /api/payments/plans

**Auth:** none (public)

**Response:**
```json
{
  "plans": [
    { "id": "monthly", "name": "Mensual", "price_cop": 4900, "duration_days": 30, "features": ["Sin anuncios", "Alertas de bajada gratis", "Acceso prioritario"] },
    { "id": "yearly",  "name": "Anual",   "price_cop": 39900, "duration_days": 365, "features": ["Todo lo de Mensual", "2 meses gratis", "Soporte prioritario"] }
  ]
}
```

---

### `backend/src/routes/paymentRoutes.ts`

```
GET  /api/payments/plans     → getPlans       (no auth)
POST /api/payments/checkout  → createCheckout (authMiddleware)
POST /api/payments/webhook   → handleWebhook  (no auth, verified by signature)
```

Import and register in `backend/src/index.ts`:
```ts
import paymentRoutes from './routes/paymentRoutes';
app.use('/api/payments', paymentRoutes);
```

---

## Frontend: New Files

### `web/src/pages/PremiumPage.tsx`

**Route:** `/premium` — add to `App.tsx` inside `PublicLayout` routes

**UI layout:**
- Header: "MiBus Premium" + subtitle "Viaja más inteligente"
- If user already has `is_premium === true` or `role === 'premium'`: show "Ya eres Premium ✓" badge with `premium_expires_at` formatted date. No checkout buttons.
- Two plan cards side by side (or stacked on mobile):
  - Monthly card: price, features list, "Suscribirse" button
  - Yearly card: highlighted as "Más popular", price with note "ahorras X%", features list, "Suscribirse" button
- On "Suscribirse" click:
  1. Call `paymentsApi.createCheckout(plan)`
  2. On success: `window.location.href = checkout_url` (redirect to Wompi)
  3. On error: show toast with error message
  4. Show loading spinner on button while fetching
- Styling: TailwindCSS, consistent with existing app (rounded-2xl cards, blue-600 primary, green for yearly)

---

### `web/src/pages/PaymentResultPage.tsx`

**Route:** `/payment/result` — add to `App.tsx` inside `PublicLayout` routes

**Logic:**
- Wompi redirects here after payment with query params: `?id=TRANSACTION_ID&status=APPROVED|DECLINED&...`
- Read `status` from `URLSearchParams`
- If `status === 'APPROVED'`:
  - Call `authApi.getProfile()` to refresh user data (so credits/premium status update)
  - Show success card: "¡Ya eres Premium! 🎉", mention bonus 50 credits, button "Ir al mapa →" → navigate('/map')
- If `status === 'DECLINED'` or `status === 'VOIDED'` or `status === 'ERROR'`:
  - Show error card: "El pago no fue procesado", button "Intentar de nuevo" → navigate('/premium')
- If no status param: redirect to '/map'

---

### `web/src/services/api.ts` — add `paymentsApi`

```ts
export const paymentsApi = {
  getPlans: () =>
    api.get('/api/payments/plans'),

  createCheckout: (plan: 'monthly' | 'yearly') =>
    api.post('/api/payments/checkout', { plan }),
};
```

---

### `web/src/components/Navbar.tsx` — add Premium link

- If `user.role !== 'premium' && user.role !== 'admin'`: show "⚡ Premium" link pointing to `/premium` in the navbar
- If `user.is_premium || user.role === 'premium'`: show "✓ Premium" badge (non-clickable or links to `/premium` for renewal info)

---

## Environment Variables to add

In `docker-compose.yml` under `backend` service environment:
```yaml
WOMPI_PUBLIC_KEY: pub_test_xxxxx
WOMPI_PRIVATE_KEY: prv_test_xxxxx
WOMPI_EVENT_SECRET: test_events_xxxxx
APP_URL: http://localhost:5173
```

In Railway backend environment (production):
```
WOMPI_PUBLIC_KEY=pub_prod_xxxxx
WOMPI_PRIVATE_KEY=prv_prod_xxxxx
WOMPI_EVENT_SECRET=prod_events_xxxxx
APP_URL=https://mibus.co
```

Use sandbox URLs (`sandbox.wompi.co`) when `NODE_ENV !== 'production'`, production URLs otherwise.

---

## Implementation Notes for Codex

- Use `node-fetch` or `axios` (already installed) for Wompi API HTTP calls — prefer `axios` since it's already a dependency
- Use `crypto` (Node.js built-in) for SHA256 signature verification: `crypto.createHash('sha256').update(str).digest('hex')`
- All new backend files follow the existing pattern: controller exports named async functions, routes file wires them with express Router
- TypeScript: all request/response types should be explicit, no `any` unless unavoidable
- Do not modify existing tables or controllers — only add new files + migrations + route registration
- Wompi sandbox base URL: `https://sandbox.wompi.co/v1`
- Wompi production base URL: `https://production.wompi.co/v1`
- The `payments` table `amount_cents` stores the amount in centavos (multiply COP price × 100)
