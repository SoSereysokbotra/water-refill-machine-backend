import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '../config/config.service';
import { SweepsScheduler } from '../sweeps/sweeps.scheduler';

export interface RetentionPurgeResult {
  deletedOutbox: number;
  deletedInbox: number;
  deletedHeartbeats: number;
}

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SweepsScheduler) private readonly sweeps: SweepsScheduler,
  ) {}

  onModuleInit() {
    const runMode = this.config.get('RUN_MODE');
    if (runMode === 'api') {
      return;
    }

    this.sweeps.registerSchedule({
      name: 'maintenance.retention',
      cronPattern: '0 3 * * *', // Daily 03:00
      processor: async () => {
        this.logger.log('Starting maintenance.retention sweep...');
        const result = await this.purgeRetention();
        this.logger.log(
          `Retention sweep completed. Deleted: ${result.deletedOutbox} outbox, ${result.deletedInbox} inbox, ${result.deletedHeartbeats} heartbeats.`,
        );
      },
    });
  }

  async purgeRetention(cutoffs?: {
    outboxCutoff?: Date;
    inboxCutoff?: Date;
    heartbeatCutoff?: Date;
  }): Promise<RetentionPurgeResult> {
    const now = Date.now();
    const outboxDays = this.config.get('RETENTION_OUTBOX_DAYS');
    const inboxDays = this.config.get('RETENTION_INBOX_DAYS');
    const heartbeatDays = this.config.get('RETENTION_HEARTBEAT_DAYS');

    const outboxCutoff =
      cutoffs?.outboxCutoff ?? new Date(now - outboxDays * 24 * 60 * 60 * 1000);
    const inboxCutoff =
      cutoffs?.inboxCutoff ?? new Date(now - inboxDays * 24 * 60 * 60 * 1000);
    const heartbeatCutoff =
      cutoffs?.heartbeatCutoff ?? new Date(now - heartbeatDays * 24 * 60 * 60 * 1000);

    // Delete ONLY dispatched outbox rows older than retention cutoff
    const outboxResult = await this.prisma.outbox.deleteMany({
      where: {
        dispatchedAt: {
          not: null,
          lt: outboxCutoff,
        },
      },
    });

    const inboxResult = await this.prisma.inbox.deleteMany({
      where: {
        receivedAt: {
          lt: inboxCutoff,
        },
      },
    });

    const heartbeatResult = await this.prisma.heartbeat.deleteMany({
      where: {
        at: {
          lt: heartbeatCutoff,
        },
      },
    });

    return {
      deletedOutbox: outboxResult.count,
      deletedInbox: inboxResult.count,
      deletedHeartbeats: heartbeatResult.count,
    };
  }
}
