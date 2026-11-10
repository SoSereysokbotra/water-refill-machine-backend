import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ClaimRefundCaseCommand,
  ClaimRefundCaseHandler,
  MarkRefundedCommand,
  MarkRefundedHandler,
  PaymentRepository,
  RefundStatus,
  RejectRefundCommand,
  RejectRefundHandler,
  ReopenRefundCommand,
  ReopenRefundHandler,
  ResolveUnknownDispenseCommand,
  ResolveUnknownDispenseHandler,
} from '../../application';

@Controller('v1')
export class RefundCasesController {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(ClaimRefundCaseHandler) private readonly claimHandler: ClaimRefundCaseHandler,
    @Inject(MarkRefundedHandler) private readonly markRefundedHandler: MarkRefundedHandler,
    @Inject(RejectRefundHandler) private readonly rejectHandler: RejectRefundHandler,
    @Inject(ReopenRefundHandler) private readonly reopenHandler: ReopenRefundHandler,
    @Inject(ResolveUnknownDispenseHandler) private readonly resolveUnknownHandler: ResolveUnknownDispenseHandler,
  ) {}

  @Get('refund-cases')
  async listRefundCases(@Query('status') status?: string) {
    const cases = await this.repo.findRefundCases({
      status: status as RefundStatus,
      limit: 100,
    });
    return { data: cases };
  }

  @Get('refund-cases/:tranId')
  async getRefundCase(@Param('tranId') tranId: string) {
    const rc = await this.repo.getRefundCase(tranId);
    return { data: rc };
  }

  @Post('refund-cases/:tranId/claim')
  async claimRefundCase(
    @Param('tranId') tranId: string,
    @Body() body: { actorId?: string; durationMinutes?: number },
  ) {
    const actorId = body.actorId || 'admin_operator';
    const duration = body.durationMinutes ?? 30;
    const res = await this.claimHandler.execute(
      new ClaimRefundCaseCommand(tranId, actorId, duration),
    );
    return { data: res };
  }

  @Post('refund-cases/:tranId/mark-refunded')
  async markRefunded(
    @Param('tranId') tranId: string,
    @Body()
    body: {
      actorId?: string;
      method: string;
      reference: string;
      amountMinor: number;
      adminOverrideReason?: string;
    },
  ) {
    const actorId = body.actorId || 'admin_operator';
    const res = await this.markRefundedHandler.execute(
      new MarkRefundedCommand(
        tranId,
        actorId,
        body.method,
        body.reference,
        body.amountMinor,
        body.adminOverrideReason,
      ),
    );
    return { data: res };
  }

  @Post('refund-cases/:tranId/reject')
  async rejectRefund(
    @Param('tranId') tranId: string,
    @Body() body: { actorId?: string; reason: string },
  ) {
    const actorId = body.actorId || 'admin_operator';
    const res = await this.rejectHandler.execute(
      new RejectRefundCommand(tranId, actorId, body.reason || 'Water delivered'),
    );
    return { data: res };
  }

  @Post('refund-cases/:tranId/reopen')
  async reopenRefund(
    @Param('tranId') tranId: string,
    @Body() body: { actorId?: string; reason: string },
  ) {
    const actorId = body.actorId || 'admin_supervisor';
    const res = await this.reopenHandler.execute(
      new ReopenRefundCommand(tranId, actorId, body.reason || 'Customer dispute reopened'),
    );
    return { data: res };
  }

  @Post('payments/:tranId/resolve-unknown')
  async resolveUnknown(
    @Param('tranId') tranId: string,
    @Body()
    body: {
      actorId?: string;
      resolution: 'dispensed' | 'refund';
      reason: string;
      adminOverrideReason?: string;
    },
  ) {
    const actorId = body.actorId || 'admin_operator';
    const res = await this.resolveUnknownHandler.execute(
      new ResolveUnknownDispenseCommand(
        tranId,
        actorId,
        body.resolution,
        body.reason || 'Manual resolution',
        body.adminOverrideReason,
      ),
    );
    return { data: res };
  }
}
