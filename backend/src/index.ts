import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pool from './config/database';
import createTables from './config/schema';
import { setIo } from './config/socket';
import authRoutes from './routes/authRoutes';
import routeRoutes from './routes/routeRoutes';
import stopRoutes from './routes/stopRoutes';
import reportRoutes from './routes/reportRoutes';
import creditRoutes from './routes/creditRoutes';
import tripRoutes from './routes/tripRoutes';
import adminRoutes from './routes/adminRoutes';
import userRoutes from './routes/userRoutes';
import traceRoutes from './routes/traceRoutes';
import suggestionRoutes from './routes/suggestionRoutes';
import paymentRoutes from './routes/paymentRoutes';
import resolutionRoutes from './routes/resolutionRoutes';
import { getRedisClient } from './config/redis';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Railway (and most cloud platforms) sit behind a reverse proxy.
// Trust the first proxy so express-rate-limit can read X-Forwarded-For correctly.
app.set('trust proxy', 1);

// Rate limiters
// Solo para login/register/google — protección contra brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { message: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reportes: máx 15 en 5 min por IP para evitar spam de créditos
const reportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 15,
  message: { message: 'Demasiados reportes en poco tiempo. Espera unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Límite general para todas las demás rutas
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 300,
  message: { message: 'Demasiadas solicitudes. Intenta de nuevo pronto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middlewares — SIEMPRE primero
app.use(cors());
app.use(express.json());
// Acepta body text/plain (usado por navigator.sendBeacon desde el frontend)
app.use(express.text({ type: 'text/plain' }));

// authLimiter solo aplica a los endpoints de credenciales (brute-force)
// GET /api/auth/profile usa generalLimiter para no bloquear cargas normales
app.post('/api/auth/login', authLimiter);
app.post('/api/auth/register', authLimiter);
app.post('/api/auth/google', authLimiter);

// Rutas
app.use('/api/auth', generalLimiter, authRoutes);
app.use('/api/routes', generalLimiter, routeRoutes);
app.use('/api/stops', generalLimiter, stopRoutes);
app.use('/api/reports', reportLimiter, reportRoutes);
app.use('/api/credits', generalLimiter, creditRoutes);
app.use('/api/trips', generalLimiter, tripRoutes);
app.use('/api/admin', generalLimiter, adminRoutes);
app.use('/api/users', generalLimiter, userRoutes);
app.use('/api/traces', generalLimiter, traceRoutes);
app.use('/api/suggestions', generalLimiter, suggestionRoutes);
app.use('/api/payments', generalLimiter, paymentRoutes);
app.use('/api/resolutions', generalLimiter, resolutionRoutes);

// Ruta de prueba
app.get('/', (_req, res) => {
  res.json({
    message: 'BusBarranquilla API funcionando',
    version: '2.0.0'
  });
});

// Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

setIo(io);

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);
  socket.on('join:route', (routeId: number) => {
    socket.join(`route:${routeId}`);
  });
  socket.on('leave:route', (routeId: number) => {
    socket.leave(`route:${routeId}`);
  });
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

// Cron: cerrar viajes zombie cada 30 minutos (viajes activos > 4h sin actualización)
setInterval(async () => {
  try {
    const result = await pool.query(`
      UPDATE active_trips
      SET is_active = false, ended_at = NOW()
      WHERE is_active = true
        AND (
          last_location_at < NOW() - INTERVAL '4 hours'
          OR (last_location_at IS NULL AND started_at < NOW() - INTERVAL '4 hours')
        )
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`🧹 ${result.rowCount} viaje(s) zombie cerrado(s)`);
    }
  } catch (err) {
    console.error('Error en cron zombie trips:', err);
  }
}, 30 * 60 * 1000);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await createTables();
    await getRedisClient();
  } catch (error) {
    console.log('Base de datos no conectada aún');
  }
});

export { io };
