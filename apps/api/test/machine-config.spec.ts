import { describe, expect, it } from 'vitest';
import { ConfigV1Schema } from '@wrm/contracts';
import { buildMachineConfig, toTierPrices } from '../src/contexts/fleet/application/machine-config';

describe('Machine config (C2 `config`, prices in major units)', () => {
  it('USD prices become 2-decimal strings', () => {
    const cfg = buildMachineConfig({
      enabled: true,
      decommissionedAt: null,
      currency: 'USD',
      prices: { 500: 15, 750: 20, 1000: 25 },
    });
    expect(cfg).toEqual({ v: 1, prices: { '500': '0.15', '750': '0.20', '1000': '0.25' }, currency: 'USD', enabled: true });
    expect(ConfigV1Schema.safeParse(cfg).success).toBe(true);
  });

  it('KHR prices are whole riel', () => {
    const cfg = buildMachineConfig({
      enabled: true,
      decommissionedAt: null,
      currency: 'KHR',
      prices: { 500: 500, 750: 700, 1000: 1000 },
    });
    expect(cfg.prices).toEqual({ '500': '500', '750': '700', '1000': '1000' });
    expect(ConfigV1Schema.safeParse(cfg).success).toBe(true);
  });

  it('a disabled or decommissioned machine is never enabled', () => {
    const base = { currency: 'USD' as const, prices: { 500: 15, 750: 20, 1000: 25 } };
    expect(buildMachineConfig({ ...base, enabled: false, decommissionedAt: null }).enabled).toBe(false);
    expect(buildMachineConfig({ ...base, enabled: true, decommissionedAt: new Date() }).enabled).toBe(false);
  });

  it('a missing tier is reported', () => {
    expect(toTierPrices([{ volumeMl: 500, amountMinor: 15 }, { volumeMl: 750, amountMinor: 20 }])).toBeNull();
  });
});
