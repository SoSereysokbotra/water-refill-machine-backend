import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/platform/config/config.service';
import { PayWayGatewayAdapter } from '../src/contexts/payments/infrastructure/gateways/payway.gateway';
import {
  DuplicateTranIdError,
  GatewayRejectedError,
  GatewayUnavailableError,
} from '../src/contexts/payments/domain/ports/payment-gateway.port';

describe('PayWay Adapter - Per-Operation Code Mapping (ADR-0009 / Plan D7)', () => {
  function createGatewayWithMockFetch(mockResponse: { status?: number; json: unknown }) {
    const config = {
      get: (key: string) => {
        if (key === 'PAYWAY_BASE_URL') return 'https://mock.payway.com.kh';
        if (key === 'PAYWAY_MERCHANT_ID') return 'mock_merchant';
        if (key === 'PAYWAY_API_KEY') return 'mock_key_123';
        if (key === 'PAYWAY_CALLBACK_URL') return 'https://callback.com';
        return '';
      },
    } as unknown as ConfigService;

    const gateway = new PayWayGatewayAdapter(config);

    // Mock internal postJson using spy on global fetch
    (gateway as any).postJson = async () => {
      return mockResponse.json;
    };

    return gateway;
  }

  describe('generate-qr', () => {
    it('maps code 0 to success with qrString and qrMd5', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '0', message: 'Success' },
          qrString: '000201010212mockqr',
          qrImageMd5: 'md5hash123',
        },
      });

      const res = await gw.createQr({
        tranId: 'tran-1',
        amount: 0.15,
        currency: 'USD',
        lifetimeMin: 3,
      });

      expect(res.qrString).toBe('000201010212mockqr');
      expect(res.qrMd5).toBe('md5hash123');
    });

    it('maps code 403 to DuplicateTranIdError', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '403', message: 'Duplicated transaction ID' },
        },
      });

      await expect(
        gw.createQr({
          tranId: 'tran-1',
          amount: 0.15,
          currency: 'USD',
          lifetimeMin: 3,
        }),
      ).rejects.toThrow(DuplicateTranIdError);
    });

    it('maps code 8 and 429 to GatewayUnavailableError', async () => {
      const gw = createGatewayWithMockFetch({
        json: { status: { code: '8', message: 'System busy' } },
      });

      await expect(
        gw.createQr({
          tranId: 'tran-1',
          amount: 0.15,
          currency: 'USD',
          lifetimeMin: 3,
        }),
      ).rejects.toThrow(GatewayUnavailableError);
    });

    it('maps invalid merchant codes to GatewayRejectedError', async () => {
      const gw = createGatewayWithMockFetch({
        json: { status: { code: '12', message: 'Currency not allowed' } },
      });

      await expect(
        gw.createQr({
          tranId: 'tran-1',
          amount: 0.15,
          currency: 'USD',
          lifetimeMin: 3,
        }),
      ).rejects.toThrow(GatewayRejectedError);
    });
  });

  describe('check-transaction-2', () => {
    it('maps code 00 + payment_status_code 0 to approved', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '00', message: 'Success' },
          data: { payment_status_code: 0, payment_status: 'APPROVED', apv: 'APV123' },
        },
      });

      const res = await gw.checkTransaction('tran-1');
      expect(res.status).toBe('approved');
      expect(res.apv).toBe('APV123');
    });

    it('maps code 00 + payment_status_code 2 to pending', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '00', message: 'Success' },
          data: { payment_status_code: 2, payment_status: 'PENDING' },
        },
      });

      const res = await gw.checkTransaction('tran-1');
      expect(res.status).toBe('pending');
    });

    it('maps code 00 + payment_status_code 3 or 7 to declined', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '00', message: 'Success' },
          data: { payment_status_code: 3, payment_status: 'DECLINED' },
        },
      });

      const res = await gw.checkTransaction('tran-1');
      expect(res.status).toBe('declined');
    });

    it('maps code 6 (transaction not found) to not_found without throwing error', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '6', message: 'Transaction not found' },
        },
      });

      const res = await gw.checkTransaction('tran-1');
      expect(res.status).toBe('not_found');
    });

    it('maps code 11 to GatewayUnavailableError', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '11', message: 'Network timeout' },
        },
      });

      await expect(gw.checkTransaction('tran-1')).rejects.toThrow(GatewayUnavailableError);
    });

    it('maps code 5 (invalid hash) to GatewayRejectedError', async () => {
      const gw = createGatewayWithMockFetch({
        json: {
          status: { code: '5', message: 'Invalid hash' },
        },
      });

      await expect(gw.checkTransaction('tran-1')).rejects.toThrow(GatewayRejectedError);
    });
  });
});
