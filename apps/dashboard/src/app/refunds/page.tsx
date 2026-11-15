'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, RefundCaseItem } from '../../lib/api';
import {
  CheckCircle2,
  Clock,
  Filter,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';

export default function RefundsPage() {
  const [items, setItems] = useState<RefundCaseItem[]>([]);
  const [filter, setFilter] = useState<string>('open');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal states
  const [activeModal, setActiveModal] = useState<'mark_refunded' | 'reject' | 'reopen' | null>(null);
  const [selectedCase, setSelectedCase] = useState<RefundCaseItem | null>(null);
  const [method, setMethod] = useState('aba_portal');
  const [reference, setReference] = useState('');
  const [amountMinor, setAmountMinor] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [adminOverrideReason, setAdminOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const res = await api.getRefundsReport(filter === 'all' ? undefined : filter);
      setItems(res.data.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleClaim = async (tranId: string) => {
    setIsSubmitting(true);
    try {
      await api.claimRefund(tranId);
      setSuccessMsg(`Successfully claimed refund case ${tranId}`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openMarkRefundedModal = (rc: RefundCaseItem) => {
    setSelectedCase(rc);
    setAmountMinor(rc.amountMinor);
    setMethod('aba_portal');
    setReference('');
    setAdminOverrideReason('');
    setActiveModal('mark_refunded');
  };

  const openRejectModal = (rc: RefundCaseItem) => {
    setSelectedCase(rc);
    setReason('');
    setActiveModal('reject');
  };

  const openReopenModal = (rc: RefundCaseItem) => {
    setSelectedCase(rc);
    setReason('');
    setActiveModal('reopen');
  };

  const handleMarkRefundedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.markRefunded(selectedCase.tranId, {
        method,
        reference,
        amountMinor,
        adminOverrideReason: adminOverrideReason.trim() || undefined,
      });
      setSuccessMsg(`Marked ${selectedCase.tranId} as REFUNDED.`);
      setActiveModal(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.rejectRefund(selectedCase.tranId, reason);
      setSuccessMsg(`Rejected refund case ${selectedCase.tranId}.`);
      setActiveModal(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.reopenRefund(selectedCase.tranId, reason);
      setSuccessMsg(`Reopened refund case ${selectedCase.tranId}.`);
      setActiveModal(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardShell onRefresh={loadData}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Refund Queue</h1>
            <p className="text-sm text-slate-500 mt-1">
              Audit-logged operator claims, disbursements, and dispute resolutions.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center space-x-1.5 bg-white p-1 rounded-lg border border-slate-200 text-xs shadow-sm">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-2" />
            {['open', 'claimed', 'refunded', 'rejected', 'all'].map((s) => (
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

        {/* Safety Banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex items-start space-x-2.5">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Architecture Safety Rule (Plan §C1):</span> Never execute a refund while a
            machine outcome is pending (`pending_outcomes &gt; 0`) or unknown. Resolve the physical dispense outcome
            first, or provide a recorded emergency override reason.
          </div>
        </div>

        {/* Refunds Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Transaction ID</th>
                  <th className="py-3 px-4">Machine & State</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Status & Claimant</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No refund cases found matching status filter "{filter}".
                    </td>
                  </tr>
                ) : (
                  items.map((rc) => {
                    const isUsd = rc.currency === 'USD';
                    const formattedAmount = isUsd
                      ? `$${(rc.amountMinor / 100).toFixed(2)}`
                      : `${rc.amountMinor.toLocaleString()} ៛`;

                    return (
                      <tr key={rc.tranId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-medium text-slate-900">
                          {rc.tranId}
                          <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                            {new Date(rc.createdAt).toLocaleString()}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-semibold">{rc.machineId}</span>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                rc.machineOnline ? 'bg-green-500' : 'bg-slate-400'
                              }`}
                              title={rc.machineOnline ? 'Machine Online' : 'Machine Offline'}
                            />
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            STM32: <span className="font-mono font-medium">{rc.lastStm32State || 'UNKNOWN'}</span>
                            {rc.machinePendingOutcomes > 0 && (
                              <span className="ml-1.5 text-amber-600 font-bold bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                                {rc.machinePendingOutcomes} stuck
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="font-bold text-slate-900 text-sm">{formattedAmount}</span>
                          <span className="text-slate-400 text-xs ml-1 font-mono">({rc.currency})</span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="font-medium text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                            {rc.refundReason}
                          </span>
                          {rc.decisionReason && (
                            <div className="text-[11px] text-slate-500 italic mt-1 max-w-xs truncate" title={rc.decisionReason}>
                              "{rc.decisionReason}"
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <div>
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                rc.refundStatus === 'open'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : rc.refundStatus === 'claimed'
                                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                  : rc.refundStatus === 'refunded'
                                  ? 'bg-green-100 text-green-800 border border-green-200'
                                  : 'bg-red-100 text-red-800 border border-red-200'
                              }`}
                            >
                              {rc.refundStatus}
                            </span>
                          </div>
                          {rc.claimantId && (
                            <div className="text-[11px] text-slate-500 mt-1 flex items-center">
                              <Clock className="w-3 h-3 mr-1 text-slate-400" />
                              <span>By: {rc.claimantId}</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          {rc.refundStatus === 'open' && (
                            <button
                              onClick={() => handleClaim(rc.tranId)}
                              disabled={isSubmitting}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
                            >
                              Claim
                            </button>
                          )}

                          {(rc.refundStatus === 'claimed' || rc.refundStatus === 'open') && (
                            <>
                              <button
                                onClick={() => openMarkRefundedModal(rc)}
                                disabled={isSubmitting}
                                className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-medium text-xs shadow-xs transition-colors disabled:opacity-50"
                              >
                                Mark Refunded
                              </button>
                              <button
                                onClick={() => openRejectModal(rc)}
                                disabled={isSubmitting}
                                className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded font-medium text-xs border border-red-200 transition-colors disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}

                          {(rc.refundStatus === 'rejected' || rc.refundStatus === 'auto_failed') && (
                            <button
                              onClick={() => openReopenModal(rc)}
                              disabled={isSubmitting}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-xs border border-slate-300 transition-colors disabled:opacity-50 flex items-center inline-flex"
                            >
                              <RotateCcw className="w-3 h-3 mr-1" /> Reopen
                            </button>
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

        {/* Modal: Mark Refunded */}
        {activeModal === 'mark_refunded' && selectedCase && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden">
              <div className="bg-green-600 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Disburse / Mark Refunded</h3>
                <button onClick={() => setActiveModal(null)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleMarkRefundedSubmit} className="p-5 space-y-4 text-xs">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                  <p>
                    <span className="font-semibold text-slate-500">Transaction:</span>{' '}
                    <span className="font-mono">{selectedCase.tranId}</span>
                  </p>
                  <p>
                    <span className="font-semibold text-slate-500">Kiosk:</span> {selectedCase.machineId}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-500">Original Amount:</span>{' '}
                    <span className="font-bold">
                      {selectedCase.currency === 'USD'
                        ? `$${(selectedCase.amountMinor / 100).toFixed(2)}`
                        : `${selectedCase.amountMinor.toLocaleString()} ៛`}
                    </span>
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Disbursement Method
                  </label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  >
                    <option value="aba_portal">ABA PayWay Merchant Portal</option>
                    <option value="cash">Cash / In-Person Operator</option>
                    <option value="bank_transfer">Bakong / Local Bank Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Payment Gateway Reference / Voucher ID
                  </label>
                  <input
                    type="text"
                    required
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="e.g. ABA-REF-8849204"
                    className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Refund Amount Minor ({selectedCase.currency})
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={amountMinor}
                    onChange={(e) => setAmountMinor(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded text-slate-800 font-mono"
                  />
                </div>

                {selectedCase.machinePendingOutcomes > 0 && (
                  <div className="bg-red-50 border border-red-200 p-3 rounded-lg text-red-700">
                    <p className="font-bold mb-1">Emergency Override Required</p>
                    <p className="mb-2">
                      Machine has {selectedCase.machinePendingOutcomes} pending outcome(s). You must provide an
                      administrative override justification.
                    </p>
                    <input
                      type="text"
                      required
                      value={adminOverrideReason}
                      onChange={(e) => setAdminOverrideReason(e.target.value)}
                      placeholder="e.g. Customer verified with CCTV pump did not run"
                      className="w-full p-2 border border-red-300 rounded text-slate-800"
                    />
                  </div>
                )}

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Recording...' : 'Confirm Refund'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Reject */}
        {activeModal === 'reject' && selectedCase && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-red-600 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Reject Refund Case</h3>
                <button onClick={() => setActiveModal(null)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleRejectSubmit} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Rejection Reason (Required)
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Machine sensor logs confirm 500 mL was dispensed in full."
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Rejecting...' : 'Reject Refund'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Reopen */}
        {activeModal === 'reopen' && selectedCase && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Reopen Refund Case</h3>
                <button onClick={() => setActiveModal(null)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleReopenSubmit} className="p-5 space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Reason for Reopening (Required)
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Customer provided supplementary payment screenshot."
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Reopening...' : 'Reopen Case'}
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
