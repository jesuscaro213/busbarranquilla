import { useState, useEffect, useCallback } from 'react';
import { adminService, AdminUser, UserRole } from '../../services/adminService';

const ROLE_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'admin', label: 'Admin' },
  { value: 'premium', label: 'Premium' },
  { value: 'free', label: 'Free' },
];

const ROLES: UserRole[] = ['admin', 'premium', 'free'];

// ─── Badges ──────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const cls = {
    admin: 'bg-red-100 text-red-700',
    premium: 'bg-yellow-100 text-yellow-700',
    free: 'bg-gray-100 text-gray-600',
  }[role];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{role}</span>
  );
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {isActive ? 'Activo' : 'Inactivo'}
    </span>
  );
}

function PremiumBadge({ user }: { user: AdminUser }) {
  const trialActive =
    user.trial_expires_at && new Date(user.trial_expires_at) > new Date();
  if (!user.is_premium && !trialActive) return <span className="text-gray-300">—</span>;
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      {user.is_premium ? 'Premium' : 'Trial'}
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded" />
        </td>
      ))}
    </tr>
  );
}

// ─── Role modal ───────────────────────────────────────────────────────────────

interface RoleModalProps {
  userId: number;
  currentRole: UserRole;
  onConfirm: (newRole: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function RoleModal({ currentRole, onConfirm, onCancel, loading }: RoleModalProps) {
  const [selected, setSelected] = useState<string>(currentRole);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cambiar rol</h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={loading || selected === currentRole}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Guardando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete modal ─────────────────────────────────────────────────────────────

interface DeleteModalProps {
  userName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteModal({ userName, onConfirm, onCancel, loading }: DeleteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Eliminar usuario</h2>
        <p className="text-sm text-gray-600 mb-5">
          ¿Estás seguro de eliminar a <strong>{userName}</strong>? Esta acción es irreversible.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [roleModal, setRoleModal] = useState<{ userId: number; currentRole: UserRole } | null>(
    null
  );
  const [deleteModal, setDeleteModal] = useState<{ userId: number; userName: string } | null>(
    null
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminService.getUsers(roleFilter);
      setUsers(res.data.users);
    } catch {
      setError('Error cargando usuarios. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const visibleUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const handleToggleActive = async (id: number) => {
    setActionLoading(id);
    try {
      await adminService.toggleUserActive(id);
      await fetchUsers();
    } catch {
      alert('Error al cambiar el estado del usuario.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRoleConfirm = async (newRole: string) => {
    if (!roleModal) return;
    setActionLoading(roleModal.userId);
    try {
      await adminService.updateUserRole(roleModal.userId, newRole);
      setRoleModal(null);
      await fetchUsers();
    } catch {
      alert('Error al actualizar el rol.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteModal) return;
    setActionLoading(deleteModal.userId);
    try {
      await adminService.deleteUser(deleteModal.userId);
      setDeleteModal(null);
      await fetchUsers();
    } catch {
      alert('Error al eliminar el usuario.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading
              ? '…'
              : `${visibleUsers.length} usuario${visibleUsers.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={fetchUsers}
          disabled={loading}
          className="text-sm text-blue-600 hover:underline disabled:opacity-50"
        >
          Recargar
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {ROLE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Buscar por nombre o email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 font-semibold">ID</th>
              <th className="px-4 py-3 font-semibold">Nombre</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Teléfono</th>
              <th className="px-4 py-3 font-semibold">Créditos</th>
              <th className="px-4 py-3 font-semibold">Rol</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Premium</th>
              <th className="px-4 py-3 font-semibold">Registro</th>
              <th className="px-4 py-3 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : visibleUsers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-400">
                  No hay usuarios que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              visibleUsers.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">{u.id}</td>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3 text-gray-500">{u.phone ?? '—'}</td>
                  <td className="px-4 py-3 font-medium">{u.credits}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-4 py-3">
                    <ActiveBadge isActive={u.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <PremiumBadge user={u} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRoleModal({ userId: u.id, currentRole: u.role })}
                        disabled={actionLoading === u.id}
                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded disabled:opacity-40 transition-colors"
                      >
                        Rol
                      </button>
                      <button
                        onClick={() => handleToggleActive(u.id)}
                        disabled={actionLoading === u.id}
                        className={`text-xs px-2 py-1 rounded disabled:opacity-40 transition-colors ${
                          u.is_active
                            ? 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                            : 'bg-green-100 hover:bg-green-200 text-green-700'
                        }`}
                      >
                        {actionLoading === u.id ? '…' : u.is_active ? 'Dar de baja' : 'Reactivar'}
                      </button>
                      <button
                        onClick={() => setDeleteModal({ userId: u.id, userName: u.name })}
                        disabled={actionLoading === u.id}
                        className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded disabled:opacity-40 transition-colors"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Role modal */}
      {roleModal && (
        <RoleModal
          userId={roleModal.userId}
          currentRole={roleModal.currentRole}
          onConfirm={handleRoleConfirm}
          onCancel={() => setRoleModal(null)}
          loading={actionLoading === roleModal.userId}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteModal && (
        <DeleteModal
          userName={deleteModal.userName}
          onConfirm={handleDelete}
          onCancel={() => setDeleteModal(null)}
          loading={actionLoading === deleteModal.userId}
        />
      )}
    </div>
  );
}
