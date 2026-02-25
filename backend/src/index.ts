import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import pool from './config/database';
import createTables from './config/schema';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ 
    message: 'BusBarranquilla API funcionando',
    version: '1.0.0'
  });
});

// Socket.io — tiempo real
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
  
  // Probar conexión a base de datos
  try {
    await pool.query('SELECT NOW()');
    await createTables();
  } catch (error) {
    console.log('Base de datos no conectada aún');
  }
});

export { io };