import { Module, OnModuleInit, Inject, Global } from '@nestjs/common';
import { ConfigService } from '../../platform/config/config.service';
import { SweepsScheduler } from '../../platform/sweeps/sweeps.scheduler';
import { SystemClock, TranIdGenerator } from '../../shared-kernel';
import { PAYMENTS_REFUND_MONITORING } from './application/public/refund-monitoring.port';
import {
  CancelPaymentHandler,
  ClaimRefundCaseHandler,
  ConfirmPaymentHandler,
  CreatePaymentHandler,
  DispensingSweep,
  ExpirePaymentHandler,
  FailPaymentHandler,
  MarkRefundedHandler,
  PaymentsSweep,
  ProbePaymentHandler,
  ReconcileSweep,
  RecordDispenseHandler,
  RejectRefundHandler,
  ReopenRefundHandler,
  ResolveUnknownDispenseHandler,
} from './application';
import {
  MockPayWayGateway,
  PayWayGatewayAdapter,
  FleetMachineAdapter,
  PrismaPaymentRepository,
} from './infrastructure';
import {
  PaymentJobsProcessor,
  PaymentOutboxHandlers,
  PaymentsController,
  PaymentsMqttConsumer,
  RefundCasesController,
} from './interface';

@Global()
@Module({
  controllers: [PaymentsController, RefundCasesController],
  providers: [
    TranIdGenerator,
    {
      provide: 'Clock',
      useClass: SystemClock,
    },
    SystemClock,
    PrismaPaymentRepository,
    {
      provide: 'PaymentRepository',
      useExisting: PrismaPaymentRepository,
    },
    {
      provide: PAYMENTS_REFUND_MONITORING,
      useExisting: PrismaPaymentRepository,
    },
    {
      provide: 'MachinePort',
      useClass: FleetMachineAdapter,
    },
    {
      provide: 'PaymentGateway',
      useFactory: (config: ConfigService, realGateway: PayWayGatewayAdapter, mockGateway: MockPayWayGateway) => {
        const mode = config.get('PAYWAY_MODE');
        const nodeEnv = config.get('NODE_ENV');
        return nodeEnv === 'test' || mode === 'mock' ? mockGateway : realGateway;
      },
      inject: [ConfigService, PayWayGatewayAdapter, MockPayWayGateway],
    },
    PayWayGatewayAdapter,
    MockPayWayGateway,
    // Handlers
    CreatePaymentHandler,
    ConfirmPaymentHandler,
    ExpirePaymentHandler,
    CancelPaymentHandler,
    FailPaymentHandler,
    ProbePaymentHandler,
    RecordDispenseHandler,
    ClaimRefundCaseHandler,
    MarkRefundedHandler,
    RejectRefundHandler,
    ReopenRefundHandler,
    ResolveUnknownDispenseHandler,
    // Sweeps
    PaymentsSweep,
    ReconcileSweep,
    DispensingSweep,
    // Interface components
    PaymentOutboxHandlers,
    PaymentsMqttConsumer,
    PaymentJobsProcessor,
  ],
  exports: [
    'PaymentRepository',
    'PaymentGateway',
    'Clock',
    CreatePaymentHandler,
    ConfirmPaymentHandler,
    ExpirePaymentHandler,
    CancelPaymentHandler,
    FailPaymentHandler,
    ProbePaymentHandler,
    RecordDispenseHandler,
    ClaimRefundCaseHandler,
    MarkRefundedHandler,
    RejectRefundHandler,
    ReopenRefundHandler,
    ResolveUnknownDispenseHandler,
    PaymentsSweep,
    ReconcileSweep,
    DispensingSweep,
    PAYMENTS_REFUND_MONITORING,
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    @Inject(SweepsScheduler) private readonly sweepsScheduler: SweepsScheduler,
    @Inject(PaymentsSweep) private readonly paymentsSweep: PaymentsSweep,
    @Inject(ReconcileSweep) private readonly reconcileSweep: ReconcileSweep,
    @Inject(DispensingSweep) private readonly dispensingSweep: DispensingSweep,
  ) {}

  onModuleInit(): void {
    this.sweepsScheduler.registerSchedule({
      name: this.paymentsSweep.name,
      everyMs: typeof this.paymentsSweep.cronOrInterval === 'number' ? this.paymentsSweep.cronOrInterval : 3000,
      processor: async () => {
        await this.paymentsSweep.execute();
      },
    });

    this.sweepsScheduler.registerSchedule({
      name: this.reconcileSweep.name,
      everyMs: typeof this.reconcileSweep.cronOrInterval === 'number' ? this.reconcileSweep.cronOrInterval : 300000,
      processor: async () => {
        await this.reconcileSweep.execute();
      },
    });

    this.sweepsScheduler.registerSchedule({
      name: this.dispensingSweep.name,
      everyMs: typeof this.dispensingSweep.cronOrInterval === 'number' ? this.dispensingSweep.cronOrInterval : 30000,
      processor: async () => {
        await this.dispensingSweep.execute();
      },
    });
  }
}
