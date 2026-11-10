import { Injectable } from '@nestjs/common';
import {
  CheckTransactionResult,
  CreateQrInput,
  CreateQrResult,
  DuplicateTranIdError,
  GatewayStatus,
  PaymentGateway,
} from '../../domain/ports/payment-gateway.port';

@Injectable()
export class MockPayWayGateway implements PaymentGateway {
  private readonly transactions = new Map<
    string,
    {
      status: GatewayStatus;
      apv?: string;
      error?: Error;
    }
  >();

  private duplicateTranIds = new Set<string>();

  setTransactionStatus(tranId: string, status: GatewayStatus, apv = 'MOCK_APV_123'): void {
    this.transactions.set(tranId, { status, apv });
  }

  setTransactionError(tranId: string, error: Error): void {
    this.transactions.set(tranId, { status: 'declined', error });
  }

  simulateDuplicate(tranId: string): void {
    this.duplicateTranIds.add(tranId);
  }

  async createQr(input: CreateQrInput): Promise<CreateQrResult> {
    if (this.duplicateTranIds.has(input.tranId)) {
      this.duplicateTranIds.delete(input.tranId);
      throw new DuplicateTranIdError(`Mock duplicate tranId: ${input.tranId}`);
    }

    const qrString = `00020101021229300016abaa0000000000015204599953038405404${input.amount}5802KH5912WRM Vending6010Phnom Penh6304${input.tranId}`;
    return {
      qrString,
      qrMd5: `md5-${input.tranId}`,
      qrImage: `data:image/png;base64,mockImage-${input.tranId}`,
      deeplink: `https://mock.abapay.com/${input.tranId}`,
    };
  }

  async checkTransaction(tranId: string): Promise<CheckTransactionResult> {
    const existing = this.transactions.get(tranId);
    if (!existing) {
      return { status: 'not_found', raw: { code: '6', message: 'Transaction not found' } };
    }

    if (existing.error) {
      throw existing.error;
    }

    return {
      status: existing.status,
      apv: existing.apv,
      paymentStatusCode: existing.status === 'approved' ? 0 : existing.status === 'pending' ? 2 : 3,
      paymentStatus: existing.status.toUpperCase(),
      raw: { mock: true, status: existing.status },
    };
  }

  async closeTransaction(tranId: string): Promise<void> {
    // Mock close
  }
}
