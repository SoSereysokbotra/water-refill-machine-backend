import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminKeyGuard } from '../../../../platform/security/access.guards';
import { ConfigService } from '../../../../platform/config/config.service';
import { ValidationError } from '../../../../shared-kernel';
import {
  ClaimRefundCaseCommand,
  ClaimRefundCaseHandler,
  MarkRefundedCommand,
  MarkRefundedHandler,
  PaymentRepository,
  RejectRefundCommand,
  RejectRefundHandler,
  ReopenRefundCommand,
  ReopenRefundHandler,
  ResolveUnknownDispenseCommand,
  ResolveUnknownDispenseHandler,
} from '../../application';

// Until Phase 6 there is no login: the operator identifies themselves with actorId (required, so
// the claim lock can tell operators apart).
const ActorId = z.string().trim().min(1).max(64);
const Reason = z.string().trim().min(1).max(500);

const ListQuery = z.object({ status: z.enum(['open', 'claimed', 'refunded', 'rejected', 'auto_failed']).optional() });
const ClaimBody = z.object({ actorId: ActorId });
const MarkRefundedBody = z.object({
  actorId: ActorId,
  method: z.string().trim().min(1).max(32),
  reference: z.string().trim().min(1).max(128),
  amountMinor: z.number().int().positive(),
  adminOverrideReason: Reason.optional(),
});
const DecisionBody = z.object({ actorId: ActorId, reason: Reason });
const ResolveUnknownBody = z.object({
  actorId: ActorId,
  resolution: z.enum(['dispensed', 'refund']),
  reason: Reason,
  adminOverrideReason: Reason.optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

// Operator/admin endpoints: local-only or X-Admin-Key until Phase 6 (Plan §C7)
@Controller('v1')
@UseGuards(AdminKeyGuard)
export class RefundCasesController {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(ClaimRefundCaseHandler) private readonly claimHandler: ClaimRefundCaseHandler,
    @Inject(MarkRefundedHandler) private readonly markRefundedHandler: MarkRefundedHandler,
    @Inject(RejectRefundHandler) private readonly rejectHandler: RejectRefundHandler,
    @Inject(ReopenRefundHandler) private readonly reopenHandler: ReopenRefundHandler,
    @Inject(ResolveUnknownDispenseHandler) private readonly resolveUnknownHandler: ResolveUnknownDispenseHandler,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Get('refund-cases')
  async listRefundCases(@Query() query: unknown) {
    const { status } = parse(ListQuery, query);
    const cases = await this.repo.findRefundCases({ status, limit: 100 });
    return { data: cases };
  }

  @Get('refund-cases/:tranId')
  async getRefundCase(@Param('tranId') tranId: string) {
    const rc = await this.repo.getRefundCase(tranId);
    return { data: rc };
  }

  @Post('refund-cases/:tranId/claim')
  async claimRefundCase(@Param('tranId') tranId: string, @Body() body: unknown) {
    const { actorId } = parse(ClaimBody, body);
    // C7: a claim lasts REFUND_CLAIM_MINUTES (config), not a client-chosen duration
    const res = await this.claimHandler.execute(
      new ClaimRefundCaseCommand(tranId, actorId, this.config.get('REFUND_CLAIM_MINUTES')),
    );
    return { data: res };
  }

  @Post('refund-cases/:tranId/mark-refunded')
  async markRefunded(@Param('tranId') tranId: string, @Body() body: unknown) {
    const b = parse(MarkRefundedBody, body);
    const res = await this.markRefundedHandler.execute(
      new MarkRefundedCommand(tranId, b.actorId, b.method, b.reference, b.amountMinor, b.adminOverrideReason),
    );
    return { data: res };
  }

  @Post('refund-cases/:tranId/reject')
  async rejectRefund(@Param('tranId') tranId: string, @Body() body: unknown) {
    const b = parse(DecisionBody, body);
    const res = await this.rejectHandler.execute(new RejectRefundCommand(tranId, b.actorId, b.reason));
    return { data: res };
  }

  @Post('refund-cases/:tranId/reopen')
  async reopenRefund(@Param('tranId') tranId: string, @Body() body: unknown) {
    const b = parse(DecisionBody, body);
    const res = await this.reopenHandler.execute(new ReopenRefundCommand(tranId, b.actorId, b.reason));
    return { data: res };
  }

  @Post('payments/:tranId/resolve-unknown')
  async resolveUnknown(@Param('tranId') tranId: string, @Body() body: unknown) {
    const b = parse(ResolveUnknownBody, body);
    const res = await this.resolveUnknownHandler.execute(
      new ResolveUnknownDispenseCommand(tranId, b.actorId, b.resolution, b.reason, b.adminOverrideReason),
    );
    return { data: res };
  }
}
