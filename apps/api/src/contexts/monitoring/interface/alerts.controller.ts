import { Body, Controller, Get, Inject, Optional, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';
import { z } from 'zod';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser } from '../../../platform/security';
import { ValidationError } from '../../../shared-kernel';
import { AlertService } from '../application/alert.service';
import { AUDIT_LOGGER_PORT, AuditLoggerPort } from '../../identity/application/public/audit-logger.port';

const ActionBody = z.object({});
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

/**
 * The actor is always the authenticated user (session, X-Admin-Key, or the local dev admin set by
 * SessionAuthGuard). A body `actorId` is ignored: it let any operator act and be audited as someone else.
 */
function actorOf(user?: AuthenticatedUser): string {
  if (!user) throw new UnauthorizedException('Authentication required');
  return user.id;
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
    parse(ActionBody, body);
    const actorId = actorOf(user);
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
    parse(ActionBody, body);
    const actorId = actorOf(user);
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
