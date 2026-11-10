import { Body, Controller, Get, Header, HttpCode, Inject, Logger, Param, Post } from '@nestjs/common';
import { QueueService } from '../../../../platform/queues/queue.service';
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
  ) {}

  @Post(['v1/payway/callback', 'v1/payments/aba/callback'])
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

  @Get('v1/payments/:tranId')
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
  async devDispense(@Body() body: { machineId?: string; tranId: string; result?: 'ok' | 'partial' | 'error' }) {
    if (!body.tranId) {
      return { status: 'missing tranId' };
    }
    const res = await this.recordDispenseHandler.execute(
      new RecordDispenseCommand(body.machineId || 'WRM-001', {
        v: 1,
        tran_id: body.tranId,
        result: body.result ?? 'ok',
        flow_ml: 502,
        weight_g: 504,
        ts: Math.floor(Date.now() / 1000),
      }),
    );
    return res;
  }

  @Get(['dev', 'v1/dev'])
  @Header('Content-Type', 'text/html')
  getDevUi(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>WRM Phase 2 — Interactive Payment Test Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 28px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 22px; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 16px; }
    .tag { font-size: 13px; font-weight: normal; background: #0369a1; color: #e0f2fe; padding: 4px 10px; border-radius: 20px; }
    .panel { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 18px; margin: 20px 0; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    select, button { padding: 10px 16px; font-size: 14px; border-radius: 6px; border: 1px solid #475569; background: #1e293b; color: #f8fafc; cursor: pointer; }
    select:focus, button:focus { outline: 2px solid #38bdf8; }
    button.primary { background: #0284c7; color: white; border: none; font-weight: 600; }
    button.primary:hover { background: #0369a1; }
    button.success { background: #16a34a; color: white; border: none; font-weight: 600; }
    button.success:hover { background: #15803d; }
    button.warning { background: #d97706; color: white; border: none; font-weight: 600; }
    button.warning:hover { background: #b45309; }
    .card { display: flex; gap: 24px; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin-top: 20px; background: #0f172a; align-items: center; }
    .qr-container { background: #ffffff; padding: 12px; border-radius: 8px; text-align: center; }
    .qr-container img { width: 220px; height: 220px; display: block; }
    .info { flex-grow: 1; }
    .info table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .info td { padding: 6px 0; }
    .info td.lbl { color: #94a3b8; width: 130px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-weight: 700; font-size: 13px; text-transform: uppercase; }
    .status-PENDING { background: #ca8a04; color: #fef08a; }
    .status-PAID { background: #16a34a; color: #dcfce7; }
    .status-DISPENSED { background: #0284c7; color: #e0f2fe; }
    .status-EXPIRED { background: #dc2626; color: #fee2e2; }
    .status-REFUND_REVIEW { background: #9333ea; color: #f3e8ff; }
    .btn-row { margin-top: 16px; display: flex; gap: 10px; flex-wrap: wrap; }
    .links { margin-top: 30px; text-align: center; font-size: 14px; color: #94a3b8; }
    .links a { color: #38bdf8; text-decoration: none; font-weight: 600; }
    .links a:hover { text-decoration: underline; }
    .log-box { margin-top: 16px; font-family: monospace; font-size: 12px; color: #94a3b8; background: #020617; padding: 10px; border-radius: 6px; word-break: break-all; max-height: 80px; overflow-y: auto; }
  </style>
</head>
<body>
<div class="container">
  <h1>
    <span>💧 Water Refill Machine (WRM) — Payment Simulator</span>
    <span class="tag">Phase 2 Cut-Over</span>
  </h1>

  <div class="panel">
    <label><b>Machine:</b></label>
    <select id="machineSelect">
      <option value="WRM-001">WRM-001 (Pilot Machine)</option>
      <option value="WRM-900">WRM-900 (Lab Test)</option>
    </select>

    <label style="margin-left: 12px;"><b>Create Payment QR:</b></label>
    <button class="primary" onclick="createPayment(500)">500 mL</button>
    <button class="primary" onclick="createPayment(750)">750 mL</button>
    <button class="primary" onclick="createPayment(1000)">1000 mL</button>
  </div>

  <div id="paymentCard" style="display: none;" class="card">
    <div class="qr-container">
      <img id="qrImg" src="" alt="KHQR Code">
      <div style="color: #0f172a; font-size: 11px; margin-top: 6px; font-weight: 600;">Scan with ABA Simulator</div>
    </div>
    <div class="info">
      <table>
        <tr><td class="lbl">Transaction ID:</td><td><b id="valTranId">-</b></td></tr>
        <tr><td class="lbl">Machine ID:</td><td id="valMachineId">-</td></tr>
        <tr><td class="lbl">Volume:</td><td id="valVolume">-</td></tr>
        <tr><td class="lbl">Amount:</td><td><b id="valAmount" style="color: #38bdf8;">-</b></td></tr>
        <tr><td class="lbl">Status:</td><td><span id="valStatus" class="status-badge">-</span></td></tr>
        <tr><td class="lbl">Expires:</td><td id="valExpires">-</td></tr>
      </table>

      <div class="btn-row">
        <button id="btnSimulatePay" class="success" onclick="simulatePay()">Simulate Pay Approval</button>
        <button id="btnSimulateDispense" class="warning" onclick="simulateDispense()">Simulate Dispense Complete</button>
        <button class="secondary" onclick="checkStatus()">Refresh Status</button>
      </div>

      <div class="log-box" id="rawQr"></div>
    </div>
  </div>

  <div class="links">
    Database Inspector: <a href="http://localhost:5555" target="_blank">Open Prisma Studio (Port 5555) ↗</a>
  </div>
</div>

<script>
  let currentTranId = null;
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
      if (!res.ok) throw new Error(data.message || 'Create payment failed');
      displayPayment(data);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  function displayPayment(data) {
    currentTranId = data.tranId;
    document.getElementById('valTranId').textContent = data.tranId;
    document.getElementById('valMachineId').textContent = data.machineId;
    document.getElementById('valVolume').textContent = data.volumeMl + ' mL';
    document.getElementById('valAmount').textContent = data.amount + ' ' + data.currency;
    
    updateStatusBadge(data.status);
    document.getElementById('valExpires').textContent = new Date(data.expiresAt).toLocaleTimeString();
    
    // Render QR Code using standard QR API
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(data.qrString);
    document.getElementById('qrImg').src = qrUrl;
    document.getElementById('rawQr').textContent = data.qrString;

    document.getElementById('paymentCard').style.display = 'flex';

    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(checkStatus, 2500);
  }

  function updateStatusBadge(status) {
    const badge = document.getElementById('valStatus');
    badge.textContent = status;
    badge.className = 'status-badge status-' + status;

    document.getElementById('btnSimulatePay').disabled = (status !== 'PENDING');
    document.getElementById('btnSimulateDispense').disabled = (status !== 'PAID');
  }

  async function checkStatus() {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/payments/' + currentTranId);
      if (!res.ok) return;
      const data = await res.json();
      updateStatusBadge(data.status);
      if (['DISPENSED', 'EXPIRED', 'FAILED', 'REFUND_REVIEW'].includes(data.status)) {
        clearInterval(pollInterval);
      }
    } catch (e) {
      // ignore
    }
  }

  async function simulatePay() {
    if (!currentTranId) return;
    try {
      const res = await fetch('/v1/payments/dev/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tranId: currentTranId, apv: 'APV_DEV_APPROVED' })
      });
      await res.json();
      setTimeout(checkStatus, 300);
    } catch (err) {
      alert('Error simulating payment: ' + err.message);
    }
  }

  async function simulateDispense() {
    if (!currentTranId) return;
    const machineId = document.getElementById('machineSelect').value;
    try {
      const res = await fetch('/v1/payments/dev/dispense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, tranId: currentTranId, result: 'ok' })
      });
      await res.json();
      setTimeout(checkStatus, 300);
    } catch (err) {
      alert('Error recording dispense: ' + err.message);
    }
  }
</script>
</body>
</html>`;
  }
}
