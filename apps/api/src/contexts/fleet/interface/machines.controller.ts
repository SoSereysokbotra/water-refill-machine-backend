import { Body, Controller, Get, Inject, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../../../platform/security/access.guards';
import { ValidationError } from '../../../shared-kernel';
import { MachinesService } from '../application';

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

/** Plan §C7 machines endpoints. Operator/admin: local-only or X-Admin-Key until Phase 6 roles. */
@Controller('v1/machines')
@UseGuards(AdminKeyGuard)
export class MachinesController {
  constructor(@Inject(MachinesService) private readonly machines: MachinesService) {}

  /** Provision: row + prices + MQTT username + one-time password (shown once). */
  @Post()
  async provision(@Body() body: unknown) {
    const b = parse(ProvisionBody, body);
    const res = await this.machines.provision({
      id: b.id,
      name: b.name,
      location: b.location,
      currency: b.currency,
      pricesMinor: toTier(b.prices),
    });
    return { data: res };
  }

  @Get()
  async list() {
    return { data: await this.machines.list() };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { data: await this.machines.get(id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return { data: await this.machines.update(id, parse(PatchBody, body)) };
  }

  @Put(':id/prices')
  async setPrices(@Param('id') id: string, @Body() body: unknown) {
    const b = parse(PricesPutBody, body);
    return { data: await this.machines.setPrices(id, b.currency, toTier(b.prices)) };
  }

  @Post(':id/rotate-credentials')
  async rotate(@Param('id') id: string) {
    return { data: await this.machines.rotateCredentials(id) };
  }

  @Post(':id/decommission')
  async decommission(@Param('id') id: string) {
    return { data: await this.machines.decommission(id) };
  }
}
