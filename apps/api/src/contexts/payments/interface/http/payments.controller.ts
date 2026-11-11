import { Body, Controller, Get, Header, HttpCode, Inject, Ip, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { AdminKeyGuard, LocalOnlyGuard } from '../../../../platform/security/access.guards';
import { QueueService } from '../../../../platform/queues/queue.service';
import { RateLimiterService } from '../../../../platform/rate-limit/rate-limiter.service';
import { ConfigService } from '../../../../platform/config/config.service';
import {
  ConfirmPaymentCommand,
  ConfirmPaymentHandler,
  CreatePaymentCommand,
  CreatePaymentHandler,
  PaymentRepository,
  RecordDispenseCommand,
  RecordDispenseHandler,
} from '../../application';

@Controller()
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(ConfirmPaymentHandler) private readonly confirmHandler: ConfirmPaymentHandler,
    @Inject(CreatePaymentHandler) private readonly createPaymentHandler: CreatePaymentHandler,
    @Inject(RecordDispenseHandler) private readonly recordDispenseHandler: RecordDispenseHandler,
    @Inject('PaymentRepository') private readonly repo: PaymentRepository,
    @Inject(RateLimiterService) private readonly limiter: RateLimiterService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Post(['v1/payway/callback', 'v1/payments/aba/callback'])
  @HttpCode(200)
  async handleCallback(@Body() body: Record<string, unknown>, @Ip() ip: string): Promise<{ status: string }> {
    // C7: CALLBACK_RATE_LIMIT_PER_MIN per IP (throws RateLimitError -> 429)
    await this.limiter.consume(`callback:${ip}`, 1, {
      points: this.config.get('CALLBACK_RATE_LIMIT_PER_MIN'),
      duration: 60,
      keyPrefix: 'rl_callback',
    });

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

  @Get('v1/payments/:tranId')
  @UseGuards(AdminKeyGuard)
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

  @Post('v1/payments/dev/create')
  @UseGuards(LocalOnlyGuard)
  async devCreate(@Body() body: { machineId?: string; volumeMl?: number }) {
    const machineId = body.machineId || 'WRM-001';
    const volumeMl = Number(body.volumeMl || 500);
    const requestId = `dev-${Date.now()}`;
    const res = await this.createPaymentHandler.execute(
      new CreatePaymentCommand(machineId, requestId, volumeMl),
    );
    const amount = res.payment.currency === 'USD' ? res.payment.amountMinor / 100 : res.payment.amountMinor;
    return {
      tranId: res.payment.tranId,
      requestId: res.payment.requestId,
      machineId: res.payment.machineId,
      volumeMl: res.payment.volumeMl,
      amount,
      currency: res.payment.currency,
      status: res.payment.status,
      qrString: res.payment.qrString,
      expiresAt: res.payment.expiresAt,
    };
  }

  @Post('v1/payments/dev/simulate')
  @UseGuards(LocalOnlyGuard)
  async simulatePayment(@Body() body: { tranId: string; apv?: string }): Promise<{ status: string }> {
    if (!body.tranId) {
      return { status: 'missing tranId' };
    }
    await this.confirmHandler.execute(
      new ConfirmPaymentCommand(body.tranId, body.apv ?? 'APV_SIMULATED', 'callback'),
    );
    return { status: 'simulated' };
  }

  @Post('v1/payments/dev/dispense')
  @UseGuards(LocalOnlyGuard)
  async devDispense(
    @Body()
    body: {
      machineId?: string;
      tranId: string;
      result?: 'ok' | 'partial' | 'error';
      flowMl?: number;
      weightG?: number;
      fault?: string;
    },
  ) {
    if (!body.tranId) {
      return { status: 'missing tranId' };
    }
    const result = body.result ?? 'ok';
    const flowMl =
      body.flowMl !== undefined
        ? body.flowMl
        : result === 'ok'
          ? 502
          : result === 'partial'
            ? 300
            : 0;
    const weightG =
      body.weightG !== undefined
        ? body.weightG
        : result === 'ok'
          ? 504
          : result === 'partial'
            ? 300
            : 0;
    const fault =
      body.fault !== undefined
        ? body.fault
        : result === 'partial'
          ? 'BOTTLE_REMOVED'
          : result === 'error'
            ? 'NO_FLOW'
            : undefined;

    const res = await this.recordDispenseHandler.execute(
      new RecordDispenseCommand(body.machineId || 'WRM-001', {
        v: 1,
        tran_id: body.tranId,
        result,
        flow_ml: flowMl,
        weight_g: weightG,
        fault: fault || undefined,
        ts: Math.floor(Date.now() / 1000),
      }),
    );
    return res;
  }

  @Get(['dev', 'v1/dev'])
  @UseGuards(LocalOnlyGuard)
  @Header('Content-Type', 'text/html')
  getDevUi(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>WRM — Payment & Dispensing Simulator</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 960px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 28px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 22px; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; }
    .tag { font-size: 13px; font-weight: normal; background: #0369a1; color: #e0f2fe; padding: 4px 10px; border-radius: 20px; }
    .panel { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 18px; margin: 20px 0; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    select, button { padding: 10px 16px; font-size: 14px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #f8fafc; cursor: pointer; }
    select:focus, button:focus { outline: 2px solid #38bdf8; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    button.primary { background: #0284c7; color: white; border: none; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #0369a1; }
    button.success { background: #16a34a; color: white; border: none; font-weight: 600; }
    button.success:hover:not(:disabled) { background: #15803d; }
    button.warning { background: #d97706; color: white; border: none; font-weight: 600; }
    button.warning:hover:not(:disabled) { background: #b45309; }
    button.danger { background: #dc2626; color: white; border: none; font-weight: 600; }
    button.danger:hover:not(:disabled) { background: #b91c1c; }
    button.purple { background: #9333ea; color: white; border: none; font-weight: 600; }
    button.purple:hover:not(:disabled) { background: #7e22ce; }
    .card { display: flex; gap: 24px; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; background: #0f172a; align-items: flex-start; }
    .qr-container { background: #ffffff; padding: 12px; border-radius: 8px; text-align: center; }
    .qr-container img { width: 220px; height: 220px; display: block; }
    .info { flex-grow: 1; }
    .info table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .info td { padding: 6px 0; }
    .info td.lbl { color: #94a3b8; width: 140px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: 700; font-size: 13px; text-transform: uppercase; }
    .status-PENDING { background: #ca8a04; color: #fef08a; }
    .status-PAID { background: #16a34a; color: #dcfce7; }
    .status-DISPENSED { background: #0284c7; color: #e0f2fe; }
    .status-EXPIRED { background: #dc2626; color: #fee2e2; }
    .status-REFUND_REVIEW { background: #9333ea; color: #f3e8ff; }
    .status-REFUNDED { background: #059669; color: #a7f3d0; }
    .status-REFUND_REJECTED { background: #475569; color: #cbd5e1; }
    .status-DISPENSE_UNKNOWN { background: #e11d48; color: #ffe4e6; }
    .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin: 16px 0 8px 0; }
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .refund-box { background: #1e1b4b; border: 1px solid #6366f1; border-radius: 8px; padding: 14px; margin-top: 14px; }
    .links { margin-top: 30px; text-align: center; font-size: 14px; color: #94a3b8; }
    .links a { color: #38bdf8; text-decoration: none; font-weight: 600; }
    .links a:hover { text-decoration: underline; }
    .log-box { margin-top: 14px; font-family: monospace; font-size: 12px; color: #94a3b8; background: #020617; padding: 10px; border-radius: 6px; word-break: break-all; max-height: 90px; overflow-y: auto; }
  </style>
</head>
<body>
<div class="container">
  <h1>
    <span>💧 Water Refill Machine (WRM) — End-to-End Simulator</span>
    <span class="tag">Phase 2 & Phase 3 Playground</span>
  </h1>

  <div class="panel">
    <label><b>Machine:</b></label>
    <select id="machineSelect">
      <option value="WRM-001">WRM-001 (Pilot Machine)</option>
      <option value="WRM-900">WRM-900 (Lab Test)</option>
    </select>

    <label style="margin-left: 12px;"><b>Simulate Customer Vending:</b></label>
    <button class="primary" onclick="createPayment(500)">500 mL (2000 KHR / 15¢)</button>
    <button class="primary" onclick="createPayment(750)">750 mL (3000 KHR / 20¢)</button>
    <button class="primary" onclick="createPayment(1000)">1000 mL (4000 KHR / 25¢)</button>
  </div>

  <div id="paymentCard" style="display: none;" class="card">
    <div class="qr-container">
      <img id="qrImg" src="" alt="KHQR Code">
      <div style="color: #0f172a; font-size: 11px; margin-top: 6px; font-weight: 600;">Scan with ABA Mobile / Simulator</div>
    </div>
    <div class="info">
      <table>
        <tr><td class="lbl">Transaction ID:</td><td><b id="valTranId">-</b></td></tr>
        <tr><td class="lbl">Machine ID:</td><td id="valMachineId">-</td></tr>
        <tr><td class="lbl">Volume:</td><td id="valVolume">-</td></tr>
        <tr><td class="lbl">Amount:</td><td><b id="valAmount" style="color: #38bdf8;">-</b></td></tr>
        <tr><td class="lbl">Payment Status:</td><td><span id="valStatus" class="status-badge">-</span></td></tr>
        <tr><td class="lbl">Expires:</td><td id="valExpires">-</td></tr>
      </table>

      <!-- Payment Step Controls -->
      <div class="section-title">1. Payment Stage (Customer / ABA)</div>
      <div class="btn-row">
        <button id="btnSimulatePay" class="success" onclick="simulatePay()">Simulate Pay Approval (ABA Callback)</button>
        <button class="secondary" onclick="checkStatus()">Refresh Status</button>
      </div>

      <!-- Dispense Step Controls -->
      <div class="section-title">2. Hardware Dispense Outcomes (Simulate ESP32 / STM32)</div>
      <div class="btn-row">
        <button id="btnDispenseOk" class="primary" onclick="simulateDispense('ok')">💧 Dispense 100% OK</button>
        <button id="btnDispensePartial" class="warning" onclick="simulateDispense('partial')">⚠️ Dispense Partial (Bottle Removed)</button>
        <button id="btnDispenseError" class="danger" onclick="simulateDispense('error')">❌ Dispense Failed (No Flow)</button>
      </div>

      <!-- Refund Review Controls -->
      <div id="refundSection" style="display: none;" class="refund-box">
        <div style="font-weight: 700; color: #a5b4fc; margin-bottom: 8px;">🛡️ ADR-0008 Refund Case Created</div>
        <div id="refundDetails" style="font-size: 13px; line-height: 1.6; margin-bottom: 12px;"></div>
        <div class="btn-row">
          <button class="purple" onclick="claimCase('operator_alice')">Claim Case (Alice)</button>
          <button class="purple" onclick="claimCase('operator_bob')">Attempt Double Claim (Bob -> 409)</button>
          <button class="success" onclick="markRefunded()">Mark Refunded (Operator)</button>
          <button class="danger" onclick="rejectRefund()">Reject Refund</button>
          <button class="secondary" onclick="reopenRefund()">Reopen Case</button>
        </div>
      </div>

      <div class="log-box" id="rawQr"></div>
    </div>
  </div>

  <div class="links">
    Database Inspector: <a href="http://localhost:5555" target="_blank">Open Prisma Studio (Port 5555) ↗</a> | 
    Health Readiness: <a href="/health/ready" target="_blank">/health/ready ↗</a> |
    Refund Cases API: <a href="/v1/refund-cases" target="_blank">/v1/refund-cases ↗</a>
  </div>
</div>

<script>
  let currentTranId = null;
  let currentRefundCase = null;
  let pollInterval = null;

  async function createPayment(volumeMl) {
    const machineId = document.getElementById('machineSelect').value;
    try {
      const res = await fetch('/v1/payments/dev/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, volumeMl })
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error?.message || data.message || 'Create payment failed';
        throw new Error(msg);
      }
      displayPayment(data);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  function displayPayment(data) {
    currentTranId = data.tranId;
    currentRefundCase = null;
    document.getElementById('valTranId').textContent = data.tranId;
    document.getElementById('valMachineId').textContent = data.machineId;
    document.getElementById('valVolume').textContent = data.volumeMl + ' mL';
    document.getElementById('valAmount').textContent = data.amount + ' ' + data.currency;
    
    updateStatusBadge(data.status);
    document.getElementById('valExpires').textContent = new Date(data.expiresAt).toLocaleTimeString();
    
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(data.qrString);
    document.getElementById('qrImg').src = qrUrl;
    document.getElementById('rawQr').textContent = data.qrString;

    document.getElementById('paymentCard').style.display = 'flex';
    document.getElementById('refundSection').style.display = 'none';

    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(checkStatus, 2000);
  }

  function updateStatusBadge(status) {
    const badge = document.getElementById('valStatus');
    badge.textContent = status;
    badge.className = 'status-badge status-' + status;

    document.getElementById('btnSimulatePay').disabled = (status !== 'PENDING');
    document.getElementById('btnDispenseOk').disabled = (status !== 'PAID');
    document.getElementById('btnDispensePartial').disabled = (status !== 'PAID');
    document.getElementById('btnDispenseError').disabled = (status !== 'PAID');

    if (status === 'REFUND_REVIEW' || status === 'REFUNDED' || status === 'REFUND_REJECTED') {
      loadRefundCase();
    }
  }

  async function checkStatus() {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/payments/' + currentTranId);
      if (!res.ok) return;
      const data = await res.json();
      updateStatusBadge(data.status);
      if (['DISPENSED', 'EXPIRED', 'FAILED', 'REFUNDED'].includes(data.status)) {
        clearInterval(pollInterval);
      }
    } catch (e) {}
  }

  async function simulatePay() {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/payments/dev/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tranId: currentTranId, apv: 'APV_SIMULATED_SUCCESS' })
      });
      await res.json();
      setTimeout(checkStatus, 300);
    } catch (err) {
      alert('Error simulating payment: ' + err.message);
    }
  }

  async function simulateDispense(result) {
    if (!currentTranId) return;
    const machineId = document.getElementById('machineSelect').value;
    try {
      const res = await fetch('/v1/payments/dev/dispense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, tranId: currentTranId, result })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Dispense error: ' + (data.error?.message || data.message));
      }
      setTimeout(checkStatus, 400);
    } catch (err) {
      alert('Error recording dispense: ' + err.message);
    }
  }

  async function loadRefundCase() {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/refund-cases/' + currentTranId);
      if (!res.ok) return;
      const json = await res.json();
      currentRefundCase = json.data;

      const div = document.getElementById('refundDetails');
      div.innerHTML = '<b>Case Status:</b> ' + currentRefundCase.status.toUpperCase() +
        '<br><b>Reason:</b> ' + currentRefundCase.reason +
        '<br><b>Suggested Refund:</b> ' + currentRefundCase.suggestedAmountMinor + ' (minor units)' +
        '<br><b>Claimed By:</b> ' + (currentRefundCase.claimedBy || 'None (Open for review)') +
        (currentRefundCase.claimedUntil ? ' (until ' + new Date(currentRefundCase.claimedUntil).toLocaleTimeString() + ')' : '') +
        (currentRefundCase.reference ? '<br><b>Refund Reference:</b> ' + currentRefundCase.reference : '');

      document.getElementById('refundSection').style.display = 'block';
    } catch (e) {}
  }

  async function claimCase(actorId) {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/refund-cases/' + currentTranId + '/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, durationMinutes: 30 })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Claim Result (' + res.status + '): ' + (data.error?.message || data.message));
      } else {
        alert('Success! Case claimed by ' + actorId + ' until ' + new Date(data.data.claimedUntil).toLocaleTimeString());
      }
      loadRefundCase();
    } catch (e) {
      alert('Network error: ' + e.message);
    }
  }

  async function markRefunded() {
    if (!currentTranId || !currentRefundCase) return;
    const ref = prompt('Enter payment portal refund reference (e.g. ABA-REF-88899):', 'ABA-MANUAL-' + Date.now().toString().slice(-6));
    if (!ref) return;

    try {
      const res = await fetch('/v1/refund-cases/' + currentTranId + '/mark-refunded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: currentRefundCase.claimedBy || 'operator_alice',
          method: 'ABA_PORTAL',
          reference: ref,
          amountMinor: currentRefundCase.suggestedAmountMinor
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Mark refunded error (' + res.status + '): ' + (data.error?.message || data.message));
      } else {
        alert('Case marked REFUNDED successfully!');
      }
      checkStatus();
      loadRefundCase();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function rejectRefund() {
    if (!currentTranId) return;
    const reason = prompt('Enter rejection reason (e.g. Water poured manually by staff):', 'Customer confirmed water dispensed manually');
    if (!reason) return;

    try {
      const res = await fetch('/v1/refund-cases/' + currentTranId + '/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: 'operator_alice', reason })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Reject error: ' + (data.error?.message || data.message));
      } else {
        alert('Case rejected.');
      }
      checkStatus();
      loadRefundCase();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function reopenRefund() {
    if (!currentTranId) return;
    const reason = prompt('Enter dispute reopen reason:', 'Customer called hotline claiming no manual pour');
    if (!reason) return;

    try {
      const res = await fetch('/v1/refund-cases/' + currentTranId + '/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId: 'admin_supervisor', reason })
      });
      const data = await res.json();
      if (!res.ok) {
        alert('Reopen error: ' + (data.error?.message || data.message));
      } else {
        alert('Case reopened for review.');
      }
      checkStatus();
      loadRefundCase();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }
</script>
</body>
</html>`;
  }
}
