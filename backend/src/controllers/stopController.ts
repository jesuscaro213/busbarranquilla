import { Request, Response } from 'express';
import pool from '../config/database';

// Agregar parada a una ruta (protegido)
export const addStop = async (req: Request, res: Response): Promise<void> => {
  const { route_id, name, latitude, longitude, stop_order } = req.body;

  if (!route_id || latitude === undefined || longitude === undefined || stop_order === undefined) {
    res.status(400).json({ message: 'route_id, latitude, longitude y stop_order son obligatorios' });
    return;
  }

  try {
    const routeExists = await pool.query(
      'SELECT id FROM routes WHERE id = $1',
      [route_id]
    );

    if (routeExists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO stops (route_id, name, latitude, longitude, stop_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [route_id, name, latitude, longitude, stop_order]
    );

    res.status(201).json({
      message: 'Parada agregada exitosamente',
      stop: result.rows[0]
    });

  } catch (error) {
    console.error('Error agregando parada:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Listar paradas de una ruta (público)
export const listStops = async (req: Request, res: Response): Promise<void> => {
  const { routeId } = req.params;

  try {
    const routeExists = await pool.query(
      'SELECT id FROM routes WHERE id = $1',
      [routeId]
    );

    if (routeExists.rows.length === 0) {
      res.status(404).json({ message: 'Ruta no encontrada' });
      return;
    }

    const result = await pool.query(
      'SELECT * FROM stops WHERE route_id = $1 ORDER BY stop_order ASC',
      [routeId]
    );

    res.json({ stops: result.rows });

  } catch (error) {
    console.error('Error listando paradas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// Eliminar parada (protegido)
export const deleteStop = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const stopExists = await pool.query(
      'SELECT id FROM stops WHERE id = $1',
      [id]
    );

    if (stopExists.rows.length === 0) {
      res.status(404).json({ message: 'Parada no encontrada' });
      return;
    }

    await pool.query('DELETE FROM stops WHERE id = $1', [id]);

    res.json({ message: 'Parada eliminada' });

  } catch (error) {
    console.error('Error eliminando parada:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
