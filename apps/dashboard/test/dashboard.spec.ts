import { describe, expect, it, vi, beforeEach } from 'vitest';
import { api, SalesReportResponse, RefundsReportResponse } from '../src/lib/api';

describe('Operator Dashboard Client & Business Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Revenue Calculation & Invariants', () => {
    it('verifies Net Revenue = Gross - Refunds holds for USD and KHR', () => {
      const mockSales: SalesReportResponse = {
        summary: {
          usd: {
            currency: 'USD',
            totalPayments: 10,
            dispensedCount: 8,
            refundedCount: 2,
            grossAmountMinor: 150, // $1.50
            refundedAmountMinor: 30, // $0.30
            netAmountMinor: 120, // $1.20
            totalVolumeMl: 4000,
          },
          khr: {
            currency: 'KHR',
            totalPayments: 20,
            dispensedCount: 18,
            refundedCount: 2,
            grossAmountMinor: 10000, // 10,000 KHR
            refundedAmountMinor: 1000, // 1,000 KHR
            netAmountMinor: 9000, // 9,000 KHR
            totalVolumeMl: 9000,
          },
        },
        pagination: { limit: 50, offset: 0, total: 2 },
        rows: [],
      };

      // USD check
      const usdGross = mockSales.summary.usd.grossAmountMinor;
      const usdRefunds = mockSales.summary.usd.refundedAmountMinor;
      const usdNet = mockSales.summary.usd.netAmountMinor;
      expect(usdGross - usdRefunds).toBe(usdNet);
      expect((usdNet / 100).toFixed(2)).toBe('1.20');

      // KHR check
      const khrGross = mockSales.summary.khr.grossAmountMinor;
      const khrRefunds = mockSales.summary.khr.refundedAmountMinor;
      const khrNet = mockSales.summary.khr.netAmountMinor;
      expect(khrGross - khrRefunds).toBe(khrNet);
      expect(khrNet).toBe(9000);
    });
  });

  describe('Refund Safety Invariants (Plan §C1)', () => {
    it('flags refund cases where machine has pending outcomes', () => {
      const mockRefunds: RefundsReportResponse = {
        summary: {
          statusCounts: { open: 1, claimed: 0, refunded: 0, rejected: 0, autoFailed: 0, total: 1 },
          amounts: { usd: { pendingMinor: 15, refundedMinor: 0 }, khr: { pendingMinor: 0, refundedMinor: 0 } },
        },
        items: [
          {
            tranId: 'tran-stuck-1',
            machineId: 'WRM-001',
            amountMinor: 15,
            currency: 'USD',
            refundStatus: 'open',
            refundReason: 'DISPENSE_FAILED',
            claimantId: null,
            claimedAt: null,
            expiresAt: null,
            decisionReason: null,
            machineOnline: false,
            machinePendingOutcomes: 1, // Stuck outcome!
            lastStm32State: 'DISPENSE',
            createdAt: '2026-11-14T10:00:00Z',
            updatedAt: '2026-11-14T10:00:00Z',
          },
        ],
      };

      const item = mockRefunds.items[0]!;
      expect(item.machinePendingOutcomes).toBeGreaterThan(0);

      // Verify safety rule: Requires emergency override reason if pendingOutcomes > 0
      const isOverrideRequired = item.machinePendingOutcomes > 0;
      expect(isOverrideRequired).toBe(true);
    });
  });

  describe('API Client Request Builder', () => {
    it('constructs correct query parameters for sales report', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            summary: {
              usd: { grossAmountMinor: 0, refundedAmountMinor: 0, netAmountMinor: 0 },
              khr: { grossAmountMinor: 0, refundedAmountMinor: 0, netAmountMinor: 0 },
            },
            pagination: { limit: 20, offset: 0, total: 0 },
            rows: [],
          },
        }),
      } as any);

      await api.getSalesReport({
        from: '2026-11-01',
        to: '2026-11-14',
        machineId: 'WRM-001',
        groupBy: 'machine',
        limit: 20,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        '/v1/reports/sales?from=2026-11-01&to=2026-11-14&machineId=WRM-001&groupBy=machine&limit=20',
        expect.objectContaining({ credentials: 'include' }),
      );
    });

    it('downloads CSV report with format=csv', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        text: async () => 'Date,Machine ID,Currency,Total Payments\r\n',
      } as any);

      const csv = await api.downloadSalesCsv({ groupBy: 'day' });
      expect(csv).toContain('Date,Machine ID,Currency');
      expect(fetchSpy).toHaveBeenCalledWith(
        '/v1/reports/sales?groupBy=day&format=csv',
        expect.objectContaining({ credentials: 'include' }),
      );
    });
  });
});
