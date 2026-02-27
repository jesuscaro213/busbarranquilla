import { useState, useEffect, useCallback } from 'react';
import {
  adminService,
  Company,
  CompanyInput,
  CompanyRoute,
} from '../../services/adminService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-200 rounded" />
        </td>
      ))}
    </tr>
  );
}

// ─── Company form (shared by Create and Edit) ─────────────────────────────────

interface FormState {
  name: string;
  nit: string;
  phone: string;
  email: string;
}

const EMPTY_FORM: FormState = { name: '', nit: '', phone: '', email: '' };

interface CompanyFormModalProps {
  title: string;
  initial: FormState;
  onSave: (data: CompanyInput) => void;
  onCancel: () => void;
  loading: boolean;
}

function CompanyFormModal({ title, initial, onSave, onCancel, loading }: CompanyFormModalProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [nameError, setNameError] = useState('');

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = () => {
    if (!form.name.trim()) {
      setNameError('El nombre es obligatorio.');
      return;
    }
    setNameError('');
    const data: CompanyInput = {
      name: form.name.trim(),
      ...(form.nit.trim() && { nit: form.nit.trim() }),
      ...(form.phone.trim() && { phone: form.phone.trim() }),
      ...(form.email.trim() && { email: form.email.trim() }),
    };
    onSave(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-96">
        <h2 className="text-lg font-semibold text-gray-900 mb-5">{title}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={set('name')}
              disabled={loading}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">NIT</label>
            <input
              type="text"
              value={form.nit}
              onChange={set('nit')}
              disabled={loading}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
            <input
              type="text"
              value={form.phone}
              onChange={set('phone')}
              disabled={loading}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              disabled={loading}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete modal ─────────────────────────────────────────────────────────────

interface DeleteModalProps {
  companyName: string;
  errorMsg: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteModal({ companyName, errorMsg, onConfirm, onCancel, loading }: DeleteModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-80">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Eliminar empresa</h2>
        <p className="text-sm text-gray-600 mb-4">
          ¿Estás seguro de eliminar <strong>{companyName}</strong>? Esta acción es irreversible.
        </p>
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
            {errorMsg}
          </div>
        )}
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
            disabled={loading || !!errorMsg}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Eliminando…' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Routes modal ─────────────────────────────────────────────────────────────

interface RoutesModalProps {
  companyName: string;
  routes: CompanyRoute[];
  loading: boolean;
  onClose: () => void;
}

function RoutesModal({ companyName, routes, loading, onClose }: RoutesModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 w-[480px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Rutas — {companyName}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
            Cargando rutas…
          </div>
        ) : routes.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            Esta empresa no tiene rutas registradas.
          </p>
        ) : (
          <div className="overflow-y-auto flex-1">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Código</th>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-left">Frecuencia</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {routes.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.code}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {r.frequency_minutes != null ? `${r.frequency_minutes} min` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <ActiveBadge isActive={r.is_active} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DeleteModalState {
  id: number;
  name: string;
  errorMsg: string | null;
}

interface RoutesModalState {
  companyName: string;
  routes: CompanyRoute[];
  loading: boolean;
}

export default function AdminCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editModal, setEditModal] = useState<Company | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const [routesModal, setRoutesModal] = useState<RoutesModalState | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminService.getCompanies();
      setCompanies(res.data.companies);
    } catch {
      setError('Error cargando empresas. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const visible = companies.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.nit ?? '').toLowerCase().includes(q)
    );
  });

  // Create
  const handleCreate = async (data: CompanyInput) => {
    setActionLoading(-1);
    try {
      await adminService.createCompany(data);
      setShowCreate(false);
      await fetchCompanies();
    } catch {
      alert('Error al crear la empresa.');
    } finally {
      setActionLoading(null);
    }
  };

  // Edit
  const handleEdit = async (data: CompanyInput) => {
    if (!editModal) return;
    setActionLoading(editModal.id);
    try {
      await adminService.updateCompany(editModal.id, data);
      setEditModal(null);
      await fetchCompanies();
    } catch {
      alert('Error al actualizar la empresa.');
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle active
  const handleToggle = async (id: number) => {
    setActionLoading(id);
    try {
      await adminService.toggleCompanyActive(id);
      await fetchCompanies();
    } catch {
      alert('Error al cambiar el estado de la empresa.');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteModal) return;
    setActionLoading(deleteModal.id);
    try {
      await adminService.deleteCompany(deleteModal.id);
      setDeleteModal(null);
      await fetchCompanies();
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
        'Error al eliminar la empresa.';
      setDeleteModal((prev) => (prev ? { ...prev, errorMsg: msg } : null));
    } finally {
      setActionLoading(null);
    }
  };

  // View routes
  const handleViewRoutes = async (company: Company) => {
    setRoutesModal({ companyName: company.name, routes: [], loading: true });
    try {
      const res = await adminService.getCompanyById(company.id);
      setRoutesModal({ companyName: company.name, routes: res.data.routes, loading: false });
    } catch {
      setRoutesModal({ companyName: company.name, routes: [], loading: false });
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading ? '…' : `${visible.length} empresa${visible.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchCompanies}
            disabled={loading}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50"
          >
            Recargar
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            + Nueva Empresa
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Buscar por nombre o NIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <th className="px-4 py-3 font-semibold">NIT</th>
              <th className="px-4 py-3 font-semibold">Teléfono</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Estado</th>
              <th className="px-4 py-3 font-semibold">Registro</th>
              <th className="px-4 py-3 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  {search ? 'No hay empresas que coincidan con la búsqueda.' : 'No hay empresas registradas.'}
                </td>
              </tr>
            ) : (
              visible.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">{c.id}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.nit ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <ActiveBadge isActive={c.is_active} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(c.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setEditModal(c)}
                        disabled={actionLoading === c.id}
                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded disabled:opacity-40 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleToggle(c.id)}
                        disabled={actionLoading === c.id}
                        className={`text-xs px-2 py-1 rounded disabled:opacity-40 transition-colors ${
                          c.is_active
                            ? 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                            : 'bg-green-100 hover:bg-green-200 text-green-700'
                        }`}
                      >
                        {actionLoading === c.id ? '…' : c.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        onClick={() => handleViewRoutes(c)}
                        disabled={actionLoading === c.id}
                        className="text-xs px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded disabled:opacity-40 transition-colors"
                      >
                        Ver rutas
                      </button>
                      <button
                        onClick={() =>
                          setDeleteModal({ id: c.id, name: c.name, errorMsg: null })
                        }
                        disabled={actionLoading === c.id}
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

      {/* Create modal */}
      {showCreate && (
        <CompanyFormModal
          title="Nueva empresa"
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => setShowCreate(false)}
          loading={actionLoading === -1}
        />
      )}

      {/* Edit modal */}
      {editModal && (
        <CompanyFormModal
          title={`Editar — ${editModal.name}`}
          initial={{
            name: editModal.name,
            nit: editModal.nit ?? '',
            phone: editModal.phone ?? '',
            email: editModal.email ?? '',
          }}
          onSave={handleEdit}
          onCancel={() => setEditModal(null)}
          loading={actionLoading === editModal.id}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteModal && (
        <DeleteModal
          companyName={deleteModal.name}
          errorMsg={deleteModal.errorMsg}
          onConfirm={handleDelete}
          onCancel={() => setDeleteModal(null)}
          loading={actionLoading === deleteModal.id}
        />
      )}

      {/* Routes modal */}
      {routesModal && (
        <RoutesModal
          companyName={routesModal.companyName}
          routes={routesModal.routes}
          loading={routesModal.loading}
          onClose={() => setRoutesModal(null)}
        />
      )}
    </div>
  );
}
