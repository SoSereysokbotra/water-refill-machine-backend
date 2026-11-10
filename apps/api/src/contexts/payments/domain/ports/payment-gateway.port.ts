import { Currency } from '../payment.types';

export type GatewayStatus = 'approved' | 'pending' | 'declined' | 'refunded' | 'not_found';

export interface CreateQrInput {
  tranId: string;
  amount: number;
  currency: Currency;
  lifetimeMin: number;
  callbackUrl?: string;
}

export interface CreateQrResult {
  qrString: string;
  qrMd5?: string;
  qrImage?: string;
  deeplink?: string;
}

export interface CheckTransactionResult {
  status: GatewayStatus;
  paymentStatusCode?: number;
  paymentStatus?: string;
  apv?: string;
  raw?: unknown;
}

export interface PaymentGateway {
  createQr(input: CreateQrInput): Promise<CreateQrResult>;
  checkTransaction(tranId: string): Promise<CheckTransactionResult>;
  closeTransaction(tranId: string): Promise<void>;
  refund?(tranId: string, amount: number, currency: Currency): Promise<void>;
}

export class DuplicateTranIdError extends Error {
  constructor(message = 'Duplicate transaction ID') {
    super(message);
    this.name = 'DuplicateTranIdError';
  }
}

export class GatewayUnavailableError extends Error {
  constructor(message = 'Payment gateway unavailable', public readonly details?: unknown) {
    super(message);
    this.name = 'GatewayUnavailableError';
  }
}

export class GatewayRejectedError extends Error {
  constructor(message = 'Payment gateway rejected request', public readonly details?: unknown) {
    super(message);
    this.name = 'GatewayRejectedError';
  }
}
