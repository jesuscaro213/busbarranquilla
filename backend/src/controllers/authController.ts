import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database';

// Registro de usuario
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, phone } = req.body;

  try {
    // Verificar si el usuario ya existe
    const userExists = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      res.status(400).json({ message: 'El correo ya está registrado' });
      return;
    }

    // Encriptar contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear usuario con 14 días premium gratis y 50 créditos iniciales
    const result = await pool.query(
      `INSERT INTO users (name, email, password, phone, credits, is_premium, trial_expires_at)
       VALUES ($1, $2, $3, $4, 50, true, NOW() + INTERVAL '14 days')
       RETURNING id, name, email, credits, is_premium, trial_expires_at`,
      [name, email, hashedPassword, phone]
    );

    const user = result.rows[0];

    // Registrar créditos iniciales en el historial
    await pool.query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, 50, 'bonus', 'Créditos de bienvenida')`,
      [user.id]
    );

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: '¡Bienvenido a BusBarranquilla! Tienes 14 días premium gratis',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        is_premium: user.is_premium,
        trial_expires_at: user.trial_expires_at
      }
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Login de usuario
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    // Buscar usuario
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ message: 'Correo o contraseña incorrectos' });
      return;
    }

    const user = result.rows[0];

    // Verificar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(400).json({ message: 'Correo o contraseña incorrectos' });
      return;
    }

    // Verificar si el trial expiró y actualizar premium
    if (user.trial_expires_at < new Date() && user.is_premium && !user.premium_expires_at) {
      await pool.query(
        'UPDATE users SET is_premium = false WHERE id = $1',
        [user.id]
      );
      user.is_premium = false;
    }

    // Generar token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Bienvenido de vuelta',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        is_premium: user.is_premium,
        trial_expires_at: user.trial_expires_at,
        premium_expires_at: user.premium_expires_at
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener perfil del usuario autenticado
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, credits, is_premium, 
              trial_expires_at, premium_expires_at, reputation, created_at 
       FROM users WHERE id = $1`,
      [(req as any).userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};