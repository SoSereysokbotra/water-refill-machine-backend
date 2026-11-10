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
}
