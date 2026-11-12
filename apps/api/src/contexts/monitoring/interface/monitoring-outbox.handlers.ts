import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainEvent } from '../../../shared-kernel';
import { OutboxHandlerRegistry } from '../../../platform/outbox/outbox-handler.registry';
import { UnitOfWork } from '../../../platform/database/unit-of-work';
import { QueueService } from '../../../platform/queues/queue.service';
import { AlertService, AlertRaisedPayload, AlertResolvedPayload } from '../application/alert.service';
import { TelegramNotifierService } from '../application/telegram/telegram-notifier.service';
import {
  ruleAccuracyMismatch,
  ruleConfigRejected,
  ruleDispenseOutcomeUnknown,
  ruleFaultReported,
  ruleLatePaymentDetected,
  ruleMachineCameOnline,
  ruleMachineWentOffline,
  ruleOutcomeRejected,
  rulePayRequestRejected,
  ruleReconciliationNeeded,
  ruleRefundCaseDecided,
  ruleRefundReviewOpened,
  ruleSiteCheckNeeded,
} from '../application/rules/monitoring.rules';

@Injectable()
export class MonitoringOutboxHandlers implements OnModuleInit {
  private readonly logger = new Logger(MonitoringOutboxHandlers.name);

  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AlertService) private readonly alertService: AlertService,
    @Inject(TelegramNotifierService) private readonly telegramNotifier: TelegramNotifierService,
    @Inject(QueueService) private readonly queueService: QueueService,
  ) {}

  onModuleInit(): void {
    // Fleet offline / online
    this.registry.register('fleet.MachineWentOffline', 'MonitoringOfflineHandler', this.handleMachineWentOffline.bind(this));
    this.registry.register('fleet.MachineCameOnline', 'MonitoringOnlineHandler', this.handleMachineCameOnline.bind(this));

    // Dispensing outcomes & errors
    this.registry.register('dispensing.DispenseOutcomeUnknown', 'MonitoringUnknownDispenseHandler', this.handleDispenseOutcomeUnknown.bind(this));
    this.registry.register('dispensing.SiteCheckNeeded', 'MonitoringSiteCheckHandler', this.handleSiteCheckNeeded.bind(this));
    this.registry.register('dispensing.OutcomeRejected', 'MonitoringOutcomeRejectedHandler', this.handleOutcomeRejected.bind(this));
    this.registry.register('dispensing.AccuracyMismatch', 'MonitoringAccuracyMismatchHandler', this.handleAccuracyMismatch.bind(this));
    this.registry.register('dispensing.ReconciliationNeeded', 'MonitoringReconciliationHandler', this.handleReconciliationNeeded.bind(this));
    this.registry.register('dispensing.FaultReported', 'MonitoringDispenseFaultHandler', this.handleFaultReported.bind(this));

    // Fleet faults & config
    this.registry.register('fleet.MachineFaultReported', 'MonitoringFleetFaultHandler', this.handleFaultReported.bind(this));
    this.registry.register('fleet.ConfigRejected', 'MonitoringConfigRejectedHandler', this.handleConfigRejected.bind(this));

    // Payments
    this.registry.register('payments.RefundReviewOpened', 'MonitoringRefundReviewHandler', this.handleRefundReviewOpened.bind(this));
    this.registry.register('payments.Refunded', 'MonitoringRefundedHandler', this.handleRefundDecided.bind(this));
    this.registry.register('payments.RefundRejected', 'MonitoringRefundRejectedHandler', this.handleRefundDecided.bind(this));
    this.registry.register('payments.LatePaymentDetected', 'MonitoringLatePaymentHandler', this.handleLatePaymentDetected.bind(this));
    this.registry.register('payments.PayRequestRejected', 'MonitoringPayRequestRejectedHandler', this.handlePayRequestRejected.bind(this));

    // Monitoring alert events -> Telegram notifier
    this.registry.register('monitoring.AlertRaised', 'MonitoringTelegramRaisedHandler', this.handleAlertRaised.bind(this));
    this.registry.register('monitoring.AlertResolved', 'MonitoringTelegramResolvedHandler', this.handleAlertResolved.bind(this));
  }

  async handleMachineWentOffline(event: DomainEvent<{ machineId: string }>): Promise<void> {
    const res = ruleMachineWentOffline(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleMachineCameOnline(event: DomainEvent<{ machineId: string }>): Promise<void> {
    const res = ruleMachineCameOnline(event.data);
    if (res && res.action === 'resolve') {
      await this.uow.run((tx) => this.alertService.resolveAlert(tx, { dedupeKey: res.dedupeKey, resolvedBy: res.resolvedBy }));
    }
  }

  async handleDispenseOutcomeUnknown(event: DomainEvent<{ tranId: string; machineId?: string }>): Promise<void> {
    const res = ruleDispenseOutcomeUnknown(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleSiteCheckNeeded(event: DomainEvent<{ tranId: string; machineId: string }>): Promise<void> {
    const res = ruleSiteCheckNeeded(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleOutcomeRejected(event: DomainEvent<{ machineId: string; tranId?: string; code: string }>): Promise<void> {
    const res = ruleOutcomeRejected(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleAccuracyMismatch(event: DomainEvent<{ machineId: string; diffPercent: number }>): Promise<void> {
    const res = ruleAccuracyMismatch(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleReconciliationNeeded(event: DomainEvent<{ tranId: string }>): Promise<void> {
    const res = ruleReconciliationNeeded(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleFaultReported(event: DomainEvent<{ machineId: string; fault: string }>): Promise<void> {
    const res = ruleFaultReported(event.data);
    if (!res) return;
    if (res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    } else if (res.action === 'resolve_many') {
      await this.uow.run((tx) => this.alertService.resolveAlerts(tx, { dedupeKeys: res.dedupeKeys, resolvedBy: res.resolvedBy }));
    }
  }

  async handleConfigRejected(event: DomainEvent<{ machineId: string; fault: string }>): Promise<void> {
    const res = ruleConfigRejected(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleRefundReviewOpened(event: DomainEvent<{ tranId: string }>): Promise<void> {
    const res = ruleRefundReviewOpened(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleRefundDecided(event: DomainEvent<{ tranId: string }>): Promise<void> {
    const res = ruleRefundCaseDecided(event.data);
    if (res && res.action === 'resolve') {
      await this.uow.run((tx) => this.alertService.resolveAlert(tx, { dedupeKey: res.dedupeKey, resolvedBy: res.resolvedBy }));
    }
  }

  async handleLatePaymentDetected(event: DomainEvent<{ tranId: string; machineId: string }>): Promise<void> {
    const res = ruleLatePaymentDetected(event.data);
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handlePayRequestRejected(event: DomainEvent<{ machineId: string; code: string }>): Promise<void> {
    const { machineId, code } = event.data;
    const redis = this.queueService.getConnection();
    const key = `payreject_count:${machineId}:${code}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 600); // 10 minutes window
    }

    const res = rulePayRequestRejected({ machineId, code, count });
    if (res && res.action === 'raise') {
      await this.uow.run((tx) => this.alertService.raiseAlert(tx, res.alert));
    }
  }

  async handleAlertRaised(event: DomainEvent<AlertRaisedPayload>): Promise<void> {
    await this.telegramNotifier.enqueue({
      action: 'raise',
      alertId: event.data.alertId,
      type: event.data.type,
      severity: event.data.severity,
      message: event.data.message,
      machineId: event.data.machineId,
      count: event.data.count,
    });
  }

  async handleAlertResolved(event: DomainEvent<AlertResolvedPayload>): Promise<void> {
    await this.telegramNotifier.enqueue({
      action: 'resolve',
      alertId: event.data.alertId,
      type: event.data.type,
      severity: event.data.severity,
      message: event.data.message,
      machineId: event.data.machineId,
    });
  }
}

