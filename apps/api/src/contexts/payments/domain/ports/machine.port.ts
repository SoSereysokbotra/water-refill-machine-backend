import { Currency } from '../payment.types';

export interface MachineForPayment {
  id: string;
  name: string;
  enabled: boolean;
  currency: Currency;
  prices: Map<number, number>; // volume_ml -> amount_minor
  priceFor(volumeMl: number): number | undefined;
}

export interface MachinePort {
  getForPayment(machineId: string, tx?: unknown): Promise<MachineForPayment>;
}
