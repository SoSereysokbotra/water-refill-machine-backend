'use client';

import React, { useState } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, PaymentDetail } from '../../lib/api';
import {
  ArrowRight,
  CheckCircle2,
  Search,
} from 'lucide-react';

export default function PaymentsPage() {
  const [tranId, setTranId] = useState('');
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Unknown dispense resolution modal
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolution, setResolution] = useState<'dispensed' | 'refund'>('dispensed');
  const [reason, setReason] = useState('');
  const [adminOverrideReason, setAdminOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tranId.trim()) return;
    setLoading(true);
    setError(null);
    setPayment(null);
    try {
      const res = await api.getPayment(tranId.trim());
      setPayment(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.resolveUnknownDispense(payment.tranId, {
        resolution,
        reason,
        adminOverrideReason: adminOverrideReason.trim() || undefined,
      });
      setSuccessMsg(`Unknown dispense resolved as ${resolution}.`);
      setShowResolveModal(false);
      // Reload payment
      const res = await api.getPayment(payment.tranId);
      setPayment(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payment Inspector & Timeline</h1>
          <p className="text-sm text-slate-500 mt-1">
            Search payments by transaction ID, audit lifecycle transitions, and resolve DISPENSE_UNKNOWN states.
          </p>
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

        {/* Search Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required
                value={tranId}
                onChange={(e) => setTranId(e.target.value)}
                placeholder="Search transaction ID (e.g. t-12345 or ABA transaction ID)..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm transition-colors shadow-xs disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Inspect Payment'}
            </button>
          </form>
        </div>

        {/* Payment Detail Card */}
        {payment && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <span className="text-xs font-mono font-semibold text-slate-400">TRANSACTION</span>
                <h2 className="text-xl font-bold font-mono text-slate-900">{payment.tranId}</h2>
              </div>

              <div className="flex items-center space-x-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    payment.status === 'DISPENSED'
                      ? 'bg-green-100 text-green-800'
                      : payment.status === 'PAID'
                      ? 'bg-blue-100 text-blue-800'
                      : payment.status === 'REFUNDED'
                      ? 'bg-purple-100 text-purple-800'
                      : payment.status === 'DISPENSE_UNKNOWN'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {payment.status}
                </span>

                {payment.status === 'DISPENSE_UNKNOWN' && (
                  <button
                    onClick={() => setShowResolveModal(true)}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                  >
                    Resolve Unknown Outcome
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-slate-100 text-xs">
              <div>
                <span className="text-slate-400 font-semibold block uppercase">Kiosk</span>
                <span className="text-sm font-bold font-mono text-slate-800">{payment.machineId}</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block uppercase">Amount</span>
                <span className="text-sm font-bold text-slate-900">
                  {payment.currency === 'USD'
                    ? `$${(payment.amountMinor / 100).toFixed(2)}`
                    : `${payment.amountMinor.toLocaleString()} ៛`}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block uppercase">Volume</span>
                <span className="text-sm font-bold text-slate-800">{payment.volumeMl} mL</span>
              </div>
              <div>
                <span className="text-slate-400 font-semibold block uppercase">Paid Timestamp</span>
                <span className="text-sm font-mono text-slate-800">
                  {payment.paidAt ? new Date(payment.paidAt).toLocaleString() : 'Not paid'}
                </span>
              </div>
            </div>

            {/* Audit Event Timeline */}
            <div className="p-5">
              <h3 className="font-semibold text-slate-800 text-xs uppercase tracking-wider mb-4">
                State Transition Audit Trail
              </h3>

              {!payment.events || payment.events.length === 0 ? (
                <p className="text-xs text-slate-400">No transition events recorded.</p>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {payment.events.map((evt, idx) => (
                    <div key={evt.id || idx} className="relative">
                      <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-xs" />
                      <div className="text-xs">
                        <div className="flex items-center space-x-2">
                          <span className="font-semibold text-slate-700">{evt.fromStatus}</span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span className="font-bold text-blue-600">{evt.toStatus}</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            {new Date(evt.at).toLocaleString()}
                          </span>
                        </div>
                        {evt.reason && (
                          <p className="text-slate-500 italic mt-0.5">"{evt.reason}"</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal: Resolve Unknown Outcome */}
        {showResolveModal && payment && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
              <div className="bg-amber-600 p-4 text-white flex justify-between items-center">
                <h3 className="font-bold text-sm">Resolve Unknown Dispense</h3>
                <button onClick={() => setShowResolveModal(false)} className="text-white/80 hover:text-white">
                  ✕
                </button>
              </div>

              <form onSubmit={handleResolveSubmit} className="p-5 space-y-4 text-xs">
                <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-amber-800">
                  Transaction {payment.tranId} on kiosk {payment.machineId} timed out waiting for hardware outcome.
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Resolution Decision</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as 'dispensed' | 'refund')}
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  >
                    <option value="dispensed">Mark Dispensed (Customer received water)</option>
                    <option value="refund">Mark Refund Review (Customer did not receive water)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">Decision Reason (Required)</label>
                  <textarea
                    required
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Phone interview with customer confirmed water dispensed normally."
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 uppercase mb-1">
                    Emergency Override Reason (If Machine Offline / Outcomes Stuck)
                  </label>
                  <input
                    type="text"
                    value={adminOverrideReason}
                    onChange={(e) => setAdminOverrideReason(e.target.value)}
                    placeholder="e.g. Authorized override by Operations Lead"
                    className="w-full p-2 border border-slate-300 rounded text-slate-800"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(false)}
                    className="px-4 py-2 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium shadow-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Resolving...' : 'Confirm Resolution'}
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
