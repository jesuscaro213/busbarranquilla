import { Request, Response } from 'express';
import pool from '../config/database';

export const listSuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, geometry, suggested_geometry, suggestion_trace_count, suggestion_updated_at
       FROM routes
       WHERE has_suggestion = true`
    );
    res.json({ suggestions: result.rows });
  } catch (error) {
    console.error('Error listing suggestions:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const applySuggestion = async (req: Request, res: Response): Promise<void> => {
  if ((req as any).userRole !== 'admin') {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE routes
       SET geometry = suggested_geometry,
           has_suggestion = false,
           suggested_geometry = null,
           suggestion_trace_count = 0
       WHERE id = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error applying suggestion:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export const discardSuggestion = async (req: Request, res: Response): Promise<void> => {
  if ((req as any).userRole !== 'admin') {
    res.status(403).json({ message: 'Forbidden' });
    return;
  }

  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE routes
       SET has_suggestion = false,
           suggested_geometry = null,
           suggestion_trace_count = 0
       WHERE id = $1`,
      [id]
    );
    await pool.query(
      `UPDATE route_traces SET status = 'discarded'
       WHERE route_id = $1 AND status = 'processed'`,
      [id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error discarding suggestion:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
