import { Body, Controller, Get, HttpCode, Inject, Logger, Param, Post } from '@nestjs/common';
import { QueueService } from '../../../../platform/queues/queue.service';
import { ConfirmPaymentCommand, ConfirmPaymentHandler, PaymentRepository } from '../../application';

@Controller('v1')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(ConfirmPaymentHandler) private readonly confirmHandler: ConfirmPaymentHandler,
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
  ) {}

  @Post(['payway/callback', 'payments/aba/callback'])
  @HttpCode(200)
  async handleCallback(@Body() body: Record<string, unknown>): Promise<{ status: string }> {
    const tranId = typeof body?.tran_id === 'string' ? body.tran_id : null;
    this.logger.log(`Received PayWay callback: tran_id=${tranId}`);

    if (tranId) {
      // Per Plan C10.4: Never trust callback body, enqueue confirmation job with check-transaction
      const queue = this.queues.getQueue('payments.confirm');
      await queue.add(
        'confirm',
        { tranId, apv: typeof body?.apv === 'string' ? body.apv : undefined },
        { jobId: tranId },
      );
    }

    // Always 200 per C10.4
    return { status: 'ok' };
  }

  @Get('payments/:tranId')
  async getPayment(@Param('tranId') tranId: string) {
    const payment = await this.repo.get(tranId);
    const amount = payment.currency === 'USD' ? payment.amountMinor / 100 : payment.amountMinor;
    return {
      tranId: payment.tranId,
      machineId: payment.machineId,
      status: payment.status,
      volumeMl: payment.volumeMl,
      amount,
      currency: payment.currency,
      qrString: payment.qrString,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt,
    };
  }

  @Post('payments/dev/simulate')
  async simulatePayment(@Body() body: { tranId: string; apv?: string }): Promise<{ status: string }> {
    if (!body.tranId) {
      return { status: 'missing tranId' };
    }
    await this.confirmHandler.execute(
      new ConfirmPaymentCommand(body.tranId, body.apv ?? 'APV_SIMULATED', 'callback'),
    );
    return { status: 'simulated' };
  }
}
