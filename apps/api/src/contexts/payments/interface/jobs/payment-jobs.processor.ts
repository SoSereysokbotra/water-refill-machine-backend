import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../../../platform/queues/queue.service';
import { ConfirmPaymentCommand, ConfirmPaymentHandler } from '../../application';

@Injectable()
export class PaymentJobsProcessor implements OnModuleInit {
  private readonly logger = new Logger(PaymentJobsProcessor.name);

  constructor(
    private readonly queues: QueueService,
    private readonly confirmHandler: ConfirmPaymentHandler,
  ) {}

  onModuleInit(): void {
    this.queues.createWorker<{ tranId: string; apv?: string }>(
      'payments.confirm',
      async (job) => {
        const { tranId, apv } = job.data;
        this.logger.log(`Processing payments.confirm job for ${tranId}`);
        await this.confirmHandler.execute(
          new ConfirmPaymentCommand(tranId, apv ?? 'APV_CALLBACK', 'callback'),
        );
      },
      { concurrency: 10 },
    );
  }
}
