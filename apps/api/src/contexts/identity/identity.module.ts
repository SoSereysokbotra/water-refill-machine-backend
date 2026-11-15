import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../platform/database/database.module';
import { ConfigModule } from '../../platform/config/config.module';
import { RateLimitModule } from '../../platform/rate-limit/rate-limit.module';
import { AuthService } from './application/auth.service';
import { UsersService } from './application/users.service';
import { AuditLogService } from './application/audit-log.service';
import { AUDIT_LOGGER_PORT } from './application/public/audit-logger.port';
import { AuthController } from './interface/auth.controller';
import { UsersController } from './interface/users.controller';
import { AuditLogsController } from './interface/audit-logs.controller';
import { SessionAuthGuard } from '../../platform/security/session-auth.guard';
import { RolesGuard } from '../../platform/security/roles.guard';

@Global()
@Module({
  imports: [DatabaseModule, ConfigModule, RateLimitModule],
  controllers: [AuthController, UsersController, AuditLogsController],
  providers: [
    AuthService,
    UsersService,
    AuditLogService,
    {
      provide: AUDIT_LOGGER_PORT,
      useExisting: AuditLogService,
    },
    SessionAuthGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    UsersService,
    AuditLogService,
    AUDIT_LOGGER_PORT,
    SessionAuthGuard,
    RolesGuard,
  ],
})
export class IdentityModule {}
