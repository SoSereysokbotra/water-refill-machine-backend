export const PAYMENTS_REFUND_MONITORING = 'PaymentsRefundMonitoringPort';

export interface StaleRefundCase {
  tranId: string;
  machineId: string | null;
  createdAt: Date;
}

export interface PaymentsRefundMonitoringPort {
  getStaleRefundCases(olderThanMinutes: number): Promise<StaleRefundCase[]>;
}

