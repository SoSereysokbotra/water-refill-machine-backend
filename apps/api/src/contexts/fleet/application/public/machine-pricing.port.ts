import { Currency } from '../../../../shared-kernel';

/**
 * Fleet public port (Architecture §4 context rules): the only way other contexts read machine
 * prices / status. Payments uses it to price a new payment.
 */
export const FLEET_MACHINE_PRICING = 'FleetMachinePricingPort';

export interface MachinePricing {
  id: string;
  name: string;
  /** false when disabled or decommissioned */
  enabled: boolean;
  currency: Currency;
  /** amount_minor per volume tier (500 / 750 / 1000) */
  pricesMinor: Map<number, number>;
}

export interface FleetMachinePricingPort {
  getMachinePricing(machineId: string, tx?: unknown): Promise<MachinePricing | null>;
}
