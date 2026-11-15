import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;

  // Plan B6 Metrics
  readonly paymentsCreatedTotal: Counter<string>;
  readonly paymentsStatusTotal: Counter<string>;
  readonly paymentTimeToPaidSeconds: Histogram<string>;
  readonly latePaymentsTotal: Counter<string>;
  readonly abaRequestDurationSeconds: Histogram<string>;
  readonly abaCheckFailuresTotal: Counter<string>;
  readonly abaCircuitState: Gauge<string>;
  readonly outboxLagSeconds: Gauge<string>;
  readonly queueDepth: Gauge<string>;
  readonly machinesOnline: Gauge<string>;
  readonly payRequestThrottledTotal: Counter<string>;
  readonly transactionAckTotal: Counter<string>;
  readonly pendingOutcomes: Gauge<string>;
  readonly dispenseAccuracyDiffPercent: Histogram<string>;
  readonly dispenseUnknownOpen: Gauge<string>;
  readonly refundCasesOpen: Gauge<string>;

  constructor() {
    this.registry = new Registry();

    this.paymentsCreatedTotal = new Counter({
      name: 'wrm_payments_created_total',
      help: 'Total number of payment requests created',
      labelNames: ['machine', 'currency'],
      registers: [this.registry],
    });

    this.paymentsStatusTotal = new Counter({
      name: 'wrm_payments_status_total',
      help: 'Total payments transitioned into a given status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.paymentTimeToPaidSeconds = new Histogram({
      name: 'wrm_payment_time_to_paid_seconds',
      help: 'Time in seconds from payment creation to confirmation (paid)',
      buckets: [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144],
      registers: [this.registry],
    });

    this.latePaymentsTotal = new Counter({
      name: 'wrm_late_payments_total',
      help: 'Total number of late payments detected after terminal state',
      registers: [this.registry],
    });

    this.abaRequestDurationSeconds = new Histogram({
      name: 'wrm_aba_request_duration_seconds',
      help: 'Duration of ABA PayWay API requests in seconds',
      labelNames: ['operation', 'outcome'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10],
      registers: [this.registry],
    });

    this.abaCheckFailuresTotal = new Counter({
      name: 'wrm_aba_check_failures_total',
      help: 'Total number of ABA check-transaction probe failures',
      registers: [this.registry],
    });

    this.abaCircuitState = new Gauge({
      name: 'wrm_aba_circuit_state',
      help: 'State of the ABA PayWay circuit breaker (0=closed, 1=half-open, 2=open)',
      registers: [this.registry],
    });

    this.outboxLagSeconds = new Gauge({
      name: 'wrm_outbox_lag_seconds',
      help: 'Age in seconds of the oldest undispatched event in the transactional outbox',
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'wrm_queue_depth',
      help: 'Depth of BullMQ queue (waiting + delayed jobs)',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.machinesOnline = new Gauge({
      name: 'wrm_machines_online',
      help: 'Total number of machines currently online',
      registers: [this.registry],
    });

    this.payRequestThrottledTotal = new Counter({
      name: 'wrm_pay_request_throttled_total',
      help: 'Total number of rate-limited or throttled payment requests',
      registers: [this.registry],
    });

    this.transactionAckTotal = new Counter({
      name: 'wrm_transaction_ack_total',
      help: 'Total transaction outcome acknowledgements returned to machines',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.pendingOutcomes = new Gauge({
      name: 'wrm_pending_outcomes',
      help: 'Pending outcomes reported by machine heartbeats',
      labelNames: ['machine'],
      registers: [this.registry],
    });

    this.dispenseAccuracyDiffPercent = new Histogram({
      name: 'wrm_dispense_accuracy_diff_percent',
      help: 'Percentage difference between flow meter and load cell measurements',
      buckets: [0.5, 1, 2, 3, 5, 10, 20, 50],
      registers: [this.registry],
    });

    this.dispenseUnknownOpen = new Gauge({
      name: 'wrm_dispense_unknown_open',
      help: 'Total number of payments currently in DISPENSE_UNKNOWN status',
      registers: [this.registry],
    });

    this.refundCasesOpen = new Gauge({
      name: 'wrm_refund_cases_open',
      help: 'Total number of refund cases currently in open or claimed status',
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: 'wrm_node_' });
  }

  getRegistry(): Registry {
    return this.registry;
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  paymentCreated(machine: string, currency: string): void {
    this.paymentsCreatedTotal.inc({ machine, currency });
  }

  paymentStatus(status: string): void {
    this.paymentsStatusTotal.inc({ status });
  }

  observePaymentTimeToPaid(seconds: number): void {
    if (seconds >= 0) {
      this.paymentTimeToPaidSeconds.observe(seconds);
    }
  }

  latePaymentDetected(): void {
    this.latePaymentsTotal.inc();
  }

  observeAbaRequest(operation: string, outcome: 'ok' | 'error', durationSec: number): void {
    this.abaRequestDurationSeconds.observe({ operation, outcome }, durationSec);
  }

  abaCheckFailure(): void {
    this.abaCheckFailuresTotal.inc();
  }

  setAbaCircuitState(state: number): void {
    this.abaCircuitState.set(state);
  }

  setOutboxLag(seconds: number): void {
    this.outboxLagSeconds.set(Math.max(0, seconds));
  }

  setQueueDepth(queue: string, depth: number): void {
    this.queueDepth.set({ queue }, Math.max(0, depth));
  }

  setMachinesOnline(count: number): void {
    this.machinesOnline.set(Math.max(0, count));
  }

  payRequestThrottled(): void {
    this.payRequestThrottledTotal.inc();
  }

  transactionAck(status: 'ok' | 'rejected'): void {
    this.transactionAckTotal.inc({ status });
  }

  setPendingOutcomes(machine: string, count: number): void {
    this.pendingOutcomes.set({ machine }, Math.max(0, count));
  }

  observeDispenseAccuracy(diffPercent: number): void {
    if (diffPercent >= 0) {
      this.dispenseAccuracyDiffPercent.observe(diffPercent);
    }
  }

  setDispenseUnknownOpen(count: number): void {
    this.dispenseUnknownOpen.set(Math.max(0, count));
  }

  setRefundCasesOpen(count: number): void {
    this.refundCasesOpen.set(Math.max(0, count));
  }

  clear(): void {
    this.registry.resetMetrics();
  }
}
