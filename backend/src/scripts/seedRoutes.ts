import { Pool } from 'pg';

export async function seedRoutes(_pool: Pool): Promise<{ routesInserted: number; stopsInserted: number }> {
  return { routesInserted: 0, stopsInserted: 0 };
}
