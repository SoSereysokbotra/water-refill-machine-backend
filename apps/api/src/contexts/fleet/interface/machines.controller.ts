import { Body, Controller, Get, Inject, Optional, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser } from '../../../platform/security';
import { ValidationError } from '../../../shared-kernel';
import { MachinesService } from '../application';
import { AUDIT_LOGGER_PORT, AuditLoggerPort } from '../../identity/application/public/audit-logger.port';

// REST prices are minor units (USD cents, KHR riel), like refund amounts. Devices get major units (C2/C3).
const PriceMinor = z.number().int().positive();
const PricesBody = z.object({ '500': PriceMinor, '750': PriceMinor, '1000': PriceMinor }); // missing tier -> 400
const Currency = z.enum(['USD', 'KHR']);

const ProvisionBody = z.object({
  id: z.string().trim(),
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().max(200).optional(),
  currency: Currency,
  prices: PricesBody,
});
const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    location: z.string().trim().max(200).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const PricesPutBody = z.object({ currency: Currency, prices: PricesBody });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

const toTier = (p: z.infer<typeof PricesBody>) => ({ 500: p['500'], 750: p['750'], 1000: p['1000'] });

/** Plan §C7 machines endpoints. Protected by SessionAuthGuard and RolesGuard. */
@Controller('v1/machines')
@UseGuards(SessionAuthGuard, RolesGuard)
export class MachinesController {
  constructor(
    @Inject(MachinesService) private readonly machines: MachinesService,
    @Optional() @Inject(AUDIT_LOGGER_PORT) private readonly audit?: AuditLoggerPort,
  ) {}

  /** Provision: row + prices + MQTT username + one-time password (shown once). */
  @Post()
  @Roles('admin')
  async provision(@Body() body: unknown, @CurrentUser() user?: AuthenticatedUser) {
    const b = parse(ProvisionBody, body);
    const res = await this.machines.provision({
      id: b.id,
      name: b.name,
      location: b.location,
      currency: b.currency,
      pricesMinor: toTier(b.prices),
    });

    await this.audit?.record({
      actorId: user?.id ?? 'system',
      action: 'machine.provision',
      entityType: 'machine',
      entityId: res.machine.id,
      after: { name: b.name, currency: b.currency, prices: b.prices },
    });

    return { data: res };
  }

  @Get()
  @Roles('viewer')
  async list() {
    return { data: await this.machines.list() };
  }

  @Get(':id')
  @Roles('viewer')
  async get(@Param('id') id: string) {
    return { data: await this.machines.get(id) };
  }

  @Patch(':id')
  @Roles('admin')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user?: AuthenticatedUser) {
    const patch = parse(PatchBody, body);
    const res = await this.machines.update(id, patch);

    await this.audit?.record({
      actorId: user?.id ?? 'system',
      action: 'machine.update',
      entityType: 'machine',
      entityId: id,
      after: patch,
    });

    return { data: res };
  }

  @Put(':id/prices')
  @Roles('admin')
  async setPrices(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user?: AuthenticatedUser) {
    const b = parse(PricesPutBody, body);
    const res = await this.machines.setPrices(id, b.currency, toTier(b.prices));

    await this.audit?.record({
      actorId: user?.id ?? 'system',
      action: 'price.update',
      entityType: 'machine',
      entityId: id,
      after: { currency: b.currency, prices: b.prices },
    });

    return { data: res };
  }

  @Post(':id/rotate-credentials')
  @Roles('admin')
  async rotate(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    const res = await this.machines.rotateCredentials(id);

    await this.audit?.record({
      actorId: user?.id ?? 'system',
      action: 'machine.rotate_credentials',
      entityType: 'machine',
      entityId: id,
    });

    return { data: res };
  }

  @Post(':id/decommission')
  @Roles('admin')
  async decommission(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    const res = await this.machines.decommission(id);

    await this.audit?.record({
      actorId: user?.id ?? 'system',
      action: 'machine.decommission',
      entityType: 'machine',
      entityId: id,
    });

    return { data: res };
  }
}
