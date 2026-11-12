import { ConfigV1 } from '@wrm/contracts';
import { Currency, Money } from '../../../shared-kernel';

export const VOLUME_TIERS = [500, 750, 1000] as const;
export type VolumeTier = (typeof VOLUME_TIERS)[number];
export type TierPrices = Record<VolumeTier, number>; // amount_minor per tier

/**
 * The retained `config` message for one machine (Plan §C2). Pure function.
 * Prices in major units as strings (USD "0.15", KHR "500"); a decommissioned machine is never enabled.
 */
export function buildMachineConfig(machine: {
  enabled: boolean;
  decommissionedAt: Date | null;
  currency: Currency;
  prices: TierPrices;
}): ConfigV1 {
  const major = (tier: VolumeTier) => Money.of(machine.prices[tier], machine.currency).toMajorString();
  return {
    v: 1,
    prices: { '500': major(500), '750': major(750), '1000': major(1000) },
    currency: machine.currency,
    enabled: machine.enabled && machine.decommissionedAt === null,
  };
}

/** Prices from DB rows; every tier must be present (plan: missing tier -> VALIDATION_FAILED). */
export function toTierPrices(rows: { volumeMl: number; amountMinor: number }[]): TierPrices | null {
  const map = new Map(rows.map((r) => [r.volumeMl, r.amountMinor]));
  if (!VOLUME_TIERS.every((t) => map.has(t))) return null;
  return { 500: map.get(500)!, 750: map.get(750)!, 1000: map.get(1000)! };
}
