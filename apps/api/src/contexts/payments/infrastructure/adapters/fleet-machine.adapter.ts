import { Inject, Injectable } from '@nestjs/common';
import { DomainError, NotFoundError } from '../../../../shared-kernel';
import {
  FLEET_MACHINE_PRICING,
  FleetMachinePricingPort,
} from '../../../fleet/application/public/machine-pricing.port';
import { MachineForPayment, MachinePort } from '../../domain/ports/machine.port';

/**
 * MachinePort backed by the Fleet public port (Phase 4: replaces the temporary Prisma adapter).
 * Payments never reads Fleet's tables directly (Architecture §4 context rules).
 */
@Injectable()
export class FleetMachineAdapter implements MachinePort {
  constructor(@Inject(FLEET_MACHINE_PRICING) private readonly fleet: FleetMachinePricingPort) {}

  async getForPayment(machineId: string, tx?: unknown): Promise<MachineForPayment> {
    const machine = await this.fleet.getMachinePricing(machineId, tx);
    if (!machine) {
      throw new NotFoundError('PAY_MACHINE_NOT_FOUND', `Machine ${machineId} does not exist`);
    }
    if (!machine.enabled) {
      throw new DomainError('PAY_MACHINE_DISABLED', `Machine ${machineId} is disabled`);
    }
    const prices = machine.pricesMinor;
    return {
      id: machine.id,
      name: machine.name,
      enabled: machine.enabled,
      currency: machine.currency,
      prices,
      priceFor: (volumeMl: number) => prices.get(volumeMl),
    };
  }
}
