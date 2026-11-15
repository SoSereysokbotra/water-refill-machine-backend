'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, User } from '../../lib/api';
import {
  CheckCircle2,
  FileText,
  Plus,
} from 'lucide-react';

interface AuditLogRow {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [createForm, setCreateForm] = useState({
    email: '',
    name: '',
    password: '',
    role: 'operator' as 'admin' | 'operator' | 'viewer',
  });

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [usersRes, logsRes] = await Promise.all([
        api.listUsers().catch(() => ({ data: [] })),
        api.listAuditLogs({ limit: 50 }).catch(() => ({ data: [] })),
      ]);
      setUsers(usersRes.data);
      setAuditLogs(logsRes.data as AuditLogRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await api.createUser(createForm);
      setSuccessMsg(`User ${createForm.email} created.`);
      setShowCreateModal(false);
      setCreateForm({ email: '', name: '', password: '', role: 'operator' });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (user: User, newRole: 'admin' | 'operator' | 'viewer') => {
    try {
      await api.updateUser(user.id, { role: newRole });
      setSuccessMsg(`Updated ${user.email} role to ${newRole}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DashboardShell onRefresh={loadData}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Identity, Users & Audit Logs</h1>
            <p className="text-sm text-slate-500 mt-1">
              Role-Based Access Control (RBAC), multi-factor authentication status, and tamper-evident audit logs.
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create User</span>
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-bold text-red-600 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg flex items-center justify-between">
            <span className="flex items-center">
              <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
              {successMsg}
            </span>
            <button onClick={() => setSuccessMsg(null)} className="text-xs font-bold text-green-600 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-sm">Authorized Operators</h3>
            <span className="text-xs text-slate-400">{users.length} registered</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Name & Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">2FA / TOTP</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{u.name}</div>
                      <div className="text-slate-400 font-mono mt-0.5">{u.email}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          u.role === 'admin'
                            ? 'bg-purple-100 text-purple-800 border border-purple-200'
                            : u.role === 'operator'
                            ? 'bg-blue-100 text-blue-800 border border-blue-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      {u.totpEnabled ? (
                        <span className="text-green-700 font-medium flex items-center">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Enabled
                        </span>
                      ) : (
                        <span className="text-slate-400">Disabled</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <select
                        value={u.role}
                        onChange={(e) =>
                          handleRoleChange(u, e.target.value as 'admin' | 'operator' | 'viewer')
                        }
                        className="p-1 border border-slate-200 rounded text-xs text-slate-700 bg-white"
                      >
                        <option value="admin">Admin</option>
                        <option value="operator">Operator</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Audit Logs Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-slate-500" />
              <h3 className="font-semibold text-slate-800 text-sm">Security & Operational Audit Log</h3>
            </div>
            <span className="text-xs text-slate-400">Showing last 50 actions</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target Entity</th>
                  <th className="py-3 px-4">Reason / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No audit events recorded yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {log.actorId}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[11px] text-slate-800 border border-slate-200">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {log.entityType}:{log.entityId}
                      </td>
                      <td className="py-3 px-4 text-slate-500 italic">
                        {log.reason || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Create User */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Create Operator Account</h3>
                <button onClick={() => setShowCreateModal(false)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="Jane Doe"
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Email Address</label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    placeholder="operator@wrm.kh"
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    placeholder="Min 8 characters"
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Role</label>
                  <select
                    value={createForm.role}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        role: e.target.value as 'admin' | 'operator' | 'viewer',
                      })
                    }
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  >
                    <option value="operator">Operator (View, Claim, Refund, Manage Kiosks)</option>
                    <option value="viewer">Viewer (Read-Only Reports & Status)</option>
                    <option value="admin">Admin (Full System Permissions)</option>
                  </select>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
