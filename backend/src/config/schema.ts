import pool from './database';
import bcrypt from 'bcryptjs';

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

    // Tabla de alertas de espera de bus (modo espera)
    await pool.query(`
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
    `);
    console.log('✅ Tabla waiting_alerts creada');

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
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_report_date DATE DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS report_streak INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(10) UNIQUE DEFAULT NULL`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
    await pool.query(`
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);

    // Migraciones para reports
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_lat DECIMAL(10,8)`);
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_lng DECIMAL(11,8)`);
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ DEFAULT NULL`);
    await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS credits_awarded_to_reporter BOOLEAN NOT NULL DEFAULT FALSE`);

    // Descripción textual del recorrido (para detectar cambios en scraper)
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS description TEXT`);

    // Estado de la ruta: 'active' (verificada) | 'pending' (importada del blog)
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
    console.log('✅ Columna status en routes');

    // Geometría de ruta (polyline de OSRM)
    await pool.query(`
      ALTER TABLE routes ADD COLUMN IF NOT EXISTS geometry JSONB DEFAULT NULL
    `);

    // Tabla de confirmaciones de reportes por usuario
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_confirmations (
        id SERIAL PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(report_id, user_id)
      )
    `);
    console.log('✅ Tabla report_confirmations creada');

    // Tabla de rutas favoritas por usuario
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_favorite_routes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, route_id)
      )
    `);
    console.log('✅ Tabla user_favorite_routes creada');

    // Tabla de trazados de ruta aportados por usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS route_traces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        points JSONB NOT NULL,
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP NOT NULL,
        point_count INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_route_traces_route_id ON route_traces(route_id)
    `);
    console.log('✅ Tabla route_traces creada');

    // Columnas para geometría sugerida por usuarios en routes
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS suggested_geometry JSONB`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS has_suggestion BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS suggestion_trace_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS suggestion_updated_at TIMESTAMP`);
    console.log('✅ Columnas de sugerencia de trazado en routes');

    // Ampliar code a VARCHAR(100) para soportar slugs largos del blog
    await pool.query(`ALTER TABLE routes ALTER COLUMN code TYPE VARCHAR(100)`);
    console.log('✅ Columna code ampliada a VARCHAR(100)');

    // Índice único en companies.name para soportar upsert del scraper
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS companies_name_unique ON companies(name)
    `);
    console.log('✅ Índice único en companies(name)');

    // Tipo de servicio y color de línea
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'bus'`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#1d4ed8'`);
    console.log('✅ Columnas type y color en routes');

    // Detección de tramo ida/regreso
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS turnaround_idx INTEGER DEFAULT NULL`);
    await pool.query(`
      ALTER TABLE stops ADD COLUMN IF NOT EXISTS leg VARCHAR(10) DEFAULT 'ida'
        CHECK (leg IN ('ida', 'regreso'))
    `);
    console.log('✅ Columnas turnaround_idx en routes y leg en stops');

    // Tabla de pagos Wompi
    await pool.query(`
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
      )
    `);
    console.log('✅ Tabla payments creada');

    // Tabla de reportes de ruta desactualizada (usuarios detectan que el bus tomó otro camino)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS route_update_reports (
        id SERIAL PRIMARY KEY,
        route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
        tipo     VARCHAR(20) NOT NULL CHECK (tipo IN ('trancon', 'ruta_real')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(route_id, user_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_route_update_reports_route_id
        ON route_update_reports(route_id)
    `);
    console.log('✅ Tabla route_update_reports creada');

    // Columna para marcar cuándo el admin revisó la alerta de ruta desactualizada
    await pool.query(`
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS route_alert_reviewed_at TIMESTAMPTZ DEFAULT NULL
    `);
    console.log('✅ Columna route_alert_reviewed_at en routes');

    // Marca de edición manual por el admin (protege la ruta de ser sobreescrita en imports)
    await pool.query(`
      ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS manually_edited_at TIMESTAMPTZ DEFAULT NULL
    `);
    console.log('✅ Columna manually_edited_at en routes');

    // Track GPS reportado por el usuario al votar ruta_real
    await pool.query(`
      ALTER TABLE route_update_reports
        ADD COLUMN IF NOT EXISTS reported_geometry JSONB DEFAULT NULL
    `);
    console.log('✅ Columna reported_geometry en route_update_reports');

    // Distancia total acumulada por viaje (para validar que recorrió ≥2 km)
    await pool.query(`
      ALTER TABLE active_trips
        ADD COLUMN IF NOT EXISTS total_distance_meters DECIMAL(10,2) DEFAULT 0
    `);
    console.log('✅ Columna total_distance_meters en active_trips');

    // Token FCM para push notifications (Firebase Cloud Messaging)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT DEFAULT NULL`);
    console.log('✅ Columna fcm_token en users');

    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{}'
    `);

    // Destino personalizado (mapa): cuando el usuario pica un punto libre en vez de una parada
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS custom_destination_lat DECIMAL(10,8) DEFAULT NULL`);
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS custom_destination_lng DECIMAL(11,8) DEFAULT NULL`);
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS custom_destination_name TEXT DEFAULT NULL`);
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS gps_trace JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS boarding_alert_prepare_sent BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE active_trips ADD COLUMN IF NOT EXISTS boarding_alert_now_sent BOOLEAN DEFAULT FALSE`);

    await pool.query(`
      ALTER TABLE route_update_reports
        DROP CONSTRAINT IF EXISTS route_update_reports_route_id_user_id_key
    `);
    console.log('✅ Columnas custom_destination en active_trips');

    // Cerrar viajes zombie (activos por más de 4 horas sin actualización de ubicación)
    const zombieClosed = await pool.query(`
      UPDATE active_trips
      SET is_active = false, ended_at = NOW()
      WHERE is_active = true
        AND (
          last_location_at < NOW() - INTERVAL '4 hours'
          OR (last_location_at IS NULL AND started_at < NOW() - INTERVAL '4 hours')
        )
      RETURNING id
    `);
    if (zombieClosed.rowCount && zombieClosed.rowCount > 0) {
      console.log(`🧹 ${zombieClosed.rowCount} viaje(s) zombie cerrados automáticamente`);
    }
    await pool.query(`
      UPDATE waiting_alerts SET is_active = false
      WHERE is_active = true AND expires_at < NOW()
    `);

    // Seed automático de usuario admin (debe correr después de todas las migraciones)
    const adminCheck = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('MiBus@Admin1', 10);
      await pool.query(
        `INSERT INTO users (name, email, password, role, is_active, is_premium, credits)
         VALUES ('Administrador', 'admin@mibus.co', $1, 'admin', true, true, 9999)
         ON CONFLICT (email) DO UPDATE SET role = 'admin', is_active = true`,
        [hash]
      );
      console.log('👤 Usuario admin creado: admin@mibus.co');
    }

    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS last_resolution VARCHAR(50)`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS last_resolution_date DATE`);

    console.log('🎉 Base de datos lista');

  } catch (error) {
    console.error('❌ Error creando tablas:', error);
  }
};

export default createTables;
