import { Request, Response } from 'express';
import pool from '../config/database';

const VALID_ROLES = ['admin', 'premium', 'free'] as const;
type Role = typeof VALID_ROLES[number];

// GET /api/admin/users — listar todos los usuarios (nunca devuelve password)
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  const { role } = req.query;

  try {
    let query = `
      SELECT id, name, email, phone, credits, role, is_premium, is_active,
             trial_expires_at, premium_expires_at, reputation, created_at
      FROM users
    `;
    const params: string[] = [];

    if (role && VALID_ROLES.includes(role as Role)) {
      query += ' WHERE role = $1';
      params.push(role as string);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ users: result.rows, total: result.rows.length });

  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/admin/users/:id — obtener un usuario por ID
export const getUserById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, credits, role, is_premium, is_active,
              trial_expires_at, premium_expires_at, reputation, created_at
       FROM users WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/admin/users/:id/role — cambiar rol de un usuario
export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role || !VALID_ROLES.includes(role as Role)) {
    res.status(400).json({ message: `role debe ser uno de: ${VALID_ROLES.join(', ')}` });
    return;
  }

  try {
    // Verificar que el usuario existe
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    // Sincronizar is_premium según el rol
    let isPremium: boolean | undefined;
    if (role === 'premium') isPremium = true;
    if (role === 'free') isPremium = false;

    const result = await pool.query(
      `UPDATE users
       SET role = $1${isPremium !== undefined ? ', is_premium = $3' : ''}
       WHERE id = $2
       RETURNING id, name, email, phone, credits, role, is_premium, is_active,
                 trial_expires_at, premium_expires_at, reputation, created_at`,
      isPremium !== undefined ? [role, id, isPremium] : [role, id]
    );

    res.json({ user: result.rows[0] });

  } catch (error) {
    console.error('Error actualizando rol:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/admin/users/:id/toggle-active — activar / desactivar usuario
export const toggleUserActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = NOT is_active WHERE id = $1
       RETURNING id, name, email, credits, role, is_premium, is_active, created_at`,
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user,
      message: user.is_active ? 'Usuario reactivado' : 'Usuario dado de baja',
    });

  } catch (error) {
    console.error('Error alternando estado del usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// DELETE /api/admin/users/:id — eliminar usuario
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'Usuario eliminado correctamente' });

  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/admin/companies — listar empresas
export const getAllCompanies = async (req: Request, res: Response): Promise<void> => {
  const { is_active } = req.query;

  try {
    let query = 'SELECT * FROM companies';
    const params: unknown[] = [];

    if (is_active === 'true' || is_active === 'false') {
      query += ' WHERE is_active = $1';
      params.push(is_active === 'true');
    }

    query += ' ORDER BY name ASC';

    const result = await pool.query(query, params);
    res.json({ companies: result.rows, total: result.rows.length });

  } catch (error) {
    console.error('Error listando empresas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// GET /api/admin/companies/:id — obtener empresa con sus rutas
export const getCompanyById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const companyResult = await pool.query(
      'SELECT * FROM companies WHERE id = $1',
      [id]
    );

    if (companyResult.rows.length === 0) {
      res.status(404).json({ message: 'Empresa no encontrada' });
      return;
    }

    const routesResult = await pool.query(
      `SELECT id, name, code, is_active, frequency_minutes
       FROM routes WHERE company_id = $1 ORDER BY name ASC`,
      [id]
    );

    res.json({ company: companyResult.rows[0], routes: routesResult.rows });

  } catch (error) {
    console.error('Error obteniendo empresa:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// POST /api/admin/companies — crear empresa
export const createCompany = async (req: Request, res: Response): Promise<void> => {
  const { name, nit, phone, email } = req.body;

  if (!name) {
    res.status(400).json({ message: 'El nombre de la empresa es obligatorio' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO companies (name, nit, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, nit ?? null, phone ?? null, email ?? null]
    );

    res.status(201).json({ message: 'Empresa creada exitosamente', company: result.rows[0] });

  } catch (error) {
    console.error('Error creando empresa:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PUT /api/admin/companies/:id — actualizar empresa (parcial)
export const updateCompany = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, nit, phone, email } = req.body;

  try {
    const exists = await pool.query('SELECT id FROM companies WHERE id = $1', [id]);
    if (exists.rows.length === 0) {
      res.status(404).json({ message: 'Empresa no encontrada' });
      return;
    }

    const result = await pool.query(
      `UPDATE companies
       SET name  = COALESCE($1, name),
           nit   = COALESCE($2, nit),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email)
       WHERE id = $5
       RETURNING *`,
      [name ?? null, nit ?? null, phone ?? null, email ?? null, id]
    );

    res.json({ message: 'Empresa actualizada', company: result.rows[0] });

  } catch (error) {
    console.error('Error actualizando empresa:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// PATCH /api/admin/companies/:id/toggle-active — alternar estado activo
export const toggleCompanyActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE companies SET is_active = NOT is_active WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Empresa no encontrada' });
      return;
    }

    const company = result.rows[0];
    res.json({
      company,
      message: company.is_active ? 'Empresa reactivada' : 'Empresa desactivada',
    });

  } catch (error) {
    console.error('Error alternando estado de la empresa:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};

// DELETE /api/admin/companies/:id — eliminar empresa
export const deleteCompany = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const activeRoutes = await pool.query(
      'SELECT COUNT(*) FROM routes WHERE company_id = $1 AND is_active = true',
      [id]
    );

    const count = parseInt(activeRoutes.rows[0].count, 10);
    if (count > 0) {
      res.status(400).json({
        message: `No se puede eliminar: la empresa tiene ${count} rutas activas asociadas`,
      });
      return;
    }

    const result = await pool.query('DELETE FROM companies WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Empresa no encontrada' });
      return;
    }

    res.json({ message: 'Empresa eliminada correctamente' });

  } catch (error) {
    console.error('Error eliminando empresa:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
};
