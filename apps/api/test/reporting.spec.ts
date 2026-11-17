import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReportingService } from '../src/contexts/reporting/application/reporting.service';
import { ReportingSweep } from '../src/contexts/reporting/application/reporting.sweep';
import { ReportsController } from '../src/contexts/reporting/interface/reports.controller';

describe('Phase 7 — Reporting & Analytics Engine', () => {
  let mockPrisma: any;
  let sweep: ReportingSweep;
  let service: ReportingService;
  let controller: ReportsController;

  beforeEach(() => {
    mockPrisma = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
      $queryRawUnsafe: vi.fn(),
    };
    sweep = new ReportingSweep(mockPrisma);
    service = new ReportingService(mockPrisma, sweep);
    controller = new ReportsController(service);
  });

  describe('ReportingSweep', () => {
    it('refreshes sales_daily and sales_by_machine materialized views concurrently', async () => {
      const res = await sweep.execute();
      expect(res.refreshed).toBe(true);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY sales_daily;',
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY sales_by_machine;',
      );
    });

    it('falls back to non-concurrent refresh if populated error occurs', async () => {
      mockPrisma.$executeRawUnsafe
        .mockRejectedValueOnce(new Error('materialized view "sales_daily" has not been populated'))
        .mockResolvedValue(1);

      const res = await sweep.execute();
      expect(res.refreshed).toBe(true);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'REFRESH MATERIALIZED VIEW sales_daily;',
      );
    });
  });

  describe('ReportingService — Net Revenue & Sales Reports', () => {
    it('calculates gross, refunds, and net revenue matching DB totals for both USD and KHR', async () => {
      // Mock sales_daily rows containing USD and KHR transactions with refunds
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          date: '2026-11-14',
          currency: 'USD',
          total_payments: '10',
          dispensed_count: '8',
          refunded_count: '2',
          gross_amount_minor: '150', // $1.50
          refunded_amount_minor: '30', // $0.30
          net_amount_minor: '120', // $1.20 net
          total_volume_ml: '4000',
        },
        {
          date: '2026-11-14',
          currency: 'KHR',
          total_payments: '20',
          dispensed_count: '18',
          refunded_count: '2',
          gross_amount_minor: '10000', // 10,000 KHR
          refunded_amount_minor: '1000', // 1,000 KHR
          net_amount_minor: '9000', // 9,000 KHR net
          total_volume_ml: '9000',
        },
      ]);

      const res = await service.getSalesReport({ groupBy: 'day' });

      // Check USD summary
      expect(res.summary.usd.grossAmountMinor).toBe(150);
      expect(res.summary.usd.refundedAmountMinor).toBe(30);
      expect(res.summary.usd.netAmountMinor).toBe(120);
      expect(res.summary.usd.grossAmountMinor - res.summary.usd.refundedAmountMinor).toBe(
        res.summary.usd.netAmountMinor,
      );
      expect(res.summary.usd.totalPayments).toBe(10);
      expect(res.summary.usd.dispensedCount).toBe(8);
      expect(res.summary.usd.refundedCount).toBe(2);

      // Check KHR summary
      expect(res.summary.khr.grossAmountMinor).toBe(10000);
      expect(res.summary.khr.refundedAmountMinor).toBe(1000);
      expect(res.summary.khr.netAmountMinor).toBe(9000);
      expect(res.summary.khr.grossAmountMinor - res.summary.khr.refundedAmountMinor).toBe(
        res.summary.khr.netAmountMinor,
      );
      expect(res.summary.khr.totalPayments).toBe(20);
      expect(res.summary.khr.dispensedCount).toBe(18);
      expect(res.summary.khr.refundedCount).toBe(2);

      expect(res.rows).toHaveLength(2);
      expect(res.pagination.total).toBe(2);
    });

    it('queries sales_by_machine when groupBy is machine', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          machine_id: 'WRM-001',
          date: '2026-11-14',
          currency: 'USD',
          total_payments: 5,
          dispensed_count: 5,
          refunded_count: 0,
          gross_amount_minor: 75,
          refunded_amount_minor: 0,
          net_amount_minor: 75,
          total_volume_ml: 2500,
        },
      ]);

      const res = await service.getSalesReport({ groupBy: 'machine', machineId: 'WRM-001' });

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.machineId).toBe('WRM-001');
      expect(res.rows[0]?.grossAmountMinor).toBe(75);
      expect(res.rows[0]?.netAmountMinor).toBe(75);
    });

    it('generates RFC-4180 compliant CSV export with both minor and major amounts', async () => {
      const report = {
        summary: {
          usd: {
            currency: 'USD' as const,
            totalPayments: 1,
            dispensedCount: 1,
            refundedCount: 0,
            grossAmountMinor: 15,
            refundedAmountMinor: 0,
            netAmountMinor: 15,
            totalVolumeMl: 500,
          },
          khr: {
            currency: 'KHR' as const,
            totalPayments: 1,
            dispensedCount: 1,
            refundedCount: 0,
            grossAmountMinor: 500,
            refundedAmountMinor: 0,
            netAmountMinor: 500,
            totalVolumeMl: 500,
          },
        },
        pagination: { limit: 50, offset: 0, total: 2 },
        rows: [
          {
            date: '2026-11-14',
            machineId: 'WRM-001',
            currency: 'USD' as const,
            totalPayments: 1,
            dispensedCount: 1,
            refundedCount: 0,
            grossAmountMinor: 15,
            refundedAmountMinor: 0,
            netAmountMinor: 15,
            totalVolumeMl: 500,
          },
          {
            date: '2026-11-14',
            machineId: 'WRM-900',
            currency: 'KHR' as const,
            totalPayments: 1,
            dispensedCount: 1,
            refundedCount: 0,
            grossAmountMinor: 500,
            refundedAmountMinor: 0,
            netAmountMinor: 500,
            totalVolumeMl: 500,
          },
        ],
      };

      const csv = service.generateSalesCsv(report);
      expect(csv).toContain('Date,Machine ID,Currency,Total Payments');
      expect(csv).toContain('2026-11-14,WRM-001,USD,1,1,0,15,0,15,0.15,0.00,0.15,500');
      expect(csv).toContain('2026-11-14,WRM-900,KHR,1,1,0,500,0,500,500,0,500,500');
    });
  });

  describe('ReportingService — Machine Status & Refund Queue', () => {
    it('queries machine_status_view with active alert count and pending outcomes', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'WRM-001',
          name: 'Main Campus Station',
          location: 'Building A, Lobby',
          enabled: true,
          currency: 'USD',
          online: true,
          last_seen_at: new Date('2026-11-14T10:00:00Z'),
          pending_outcomes: 0,
          pending_outcomes_since: null,
          last_stm32_state: 'IDLE',
          decommissioned_at: null,
          active_alerts_count: 0,
        },
        {
          id: 'WRM-002',
          name: 'Library Station',
          location: '2nd Floor',
          enabled: true,
          currency: 'USD',
          online: false,
          last_seen_at: new Date('2026-11-14T08:00:00Z'),
          pending_outcomes: 1,
          pending_outcomes_since: new Date('2026-11-14T08:05:00Z'),
          last_stm32_state: 'DISPENSE',
          decommissioned_at: null,
          active_alerts_count: 2,
        },
      ]);

      const fleet = await service.getFleetStatus();
      expect(fleet).toHaveLength(2);
      expect(fleet[0]?.id).toBe('WRM-001');
      expect(fleet[0]?.online).toBe(true);
      expect(fleet[1]?.id).toBe('WRM-002');
      expect(fleet[1]?.online).toBe(false);
      expect(fleet[1]?.pendingOutcomes).toBe(1);
      expect(fleet[1]?.activeAlertsCount).toBe(2);
    });

    it('queries refund_queue_view and produces categorized metrics and items', async () => {
      const now = new Date();
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          tran_id: 't-usd-open',
          machine_id: 'WRM-001',
          amount_minor: '15',
          currency: 'USD',
          refund_status: 'open',
          refund_reason: 'DISPENSE_FAILED',
          suggested_amount_minor: '15',
          refunded_amount_minor: null,
          claimant_id: null,
          expires_at: null,
          decision_reason: null,
          machine_online: true,
          machine_pending_outcomes: '0',
          last_stm32_state: 'IDLE',
          created_at: now,
          updated_at: now,
        },
        {
          tran_id: 't-usd-refunded',
          machine_id: 'WRM-001',
          amount_minor: '20',
          currency: 'USD',
          refund_status: 'refunded',
          refund_reason: 'LATE_PAYMENT',
          suggested_amount_minor: '20',
          refunded_amount_minor: '20',
          claimant_id: 'u-admin',
          expires_at: now,
          decision_reason: 'Refunded via ABA PayWay portal',
          machine_online: true,
          machine_pending_outcomes: '0',
          last_stm32_state: 'IDLE',
          created_at: now,
          updated_at: now,
        },
        {
          tran_id: 't-khr-open',
          machine_id: 'WRM-900',
          amount_minor: '500',
          currency: 'KHR',
          refund_status: 'open',
          refund_reason: 'DISPENSE_FAILED',
          suggested_amount_minor: '500',
          refunded_amount_minor: null,
          claimant_id: null,
          expires_at: null,
          decision_reason: null,
          machine_online: false,
          machine_pending_outcomes: '1',
          last_stm32_state: 'DISPENSE',
          created_at: now,
          updated_at: now,
        },
      ]);

      const res = await service.getRefundsReport();
      expect(res.summary.statusCounts.open).toBe(2);
      expect(res.summary.statusCounts.refunded).toBe(1);
      expect(res.summary.statusCounts.total).toBe(3);

      expect(res.summary.amounts.usd.pendingMinor).toBe(15);
      expect(res.summary.amounts.usd.refundedMinor).toBe(20);
      expect(res.summary.amounts.khr.pendingMinor).toBe(500);

      expect(res.items).toHaveLength(3);
      expect(res.items[0]?.tranId).toBe('t-usd-open');
      expect(res.items[0]?.machinePendingOutcomes).toBe(0);
      expect(res.items[2]?.machinePendingOutcomes).toBe(1);
      expect(res.items[2]?.machineOnline).toBe(false);
    });
  });

  describe('ReportsController', () => {
    it('returns sales report data in JSON format by default', async () => {
      vi.spyOn(service, 'getSalesReport').mockResolvedValueOnce({
        summary: {
          usd: {
            currency: 'USD',
            totalPayments: 1,
            dispensedCount: 1,
            refundedCount: 0,
            grossAmountMinor: 15,
            refundedAmountMinor: 0,
            netAmountMinor: 15,
            totalVolumeMl: 500,
          },
          khr: {
            currency: 'KHR',
            totalPayments: 0,
            dispensedCount: 0,
            refundedCount: 0,
            grossAmountMinor: 0,
            refundedAmountMinor: 0,
            netAmountMinor: 0,
            totalVolumeMl: 0,
          },
        },
        pagination: { limit: 50, offset: 0, total: 1 },
        rows: [],
      });

      const res = await controller.getSalesReport({ groupBy: 'day' });
      expect(typeof res).not.toBe('string');
      if (typeof res !== 'string') {
        expect(res).toHaveProperty('data');
        expect(res.data.summary.usd.netAmountMinor).toBe(15);
      }
    });

    it('sets CSV headers and returns CSV text when format=csv', async () => {
      vi.spyOn(service, 'getSalesReport').mockResolvedValueOnce({
        summary: {
          usd: {
            currency: 'USD',
            totalPayments: 0,
            dispensedCount: 0,
            refundedCount: 0,
            grossAmountMinor: 0,
            refundedAmountMinor: 0,
            netAmountMinor: 0,
            totalVolumeMl: 0,
          },
          khr: {
            currency: 'KHR',
            totalPayments: 0,
            dispensedCount: 0,
            refundedCount: 0,
            grossAmountMinor: 0,
            refundedAmountMinor: 0,
            netAmountMinor: 0,
            totalVolumeMl: 0,
          },
        },
        pagination: { limit: 50, offset: 0, total: 0 },
        rows: [],
      });

      const setHeader = vi.fn();
      const mockReply: any = {
        header: setHeader,
      };

      const res = await controller.getSalesReport({ format: 'csv' }, mockReply);
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="sales-report.csv"',
      );
      expect(typeof res).toBe('string');
      expect(res).toContain('Date,Machine ID,Currency');
    });

    it('returns fleet status and refund reports through controller endpoints', async () => {
      vi.spyOn(service, 'getFleetStatus').mockResolvedValueOnce([
        {
          id: 'WRM-001',
          name: 'Main',
          location: 'HQ',
          enabled: true,
          currency: 'USD',
          online: true,
          lastSeenAt: null,
          pendingOutcomes: 0,
          pendingOutcomesSince: null,
          lastStm32State: 'IDLE',
          decommissionedAt: null,
          activeAlertsCount: 0,
        },
      ]);

      const fleetRes = await controller.getFleetStatus();
      expect(fleetRes.data).toHaveLength(1);

      vi.spyOn(service, 'getRefundsReport').mockResolvedValueOnce({
        summary: {
          statusCounts: { open: 1, claimed: 0, refunded: 0, rejected: 0, autoFailed: 0, total: 1 },
          amounts: { usd: { pendingMinor: 15, refundedMinor: 0 }, khr: { pendingMinor: 0, refundedMinor: 0 } },
        },
        items: [],
      });

      const refundRes = await controller.getRefundsReport({});
      expect(refundRes.data.summary.statusCounts.open).toBe(1);

      const refreshRes = await controller.refreshViews();
      expect(refreshRes.data.refreshed).toBe(true);
    });
  });
});
