# Spec 55 — Dirección de paradas en DB (columna `address` en `stops`)

## Problema

El endpoint `/api/routes/plan` necesita mostrar la dirección real de la parada de bajada
(ej. "Carrera 52 con Calle 45, Barrio América") en vez de "Parada 67".
La solución anterior hacía llamadas HTTP a Nominatim + Overpass en runtime por cada request,
lo que genera latencia, dependencia de servicios externos y riesgo de rate-limiting.

## Solución

Guardar la dirección geocodificada directamente en la columna `stops.address`.
Se geocodifica una sola vez con un script offline, con rate limiting controlado.
En runtime el planner hace un JOIN normal — cero llamadas externas.

---

## Paso 1 — Migración en `backend/src/config/schema.ts`

Agregar al bloque de migrations existente (`ALTER TABLE ADD COLUMN IF NOT EXISTS`):

```typescript
await pool.query(`ALTER TABLE stops ADD COLUMN IF NOT EXISTS address TEXT`);
console.log('✅ Columna address en stops');
```

---

## Paso 2 — Script de geocodificación `backend/scripts/geocode-stops.ts`

Crea el archivo. Geocodifica todas las paradas sin `address` llamando a Nominatim
(1 request/segundo para respetar rate limit) + Overpass para la calle cruzada.

```typescript
import pool from '../src/config/database';

const NOMINATIM_DELAY_MS = 1100;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchNominatim(lat: number, lng: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es&zoom=17`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'MiBus/1.0 (mibus.co)' },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as {
    address?: {
      road?: string; highway?: string; pedestrian?: string; footway?: string;
      suburb?: string; neighbourhood?: string; city_district?: string; quarter?: string;
    };
  };
  const road = data.address?.road ?? data.address?.highway ?? data.address?.pedestrian ?? data.address?.footway;
  const barrio = data.address?.suburb ?? data.address?.neighbourhood ?? data.address?.city_district ?? data.address?.quarter;
  return { road, barrio };
}

async function fetchCrossStreet(lat: number, lng: number, mainRoad: string | undefined) {
  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=[out:json][timeout:6];way(around:40,${lat},${lng})["highway"]["name"];out tags;`,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return undefined;
    const data = await resp.json() as { elements?: { tags?: { name?: string } }[] };
    return (data.elements ?? [])
      .map((w) => w.tags?.name)
      .find((n): n is string => !!n && n !== mainRoad);
  } catch {
    return undefined;
  }
}

async function main() {
  const { rows: stops } = await pool.query<{ id: number; latitude: string; longitude: string }>(
    `SELECT id, latitude, longitude FROM stops WHERE address IS NULL ORDER BY id`
  );

  console.log(`Geocodificando ${stops.length} paradas...`);

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const lat = parseFloat(stop.latitude);
    const lng = parseFloat(stop.longitude);

    try {
      const nom = await fetchNominatim(lat, lng);
      const crossStreet = nom?.road
        ? await fetchCrossStreet(lat, lng, nom.road)
        : undefined;

      let address: string | null = null;
      if (nom?.road || nom?.barrio) {
        const streetPart = nom.road
          ? (crossStreet ? `${nom.road} con ${crossStreet}` : nom.road)
          : crossStreet ?? '';
        address = nom.barrio ? `${streetPart}, ${nom.barrio}` : streetPart || null;
      }

      if (address) {
        await pool.query(`UPDATE stops SET address = $1 WHERE id = $2`, [address, stop.id]);
        console.log(`[${i + 1}/${stops.length}] stop ${stop.id} → ${address}`);
      } else {
        console.log(`[${i + 1}/${stops.length}] stop ${stop.id} → sin dirección`);
      }
    } catch (e) {
      console.log(`[${i + 1}/${stops.length}] stop ${stop.id} → error: ${e}`);
    }

    // Rate limit: 1 req/seg a Nominatim
    if (i < stops.length - 1) await sleep(NOMINATIM_DELAY_MS);
  }

  console.log('✅ Geocodificación completada');
  await pool.end();
}

main();
```

Agregar script al `package.json`:
```json
"geocode-stops": "ts-node scripts/geocode-stops.ts"
```

Correr una sola vez en el servidor:
```bash
npm run geocode-stops
```

---

## Paso 3 — Actualizar `getPlanRoutes` en `backend/src/controllers/routeController.ts`

El campo ya está expuesto. Solo asegurarse que `alightingStop` tenga `address` en el SELECT.

Verificar que el query de stops en `getPlanRoutes` incluya la columna `address`:

```sql
-- El SELECT de stops debe incluir address:
SELECT id, route_id, name, latitude, longitude, stop_order, leg, address
FROM stops WHERE route_id = ANY($1)
```

En el `results.push(...)`, ya existe:
```typescript
nearest_stop_address: alightingStop?.address ?? null,
```

No hay más cambios en el controller.

---

## Paso 4 — Flutter (ya implementado en sesiones anteriores)

`PlanResult` ya tiene `nearestStopAddress` desde spec implícito de esta sesión:
- `lib/core/domain/models/plan_result.dart` — campo `nearestStopAddress`, `fromJson`, `toJson`, `copyWith`
- `lib/features/planner/widgets/plan_result_card.dart` — muestra `nearestStopAddress ?? nearestStopName`

No hay cambios Flutter pendientes.

---

## Verificación

```bash
~/development/flutter/bin/flutter analyze  # 0 issues
```

En el servidor tras correr el script:
```sql
SELECT id, name, address FROM stops WHERE address IS NOT NULL LIMIT 10;
```

En el planner de la app: las tarjetas de resultado deben mostrar
"Carrera 52 con Calle 45, Barrio América" en lugar de "Parada 67".
