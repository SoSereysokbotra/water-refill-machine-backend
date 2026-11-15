import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TracerService } from '../src/platform/telemetry/tracer.service';
import { MetricsService } from '../src/platform/metrics/metrics.service';
import { MetricsCollectorService } from '../src/platform/metrics/metrics-collector.service';
import {
  getCorrelationContext,
  runWithCorrelation,
} from '../src/platform/logging/correlation-context';
import { createDomainEvent } from '../src/shared-kernel/domain-event';
import { OutboxService } from '../src/platform/outbox/outbox.service';
import { PrismaTransaction } from '../src/platform/database/unit-of-work';

describe('Phase 8: Observability Suite', () => {
  describe('OpenTelemetry Tracing & Single Trace End-to-End', () => {
    let tracer: TracerService;

    beforeEach(() => {
      tracer = new TracerService();
      tracer.onModuleInit();
      tracer.clearExportedSpans();
    });

    afterEach(() => {
      tracer.onModuleDestroy();
    });

    it('generates 32-hex traceId and 16-hex spanId adhering to W3C specification', () => {
      const traceId = tracer.generateTraceId();
      const spanId = tracer.generateSpanId();

      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('follows an entire payment flow end-to-end in a single trace across MQTT -> DB -> ABA -> Outbox -> Relay -> Publish', async () => {
      // 1. MQTT Intake starts the root payment span
      const machineId = 'WRM-001';
      const requestId = 'req-1234567890abcdef';
      const rootTraceId = tracer.generateTraceId();

      let capturedTraceIdInOutbox = '';
      let capturedTraceIdInRelay = '';
      let capturedTraceIdInPublish = '';

      await tracer.startActiveSpan(
        'mqtt.pay_request',
        async (rootSpan) => {
          rootSpan.setAttribute('wrm.machine_id', machineId);
          rootSpan.setAttribute('wrm.request_id', requestId);

          const currentTraceId = tracer.getCurrentTraceId()!;
          expect(currentTraceId).toBe(rootTraceId);

          // 2. Command execution calls ABA Gateway (child span)
          await tracer.startActiveSpan('aba.generate_qr', async (abaSpan) => {
            abaSpan.setAttribute('wrm.tran_id', 'tran-999');
            expect(tracer.getCurrentTraceId()).toBe(rootTraceId);
          });

          // 3. Payment Aggregate creates DomainEvent and commits to Outbox
          const outboxEvent = createDomainEvent('payments.PaymentCreated', {
            tranId: 'tran-999',
            machineId,
            requestId,
            amountMinor: 25,
            currency: 'USD',
            qrString: '00020101...',
          }, { traceId: currentTraceId });

          // Mock outbox storage
          const fakeTx = {
            outbox: {
              create: vi.fn().mockImplementation((args) => {
                capturedTraceIdInOutbox = args.data.payload.traceId;
                return Promise.resolve(args.data);
              }),
            },
          } as unknown as PrismaTransaction;

          const outboxService = new OutboxService(tracer);
          await outboxService.add([outboxEvent], fakeTx, 'Payment', 'tran-999');
          expect(capturedTraceIdInOutbox).toBe(rootTraceId);

          // 4. Outbox Relay worker picks up event and executes handler under propagated traceId
          await tracer.startActiveSpan(
            'outbox.handler.PaymentCreatedMqttHandler',
            async (relaySpan) => {
              capturedTraceIdInRelay = tracer.getCurrentTraceId()!;
              relaySpan.setAttribute('wrm.event_type', 'payments.PaymentCreated');

              // 5. Handler publishes MQTT pay/qr under active trace
              await tracer.startActiveSpan('mqtt.publish_pay_qr', async (publishSpan) => {
                capturedTraceIdInPublish = tracer.getCurrentTraceId()!;
                publishSpan.setAttribute('wrm.tran_id', 'tran-999');
              });
            },
            { traceId: capturedTraceIdInOutbox },
          );
        },
        { traceId: rootTraceId },
      );

      // Verify propagated traceId remains identical across every hop
      expect(capturedTraceIdInOutbox).toBe(rootTraceId);
      expect(capturedTraceIdInRelay).toBe(rootTraceId);
      expect(capturedTraceIdInPublish).toBe(rootTraceId);

      // Inspect recorded spans
      const spans = tracer.getExportedSpans();
      expect(spans.length).toBe(4);

      const spanNames = spans.map((s) => s.name);
      expect(spanNames).toContain('mqtt.pay_request');
      expect(spanNames).toContain('aba.generate_qr');
      expect(spanNames).toContain('outbox.handler.PaymentCreatedMqttHandler');
      expect(spanNames).toContain('mqtt.publish_pay_qr');

      // Verify all spans share the same root traceId
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(rootTraceId);
      }
    });

    it('propagates correlation context via AsyncLocalStorage for structured logging', async () => {
      const traceId = 'a'.repeat(32);
      const tranId = 'tran-test-456';
      const machineId = 'WRM-002';

      await runWithCorrelation({ traceId, tranId, machineId }, async () => {
        const ctx = getCorrelationContext();
        expect(ctx?.traceId).toBe(traceId);
        expect(ctx?.tranId).toBe(tranId);
        expect(ctx?.machineId).toBe(machineId);
      });

      // Context cleans up outside scope
      expect(getCorrelationContext()).toBeUndefined();
    });
  });

  describe('Prometheus Metrics Engine & /metrics Endpoint', () => {
    let metrics: MetricsService;

    beforeEach(() => {
      metrics = new MetricsService();
      metrics.onModuleInit();
    });

    it('registers and records all Plan B6 metric signals', async () => {
      // 1. Payment created & status transitions
      metrics.paymentCreated('WRM-001', 'USD');
      metrics.paymentCreated('WRM-001', 'KHR');
      metrics.paymentStatus('PENDING');
      metrics.paymentStatus('PAID');

      // 2. Time to paid histogram
      metrics.observePaymentTimeToPaid(3.45);

      // 3. Late payment counter
      metrics.latePaymentDetected();

      // 4. ABA latency & check failures
      metrics.observeAbaRequest('generate-qr', 'ok', 0.42);
      metrics.observeAbaRequest('check-transaction', 'error', 5.12);
      metrics.abaCheckFailure();
      metrics.setAbaCircuitState(0); // closed

      // 5. Queues and Outbox lag
      metrics.setOutboxLag(2.5);
      metrics.setQueueDepth('outbox.dispatch', 12);
      metrics.setMachinesOnline(5);

      // 6. Throttling and Acks
      metrics.payRequestThrottled();
      metrics.transactionAck('ok');
      metrics.transactionAck('rejected');

      // 7. Dispense accuracy diff and open cases
      metrics.setPendingOutcomes('WRM-001', 1);
      metrics.observeDispenseAccuracy(2.3);
      metrics.setDispenseUnknownOpen(0);
      metrics.setRefundCasesOpen(1);

      // Scrape metrics string
      const text = await metrics.getMetricsText();

      expect(text).toContain('wrm_payments_created_total{machine="WRM-001",currency="USD"} 1');
      expect(text).toContain('wrm_payments_created_total{machine="WRM-001",currency="KHR"} 1');
      expect(text).toContain('wrm_payments_status_total{status="PAID"} 1');
      expect(text).toContain('wrm_payment_time_to_paid_seconds_bucket');
      expect(text).toContain('wrm_late_payments_total 1');
      expect(text).toContain('wrm_aba_request_duration_seconds_bucket{le="0.5",operation="generate-qr",outcome="ok"} 1');
      expect(text).toContain('wrm_aba_check_failures_total 1');
      expect(text).toContain('wrm_aba_circuit_state 0');
      expect(text).toContain('wrm_outbox_lag_seconds 2.5');
      expect(text).toContain('wrm_queue_depth{queue="outbox.dispatch"} 12');
      expect(text).toContain('wrm_machines_online 5');
      expect(text).toContain('wrm_pay_request_throttled_total 1');
      expect(text).toContain('wrm_transaction_ack_total{status="ok"} 1');
      expect(text).toContain('wrm_transaction_ack_total{status="rejected"} 1');
      expect(text).toContain('wrm_pending_outcomes{machine="WRM-001"} 1');
      expect(text).toContain('wrm_dispense_accuracy_diff_percent_bucket');
      expect(text).toContain('wrm_dispense_unknown_open 0');
      expect(text).toContain('wrm_refund_cases_open 1');

      // Default Node.js runtime metrics
      expect(text).toContain('wrm_node_process_cpu_user_seconds_total');
      expect(text).toContain('wrm_node_nodejs_heap_size_used_bytes');
    });

    it('collects real-time gauges from database and queues via MetricsCollectorService', async () => {
      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ lag: 4.2 }]),
        machine: {
          count: vi.fn().mockResolvedValue(3),
          findMany: vi.fn().mockResolvedValue([{ id: 'WRM-001', pendingOutcomes: 2 }]),
        },
        payment: {
          count: vi.fn().mockResolvedValue(1),
        },
        refundCase: {
          count: vi.fn().mockResolvedValue(2),
        },
      } as any;

      const mockQueues = {
        getQueue: vi.fn().mockReturnValue({
          getWaitingCount: vi.fn().mockResolvedValue(7),
        }),
      } as any;

      const collector = new MetricsCollectorService(metrics, mockPrisma, mockQueues);
      await collector.collectGauges();

      const text = await metrics.getMetricsText();
      expect(text).toContain('wrm_outbox_lag_seconds 4.2');
      expect(text).toContain('wrm_machines_online 3');
      expect(text).toContain('wrm_dispense_unknown_open 1');
      expect(text).toContain('wrm_refund_cases_open 2');
      expect(text).toContain('wrm_pending_outcomes{machine="WRM-001"} 2');
      expect(text).toContain('wrm_queue_depth{queue="outbox.dispatch"} 7');
    });
  });

  describe('Simulation of Deployment §10 Alert Rules', () => {
    // Pure rule simulation functions matching Prometheus rules in infra/prometheus/rules/alerts.yml
    interface MetricsSnapshot {
      apiUp: boolean;
      paymentSuccessRate15m: number; // percentage
      abaP95LatencySeconds: number;
      abaErrorRatePerMin: number;
      abaCheckFailureRate: number; // fraction 0..1
      outboxLagSeconds: number;
      queueDepthTrendGrowing: boolean;
      queueDepth: number;
      secondsSinceLastSweep: number;
      latePaymentsIncrease: number;
      machinesOnline: number;
      pendingOutcomesAgeHours: number;
      pendingOutcomesCount: number;
      dispenseUnknownCount: number;
      refundCasesOpenDurationHours: number;
      refundCasesCount: number;
      rejectedAckIncrease: number;
      cpuUtilizationPercent: number;
    }

    interface TriggeredAlert {
      alert: string;
      severity: 'critical' | 'warning';
      summary: string;
      description: string;
    }

    function evaluateDeploymentAlerts(m: MetricsSnapshot): TriggeredAlert[] {
      const alerts: TriggeredAlert[] = [];

      // 1. ApiDown
      if (!m.apiUp) {
        alerts.push({
          alert: 'ApiDown',
          severity: 'critical',
          summary: 'WRM API instance is unreachable',
          description: 'API is down for > 1 minute',
        });
      }

      // 2. PaymentSuccessRateLow
      if (m.paymentSuccessRate15m < 95) {
        alerts.push({
          alert: 'PaymentSuccessRateLow',
          severity: 'critical',
          summary: 'Payment success rate dropped below 95%',
          description: `Current success rate: ${m.paymentSuccessRate15m}%`,
        });
      }

      // 3. AbaLatencyHigh
      if (m.abaP95LatencySeconds > 5) {
        alerts.push({
          alert: 'AbaLatencyHigh',
          severity: 'warning',
          summary: 'ABA PayWay p95 latency exceeds 5 seconds',
          description: `Current p95 latency: ${m.abaP95LatencySeconds}s`,
        });
      }

      // 4. AbaErrorSpike
      if (m.abaErrorRatePerMin > 0.1) {
        alerts.push({
          alert: 'AbaErrorSpike',
          severity: 'critical',
          summary: 'ABA PayWay API error spike detected',
          description: 'ABA calls returning errors',
        });
      }

      // 5. OutboxLagCritical
      if (m.outboxLagSeconds > 30) {
        alerts.push({
          alert: 'OutboxLagCritical',
          severity: 'critical',
          summary: 'Transactional outbox relay lag exceeds 30 seconds',
          description: `Outbox lag is ${m.outboxLagSeconds}s`,
        });
      }

      // 6. QueueDepthGrowing
      if (m.queueDepthTrendGrowing && m.queueDepth > 50) {
        alerts.push({
          alert: 'QueueDepthGrowing',
          severity: 'warning',
          summary: 'BullMQ queue depth is accumulating',
          description: `Queue depth reached ${m.queueDepth}`,
        });
      }

      // 7. SweepsStalled
      if (m.secondsSinceLastSweep > 300) {
        alerts.push({
          alert: 'SweepsStalled',
          severity: 'critical',
          summary: 'Background sweep execution stalled',
          description: `No sweep run for ${m.secondsSinceLastSweep}s`,
        });
      }

      // 8. AbaCheckFailuresHigh
      if (m.abaCheckFailureRate > 0.05) {
        alerts.push({
          alert: 'AbaCheckFailuresHigh',
          severity: 'warning',
          summary: 'High failure rate on ABA check-transaction probes',
          description: `${(m.abaCheckFailureRate * 100).toFixed(1)}% check failures`,
        });
      }

      // 9. LatePaymentDetected
      if (m.latePaymentsIncrease > 0) {
        alerts.push({
          alert: 'LatePaymentDetected',
          severity: 'warning',
          summary: 'Late payment detected after expiration or cancellation',
          description: `${m.latePaymentsIncrease} late payments detected`,
        });
      }

      // 10. MachineOffline
      if (m.machinesOnline < 1) {
        alerts.push({
          alert: 'MachineOffline',
          severity: 'warning',
          summary: 'Machine offline for more than 3 minutes',
          description: 'No online machines in fleet',
        });
      }

      // 11. PendingOutcomesStuck
      if (m.pendingOutcomesCount > 0 && m.pendingOutcomesAgeHours >= 1) {
        alerts.push({
          alert: 'PendingOutcomesStuck',
          severity: 'warning',
          summary: 'Kiosk has pending outcomes stuck in NVS queue for > 1 hour',
          description: `${m.pendingOutcomesCount} outcomes pending for ${m.pendingOutcomesAgeHours}h`,
        });
      }

      // 12. DispenseOutcomeUnknown
      if (m.dispenseUnknownCount > 0) {
        alerts.push({
          alert: 'DispenseOutcomeUnknown',
          severity: 'critical',
          summary: 'Payment in DISPENSE_UNKNOWN status',
          description: `${m.dispenseUnknownCount} unconfirmed dispenses`,
        });
      }

      // 13. RefundCaseStale
      if (m.refundCasesCount > 0 && m.refundCasesOpenDurationHours >= 24) {
        alerts.push({
          alert: 'RefundCaseStale',
          severity: 'warning',
          summary: 'Unresolved refund cases pending for > 24 hours',
          description: `${m.refundCasesCount} stale refund cases`,
        });
      }

      // 14. OutcomeRejected
      if (m.rejectedAckIncrease > 0) {
        alerts.push({
          alert: 'OutcomeRejected',
          severity: 'critical',
          summary: 'Dispense outcome rejected by backend',
          description: `${m.rejectedAckIncrease} rejected outcomes`,
        });
      }

      // 15. HostResourcesHigh
      if (m.cpuUtilizationPercent > 80) {
        alerts.push({
          alert: 'HostResourcesHigh',
          severity: 'warning',
          summary: 'High backend CPU utilization (> 80%)',
          description: `CPU usage: ${m.cpuUtilizationPercent}%`,
        });
      }

      return alerts;
    }

    const healthySnapshot: MetricsSnapshot = {
      apiUp: true,
      paymentSuccessRate15m: 98.5,
      abaP95LatencySeconds: 0.85,
      abaErrorRatePerMin: 0.0,
      abaCheckFailureRate: 0.01,
      outboxLagSeconds: 0.25,
      queueDepthTrendGrowing: false,
      queueDepth: 5,
      secondsSinceLastSweep: 15,
      latePaymentsIncrease: 0,
      machinesOnline: 10,
      pendingOutcomesAgeHours: 0,
      pendingOutcomesCount: 0,
      dispenseUnknownCount: 0,
      refundCasesOpenDurationHours: 2,
      refundCasesCount: 1,
      rejectedAckIncrease: 0,
      cpuUtilizationPercent: 25.0,
    };

    it('evaluates healthy system with zero alerts triggered', () => {
      const alerts = evaluateDeploymentAlerts(healthySnapshot);
      expect(alerts).toHaveLength(0);
    });

    it('triggers ApiDown alert when API is unreachable', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, apiUp: false });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'ApiDown', severity: 'critical' }));
    });

    it('triggers PaymentSuccessRateLow when success rate drops below 95%', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, paymentSuccessRate15m: 88.0 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'PaymentSuccessRateLow', severity: 'critical' }));
    });

    it('triggers AbaLatencyHigh when p95 exceeds 5s', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, abaP95LatencySeconds: 6.2 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'AbaLatencyHigh', severity: 'warning' }));
    });

    it('triggers AbaErrorSpike on API failures', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, abaErrorRatePerMin: 0.5 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'AbaErrorSpike', severity: 'critical' }));
    });

    it('triggers OutboxLagCritical when lag exceeds 30s', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, outboxLagSeconds: 45.0 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'OutboxLagCritical', severity: 'critical' }));
    });

    it('triggers QueueDepthGrowing when queue is accumulating', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, queueDepthTrendGrowing: true, queueDepth: 80 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'QueueDepthGrowing', severity: 'warning' }));
    });

    it('triggers SweepsStalled when background sweeps stop executing', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, secondsSinceLastSweep: 350 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'SweepsStalled', severity: 'critical' }));
    });

    it('triggers AbaCheckFailuresHigh when failure rate exceeds 5%', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, abaCheckFailureRate: 0.08 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'AbaCheckFailuresHigh', severity: 'warning' }));
    });

    it('triggers LatePaymentDetected when customer pays late', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, latePaymentsIncrease: 1 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'LatePaymentDetected', severity: 'warning' }));
    });

    it('triggers MachineOffline when no machines are online', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, machinesOnline: 0 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'MachineOffline', severity: 'warning' }));
    });

    it('triggers PendingOutcomesStuck when outcome is stored on kiosk > 1h', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, pendingOutcomesCount: 1, pendingOutcomesAgeHours: 2 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'PendingOutcomesStuck', severity: 'warning' }));
    });

    it('triggers DispenseOutcomeUnknown when dispense status is unknown', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, dispenseUnknownCount: 1 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'DispenseOutcomeUnknown', severity: 'critical' }));
    });

    it('triggers RefundCaseStale when refund case is open > 24h', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, refundCasesCount: 1, refundCasesOpenDurationHours: 36 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'RefundCaseStale', severity: 'warning' }));
    });

    it('triggers OutcomeRejected when invalid outcome is received', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, rejectedAckIncrease: 1 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'OutcomeRejected', severity: 'critical' }));
    });

    it('triggers HostResourcesHigh when CPU exceeds 80%', () => {
      const alerts = evaluateDeploymentAlerts({ ...healthySnapshot, cpuUtilizationPercent: 88.5 });
      expect(alerts).toContainEqual(expect.objectContaining({ alert: 'HostResourcesHigh', severity: 'warning' }));
    });
  });
});
