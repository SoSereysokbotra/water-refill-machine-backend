import {
  Controller,
  Get,
  Query,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { AuditLogService } from '../application/audit-log.service';
import { SessionAuthGuard } from '../../../platform/security/session-auth.guard';
import { RolesGuard } from '../../../platform/security/roles.guard';
import { Roles } from '../../../platform/security/roles.decorator';

@Controller('v1/audit-logs')
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles('admin')
export class AuditLogsController {
  constructor(@Inject(AuditLogService) private readonly auditLogService: AuditLogService) {}

  @Get()
  async getAuditLogs(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const logs = await this.auditLogService.queryLogs({
      entityType,
      entityId,
      actorId,
      limit: parsedLimit,
    });
    return { data: logs };
  }
}
