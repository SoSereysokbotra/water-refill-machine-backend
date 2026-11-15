import { Body, Controller, Get, Inject, Optional, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';
import { z } from 'zod';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser } from '../../../platform/security';
import { ValidationError } from '../../../shared-kernel';
import { AlertService } from '../application/alert.service';
import { AUDIT_LOGGER_PORT, AuditLoggerPort } from '../../identity/application/public/audit-logger.port';

const ActorId = z.string().trim().min(1).max(64);
const ActionBody = z.object({ actorId: ActorId.optional() });
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
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('operator')
export class AlertsController {
  constructor(
    @Inject(AlertService) private readonly alertService: AlertService,
    @Optional() @Inject(AUDIT_LOGGER_PORT) private readonly audit?: AuditLoggerPort,
  ) {}

  @Get()
  async listAlerts(@Query() query: unknown) {
    const parsed = parse(ListQuery, query);
    return this.alertService.listAlerts(parsed.status as AlertStatus | undefined);
  }

  @Post(':id/ack')
  async acknowledgeAlert(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const parsed = parse(ActionBody, body);
    const actorId = parsed.actorId ?? user?.id ?? 'system';
    const res = await this.alertService.acknowledgeAlert(id, actorId);

    await this.audit?.record({
      actorId,
      action: 'alert.acknowledge',
      entityType: 'alert',
      entityId: id,
    });

    return res;
  }

  @Post(':id/resolve')
  async resolveAlert(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const parsed = parse(ActionBody, body);
    const actorId = parsed.actorId ?? user?.id ?? 'system';
    const res = await this.alertService.resolveAlertById(id, actorId);

    await this.audit?.record({
      actorId,
      action: 'alert.resolve',
      entityType: 'alert',
      entityId: id,
    });

    return res;
  }
}
