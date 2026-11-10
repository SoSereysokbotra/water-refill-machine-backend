import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '../../platform/config/config.service';
import { SweepsScheduler } from '../../platform/sweeps/sweeps.scheduler';
import { SystemClock, TranIdGenerator } from '../../shared-kernel';
import {
  CancelPaymentHandler,
  ConfirmPaymentHandler,
  CreatePaymentHandler,
  ExpirePaymentHandler,
  FailPaymentHandler,
  PaymentsSweep,
  ProbePaymentHandler,
  ReconcileSweep,
  RecordDispenseHandler,
} from './application';
import {
  MockPayWayGateway,
  PayWayGatewayAdapter,
  PrismaMachineAdapter,
  PrismaPaymentRepository,
} from './infrastructure';
import {
  PaymentJobsProcessor,
  PaymentOutboxHandlers,
  PaymentsController,
  PaymentsMqttConsumer,
} from './interface';

@Module({
  controllers: [PaymentsController],
  providers: [
    TranIdGenerator,
    {
      provide: 'Clock',
      useClass: SystemClock,
    },
    SystemClock,
    {
      provide: 'PaymentRepository',
      useClass: PrismaPaymentRepository,
    },
    {
      provide: 'MachinePort',
      useClass: PrismaMachineAdapter,
    },
    {
      provide: 'PaymentGateway',
      useFactory: (config: ConfigService, realGateway: PayWayGatewayAdapter, mockGateway: MockPayWayGateway) => {
        const mode = config.get('PAYWAY_MODE');
        return mode === 'mock' ? mockGateway : realGateway;
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
    // Sweeps
    PaymentsSweep,
    ReconcileSweep,
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
    PaymentsSweep,
    ReconcileSweep,
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    @Inject(SweepsScheduler) private readonly sweepsScheduler: SweepsScheduler,
    @Inject(PaymentsSweep) private readonly paymentsSweep: PaymentsSweep,
    @Inject(ReconcileSweep) private readonly reconcileSweep: ReconcileSweep,
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
  }
}
