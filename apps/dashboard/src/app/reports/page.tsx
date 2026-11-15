'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { DashboardShell } from '../../components/dashboard-shell';
import { api, SalesReportResponse, MachineItem } from '../../lib/api';
import {
  Download,
  RefreshCw,
} from 'lucide-react';

export default function ReportsPage() {
  const [report, setReport] = useState<SalesReportResponse | null>(null);
  const [machines, setMachines] = useState<MachineItem[]>([]);
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [machineId, setMachineId] = useState<string>('');
  const [groupBy, setGroupBy] = useState<'day' | 'machine'>('day');
  const [refreshingViews, setRefreshingViews] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [reportRes, machinesRes] = await Promise.all([
        api.getSalesReport({
          from: from || undefined,
          to: to || undefined,
          machineId: machineId || undefined,
          groupBy,
        }),
        api.listMachines().catch(() => ({ data: [] })),
      ]);
      setReport(reportRes.data);
      setMachines(machinesRes.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [from, to, machineId, groupBy]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDownloadCsv = async () => {
    try {
      const csvText = await api.downloadSalesCsv({
        from: from || undefined,
        to: to || undefined,
        machineId: machineId || undefined,
        groupBy,
      });

      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `sales-report-${groupBy}-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRefreshViews = async () => {
    setRefreshingViews(true);
    try {
      await api.refreshViews();
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingViews(false);
    }
  };

  const usd = report?.summary.usd;
  const khr = report?.summary.khr;

  return (
    <DashboardShell onRefresh={loadData}>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sales & Net Revenue Reports</h1>
            <p className="text-sm text-slate-500 mt-1">
              Read-side CQRS reporting aggregating gross sales, refunds, and net revenue across USD & KHR.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleRefreshViews}
              disabled={refreshingViews}
              className="flex items-center space-x-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border border-slate-300 transition-colors disabled:opacity-50"
              title="Trigger REFRESH MATERIALIZED VIEW CONCURRENTLY"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingViews ? 'animate-spin' : ''}`} />
              <span>Refresh Materialized Views</span>
            </button>

            <button
              onClick={handleDownloadCsv}
              className="flex items-center space-x-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV</span>
            </button>
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

        {/* Filters Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-500 font-semibold mb-1">From Date</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded text-slate-800"
            />
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">To Date</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded text-slate-800"
            />
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">Filter by Machine</label>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded text-slate-800"
            >
              <option value="">All Machines</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-500 font-semibold mb-1">Group By</label>
            <div className="flex rounded border border-slate-300 overflow-hidden">
              <button
                onClick={() => setGroupBy('day')}
                className={`flex-1 py-2 font-semibold ${
                  groupBy === 'day' ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setGroupBy('machine')}
                className={`flex-1 py-2 font-semibold ${
                  groupBy === 'machine' ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Machine
              </button>
            </div>
          </div>
        </div>

        {/* Currency Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* USD Summary Card */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-green-50 text-green-700 flex items-center justify-center font-bold text-sm">
                  $
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">USD Revenue Summary</h2>
                  <p className="text-xs text-slate-400">Total Net = Gross Sales − Deducted Refunds</p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-green-100 text-green-800 rounded-full">
                USD
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-500 block">Gross Revenue</span>
                <span className="text-lg font-bold text-slate-800">
                  ${usd ? (usd.grossAmountMinor / 100).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                <span className="text-xs text-red-600 block">Refunds</span>
                <span className="text-lg font-bold text-red-700">
                  -${usd ? (usd.refundedAmountMinor / 100).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                <span className="text-xs text-green-700 block font-semibold">Net Revenue</span>
                <span className="text-lg font-bold text-green-800">
                  ${usd ? (usd.netAmountMinor / 100).toFixed(2) : '0.00'}
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Payments: {usd?.totalPayments ?? 0}</span>
              <span>Dispensed: {usd?.dispensedCount ?? 0}</span>
              <span>Refunded: {usd?.refundedCount ?? 0}</span>
              <span>Volume: {usd ? (usd.totalVolumeMl / 1000).toFixed(1) : 0} L</span>
            </div>
          </div>

          {/* KHR Summary Card */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-sm">
                  ៛
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 text-base">KHR Revenue Summary</h2>
                  <p className="text-xs text-slate-400">Total Net = Gross Sales − Deducted Refunds</p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full">
                KHR
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-4 text-center">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                <span className="text-xs text-slate-500 block">Gross Revenue</span>
                <span className="text-lg font-bold text-slate-800">
                  {khr ? khr.grossAmountMinor.toLocaleString() : 0} ៛
                </span>
              </div>
              <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                <span className="text-xs text-red-600 block">Refunds</span>
                <span className="text-lg font-bold text-red-700">
                  -{khr ? khr.refundedAmountMinor.toLocaleString() : 0} ៛
                </span>
              </div>
              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                <span className="text-xs text-indigo-700 block font-semibold">Net Revenue</span>
                <span className="text-lg font-bold text-indigo-800">
                  {khr ? khr.netAmountMinor.toLocaleString() : 0} ៛
                </span>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Payments: {khr?.totalPayments ?? 0}</span>
              <span>Dispensed: {khr?.dispensedCount ?? 0}</span>
              <span>Refunded: {khr?.refundedCount ?? 0}</span>
              <span>Volume: {khr ? (khr.totalVolumeMl / 1000).toFixed(1) : 0} L</span>
            </div>
          </div>
        </div>

        {/* Breakdown Data Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-sm">
              Sales Breakdown ({groupBy === 'day' ? 'By Date' : 'By Kiosk & Date'})
            </h3>
            <span className="text-xs text-slate-400">
              Showing {report?.rows.length ?? 0} rows (capped at {report?.pagination.limit ?? 50})
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="py-3 px-4">Date</th>
                  {groupBy === 'machine' && <th className="py-3 px-4">Machine ID</th>}
                  <th className="py-3 px-4">Currency</th>
                  <th className="py-3 px-4">Payments</th>
                  <th className="py-3 px-4">Dispensed</th>
                  <th className="py-3 px-4">Refunded</th>
                  <th className="py-3 px-4">Gross Sales</th>
                  <th className="py-3 px-4">Refunds</th>
                  <th className="py-3 px-4 font-bold text-slate-900">Net Revenue</th>
                  <th className="py-3 px-4 text-right">Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {!report?.rows || report.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={groupBy === 'machine' ? 10 : 9}
                      className="py-12 text-center text-slate-400"
                    >
                      No sales records found for selected filter criteria.
                    </td>
                  </tr>
                ) : (
                  report.rows.map((r, i) => {
                    const isUsd = r.currency === 'USD';
                    const gross = isUsd
                      ? `$${(r.grossAmountMinor / 100).toFixed(2)}`
                      : `${r.grossAmountMinor.toLocaleString()} ៛`;
                    const refunded = isUsd
                      ? `$${(r.refundedAmountMinor / 100).toFixed(2)}`
                      : `${r.refundedAmountMinor.toLocaleString()} ៛`;
                    const net = isUsd
                      ? `$${(r.netAmountMinor / 100).toFixed(2)}`
                      : `${r.netAmountMinor.toLocaleString()} ៛`;

                    return (
                      <tr key={`${r.date}-${r.machineId}-${r.currency}-${i}`} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono font-medium">{r.date}</td>
                        {groupBy === 'machine' && (
                          <td className="py-3 px-4 font-mono font-bold text-slate-800">
                            {r.machineId}
                          </td>
                        )}
                        <td className="py-3 px-4">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isUsd ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {r.currency}
                          </span>
                        </td>
                        <td className="py-3 px-4">{r.totalPayments}</td>
                        <td className="py-3 px-4 text-green-700 font-medium">{r.dispensedCount}</td>
                        <td className="py-3 px-4 text-red-600 font-medium">{r.refundedCount}</td>
                        <td className="py-3 px-4 font-medium">{gross}</td>
                        <td className="py-3 px-4 text-red-600">-{refunded}</td>
                        <td className="py-3 px-4 font-bold text-slate-900 bg-slate-50/50">{net}</td>
                        <td className="py-3 px-4 text-right text-slate-500 font-mono">
                          {(r.totalVolumeMl / 1000).toFixed(1)} L
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
