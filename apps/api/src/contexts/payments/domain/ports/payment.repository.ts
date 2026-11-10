import { Payment } from '../payment.aggregate';
import { Dispense } from '../dispense.entity';
import { RefundCase, RefundStatus } from '../refund-case.entity';

export interface PaymentRepository {
  get(tranId: string, tx?: unknown): Promise<Payment>;
  findByTranId(tranId: string, tx?: unknown): Promise<Payment | null>;
  findByRequest(machineId: string, requestId: string, tx?: unknown): Promise<Payment | null>;
  hasPaidOpen(machineId: string, tx?: unknown): Promise<boolean>;
  cancelPendingForMachine(machineId: string, reason: string, tx?: unknown): Promise<Payment[]>;
  insert(payment: Payment, tx?: unknown): Promise<void>;
  save(payment: Payment, tx?: unknown): Promise<void>;
  findDueForAbaCheck(now: Date, limit: number, tx?: unknown): Promise<Payment[]>;
  findDueForReconciliation(now: Date, limit: number, tx?: unknown): Promise<Payment[]>;
  findDueForDispenseUnknown(cutoff: Date, limit: number, tx?: unknown): Promise<Payment[]>;
  findDueForUnknownEscalation(cutoff: Date, limit: number, tx?: unknown): Promise<Payment[]>;

  // Dispenses & Outcomes
  recordDispense(dispense: Dispense, tx?: unknown): Promise<void>;
  getDispense(tranId: string, tx?: unknown): Promise<Dispense | null>;
  recordRejection(machineId: string, tranId: string | undefined, code: string, raw: unknown, tx?: unknown): Promise<void>;

  // Refund Cases
  saveRefundCase(refundCase: RefundCase, tx?: unknown): Promise<void>;
  getRefundCase(tranId: string, tx?: unknown): Promise<RefundCase | null>;
  findRefundCases(filter: { status?: RefundStatus; limit?: number }, tx?: unknown): Promise<RefundCase[]>;

  // Fleet guards
  getMachinePendingOutcomes(machineId: string, tx?: unknown): Promise<number>;
}
