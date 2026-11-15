'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, MachineItem } from '../../lib/api';
import {
  CheckCircle2,
  Copy,
  Edit2,
  KeyRound,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';

export default function MachinesPage() {
  const [machines, setMachines] = useState<MachineItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<MachineItem | null>(null);

  // Forms
  const [provisionForm, setProvisionForm] = useState({
    id: '',
    name: '',
    location: '',
    currency: 'USD' as 'USD' | 'KHR',
    p500: 15,
    p750: 20,
    p1000: 25,
  });

  const [priceForm, setPriceForm] = useState({
    p500: 0,
    p750: 0,
    p1000: 0,
  });

  const [oneTimeCredentials, setOneTimeCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await api.listMachines();
      setMachines(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleEnable = async (m: MachineItem) => {
    try {
      await api.toggleMachine(m.id, !m.enabled);
      setSuccessMsg(`Machine ${m.id} ${m.enabled ? 'disabled' : 'enabled'}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenPriceModal = (m: MachineItem) => {
    setSelectedMachine(m);
    const p = m.pricesMinor || {};
    setPriceForm({
      p500: p[500] ?? (m.currency === 'USD' ? 15 : 500),
      p750: p[750] ?? (m.currency === 'USD' ? 20 : 700),
      p1000: p[1000] ?? (m.currency === 'USD' ? 25 : 1000),
    });
    setShowPriceModal(true);
  };

  const handlePriceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMachine) return;
    setIsSubmitting(true);
    try {
      await api.updatePrices(selectedMachine.id, {
        500: priceForm.p500,
        750: priceForm.p750,
        1000: priceForm.p1000,
      });
      setSuccessMsg(`Prices updated for ${selectedMachine.id}. Retained config sent to broker.`);
      setShowPriceModal(false);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.provisionMachine({
        id: provisionForm.id.trim(),
        name: provisionForm.name.trim(),
        location: provisionForm.location.trim() || undefined,
        currency: provisionForm.currency,
        prices: {
          500: provisionForm.p500,
          750: provisionForm.p750,
          1000: provisionForm.p1000,
        },
      });

      setOneTimeCredentials(res.data.mqttCredentials);
      setShowProvisionModal(false);
      setShowCredentialsModal(true);
      setSuccessMsg(`Kiosk ${provisionForm.id} provisioned.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRotateCredentials = async (m: MachineItem) => {
    if (!confirm(`Are you sure you want to rotate MQTT credentials for ${m.id}?`)) return;
    try {
      const res = await api.rotateCredentials(m.id);
      setOneTimeCredentials(res.data.mqttCredentials);
      setShowCredentialsModal(true);
      setSuccessMsg(`Credentials rotated for ${m.id}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDecommission = async (m: MachineItem) => {
    if (!confirm(`Are you sure you want to decommission ${m.id}? This marks the kiosk as permanently retired.`)) return;
    try {
      await api.decommissionMachine(m.id);
      setSuccessMsg(`Machine ${m.id} decommissioned.`);
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
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Kiosk Fleet Management</h1>
            <p className="text-sm text-slate-500 mt-1">
              Provision machines, set volume prices, rotate credentials, and manage hardware lifecycle.
            </p>
          </div>

          <button
            onClick={() => setShowProvisionModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Provision Kiosk</span>
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

        {/* Machines Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Machine ID</th>
                  <th className="py-3 px-4">Name & Location</th>
                  <th className="py-3 px-4">Status & Presence</th>
                  <th className="py-3 px-4">Pricing (500 / 750 / 1000 mL)</th>
                  <th className="py-3 px-4">Outcomes</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {machines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No machines registered. Click "Provision Kiosk" to add the first machine.
                    </td>
                  </tr>
                ) : (
                  machines.map((m) => {
                    const isDecommissioned = !!m.decommissionedAt;
                    const isUsd = m.currency === 'USD';
                    const p = m.pricesMinor || {};

                    const fmtPrice = (val?: number) => {
                      if (val === undefined) return '-';
                      return isUsd ? `$${(val / 100).toFixed(2)}` : `${val} ៛`;
                    };

                    return (
                      <tr
                        key={m.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isDecommissioned ? 'opacity-60 bg-slate-50' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-slate-900 text-sm">{m.id}</span>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            MQTT: {m.mqttUsername}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-800">{m.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {m.location || 'No location set'}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.online
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {m.online ? 'ONLINE' : 'OFFLINE'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.enabled
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {m.enabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1">
                            STM32: <span className="font-mono font-medium">{m.lastStm32State || 'UNKNOWN'}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono font-medium">
                          <span className="text-slate-900">{fmtPrice(p[500])}</span>
                          <span className="text-slate-400 mx-1">/</span>
                          <span className="text-slate-900">{fmtPrice(p[750])}</span>
                          <span className="text-slate-400 mx-1">/</span>
                          <span className="text-slate-900">{fmtPrice(p[1000])}</span>
                          <span className="ml-1 text-[10px] text-slate-400">({m.currency})</span>
                        </td>

                        <td className="py-3.5 px-4">
                          {m.pendingOutcomes > 0 ? (
                            <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold border border-amber-200">
                              {m.pendingOutcomes} stuck
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {!isDecommissioned && (
                            <>
                              <button
                                onClick={() => handleOpenPriceModal(m)}
                                className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                                title="Edit Pricing"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleToggleEnable(m)}
                                className={`p-1.5 rounded ${
                                  m.enabled
                                    ? 'text-slate-600 hover:text-amber-600 hover:bg-amber-50'
                                    : 'text-slate-600 hover:text-green-600 hover:bg-green-50'
                                }`}
                                title={m.enabled ? 'Disable Kiosk' : 'Enable Kiosk'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleRotateCredentials(m)}
                                className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                title="Rotate MQTT Credentials"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleDecommission(m)}
                                className="p-1.5 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Decommission Kiosk"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {isDecommissioned && (
                            <span className="text-xs text-red-500 font-semibold italic">
                              Decommissioned
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Provision Machine */}
        {showProvisionModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
              <div className="bg-blue-600 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Provision New Kiosk (WRM)</h3>
                <button onClick={() => setShowProvisionModal(false)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleProvisionSubmit} className="p-5 space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 uppercase mb-1">
                      Machine ID (Pattern: WRM-XXX)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="WRM-003"
                      value={provisionForm.id}
                      onChange={(e) => setProvisionForm({ ...provisionForm, id: e.target.value })}
                      className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 uppercase mb-1">Currency</label>
                    <select
                      value={provisionForm.currency}
                      onChange={(e) => {
                        const cur = e.target.value as 'USD' | 'KHR';
                        setProvisionForm({
                          ...provisionForm,
                          currency: cur,
                          p500: cur === 'USD' ? 15 : 500,
                          p750: cur === 'USD' ? 20 : 700,
                          p1000: cur === 'USD' ? 25 : 1000,
                        });
                      }}
                      className="w-full p-2 border border-slate-300 rounded text-slate-800"
                    >
                      <option value="USD">USD (Cents / Minor)</option>
                      <option value="KHR">KHR (Riels)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Friendly Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Engineering Dept Kiosk"
                    value={provisionForm.name}
                    onChange={(e) => setProvisionForm({ ...provisionForm, name: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Location Details</label>
                  <input
                    type="text"
                    placeholder="Building 2, Floor 1"
                    value={provisionForm.location}
                    onChange={(e) => setProvisionForm({ ...provisionForm, location: e.target.value })}
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <label className="block font-bold text-slate-800 uppercase mb-2">
                    Pricing Tiers ({provisionForm.currency} Minor Units)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="block text-slate-500 mb-0.5">500 mL</span>
                      <input
                        type="number"
                        required
                        min={1}
                        value={provisionForm.p500}
                        onChange={(e) => setProvisionForm({ ...provisionForm, p500: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                      />
                    </div>
                    <div>
                      <span className="block text-slate-500 mb-0.5">750 mL</span>
                      <input
                        type="number"
                        required
                        min={1}
                        value={provisionForm.p750}
                        onChange={(e) => setProvisionForm({ ...provisionForm, p750: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                      />
                    </div>
                    <div>
                      <span className="block text-slate-500 mb-0.5">1000 mL</span>
                      <input
                        type="number"
                        required
                        min={1}
                        value={provisionForm.p1000}
                        onChange={(e) => setProvisionForm({ ...provisionForm, p1000: Number(e.target.value) })}
                        className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowProvisionModal(false)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Provisioning...' : 'Provision Machine'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Edit Pricing */}
        {showPriceModal && selectedMachine && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Update Prices: {selectedMachine.id}</h3>
                <button onClick={() => setShowPriceModal(false)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handlePriceSubmit} className="p-5 space-y-4 text-xs">
                <p className="text-slate-500">
                  Prices are stored in minor units ({selectedMachine.currency}) and published to EMQX as retained
                  configuration for the kiosk.
                </p>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className="block text-slate-500 font-semibold mb-1">500 mL</span>
                    <input
                      type="number"
                      required
                      min={1}
                      value={priceForm.p500}
                      onChange={(e) => setPriceForm({ ...priceForm, p500: Number(e.target.value) })}
                      className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-1">750 mL</span>
                    <input
                      type="number"
                      required
                      min={1}
                      value={priceForm.p750}
                      onChange={(e) => setPriceForm({ ...priceForm, p750: Number(e.target.value) })}
                      className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-1">1000 mL</span>
                    <input
                      type="number"
                      required
                      min={1}
                      value={priceForm.p1000}
                      onChange={(e) => setPriceForm({ ...priceForm, p1000: Number(e.target.value) })}
                      className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowPriceModal(false)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Prices'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: One-Time Credentials Display */}
        {showCredentialsModal && oneTimeCredentials && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-amber-600 p-4 text-white flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <KeyRound className="w-5 h-5" />
                  <h3 className="font-bold text-sm">One-Time MQTT Credentials</h3>
                </div>
                <button onClick={() => setShowCredentialsModal(false)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg">
                  <span className="font-bold">Important:</span> Copy this password now. It is shown only once and
                  cannot be retrieved later. Add this user to your EMQX Cloud dashboard.
                </div>

                <div>
                  <span className="block font-semibold text-slate-500 uppercase mb-1">MQTT Username</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={oneTimeCredentials.username}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 font-mono select-all"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(oneTimeCredentials.username)}
                      className="p-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-700"
                      title="Copy Username"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <span className="block font-semibold text-slate-500 uppercase mb-1">MQTT Password</span>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={oneTimeCredentials.password}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-slate-800 font-mono font-bold select-all"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(oneTimeCredentials.password)}
                      className="p-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-700"
                      title="Copy Password"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setShowCredentialsModal(false)}
                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded font-medium shadow-sm"
                  >
                    I Have Copied the Credentials
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
