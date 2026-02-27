import { Request, Response } from 'express';
import pool from '../config/database';

// Listar todas las rutas activas
export const listRoutes = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT r.*, c.name AS company_name
       FROM routes r
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE r.is_active = true
       ORDER BY r.name ASC`
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
      `SELECT r.*, c.name AS company_name
       FROM routes r
       LEFT JOIN companies c ON c.id = r.company_id
       WHERE r.id = $1`,
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
  const { name, code, company, company_id, first_departure, last_departure, frequency_minutes } = req.body;

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
      `INSERT INTO routes (name, code, company, company_id, first_departure, last_departure, frequency_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, code, company, company_id ?? null, first_departure, last_departure, frequency_minutes]
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

// Rutas cercanas a una coordenada (Haversine sobre paradas)
export const getNearbyRoutes = async (req: Request, res: Response): Promise<void> => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    res.status(400).json({ message: 'lat y lng son obligatorios' });
    return;
  }

  const radiusKm = parseFloat(radius as string) || 0.5;

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (r.id) r.*,
              MIN(
                6371 * acos(
                  cos(radians($1)) * cos(radians(s.latitude)) *
                  cos(radians(s.longitude) - radians($2)) +
                  sin(radians($1)) * sin(radians(s.latitude))
                )
              ) OVER (PARTITION BY r.id) AS min_distance
       FROM routes r
       JOIN stops s ON s.route_id = r.id
       WHERE r.is_active = true
         AND (
           6371 * acos(
             cos(radians($1)) * cos(radians(s.latitude)) *
             cos(radians(s.longitude) - radians($2)) +
             sin(radians($1)) * sin(radians(s.latitude))
           )
         ) < $3
       ORDER BY r.id, min_distance ASC`,
      [parseFloat(lat as string), parseFloat(lng as string), radiusKm]
    );

    res.json({ routes: result.rows });

  } catch (error) {
    console.error('Error buscando rutas cercanas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Actualizar ruta (requiere admin)
export const updateRoute = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, code, company, company_id, first_departure, last_departure, frequency_minutes } = req.body;

  try {
    const exists = await pool.query('SELECT id FROM routes WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const result = await pool.query(
      `UPDATE routes
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           company = COALESCE($3, company),
           company_id = COALESCE($4, company_id),
           first_departure = COALESCE($5, first_departure),
           last_departure = COALESCE($6, last_departure),
           frequency_minutes = COALESCE($7, frequency_minutes)
       WHERE id = $8
       RETURNING *`,
      [name, code, company, company_id ?? null, first_departure, last_departure, frequency_minutes, id]
    );

    res.json({ message: 'Ruta actualizada', route: result.rows[0] });

  } catch (error) {
    console.error('Error actualizando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Eliminar ruta y sus paradas (requiere admin)
export const deleteRoute = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const exists = await pool.query('SELECT id FROM routes WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    // Eliminar paradas primero (FK sin CASCADE)
    await pool.query('DELETE FROM stops WHERE route_id = $1', [id]);
    await pool.query('DELETE FROM routes WHERE id = $1', [id]);

    res.json({ message: 'Ruta eliminada correctamente' });

  } catch (error) {
    console.error('Error eliminando ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Alternar is_active de una ruta (requiere admin)
export const toggleRouteActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE routes SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const route = result.rows[0];
    res.json({
      route,
      message: route.is_active ? 'Ruta activada' : 'Ruta desactivada',
    });

  } catch (error) {
    console.error('Error alternando estado de la ruta:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Seed deshabilitado — las rutas se crean desde el panel admin
export const seedRoutesHandler = async (_req: Request, res: Response): Promise<void> => {
  res.json({ message: 'Seed deshabilitado. Usa el panel admin para crear rutas.' });
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
