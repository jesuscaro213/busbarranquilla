import { Request, Response } from 'express';
import pool from '../config/database';

// Listar todas las rutas activas
export const listRoutes = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT * FROM routes WHERE is_active = true ORDER BY name ASC'
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error listando rutas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Obtener ruta por ID con sus paradas
export const getRouteById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const routeResult = await pool.query(
      'SELECT * FROM routes WHERE id = $1',
      [id]
    );

    if (routeResult.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const stopsResult = await pool.query(
      'SELECT * FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
      [id]
    );

    const route = {
      ...routeResult.rows[0],
      stops: stopsResult.rows
    };

    res.json({ route });

  } catch (error) {
    console.error('Error obteniendo ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Crear ruta nueva (requiere autenticación)
export const createRoute = async (req: Request, res: Response): Promise<void> => {
  const { name, code, company, first_departure, last_departure, frequency_minutes } = req.body;

  if (!name || !code) {
    res.status(400).json({ message: 'El nombre y el código de la ruta son obligatorios' });
    return;
  }

  try {
    const codeExists = await pool.query(
      'SELECT id FROM routes WHERE code = $1',
      [code]
    );

    if (codeExists.rows.length > 0) {
      res.status(400).json({ message: 'El código de ruta ya existe' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO routes (name, code, company, first_departure, last_departure, frequency_minutes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, code, company, first_departure, last_departure, frequency_minutes]
    );

    res.status(201).json({
      message: 'Ruta creada exitosamente',
      route: result.rows[0]
    });

  } catch (error) {
    console.error('Error creando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Buscar rutas que sirven entre origen y destino
export const searchRoute = async (req: Request, res: Response): Promise<void> => {
  const { origin, destination } = req.query;

  if (!origin || !destination) {
    res.status(400).json({ message: 'Se requieren los parámetros origin y destination' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT DISTINCT r.*
       FROM routes r
       JOIN stops s1 ON s1.route_id = r.id
       JOIN stops s2 ON s2.route_id = r.id
       WHERE s1.name ILIKE $1
         AND s2.name ILIKE $2
         AND s1.stop_order < s2.stop_order
         AND r.is_active = true
       ORDER BY r.name ASC`,
      [`%${origin}%`, `%${destination}%`]
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error buscando rutas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
