import pool from './database';
import { seedRoutes } from '../scripts/seedRoutes';

const createTables = async () => {
  try {

    // Tabla de usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        credits INTEGER DEFAULT 50,
        is_premium BOOLEAN DEFAULT FALSE,
        premium_expires_at TIMESTAMP,
        trial_expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
        reputation INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla users creada');

    // Tabla de empresas de transporte
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        nit VARCHAR(30),
        phone VARCHAR(20),
        email VARCHAR(150),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla companies creada');

    // Tabla de rutas de buses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS routes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        company VARCHAR(100),
        first_departure TIME,
        last_departure TIME,
        frequency_minutes INTEGER,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla routes creada');

    // Tabla de paradas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stops (
        id SERIAL PRIMARY KEY,
        route_id INTEGER REFERENCES routes(id),
        name VARCHAR(100),
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        stop_order INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla stops creada');

    // Tabla de reportes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        route_id INTEGER REFERENCES routes(id),
        type VARCHAR(50) NOT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        confirmations INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 minutes')
      );
    `);
    console.log('✅ Tabla reports creada');

    // Tabla de transacciones de créditos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Tabla credit_transactions creada');

    // Tabla de viajes activos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS active_trips (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
        current_latitude DECIMAL(10,8),
        current_longitude DECIMAL(11,8),
        destination_stop_id INTEGER REFERENCES stops(id) ON DELETE SET NULL,
        started_at TIMESTAMP DEFAULT NOW(),
        last_location_at TIMESTAMP,
        ended_at TIMESTAMP,
        credits_earned INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true
      );
    `);
    console.log('✅ Tabla active_trips creada');

    // Seed automático si la tabla de rutas está vacía
    const { rows } = await pool.query('SELECT COUNT(*) FROM routes');
    if (parseInt(rows[0].count, 10) === 0) {
      console.log('📦 Tabla routes vacía — ejecutando seed de Barranquilla...');
      const summary = await seedRoutes(pool);
      console.log(`✅ Seed completado: ${summary.routesInserted} rutas, ${summary.stopsInserted} paradas`);
    }

    // Migraciones seguras para campos nuevos en tabla users
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'free'
          CHECK (role IN ('admin', 'premium', 'free'))
    `);
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await pool.query(`
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);

    console.log('🎉 Base de datos lista');

  } catch (error) {
    console.error('❌ Error creando tablas:', error);
  }
};

export default createTables;