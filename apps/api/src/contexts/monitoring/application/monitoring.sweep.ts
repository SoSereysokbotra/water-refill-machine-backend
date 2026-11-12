import { Inject, Injectable } from '@nestjs/common';
import { BaseSweep } from '../../../platform/sweeps/sweep.base';
import { PrismaTransaction, UnitOfWork } from '../../../platform/database/unit-of-work';
import { PrismaService } from '../../../platform/database/prisma.service';
import { FLEET_MONITORING, FleetMonitoringPort } from '../../fleet/application/public/fleet-monitoring.port';
import { PAYMENTS_REFUND_MONITORING, PaymentsRefundMonitoringPort } from '../../payments/application/public/refund-monitoring.port';
import { AlertService } from './alert.service';
import { rulePendingOutcomesStuck, ruleRefundCaseStale } from './rules/monitoring.rules';

export interface MonitoringSweepItem {
  kind: 'stale_refund' | 'stuck_outcomes' | 'resolve_stuck_outcomes';
  data: Record<string, unknown>;
}

@Injectable()
export class MonitoringSweep extends BaseSweep<MonitoringSweepItem> {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AlertService) private readonly alertService: AlertService,
    @Inject(FLEET_MONITORING) private readonly fleetMonitoring: FleetMonitoringPort,
    @Inject(PAYMENTS_REFUND_MONITORING) private readonly refundMonitoring: PaymentsRefundMonitoringPort,
  ) {
    // Runs every 60 seconds per Plan §C5
    super('monitoring', 60000);
  }

  async findDueItems(): Promise<MonitoringSweepItem[]> {
    const items: MonitoringSweepItem[] = [];

    // 1. Stale refund cases (open/claimed > 24h = 1440 min)
    const staleCases = await this.refundMonitoring.getStaleRefundCases(24 * 60);
    for (const c of staleCases) {
      items.push({ kind: 'stale_refund', data: c });
    }

    // 2. Machines with pending outcomes stuck for >= 1h (60 min)
    const stuckMachines = await this.fleetMonitoring.getMachinesWithStuckOutcomes(60);
    const stuckMachineIds = new Set(stuckMachines.map((m) => m.machineId));
    for (const m of stuckMachines) {
      items.push({ kind: 'stuck_outcomes', data: m });
    }

    // 3. Check existing active PENDING_OUTCOMES_STUCK alerts for auto-resolve (when pending_outcomes = 0)
    const activeStuckAlerts = await this.prisma.alert.findMany({
      where: {
        type: 'PENDING_OUTCOMES_STUCK',
        status: { in: ['active', 'acknowledged'] },
      },
    });

    for (const alert of activeStuckAlerts) {
      if (alert.machineId && !stuckMachineIds.has(alert.machineId)) {
        items.push({ kind: 'resolve_stuck_outcomes', data: { machineId: alert.machineId } });
      }
    }

    return items;
  }

  async processItem(item: MonitoringSweepItem): Promise<void> {
    await this.uow.run(async (tx: PrismaTransaction) => {
      if (item.kind === 'stale_refund') {
        const d = item.data as { tranId: string; machineId?: string | null };
        const ruleRes = ruleRefundCaseStale({ tranId: d.tranId, machineId: d.machineId });
        if (ruleRes && ruleRes.action === 'raise') {
          await this.alertService.raiseAlert(tx, ruleRes.alert);
        }
      } else if (item.kind === 'stuck_outcomes') {
        const d = item.data as { machineId: string; pendingOutcomes: number };
        const ruleRes = rulePendingOutcomesStuck({
          machineId: d.machineId,
          pendingOutcomes: d.pendingOutcomes,
        });
        if (ruleRes && ruleRes.action === 'raise') {
          await this.alertService.raiseAlert(tx, ruleRes.alert);
        }
      } else if (item.kind === 'resolve_stuck_outcomes') {
        const d = item.data as { machineId: string };
        await this.alertService.resolveAlert(tx, {
          dedupeKey: `pending:${d.machineId}`,
          resolvedBy: 'system',
        });
      }
    });
  }
}
