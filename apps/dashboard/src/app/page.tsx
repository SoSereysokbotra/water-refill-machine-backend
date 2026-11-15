'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../components/dashboard-shell';
import {
  api,
  SalesReportResponse,
  MachineStatusRow,
  RefundsReportResponse,
  AlertItem,
} from '../lib/api';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  CreditCard,
  DollarSign,
  Undo2,
  XCircle,
} from 'lucide-react';

export default function OverviewPage() {
  const [salesReport, setSalesReport] = useState<SalesReportResponse | null>(null);
  const [fleet, setFleet] = useState<MachineStatusRow[]>([]);
  const [refunds, setRefunds] = useState<RefundsReportResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [salesRes, fleetRes, refundsRes, alertsRes] = await Promise.all([
        api.getSalesReport(),
        api.getFleetStatus(),
        api.getRefundsReport(),
        api.listAlerts('active'),
      ]);

      setSalesReport(salesRes.data);
      setFleet(fleetRes.data);
      setRefunds(refundsRes.data);
      setAlerts(alertsRes.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onlineCount = fleet.filter((m) => m.online).length;
  const offlineCount = fleet.filter((m) => !m.online).length;
  const stuckOutcomesCount = fleet.filter((m) => m.pendingOutcomes > 0).length;

  const usd = salesReport?.summary.usd;
  const khr = salesReport?.summary.khr;

  return (
    <DashboardShell onRefresh={loadData}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Fleet Overview</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time status of water refill kiosks, sales metrics, and active alerts.
          </p>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={loadData}
              className="text-xs bg-red-100 hover:bg-red-200 px-2 py-1 rounded font-semibold text-red-800"
            >
              Retry
            </button>
          </div>
        )}

        {/* Sales KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* USD Net Revenue */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Net Revenue (USD)
              </span>
              <div className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900">
                ${usd ? (usd.netAmountMinor / 100).toFixed(2) : '0.00'}
              </span>
              <span className="text-xs text-slate-500">
                Gross: ${usd ? (usd.grossAmountMinor / 100).toFixed(2) : '0.00'}
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500 flex justify-between border-t border-slate-100 pt-2">
              <span>Refunds: ${usd ? (usd.refundedAmountMinor / 100).toFixed(2) : '0.00'}</span>
              <span>{usd?.totalPayments ?? 0} payments</span>
            </div>
          </div>

          {/* KHR Net Revenue */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Net Revenue (KHR)
              </span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <CreditCard className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-900">
                {khr ? khr.netAmountMinor.toLocaleString() : '0'} ៛
              </span>
              <span className="text-xs text-slate-500">
                Gross: {khr ? khr.grossAmountMinor.toLocaleString() : '0'} ៛
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-500 flex justify-between border-t border-slate-100 pt-2">
              <span>Refunds: {khr ? khr.refundedAmountMinor.toLocaleString() : '0'} ៛</span>
              <span>{khr?.totalPayments ?? 0} payments</span>
            </div>
          </div>

          {/* Fleet Status */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Fleet Kiosks
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Cpu className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl font-bold text-slate-900">{fleet.length}</span>
              <span className="text-xs text-slate-500">total machines</span>
            </div>
            <div className="mt-2 text-xs flex justify-between border-t border-slate-100 pt-2">
              <span className="text-green-600 font-medium flex items-center">
                <CheckCircle2 className="w-3 h-3 mr-1" /> {onlineCount} online
              </span>
              <span className="text-slate-500 flex items-center">
                <XCircle className="w-3 h-3 mr-1 text-slate-400" /> {offlineCount} offline
              </span>
              {stuckOutcomesCount > 0 && (
                <span className="text-amber-600 font-bold">
                  {stuckOutcomesCount} stuck
                </span>
              )}
            </div>
          </div>

          {/* Refund Queue & Alerts */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Action Items
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Undo2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-bold text-amber-600">
                  {refunds?.summary.statusCounts.open ?? 0}
                </span>
                <span className="text-xs text-slate-500 ml-1.5">open refunds</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-red-600">{alerts.length}</span>
                <span className="text-xs text-slate-500 ml-1.5">alerts</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500 flex justify-between border-t border-slate-100 pt-2">
              <span>{refunds?.summary.statusCounts.claimed ?? 0} claimed in review</span>
              <a href="/refunds" className="text-blue-600 hover:underline flex items-center font-medium">
                Resolve <ArrowRight className="w-3 h-3 ml-0.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Two Columns: Active Alerts & Machines Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Alerts Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <h2 className="font-semibold text-slate-800 text-sm">Active Alerts</h2>
              </div>
              <a href="/alerts" className="text-xs font-medium text-blue-600 hover:underline flex items-center">
                View all <ArrowRight className="w-3 h-3 ml-0.5" />
              </a>
            </div>

            <div className="divide-y divide-slate-100">
              {alerts.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No active alerts. All machines are operating normally.
                </div>
              ) : (
                alerts.slice(0, 5).map((a) => (
                  <div key={a.id} className="p-3.5 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          a.severity === 'critical'
                            ? 'bg-red-500'
                            : a.severity === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-blue-500'
                        }`}
                      />
                      <div>
                        <span className="font-semibold text-slate-800">{a.type}</span>
                        <span className="ml-2 text-slate-500 font-mono">[{a.machineId}]</span>
                      </div>
                    </div>
                    <span className="text-slate-400">
                      {new Date(a.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Kiosks Online Status Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-blue-500" />
                <h2 className="font-semibold text-slate-800 text-sm">Fleet Status</h2>
              </div>
              <a href="/machines" className="text-xs font-medium text-blue-600 hover:underline flex items-center">
                Manage kiosks <ArrowRight className="w-3 h-3 ml-0.5" />
              </a>
            </div>

            <div className="divide-y divide-slate-100">
              {fleet.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No machines provisioned yet.
                </div>
              ) : (
                fleet.slice(0, 5).map((m) => (
                  <div key={m.id} className="p-3.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold font-mono text-slate-800">{m.id}</span>
                        <span className="text-slate-600 font-medium">{m.name}</span>
                        <span className="text-slate-400">({m.currency})</span>
                      </div>
                      <div className="text-slate-400 text-[11px] mt-0.5">
                        {m.location || 'No location set'} • STM32: {m.lastStm32State || 'UNKNOWN'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.online
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {m.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                      {m.pendingOutcomes > 0 && (
                        <div className="text-amber-600 font-bold text-[10px] mt-0.5">
                          {m.pendingOutcomes} pending outcomes
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
