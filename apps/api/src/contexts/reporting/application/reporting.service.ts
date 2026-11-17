import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';
import { ReportingSweep } from './reporting.sweep';

export interface SalesSummaryByCurrency {
  currency: 'USD' | 'KHR';
  totalPayments: number;
  dispensedCount: number;
  refundedCount: number;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  netAmountMinor: number;
  totalVolumeMl: number;
}

export interface SalesReportRow {
  date?: string;
  machineId?: string;
  currency: 'USD' | 'KHR';
  totalPayments: number;
  dispensedCount: number;
  refundedCount: number;
  grossAmountMinor: number;
  refundedAmountMinor: number;
  netAmountMinor: number;
  totalVolumeMl: number;
}

export interface SalesReportQuery {
  from?: string;
  to?: string;
  machineId?: string;
  groupBy?: 'day' | 'machine';
  limit?: number;
  offset?: number;
  format?: 'json' | 'csv';
}

export interface SalesReportResponse {
  summary: {
    usd: SalesSummaryByCurrency;
    khr: SalesSummaryByCurrency;
  };
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
  rows: SalesReportRow[];
}

export interface MachineStatusReportRow {
  id: string;
  name: string;
  location: string | null;
  enabled: boolean;
  currency: string;
  online: boolean;
  lastSeenAt: Date | null;
  pendingOutcomes: number;
  pendingOutcomesSince: Date | null;
  lastStm32State: string | null;
  decommissionedAt: Date | null;
  activeAlertsCount: number;
}

export interface RefundQueueReportItem {
  tranId: string;
  machineId: string;
  amountMinor: number;
  currency: string;
  refundStatus: string;
  refundReason: string;
  suggestedAmountMinor: number;
  refundedAmountMinor: number | null;
  claimantId: string | null;
  expiresAt: Date | null;
  decisionReason: string | null;
  machineOnline: boolean;
  machinePendingOutcomes: number;
  lastStm32State: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefundsReportResponse {
  summary: {
    statusCounts: {
      open: number;
      claimed: number;
      refunded: number;
      rejected: number;
      autoFailed: number;
      total: number;
    };
    amounts: {
      usd: {
        pendingMinor: number;
        refundedMinor: number;
      };
      khr: {
        pendingMinor: number;
        refundedMinor: number;
      };
    };
  };
  items: RefundQueueReportItem[];
}

interface RawSalesDailyRow {
  date: string | Date;
  currency: string;
  total_payments: number | string | bigint;
  dispensed_count: number | string | bigint;
  refunded_count: number | string | bigint;
  gross_amount_minor: number | string | bigint;
  refunded_amount_minor: number | string | bigint;
  net_amount_minor: number | string | bigint;
  total_volume_ml: number | string | bigint;
}

interface RawSalesByMachineRow extends RawSalesDailyRow {
  machine_id: string;
}

interface RawMachineStatusRow {
  id: string;
  name: string;
  location: string | null;
  enabled: boolean;
  currency: string;
  online: boolean;
  last_seen_at: Date | null;
  pending_outcomes: number | string;
  pending_outcomes_since: Date | null;
  last_stm32_state: string | null;
  decommissioned_at: Date | null;
  active_alerts_count: number | string;
}

interface RawRefundQueueRow {
  tran_id: string;
  machine_id: string;
  amount_minor: number | string;
  currency: string;
  refund_status: string;
  refund_reason: string;
  suggested_amount_minor: number | string;
  refunded_amount_minor: number | string | null;
  claimant_id: string | null;
  expires_at: Date | null;
  decision_reason: string | null;
  machine_online: boolean;
  machine_pending_outcomes: number | string;
  last_stm32_state: string | null;
  created_at: Date;
  updated_at: Date;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  return Number(v) || 0;
}

function formatDate(d: string | Date): string {
  if (d instanceof Date) {
    return d.toISOString().split('T')[0] ?? '';
  }
  return String(d).split('T')[0] ?? '';
}

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ReportingSweep) private readonly sweep: ReportingSweep,
  ) {}

  async refreshViews(): Promise<void> {
    await this.sweep.execute();
  }

  async getSalesReport(query: SalesReportQuery = {}): Promise<SalesReportResponse> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);
    const groupBy = query.groupBy === 'machine' || query.machineId ? 'machine' : 'day';

    let allRows: SalesReportRow[] = [];

    if (groupBy === 'machine') {
      let sql = 'SELECT * FROM sales_by_machine WHERE 1=1';
      const params: unknown[] = [];

      if (query.machineId) {
        params.push(query.machineId);
        sql += ` AND machine_id = $${params.length}`;
      }
      if (query.from) {
        params.push(query.from);
        sql += ` AND date >= $${params.length}::date`;
      }
      if (query.to) {
        params.push(query.to);
        sql += ` AND date <= $${params.length}::date`;
      }
      sql += ' ORDER BY date DESC, machine_id ASC';

      // No silent fallback: the view is created by the Phase 7 migration; a failure must surface.
      const rawRows = await this.prisma.$queryRawUnsafe<RawSalesByMachineRow[]>(sql, ...params);

      allRows = rawRows.map((r) => ({
        date: formatDate(r.date),
        machineId: r.machine_id,
        currency: (r.currency === 'USD' ? 'USD' : 'KHR') as 'USD' | 'KHR',
        totalPayments: toNum(r.total_payments),
        dispensedCount: toNum(r.dispensed_count),
        refundedCount: toNum(r.refunded_count),
        grossAmountMinor: toNum(r.gross_amount_minor),
        refundedAmountMinor: toNum(r.refunded_amount_minor),
        netAmountMinor: toNum(r.net_amount_minor),
        totalVolumeMl: toNum(r.total_volume_ml),
      }));
    } else {
      let sql = 'SELECT * FROM sales_daily WHERE 1=1';
      const params: unknown[] = [];

      if (query.from) {
        params.push(query.from);
        sql += ` AND date >= $${params.length}::date`;
      }
      if (query.to) {
        params.push(query.to);
        sql += ` AND date <= $${params.length}::date`;
      }
      sql += ' ORDER BY date DESC';

      const rawRows = await this.prisma.$queryRawUnsafe<RawSalesDailyRow[]>(sql, ...params);

      allRows = rawRows.map((r) => ({
        date: formatDate(r.date),
        currency: (r.currency === 'USD' ? 'USD' : 'KHR') as 'USD' | 'KHR',
        totalPayments: toNum(r.total_payments),
        dispensedCount: toNum(r.dispensed_count),
        refundedCount: toNum(r.refunded_count),
        grossAmountMinor: toNum(r.gross_amount_minor),
        refundedAmountMinor: toNum(r.refunded_amount_minor),
        netAmountMinor: toNum(r.net_amount_minor),
        totalVolumeMl: toNum(r.total_volume_ml),
      }));
    }

    const summaryUSD: SalesSummaryByCurrency = {
      currency: 'USD',
      totalPayments: 0,
      dispensedCount: 0,
      refundedCount: 0,
      grossAmountMinor: 0,
      refundedAmountMinor: 0,
      netAmountMinor: 0,
      totalVolumeMl: 0,
    };

    const summaryKHR: SalesSummaryByCurrency = {
      currency: 'KHR',
      totalPayments: 0,
      dispensedCount: 0,
      refundedCount: 0,
      grossAmountMinor: 0,
      refundedAmountMinor: 0,
      netAmountMinor: 0,
      totalVolumeMl: 0,
    };

    for (const row of allRows) {
      const target = row.currency === 'USD' ? summaryUSD : summaryKHR;
      target.totalPayments += row.totalPayments;
      target.dispensedCount += row.dispensedCount;
      target.refundedCount += row.refundedCount;
      target.grossAmountMinor += row.grossAmountMinor;
      target.refundedAmountMinor += row.refundedAmountMinor;
      target.netAmountMinor += row.netAmountMinor;
      target.totalVolumeMl += row.totalVolumeMl;
    }

    const paginatedRows = allRows.slice(offset, offset + limit);

    return {
      summary: {
        usd: summaryUSD,
        khr: summaryKHR,
      },
      pagination: {
        limit,
        offset,
        total: allRows.length,
      },
      rows: paginatedRows,
    };
  }

  async getFleetStatus(): Promise<MachineStatusReportRow[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawMachineStatusRow[]>(`
      SELECT * FROM machine_status_view ORDER BY id ASC;
    `);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location,
      enabled: r.enabled,
      currency: r.currency,
      online: r.online,
      lastSeenAt: r.last_seen_at,
      pendingOutcomes: toNum(r.pending_outcomes),
      pendingOutcomesSince: r.pending_outcomes_since,
      lastStm32State: r.last_stm32_state,
      decommissionedAt: r.decommissioned_at,
      activeAlertsCount: toNum(r.active_alerts_count),
    }));
  }

  async getRefundsReport(query: { status?: string } = {}): Promise<RefundsReportResponse> {
    let sql = 'SELECT * FROM refund_queue_view WHERE 1=1';
    const params: unknown[] = [];
    if (query.status) {
      params.push(query.status);
      // refund_status is a Postgres enum; compare as text (the controller validates the value)
      sql += ` AND refund_status::text = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC;';

    const rawRows = await this.prisma.$queryRawUnsafe<RawRefundQueueRow[]>(sql, ...params);

    const statusCounts = {
      open: 0,
      claimed: 0,
      refunded: 0,
      rejected: 0,
      autoFailed: 0,
      total: rawRows.length,
    };

    const amounts = {
      usd: { pendingMinor: 0, refundedMinor: 0 },
      khr: { pendingMinor: 0, refundedMinor: 0 },
    };

    const items: RefundQueueReportItem[] = rawRows.map((r) => {
      const amount = toNum(r.amount_minor);
      // Money totals use the refund amounts, not the payment amount (partial refunds)
      const pending = toNum(r.suggested_amount_minor);
      const refunded = toNum(r.refunded_amount_minor ?? 0);
      const isUsd = r.currency === 'USD';

      if (r.refund_status === 'open') {
        statusCounts.open++;
        if (isUsd) amounts.usd.pendingMinor += pending;
        else amounts.khr.pendingMinor += pending;
      } else if (r.refund_status === 'claimed') {
        statusCounts.claimed++;
        if (isUsd) amounts.usd.pendingMinor += pending;
        else amounts.khr.pendingMinor += pending;
      } else if (r.refund_status === 'refunded') {
        statusCounts.refunded++;
        if (isUsd) amounts.usd.refundedMinor += refunded;
        else amounts.khr.refundedMinor += refunded;
      } else if (r.refund_status === 'rejected') {
        statusCounts.rejected++;
      } else if (r.refund_status === 'auto_failed') {
        statusCounts.autoFailed++;
        if (isUsd) amounts.usd.pendingMinor += pending;
        else amounts.khr.pendingMinor += pending;
      }

      return {
        tranId: r.tran_id,
        machineId: r.machine_id,
        amountMinor: amount,
        currency: r.currency,
        refundStatus: r.refund_status,
        refundReason: r.refund_reason,
        suggestedAmountMinor: toNum(r.suggested_amount_minor),
        refundedAmountMinor: r.refunded_amount_minor === null ? null : toNum(r.refunded_amount_minor),
        claimantId: r.claimant_id,
        expiresAt: r.expires_at,
        decisionReason: r.decision_reason,
        machineOnline: r.machine_online,
        machinePendingOutcomes: toNum(r.machine_pending_outcomes),
        lastStm32State: r.last_stm32_state,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    return {
      summary: {
        statusCounts,
        amounts,
      },
      items,
    };
  }

  generateSalesCsv(report: SalesReportResponse): string {
    const headers = [
      'Date',
      'Machine ID',
      'Currency',
      'Total Payments',
      'Dispensed Count',
      'Refunded Count',
      'Gross Amount Minor',
      'Refunded Amount Minor',
      'Net Amount Minor',
      'Gross Amount Major',
      'Refunded Amount Major',
      'Net Amount Major',
      'Total Volume mL',
    ];

    const lines: string[] = [headers.join(',')];

    for (const r of report.rows) {
      const isUsd = r.currency === 'USD';
      const grossMajor = isUsd ? (r.grossAmountMinor / 100).toFixed(2) : String(r.grossAmountMinor);
      const refundedMajor = isUsd ? (r.refundedAmountMinor / 100).toFixed(2) : String(r.refundedAmountMinor);
      const netMajor = isUsd ? (r.netAmountMinor / 100).toFixed(2) : String(r.netAmountMinor);

      const row = [
        r.date ?? '',
        r.machineId ?? '',
        r.currency,
        r.totalPayments,
        r.dispensedCount,
        r.refundedCount,
        r.grossAmountMinor,
        r.refundedAmountMinor,
        r.netAmountMinor,
        grossMajor,
        refundedMajor,
        netMajor,
        r.totalVolumeMl,
      ];
      lines.push(row.map(escapeCsvValue).join(','));
    }

    return lines.join('\r\n') + '\r\n';
  }

}

function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
