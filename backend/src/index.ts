import express from 'express';
import cors from 'cors';
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

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Middlewares — SIEMPRE primero
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/stops', stopRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/admin', adminRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
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
  socket.on('disconnect', () => {
    console.log('Usuario desconectado:', socket.id);
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  try {
    await pool.query('SELECT NOW()');
    await createTables();
  } catch (error) {
    console.log('Base de datos no conectada aún');
  }
});

export { io };
