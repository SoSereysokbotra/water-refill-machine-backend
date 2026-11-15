'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, AlertItem } from '../../lib/api';
import { CheckCircle2, Filter } from 'lucide-react';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [filter, setFilter] = useState<'active' | 'ack' | 'resolved' | 'all'>('active');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await api.listAlerts(filter === 'all' ? undefined : filter);
      setAlerts(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAck = async (id: string) => {
    try {
      await api.ackAlert(id);
      setSuccessMsg(`Alert ${id} acknowledged.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await api.resolveAlert(id);
      setSuccessMsg(`Alert ${id} marked as resolved.`);
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
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Kiosk Incidents & Alerts</h1>
            <p className="text-sm text-slate-500 mt-1">
              Active hardware faults, sensor mismatches, and offline warnings.
            </p>
          </div>

          <div className="flex items-center space-x-1.5 bg-white p-1 rounded-lg border border-slate-200 text-xs shadow-sm">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-2" />
            {(['active', 'ack', 'resolved', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-md font-semibold capitalize transition-all ${
                  filter === s
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
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

        {/* Alerts Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Severity & Type</th>
                  <th className="py-3 px-4">Kiosk ID</th>
                  <th className="py-3 px-4">Fault Details</th>
                  <th className="py-3 px-4">Status & Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {alerts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No alerts found for filter "{filter}".
                    </td>
                  </tr>
                ) : (
                  alerts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              a.severity === 'critical'
                                ? 'bg-red-100 text-red-800 border border-red-200'
                                : a.severity === 'warning'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}
                          >
                            {a.severity}
                          </span>
                          <span className="font-bold text-slate-900">{a.type}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">
                        {a.machineId}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                        {JSON.stringify(a.data || {})}
                      </td>

                      <td className="py-3.5 px-4">
                        <div>
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              a.status === 'active'
                                ? 'bg-red-100 text-red-800'
                                : a.status === 'ack'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            {a.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          {new Date(a.createdAt).toLocaleString()}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {a.status === 'active' && (
                          <button
                            onClick={() => handleAck(a.id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded font-medium text-xs border border-amber-200 transition-colors"
                          >
                            Acknowledge
                          </button>
                        )}
                        {a.status !== 'resolved' && (
                          <button
                            onClick={() => handleResolve(a.id)}
                            className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-medium text-xs shadow-xs transition-colors"
                          >
                            Resolve
                          </button>
                        )}
                        {a.status === 'resolved' && (
                          <span className="text-slate-400 text-xs italic">Resolved</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
