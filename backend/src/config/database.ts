import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', () => {
  console.log('Conectado a PostgreSQL');
});

pool.on('error', (err: Error) => {
  console.error(' Error en PostgreSQL:', err);
  process.exit(-1);
});

export default pool;