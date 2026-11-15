import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service';

@Injectable()
export class ReportingSweep {
  readonly name = 'reporting.refresh-views';
  readonly intervalMs = 300_000; // 5 minutes per Plan §C7 / Phase 7 Task 1
  private readonly logger = new Logger(ReportingSweep.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async execute(): Promise<{ refreshed: boolean; error?: string }> {
    this.logger.debug('Refreshing materialized views concurrently...');
    try {
      await this.refreshView('sales_daily');
      await this.refreshView('sales_by_machine');
      this.logger.debug('Materialized views refreshed successfully.');
      return { refreshed: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to refresh materialized views: ${msg}`);
      return { refreshed: false, error: msg };
    }
  }

  private async refreshView(viewName: 'sales_daily' | 'sales_by_machine'): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName};`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Fallback to standard refresh if concurrent is not yet possible
      if (msg.includes('populated') || msg.includes('does not have a unique index')) {
        this.logger.warn(`Concurrent refresh failed for ${viewName}, falling back to non-concurrent: ${msg}`);
        await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${viewName};`);
      } else {
        throw err;
      }
    }
  }
}
