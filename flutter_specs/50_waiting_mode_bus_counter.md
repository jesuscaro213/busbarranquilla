# Spec 50 — Waiting mode: contador de buses + alerta de llegada

## Problem

En modo espera el usuario no sabe si hay buses activos en su ruta cerca. Los marcadores en el mapa
requieren que el usuario esté mirando la pantalla. No hay forma de saber cuántos buses vienen hacia
él ni de recibir un aviso cuando uno esté a punto de llegar.

---

## Comportamiento esperado

- `_WaitingBanner` muestra **"N buses en camino"** (gratis) — solo buses de la ruta seleccionada,
  dentro de 2 km, cuyo índice en la polyline es **menor** al del usuario (vienen hacia él).
- Botón **"Avisarme cuando llegue"** (3 créditos para free; gratis para premium/admin):
  registra una alerta en el backend. Cuando un bus entre al radio de 300 m en dirección correcta,
  el backend dispara un push y elimina la alerta.
- La alerta expira automáticamente a los 30 min si ningún bus llegó.
- Al salir del modo espera el cliente cancela la alerta si estaba activa.

---

## Backend

### File B1 — `backend/src/config/schema.ts`

Add the `waiting_alerts` table after the existing table blocks:

```sql
CREATE TABLE IF NOT EXISTS waiting_alerts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id)   ON DELETE CASCADE,
  route_id      INTEGER REFERENCES routes(id)  ON DELETE CASCADE,
  user_lat      DECIMAL(10,8) NOT NULL,
  user_lng      DECIMAL(11,8) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes'
);
CREATE INDEX IF NOT EXISTS idx_waiting_alerts_route
  ON waiting_alerts(route_id) WHERE is_active = TRUE;
```

Also add the zombie-cleanup query to the startup block that already closes stale active trips:

**Old:**
```typescript
    await pool.query(`
      UPDATE active_trips
      SET is_active = false, ended_at = NOW()
      WHERE is_active = true
        AND last_location_at < NOW() - INTERVAL '4 hours'
    `);
```

**New:**
```typescript
    await pool.query(`
      UPDATE active_trips
      SET is_active = false, ended_at = NOW()
      WHERE is_active = true
        AND last_location_at < NOW() - INTERVAL '4 hours'
    `);
    await pool.query(`
      UPDATE waiting_alerts SET is_active = false
      WHERE is_active = true AND expires_at < NOW()
    `);
```

---

### File B2 — `backend/src/controllers/routeController.ts`

Add the `findNearestIdx` helper and `getNearbyBuses` controller at the bottom of the file (before
the closing export if any):

```typescript
function findNearestIdx(geometry: [number, number][], lat: number, lng: number): number {
  let minDist = Infinity;
  let idx = 0;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineKm(lat, lng, geometry[i][0], geometry[i][1]);
    if (d < minDist) { minDist = d; idx = i; }
  }
  return idx;
}

// GET /api/routes/:id/nearby-buses?userLat=X&userLng=Y&radiusKm=2
export const getNearbyBuses = async (req: Request, res: Response): Promise<void> => {
  const routeId = parseInt(req.params.id, 10);
  const userLat = parseFloat(req.query.userLat as string);
  const userLng = parseFloat(req.query.userLng as string);
  const radiusKm = parseFloat((req.query.radiusKm as string) ?? '2');

  if (isNaN(userLat) || isNaN(userLng)) {
    res.status(400).json({ error: 'userLat and userLng required' });
    return;
  }

  const routeResult = await pool.query(
    'SELECT geometry FROM routes WHERE id = $1',
    [routeId],
  );
  const geometry: [number, number][] | null = routeResult.rows[0]?.geometry ?? null;

  const tripsResult = await pool.query(
    `SELECT current_latitude, current_longitude
     FROM active_trips
     WHERE route_id = $1 AND is_active = true
       AND last_location_at > NOW() - INTERVAL '5 minutes'`,
    [routeId],
  );

  const userIdx = geometry ? findNearestIdx(geometry, userLat, userLng) : -1;

  let count = 0;
  for (const row of tripsResult.rows) {
    const busLat = parseFloat(row.current_latitude);
    const busLng = parseFloat(row.current_longitude);
    const distKm = haversineKm(userLat, userLng, busLat, busLng);
    if (distKm > radiusKm) continue;

    if (geometry && userIdx > 0) {
      const busIdx = findNearestIdx(geometry, busLat, busLng);
      if (busIdx >= userIdx) continue; // already passed or behind
    }
    count++;
  }

  res.json({ count });
};
```

---

### File B3 — `backend/src/controllers/waitingAlertController.ts` (create)

```typescript
import { Request, Response } from 'express';
import { pool } from '../config/database';
import { haversineKm } from './routeController';

// POST /api/routes/:id/waiting-alert
// Body: { userLat, userLng }
// Charges 3 credits to free users; free for premium/admin.
export const subscribeWaitingAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const routeId = parseInt(req.params.id, 10);
  const { userLat, userLng } = req.body;

  if (!userLat || !userLng) {
    res.status(400).json({ error: 'userLat and userLng required' });
    return;
  }

  const userResult = await pool.query(
    'SELECT credits, is_premium, role FROM users WHERE id = $1',
    [userId],
  );
  const user = userResult.rows[0];
  const isFree = !user.is_premium && user.role === 'free';

  if (isFree) {
    if (user.credits < 3) {
      res.status(402).json({ error: 'insufficient_credits', required: 3, current: user.credits });
      return;
    }
    await pool.query(
      `UPDATE users SET credits = credits - 3 WHERE id = $1`,
      [userId],
    );
    await pool.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, -3, 'spend', 'Alerta bus llegando')`,
      [userId],
    );
  }

  // Deactivate any previous alert for same user+route
  await pool.query(
    `UPDATE waiting_alerts SET is_active = false
     WHERE user_id = $1 AND route_id = $2`,
    [userId, routeId],
  );

  await pool.query(
    `INSERT INTO waiting_alerts (user_id, route_id, user_lat, user_lng)
     VALUES ($1, $2, $3, $4)`,
    [userId, routeId, userLat, userLng],
  );

  res.json({ ok: true });
};

// DELETE /api/routes/:id/waiting-alert
export const unsubscribeWaitingAlert = async (req: Request, res: Response): Promise<void> => {
  const userId = (req as any).userId as number;
  const routeId = parseInt(req.params.id, 10);

  await pool.query(
    `UPDATE waiting_alerts SET is_active = false
     WHERE user_id = $1 AND route_id = $2`,
    [userId, routeId],
  );

  res.json({ ok: true });
};
```

---

### File B4 — `backend/src/controllers/tripController.ts`

Inside `updateLocation`, after the existing boarding alerts block (`boarding_alert_now_sent` check),
add the waiting alerts check. Follow the same try/catch isolation pattern already used for boarding
alerts:

```typescript
    // ── Waiting alerts ────────────────────────────────────────────────────
    try {
      const routeResult = await pool.query(
        'SELECT geometry FROM routes WHERE id = $1',
        [trip.route_id],
      );
      const geometry: [number, number][] | null = routeResult.rows[0]?.geometry ?? null;

      const alertsResult = await pool.query(
        `SELECT wa.id, wa.user_id, wa.user_lat, wa.user_lng, u.fcm_token
         FROM waiting_alerts wa
         JOIN users u ON u.id = wa.user_id
         WHERE wa.route_id = $1 AND wa.is_active = true AND wa.expires_at > NOW()`,
        [trip.route_id],
      );

      for (const alert of alertsResult.rows) {
        const distKm = haversineKm(
          parseFloat(alert.user_lat), parseFloat(alert.user_lng),
          latitude, longitude,
        );
        if (distKm > 0.3) continue;

        // Direction check
        if (geometry) {
          const userIdx = findNearestIdx(geometry,
            parseFloat(alert.user_lat), parseFloat(alert.user_lng));
          const busIdx  = findNearestIdx(geometry, latitude, longitude);
          if (busIdx >= userIdx) continue; // wrong direction
        }

        // Fire push
        if (alert.fcm_token) {
          await sendPushNotification(alert.fcm_token, {
            title: '¡Tu bus está llegando!',
            body: 'Un bus de tu ruta está a menos de 300 m. ¡Prepárate!',
            data: { type: 'bus_arriving', routeId: String(trip.route_id) },
          });
        }

        // Deactivate alert so it only fires once
        await pool.query(
          'UPDATE waiting_alerts SET is_active = false WHERE id = $1',
          [alert.id],
        );
      }
    } catch (err) {
      console.error('Waiting alert check error:', err);
    }
```

> **Note:** `findNearestIdx` and `haversineKm` must be importable from `routeController.ts` — add
> `export` to the `haversineKm` function declaration if not already exported, and export
> `findNearestIdx` too. Import both in `tripController.ts`.

---

### File B5 — `backend/src/routes/routeRoutes.ts`

Add the three new endpoints. Named routes must stay above `/:id`:

```typescript
// Nearby buses counter (direction-aware)
router.get('/:id/nearby-buses', authMiddleware, getNearbyBuses);

// Waiting alerts
router.post('/:id/waiting-alert',    authMiddleware, subscribeWaitingAlert);
router.delete('/:id/waiting-alert',  authMiddleware, unsubscribeWaitingAlert);
```

Import the new controllers at the top of the file:
```typescript
import { getNearbyBuses } from '../controllers/routeController';
import { subscribeWaitingAlert, unsubscribeWaitingAlert } from '../controllers/waitingAlertController';
```

---

## Flutter

### File F1 — `lib/core/api/api_paths.dart`

**Old:**
```dart
  static String routeActivity(int id) => '$_base/routes/$id/activity';
```

**New:**
```dart
  static String routeActivity(int id) => '$_base/routes/$id/activity';
  static String routeNearbyBuses(int id) => '$_base/routes/$id/nearby-buses';
  static String routeWaitingAlert(int id) => '$_base/routes/$id/waiting-alert';
```

---

### File F2 — `lib/core/data/sources/routes_remote_source.dart`

Add two methods:

```dart
  Future<int> getNearbyBusCount({
    required int routeId,
    required double userLat,
    required double userLng,
    double radiusKm = 2.0,
  }) async {
    final response = await _client.get<Map<String, dynamic>>(
      ApiPaths.routeNearbyBuses(routeId),
      queryParameters: {
        'userLat': userLat,
        'userLng': userLng,
        'radiusKm': radiusKm,
      },
    );
    return (response.data!['count'] as num).toInt();
  }

  Future<void> subscribeWaitingAlert({
    required int routeId,
    required double userLat,
    required double userLng,
  }) async {
    await _client.post<void>(
      ApiPaths.routeWaitingAlert(routeId),
      data: {'userLat': userLat, 'userLng': userLng},
    );
  }

  Future<void> unsubscribeWaitingAlert(int routeId) async {
    await _client.delete<void>(ApiPaths.routeWaitingAlert(routeId));
  }
```

---

### File F3 — `lib/core/data/repositories/routes_repository.dart`

Add three methods:

```dart
  Future<Result<int>> getNearbyBusCount({
    required int routeId,
    required double userLat,
    required double userLng,
  }) async {
    try {
      final count = await _source.getNearbyBusCount(
        routeId: routeId,
        userLat: userLat,
        userLng: userLng,
      );
      return Success(count);
    } on DioException catch (e) {
      return Failure(AppError.fromDio(e));
    }
  }

  Future<Result<void>> subscribeWaitingAlert({
    required int routeId,
    required double userLat,
    required double userLng,
  }) async {
    try {
      await _source.subscribeWaitingAlert(
        routeId: routeId,
        userLat: userLat,
        userLng: userLng,
      );
      return const Success(null);
    } on DioException catch (e) {
      return Failure(AppError.fromDio(e));
    }
  }

  Future<void> unsubscribeWaitingAlert(int routeId) async {
    try {
      await _source.unsubscribeWaitingAlert(routeId);
    } catch (_) {}
  }
```

---

### File F4 — `lib/core/l10n/strings.dart`

Add at the end of the `AppStrings` class:

```dart
  static const waitingBusCount0 = 'Sin buses en camino';
  static const waitingBusCount1 = '1 bus en camino';
  static String waitingBusCountN(int n) => '$n buses en camino';
  static const waitingAlertButton = 'Avisarme cuando llegue';
  static const waitingAlertActive = 'Te avisaremos cuando llegue';
  static const waitingAlertActivating = 'Activando alerta…';
  static const waitingAlertInsufficientCredits = 'Necesitas 3 créditos para activar la alerta';
  static const waitingAlertCost = '3 créditos';
```

---

### File F5 — `lib/features/map/screens/map_screen.dart`

This file already has `_WaitingBanner` and the waiting mode state. Make the following additions:

#### 5-A: Add state fields to `_MapScreenState`

**Old:**
```dart
  BusRoute? _waitingRoute;
```

**New:**
```dart
  BusRoute? _waitingRoute;
  int _nearbyBusCount = 0;
  bool _alertActive = false;
  bool _alertLoading = false;
  Timer? _busCountTimer;
```

#### 5-B: Add `_startBusCountPolling` and `_stopBusCountPolling` methods

Add these methods alongside the other waiting-mode helpers in `_MapScreenState`:

```dart
  void _startBusCountPolling(int routeId) {
    _fetchBusCount(routeId);
    _busCountTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _fetchBusCount(routeId);
    });
  }

  void _stopBusCountPolling() {
    _busCountTimer?.cancel();
    _busCountTimer = null;
    if (mounted) setState(() { _nearbyBusCount = 0; _alertActive = false; });
  }

  Future<void> _fetchBusCount(int routeId) async {
    final pos = ref.read(mapNotifierProvider).maybeWhen(
      ready: (pos, _, __, ___) => pos,
      orElse: () => null,
    );
    if (pos == null) return;
    final result = await ref.read(routesRepositoryProvider).getNearbyBusCount(
      routeId: routeId,
      userLat: pos.latitude,
      userLng: pos.longitude,
    );
    if (result is Success && mounted) {
      setState(() => _nearbyBusCount = result.data);
    }
  }

  Future<void> _activateWaitingAlert(int routeId) async {
    final pos = ref.read(mapNotifierProvider).maybeWhen(
      ready: (pos, _, __, ___) => pos,
      orElse: () => null,
    );
    if (pos == null) return;
    setState(() => _alertLoading = true);
    final result = await ref.read(routesRepositoryProvider).subscribeWaitingAlert(
      routeId: routeId,
      userLat: pos.latitude,
      userLng: pos.longitude,
    );
    if (!mounted) return;
    if (result is Success) {
      setState(() { _alertActive = true; _alertLoading = false; });
    } else {
      setState(() => _alertLoading = false);
      final err = (result as Failure).error;
      AppSnackbar.show(context,
        err.code == '402'
            ? AppStrings.waitingAlertInsufficientCredits
            : err.message,
        SnackbarType.error,
      );
    }
  }
```

#### 5-C: Start/stop polling when waiting mode changes

Find the place where `_waitingRoute` is set (entering waiting mode) and cleared (leaving waiting
mode). Add the polling calls:

When setting `_waitingRoute`:
```dart
    _startBusCountPolling(route.id);
```

When clearing `_waitingRoute`:
```dart
    _stopBusCountPolling();
    if (_waitingRoute != null) {
      unawaited(ref.read(routesRepositoryProvider)
          .unsubscribeWaitingAlert(_waitingRoute!.id));
    }
```

Also cancel in `dispose()`:
```dart
    _busCountTimer?.cancel();
```

#### 5-D: Update `_WaitingBanner` to show counter and alert button

Find the `_WaitingBanner` widget build method. Add the counter row and button below the existing
content (route name / "Monitoreando tu posición" chip):

```dart
          // Bus count
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(
                _nearbyBusCount > 0 ? Icons.directions_bus : Icons.directions_bus_outlined,
                size: 15,
                color: _nearbyBusCount > 0 ? AppColors.success : AppColors.textSecondary,
              ),
              const SizedBox(width: 4),
              Text(
                _nearbyBusCount == 0
                    ? AppStrings.waitingBusCount0
                    : _nearbyBusCount == 1
                        ? AppStrings.waitingBusCount1
                        : AppStrings.waitingBusCountN(_nearbyBusCount),
                style: AppTextStyles.caption.copyWith(
                  color: _nearbyBusCount > 0 ? AppColors.success : AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // Alert button
          SizedBox(
            width: double.infinity,
            child: _alertActive
                ? Container(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.success.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.notifications_active, size: 15,
                            color: AppColors.success),
                        const SizedBox(width: 6),
                        Text(AppStrings.waitingAlertActive,
                            style: AppTextStyles.caption
                                .copyWith(color: AppColors.success)),
                      ],
                    ),
                  )
                : AppButton.outlined(
                    label: _alertLoading
                        ? AppStrings.waitingAlertActivating
                        : '${AppStrings.waitingAlertButton} · ${AppStrings.waitingAlertCost}',
                    onPressed: _alertLoading || _waitingRoute == null
                        ? null
                        : () => _activateWaitingAlert(_waitingRoute!.id),
                  ),
          ),
```

---

## Verification

```bash
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/flutter analyze
```

Expected: 0 issues.

## Behavior summary

| Scenario | Result |
|----------|--------|
| Usuario entra en modo espera | Polling cada 30s a `/nearby-buses` |
| 0 buses en 2 km | "Sin buses en camino" (gris) |
| N buses en camino | "N buses en camino" (verde) |
| Toca "Avisarme cuando llegue" (free, ≥3 cr) | Descuenta 3 cr, registra alerta, botón → "Te avisaremos" |
| Toca "Avisarme" (free, <3 cr) | Snackbar error "Necesitas 3 créditos" |
| Toca "Avisarme" (premium/admin) | Gratis, registra alerta |
| Bus entra a 300 m en dirección correcta | Push "¡Tu bus está llegando!" + alerta se desactiva |
| Bus pasa en dirección contraria | Ignorado |
| Usuario sale del modo espera | Polling cancela, alerta se cancela en backend |
| Alerta sin bus por 30 min | Backend la expira automáticamente |
