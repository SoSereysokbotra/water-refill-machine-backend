import { Payment } from '../payment.aggregate';

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
}
