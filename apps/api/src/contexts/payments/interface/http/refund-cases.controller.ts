import { Body, Controller, Get, Inject, Optional, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../../../../platform/config/config.service';
import { SessionAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser } from '../../../../platform/security';
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
import { AUDIT_LOGGER_PORT, AuditLoggerPort } from '../../../identity/application/public/audit-logger.port';

const Reason = z.string().trim().min(1).max(500);

const ListQuery = z.object({
  status: z.enum(['open', 'claimed', 'refunded', 'rejected', 'auto_failed']).optional(),
});
const ClaimBody = z.object({
  durationMinutes: z.number().int().min(1).max(120).optional(),
});
const MarkRefundedBody = z.object({
  method: z.string().trim().min(1).max(64),
  reference: z.string().trim().min(1).max(128),
  amountMinor: z.number().int().positive(),
  adminOverrideReason: Reason.optional(),
});
const DecisionBody = z.object({
  reason: Reason,
});
const ResolveUnknownBody = z.object({
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

/**
 * The actor is always the authenticated user (session, X-Admin-Key, or the local dev admin set by
 * SessionAuthGuard). A body `actorId` is ignored: it let any operator act and be audited as someone else.
 */
function actorOf(user?: AuthenticatedUser): string {
  if (!user) throw new UnauthorizedException('Authentication required');
  return user.id;
}


/** Operator/admin endpoints protected by SessionAuthGuard and RolesGuard (Plan §C7). */
@Controller('v1')
@UseGuards(SessionAuthGuard, RolesGuard)
export class RefundCasesController {
  constructor(
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(ClaimRefundCaseHandler) private readonly claimHandler: ClaimRefundCaseHandler,
    @Inject(MarkRefundedHandler) private readonly markRefundedHandler: MarkRefundedHandler,
    @Inject(RejectRefundHandler) private readonly rejectHandler: RejectRefundHandler,
    @Inject(ReopenRefundHandler) private readonly reopenHandler: ReopenRefundHandler,
    @Inject(ResolveUnknownDispenseHandler) private readonly resolveUnknownHandler: ResolveUnknownDispenseHandler,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Optional() @Inject(AUDIT_LOGGER_PORT) private readonly audit?: AuditLoggerPort,
  ) {}

  @Get('refund-cases')
  @Roles('operator')
  async listRefundCases(@Query() query: unknown) {
    const { status } = parse(ListQuery, query);
    const cases = await this.repo.findRefundCases({ status, limit: 100 });
    return { data: cases };
  }

  @Get('refund-cases/:tranId')
  @Roles('operator')
  async getRefundCase(@Param('tranId') tranId: string) {
    const rc = await this.repo.getRefundCase(tranId);
    return { data: rc };
  }

  @Post('refund-cases/:tranId/claim')
  @Roles('operator')
  async claimRefundCase(
    @Param('tranId') tranId: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    parse(ClaimBody, body);
    const actorId = actorOf(user);
    const res = await this.claimHandler.execute(
      new ClaimRefundCaseCommand(tranId, actorId, this.config.get('REFUND_CLAIM_MINUTES')),
    );

    await this.audit?.record({
      actorId,
      action: 'refund.claim',
      entityType: 'refund_case',
      entityId: tranId,
    });

    return { data: res };
  }

  @Post('refund-cases/:tranId/mark-refunded')
  @Roles('admin')
  async markRefunded(
    @Param('tranId') tranId: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const b = parse(MarkRefundedBody, body);
    const actorId = actorOf(user);
    const res = await this.markRefundedHandler.execute(
      new MarkRefundedCommand(tranId, actorId, b.method, b.reference, b.amountMinor, b.adminOverrideReason),
    );

    await this.audit?.record({
      actorId,
      action: 'refund.mark_refunded',
      entityType: 'refund_case',
      entityId: tranId,
      after: { method: b.method, reference: b.reference, amountMinor: b.amountMinor },
      reason: b.adminOverrideReason,
    });

    return { data: res };
  }

  @Post('refund-cases/:tranId/reject')
  @Roles('admin')
  async rejectRefund(
    @Param('tranId') tranId: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const b = parse(DecisionBody, body);
    const actorId = actorOf(user);
    const res = await this.rejectHandler.execute(new RejectRefundCommand(tranId, actorId, b.reason));

    await this.audit?.record({
      actorId,
      action: 'refund.reject',
      entityType: 'refund_case',
      entityId: tranId,
      reason: b.reason,
    });

    return { data: res };
  }

  @Post('refund-cases/:tranId/reopen')
  @Roles('admin')
  async reopenRefund(
    @Param('tranId') tranId: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const b = parse(DecisionBody, body);
    const actorId = actorOf(user);
    const res = await this.reopenHandler.execute(new ReopenRefundCommand(tranId, actorId, b.reason));

    await this.audit?.record({
      actorId,
      action: 'refund.reopen',
      entityType: 'refund_case',
      entityId: tranId,
      reason: b.reason,
    });

    return { data: res };
  }

  @Post('payments/:tranId/resolve-unknown')
  @Roles('admin')
  async resolveUnknown(
    @Param('tranId') tranId: string,
    @Body() body: unknown,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const b = parse(ResolveUnknownBody, body);
    const actorId = actorOf(user);
    const res = await this.resolveUnknownHandler.execute(
      new ResolveUnknownDispenseCommand(tranId, actorId, b.resolution, b.reason, b.adminOverrideReason),
    );

    await this.audit?.record({
      actorId,
      action: 'dispense.resolve_unknown',
      entityType: 'payment',
      entityId: tranId,
      after: { resolution: b.resolution },
      reason: b.reason,
    });

    return { data: res };
  }
}
