import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigV1, ERROR_CODES } from '@wrm/contracts';
import { PrismaService } from '../../../platform/database/prisma.service';
import { PrismaTransaction, UnitOfWork } from '../../../platform/database/unit-of-work';
import { OutboxService } from '../../../platform/outbox/outbox.service';
import { Clock, ConflictError, Currency, NotFoundError, ValidationError } from '../../../shared-kernel';
import { machineConfigChangedEvent, MachineConfigChangedData } from './fleet.events';
import { buildMachineConfig, TierPrices, toTierPrices, VOLUME_TIERS } from './machine-config';
import { FleetMachinePricingPort, MachinePricing } from './public/machine-pricing.port';
import { FleetMonitoringPort, MachineStuckOutcomes } from './public/fleet-monitoring.port';

/** Plan §C2: machineId = WRM-<3..6 digits> */
export const MACHINE_ID_PATTERN = /^WRM-\d{3,6}$/;

export interface MqttCredentials {
  username: string;
  /** Shown once. Never stored by the backend; the broker (EMQX) keeps it. */
  password: string;
  /** Manual step until an EMQX management API adapter exists (Plan Phase 4 task 1). */
  brokerSetup: string[];
}

export interface MachineView {
  id: string;
  name: string;
  location: string | null;
  enabled: boolean;
  decommissionedAt: Date | null;
  currency: Currency;
  pricesMinor: TierPrices | null;
  mqttUsername: string;
  online: boolean;
  lastSeenAt: Date | null;
  firmware: string | null;
  lastStm32State: string | null;
  pendingOutcomes: number;
  createdAt: Date;
}

type MachineRow = Prisma.MachineGetPayload<{ include: { prices: true } }>;

/**
 * Fleet machine management (2-layer supporting context, Plan B2 / Phase 4 task 1).
 * Every change that affects the machine publishes `fleet.MachineConfigChanged` through the outbox;
 * the handler sends the retained `config` message.
 */
@Injectable()
export class MachinesService implements FleetMachinePricingPort, FleetMonitoringPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject('Clock') private readonly clock: Clock,
  ) {}

  async provision(input: {
    id: string;
    name: string;
    location?: string;
    currency: Currency;
    pricesMinor: TierPrices;
  }): Promise<{ machine: MachineView; credentials: MqttCredentials }> {
    if (!MACHINE_ID_PATTERN.test(input.id)) {
      throw new ValidationError(`Machine id must match ${MACHINE_ID_PATTERN} (e.g. WRM-001)`);
    }
    assertPrices(input.pricesMinor);
    const username = input.id.toLowerCase();

    const existing = await this.prisma.machine.findFirst({
      where: { OR: [{ id: input.id }, { mqttUsername: username }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError(ERROR_CODES.FLEET_MACHINE_EXISTS, `Machine ${input.id} or MQTT user ${username} already exists`);
    }

    // A concurrent provision of the same id loses on the unique key -> 409 CONCURRENCY_CONFLICT
    await this.uow.run(
      async (tx) => {
        await tx.machine.create({
          data: {
            id: input.id,
            name: input.name,
            location: input.location ?? null,
            enabled: true,
            currency: input.currency,
            mqttUsername: username,
            prices: { create: VOLUME_TIERS.map((v) => ({ volumeMl: v, amountMinor: input.pricesMinor[v] })) },
          },
        });
        await this.publishConfigChanged(tx, { machineId: input.id, reason: 'provisioned' });
      },
      { retryOn: [] },
    );

    return { machine: await this.get(input.id), credentials: this.newCredentials(username, input.id, 'create') };
  }

  async list(): Promise<MachineView[]> {
    const rows = await this.prisma.machine.findMany({ include: { prices: true }, orderBy: { id: 'asc' } });
    return rows.map(toView);
  }

  async get(machineId: string): Promise<MachineView> {
    return toView(await this.load(this.prisma, machineId));
  }

  async update(machineId: string, patch: { name?: string; location?: string | null; enabled?: boolean }): Promise<MachineView> {
    await this.uow.run(async (tx) => {
      const row = await this.load(tx, machineId);
      if (row.decommissionedAt && patch.enabled === true) {
        throw new ConflictError(ERROR_CODES.FLEET_MACHINE_DECOMMISSIONED, `Machine ${machineId} is decommissioned`);
      }
      await tx.machine.update({
        where: { id: machineId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          version: { increment: 1 },
        },
      });
      if (patch.enabled !== undefined && patch.enabled !== row.enabled) {
        await this.publishConfigChanged(tx, { machineId, reason: 'enabled' });
      }
    });
    return this.get(machineId);
  }

  /** Prices for all three tiers (+ currency). A payment keeps the price it was created with. */
  async setPrices(machineId: string, currency: Currency, pricesMinor: TierPrices): Promise<MachineView> {
    assertPrices(pricesMinor);
    await this.uow.run(async (tx) => {
      const row = await this.load(tx, machineId);
      if (row.decommissionedAt) {
        throw new ConflictError(ERROR_CODES.FLEET_MACHINE_DECOMMISSIONED, `Machine ${machineId} is decommissioned`);
      }
      await tx.machine.update({ where: { id: machineId }, data: { currency, version: { increment: 1 } } });
      for (const v of VOLUME_TIERS) {
        await tx.machinePrice.upsert({
          where: { machineId_volumeMl: { machineId, volumeMl: v } },
          update: { amountMinor: pricesMinor[v] },
          create: { machineId, volumeMl: v, amountMinor: pricesMinor[v] },
        });
      }
      await this.publishConfigChanged(tx, { machineId, reason: 'prices' });
    });
    return this.get(machineId);
  }

  /** New MQTT password, shown once. The old one stays valid until it is changed at the broker. */
  async rotateCredentials(machineId: string): Promise<MqttCredentials> {
    const row = await this.load(this.prisma, machineId);
    if (row.decommissionedAt) {
      throw new ConflictError(ERROR_CODES.FLEET_MACHINE_DECOMMISSIONED, `Machine ${machineId} is decommissioned`);
    }
    return this.newCredentials(row.mqttUsername, machineId, 'rotate');
  }

  /** Retire a machine: disabled for good (config enabled=false), its MQTT user must be removed at the broker. */
  async decommission(machineId: string): Promise<{ machine: MachineView; brokerSetup: string[] }> {
    let username = '';
    await this.uow.run(async (tx) => {
      const row = await this.load(tx, machineId);
      username = row.mqttUsername;
      if (row.decommissionedAt) return; // idempotent
      await tx.machine.update({
        where: { id: machineId },
        data: { enabled: false, decommissionedAt: this.clock.now(), version: { increment: 1 } },
      });
      await this.publishConfigChanged(tx, { machineId, reason: 'decommissioned' });
    });
    return {
      machine: await this.get(machineId),
      brokerSetup: [`In the EMQX console (Access Control > Authentication), delete the user "${username}".`],
    };
  }

  /** Current config for the retained `config` message (built from the DB at publish time: newest wins). */
  async getConfig(machineId: string): Promise<ConfigV1> {
    const row = await this.load(this.prisma, machineId);
    const prices = toTierPrices(row.prices);
    if (!prices) {
      throw new ValidationError(`Machine ${machineId} is missing a price tier`);
    }
    return buildMachineConfig({
      enabled: row.enabled,
      decommissionedAt: row.decommissionedAt,
      currency: row.currency as Currency,
      prices,
    });
  }

  // FleetMachinePricingPort (public port for Payments)
  async getMachinePricing(machineId: string, tx?: unknown): Promise<MachinePricing | null> {
    const client = (tx as PrismaTransaction | undefined) ?? this.prisma;
    const row = await client.machine.findUnique({ where: { id: machineId }, include: { prices: true } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled && row.decommissionedAt === null,
      currency: row.currency as Currency,
      pricesMinor: new Map(row.prices.map((p) => [p.volumeMl, p.amountMinor])),
    };
  }

  private async load(client: PrismaTransaction | PrismaService, machineId: string): Promise<MachineRow> {
    const row = await client.machine.findUnique({ where: { id: machineId }, include: { prices: true } });
    if (!row) {
      throw new NotFoundError(ERROR_CODES.PAY_MACHINE_NOT_FOUND, `Machine ${machineId} does not exist`);
    }
    return row;
  }

  private async publishConfigChanged(tx: PrismaTransaction, data: MachineConfigChangedData): Promise<void> {
    await this.outbox.add([machineConfigChangedEvent(data, this.clock.now())], tx, 'Machine', data.machineId);
  }

  private newCredentials(username: string, machineId: string, kind: 'create' | 'rotate'): MqttCredentials {
    const password = randomBytes(18).toString('base64url'); // 24 chars, URL/C-string safe
    const brokerStep =
      kind === 'create'
        ? `In the EMQX console (Access Control > Authentication), add user "${username}" with this password.`
        : `In the EMQX console (Access Control > Authentication), change the password of user "${username}" to this one (the old password stops working then).`;
    return {
      username,
      password,
      brokerSetup: [
        brokerStep,
        `In firmware/esp32-gateway/include/secrets.h set MACHINE_ID "${machineId}", MQTT_USERNAME "${username}", MQTT_PASSWORD to this password, then flash the ESP32.`,
        'This password is shown only once and is not stored by the backend.',
      ],
    };
  }

  async getMachinesWithStuckOutcomes(olderThanMinutes: number): Promise<MachineStuckOutcomes[]> {
    const cutoff = new Date(this.clock.now().getTime() - olderThanMinutes * 60 * 1000);
    const rows = await this.prisma.machine.findMany({
      where: {
        pendingOutcomes: { gt: 0 },
        pendingOutcomesSince: { lte: cutoff },
      },
      select: {
        id: true,
        pendingOutcomes: true,
        pendingOutcomesSince: true,
      },
    });
    return rows.map((r) => ({
      machineId: r.id,
      pendingOutcomes: r.pendingOutcomes,
      pendingOutcomesSince: r.pendingOutcomesSince!,
    }));
  }
}

function assertPrices(prices: TierPrices): void {
  for (const v of VOLUME_TIERS) {
    const p = prices[v];
    if (!Number.isInteger(p) || p <= 0) {
      throw new ValidationError(`Price for ${v} mL must be a positive integer in minor units`);
    }
  }
}

function toView(row: MachineRow): MachineView {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    enabled: row.enabled,
    decommissionedAt: row.decommissionedAt,
    currency: row.currency as Currency,
    pricesMinor: toTierPrices(row.prices),
    mqttUsername: row.mqttUsername,
    online: row.online,
    lastSeenAt: row.lastSeenAt,
    firmware: row.firmware,
    lastStm32State: row.lastStm32State,
    pendingOutcomes: row.pendingOutcomes,
    createdAt: row.createdAt,
  };
}
