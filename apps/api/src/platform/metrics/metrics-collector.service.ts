import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { QueueService } from '../queues/queue.service';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsCollectorService {
  private readonly logger = new Logger(MetricsCollectorService.name);

  constructor(
    @Inject(MetricsService) private readonly metrics: MetricsService,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
    @Optional() @Inject(QueueService) private readonly queues?: QueueService,
  ) {}

  async collectGauges(): Promise<void> {
    if (!this.prisma) return;

    try {
      // 1. Outbox Lag
      const outboxLagResult = await this.prisma.$queryRaw<{ lag: number | null }[]>`
        SELECT EXTRACT(EPOCH FROM (now() - MIN(occurred_at)))::float AS lag
        FROM outbox
        WHERE dispatched_at IS NULL AND dead_at IS NULL
      `;
      const outboxLag = outboxLagResult[0]?.lag ?? 0;
      this.metrics.setOutboxLag(outboxLag);

      // 2. Machines Online
      const machinesOnline = await this.prisma.machine.count({
        where: { online: true, decommissionedAt: null },
      });
      this.metrics.setMachinesOnline(machinesOnline);

      // 3. Dispense Unknown Open
      const unknownCount = await this.prisma.payment.count({
        where: { status: 'DISPENSE_UNKNOWN' },
      });
      this.metrics.setDispenseUnknownOpen(unknownCount);

      // 4. Refund Cases Open
      const refundCount = await this.prisma.refundCase.count({
        where: { status: { in: ['open', 'claimed'] } },
      });
      this.metrics.setRefundCasesOpen(refundCount);

      // 5. Pending Outcomes per Machine
      const pendingMachines = await this.prisma.machine.findMany({
        where: { pendingOutcomes: { gt: 0 } },
        select: { id: true, pendingOutcomes: true },
      });
      for (const m of pendingMachines) {
        this.metrics.setPendingOutcomes(m.id, m.pendingOutcomes);
      }

      // 6. BullMQ Queue Depths
      if (this.queues) {
        const queueNames = ['outbox.dispatch', 'payments.aba-check', 'payments.confirm', 'notify.telegram'];
        for (const qName of queueNames) {
          try {
            const q = this.queues.getQueue(qName);
            const count = await q.getWaitingCount();
            this.metrics.setQueueDepth(qName, count);
          } catch {
            // Queue might not be initialized yet in this runtime mode
          }
        }
      }
    } catch (err) {
      this.logger.debug(`Could not collect DB gauges: ${(err as Error).message}`);
    }
  }
}
