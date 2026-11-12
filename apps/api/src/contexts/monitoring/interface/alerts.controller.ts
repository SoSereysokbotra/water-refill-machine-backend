import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';
import { z } from 'zod';
import { AdminKeyGuard } from '../../../platform/security/access.guards';
import { ValidationError } from '../../../shared-kernel';
import { AlertService } from '../application/alert.service';

const ActorId = z.string().trim().min(1).max(64);
const ActionBody = z.object({ actorId: ActorId });
const ListQuery = z.object({
  status: z.enum(['active', 'acknowledged', 'resolved']).optional(),
});

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

@Controller('v1/alerts')
@UseGuards(AdminKeyGuard)
export class AlertsController {
  constructor(@Inject(AlertService) private readonly alertService: AlertService) {}

  @Get()
  async listAlerts(@Query() query: unknown) {
    const parsed = parse(ListQuery, query);
    return this.alertService.listAlerts(parsed.status as AlertStatus | undefined);
  }

  @Post(':id/ack')
  async acknowledgeAlert(@Param('id') id: string, @Body() body: unknown) {
    const parsed = parse(ActionBody, body);
    return this.alertService.acknowledgeAlert(id, parsed.actorId);
  }

  @Post(':id/resolve')
  async resolveAlert(@Param('id') id: string, @Body() body: unknown) {
    const parsed = parse(ActionBody, body);
    return this.alertService.resolveAlertById(id, parsed.actorId);
  }
}
