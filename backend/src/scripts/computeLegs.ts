/**
 * computeLegs.ts — Script de migración one-shot
 *
 * Procesa todas las rutas existentes que ya tienen geometry.
 * Úsalo una sola vez para las rutas que existían antes de esta feature.
 *
 * Run inside Docker:
 *   docker-compose exec backend npx ts-node src/scripts/computeLegs.ts
 */

import pool from '../config/database';
import { computeLegsForRoute } from '../services/legService';

async function main() {
  const { rows } = await pool.query(
    `SELECT id, name FROM routes WHERE geometry IS NOT NULL ORDER BY id ASC`
  );

  console.log(`Found ${rows.length} routes with geometry`);

  for (const route of rows) {
    await computeLegsForRoute(route.id);
    console.log(`  ✅ Route ${route.id} (${route.name})`);
  }

  console.log(`\nDone. Processed ${rows.length} routes.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
