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
  claimantId: string | null;
  claimedAt: Date | null;
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
  claimant_id: string | null;
  claimed_at: Date | null;
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

      let rawRows: RawSalesByMachineRow[] = [];
      try {
        rawRows = await this.prisma.$queryRawUnsafe<RawSalesByMachineRow[]>(sql, ...params);
      } catch (err) {
        this.logger.warn(`Failed to query sales_by_machine, fallback to direct query: ${(err as Error).message}`);
        rawRows = await this.queryDirectSalesByMachine(query);
      }

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

      let rawRows: RawSalesDailyRow[] = [];
      try {
        rawRows = await this.prisma.$queryRawUnsafe<RawSalesDailyRow[]>(sql, ...params);
      } catch (err) {
        this.logger.warn(`Failed to query sales_daily, fallback to direct query: ${(err as Error).message}`);
        rawRows = await this.queryDirectSalesDaily(query);
      }

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
    let rows: RawMachineStatusRow[] = [];
    try {
      rows = await this.prisma.$queryRawUnsafe<RawMachineStatusRow[]>(`
        SELECT * FROM machine_status_view ORDER BY id ASC;
      `);
    } catch (err) {
      this.logger.warn(`Failed to query machine_status_view, falling back to direct join: ${(err as Error).message}`);
      rows = await this.prisma.$queryRawUnsafe<RawMachineStatusRow[]>(`
        SELECT
            m.id,
            m.name,
            m.location,
            m.enabled,
            m.currency,
            m.online,
            m.last_seen_at,
            m.pending_outcomes,
            m.pending_outcomes_since,
            m.last_stm32_state,
            m.decommissioned_at,
            COUNT(a.id) FILTER (WHERE a.status = 'active')::INTEGER AS active_alerts_count
        FROM machines m
        LEFT JOIN alerts a ON a.machine_id = m.id
        GROUP BY m.id
        ORDER BY m.id ASC;
      `);
    }

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
      sql += ` AND refund_status = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC;';

    let rawRows: RawRefundQueueRow[] = [];
    try {
      rawRows = await this.prisma.$queryRawUnsafe<RawRefundQueueRow[]>(sql, ...params);
    } catch (err) {
      this.logger.warn(`Failed to query refund_queue_view, falling back to direct join: ${(err as Error).message}`);
      rawRows = await this.prisma.$queryRawUnsafe<RawRefundQueueRow[]>(`
        SELECT
            rc.tran_id,
            p.machine_id,
            p.amount_minor,
            p.currency,
            rc.status AS refund_status,
            rc.reason AS refund_reason,
            rc.claimant_id,
            rc.claimed_at,
            rc.expires_at,
            rc.decision_reason,
            m.online AS machine_online,
            m.pending_outcomes AS machine_pending_outcomes,
            m.last_stm32_state,
            rc.created_at,
            rc.updated_at
        FROM refund_cases rc
        JOIN payments p ON p.tran_id = rc.tran_id
        JOIN machines m ON m.id = p.machine_id
        ${query.status ? 'WHERE rc.status = $1' : ''}
        ORDER BY rc.created_at DESC;
      `, ...(query.status ? [query.status] : []));
    }

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
      const isUsd = r.currency === 'USD';

      if (r.refund_status === 'open') {
        statusCounts.open++;
        if (isUsd) amounts.usd.pendingMinor += amount;
        else amounts.khr.pendingMinor += amount;
      } else if (r.refund_status === 'claimed') {
        statusCounts.claimed++;
        if (isUsd) amounts.usd.pendingMinor += amount;
        else amounts.khr.pendingMinor += amount;
      } else if (r.refund_status === 'refunded') {
        statusCounts.refunded++;
        if (isUsd) amounts.usd.refundedMinor += amount;
        else amounts.khr.refundedMinor += amount;
      } else if (r.refund_status === 'rejected') {
        statusCounts.rejected++;
      } else if (r.refund_status === 'auto_failed') {
        statusCounts.autoFailed++;
        if (isUsd) amounts.usd.pendingMinor += amount;
        else amounts.khr.pendingMinor += amount;
      }

      return {
        tranId: r.tran_id,
        machineId: r.machine_id,
        amountMinor: amount,
        currency: r.currency,
        refundStatus: r.refund_status,
        refundReason: r.refund_reason,
        claimantId: r.claimant_id,
        claimedAt: r.claimed_at,
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

  private async queryDirectSalesDaily(query: SalesReportQuery): Promise<RawSalesDailyRow[]> {
    let sql = `
      SELECT
          DATE(p.paid_at) AS date,
          p.currency,
          COUNT(*)::INTEGER AS total_payments,
          COUNT(*) FILTER (WHERE p.status = 'DISPENSED')::INTEGER AS dispensed_count,
          COUNT(*) FILTER (WHERE p.status = 'REFUNDED')::INTEGER AS refunded_count,
          SUM(p.amount_minor)::BIGINT AS gross_amount_minor,
          SUM(COALESCE(p.refunded_amount_minor, 0))::BIGINT AS refunded_amount_minor,
          (SUM(p.amount_minor) - SUM(COALESCE(p.refunded_amount_minor, 0)))::BIGINT AS net_amount_minor,
          SUM(p.volume_ml)::BIGINT AS total_volume_ml
      FROM payments p
      WHERE p.paid_at IS NOT NULL
    `;
    const params: unknown[] = [];
    if (query.from) {
      params.push(query.from);
      sql += ` AND p.paid_at >= $${params.length}::date`;
    }
    if (query.to) {
      params.push(query.to);
      sql += ` AND p.paid_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }
    sql += ' GROUP BY DATE(p.paid_at), p.currency ORDER BY DATE(p.paid_at) DESC';

    return this.prisma.$queryRawUnsafe<RawSalesDailyRow[]>(sql, ...params);
  }

  private async queryDirectSalesByMachine(query: SalesReportQuery): Promise<RawSalesByMachineRow[]> {
    let sql = `
      SELECT
          p.machine_id,
          DATE(p.paid_at) AS date,
          p.currency,
          COUNT(*)::INTEGER AS total_payments,
          COUNT(*) FILTER (WHERE p.status = 'DISPENSED')::INTEGER AS dispensed_count,
          COUNT(*) FILTER (WHERE p.status = 'REFUNDED')::INTEGER AS refunded_count,
          SUM(p.amount_minor)::BIGINT AS gross_amount_minor,
          SUM(COALESCE(p.refunded_amount_minor, 0))::BIGINT AS refunded_amount_minor,
          (SUM(p.amount_minor) - SUM(COALESCE(p.refunded_amount_minor, 0)))::BIGINT AS net_amount_minor,
          SUM(p.volume_ml)::BIGINT AS total_volume_ml
      FROM payments p
      WHERE p.paid_at IS NOT NULL
    `;
    const params: unknown[] = [];
    if (query.machineId) {
      params.push(query.machineId);
      sql += ` AND p.machine_id = $${params.length}`;
    }
    if (query.from) {
      params.push(query.from);
      sql += ` AND p.paid_at >= $${params.length}::date`;
    }
    if (query.to) {
      params.push(query.to);
      sql += ` AND p.paid_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }
    sql += ' GROUP BY p.machine_id, DATE(p.paid_at), p.currency ORDER BY DATE(p.paid_at) DESC, p.machine_id ASC';

    return this.prisma.$queryRawUnsafe<RawSalesByMachineRow[]>(sql, ...params);
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
