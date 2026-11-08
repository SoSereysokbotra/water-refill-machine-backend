# Cashless QR Payment Flow

> How one KHQR payment works from button press to water. Exact formats: Implementation Plan **§C1** (payment states), **§C2** (MQTT), **§C3** (UART), **§C10** (ABA PayWay).

## 1. Payment Sequence

```text
CUSTOMER        STM32               ESP32                BACKEND                 ABA PayWay
   │              │                   │                     │                        │
   │─ press 500 ─▶│                   │                     │                        │
   │              │─ REQ_PAY,500 ────▶│                     │                        │
   │              │                   │─ pay/request ──────▶│                        │
   │              │                   │  {request_id, 500}  │─ generate-qr ─────────▶│
   │              │                   │                     │◀─ qrString ────────────│
   │              │                   │◀─ pay/qr ───────────│  (payment = PENDING)   │
   │              │◀─ QR,<tran_id>,0.15,USD,180,<qr_text> ──│                        │
   │◀─ KHQR + 3:00 countdown ─────────│                     │                        │
   │                                  │                     │                        │
   │─────────── scans + pays in banking app ──────────────────────────────────────▶ │
   │              │                   │                     │◀─ callback (tran_id) ──│
   │              │                   │                     │─ check-transaction ───▶│
   │              │                   │                     │◀─ APPROVED ────────────│
   │              │                   │◀─ pay/status paid ──│  (payment = PAID)      │
   │              │◀─ PAID,<tran_id> ─│                     │                        │
   │              │─ PAID,ACK,<id> ──▶│                     │                        │
   │◀─ "Place your bottle" → fill ────│                     │                        │
   │              │─ DONE,<id>,498,501 ▶│                   │                        │
   │              │                   │─ transaction ──────▶│  (payment = DISPENSED) │
   │              │                   │◀─ transaction/ack ──│                        │
   │              │◀─ ACK,<tran_id> ──│                     │                        │
```

The backend **doesn't rely on the callback**. It also polls ABA (every 3 s for the first minute, then every 5 s), so a lost callback only delays confirmation by a few seconds.

---

## 2. Payment States (simple view)

| State | Meaning | What the machine shows |
|---|---|---|
| **PENDING** | QR created, waiting for the customer | QR + countdown |
| **PAID** | ABA confirmed the money | "Place your bottle" → filling |
| **DISPENSED** | Water delivered ✅ | "Thank you" |
| **EXPIRED** | Not paid within 3 minutes | Back to Welcome |
| **CANCELLED** | Customer pressed Cancel, or a new request replaced it | Back to Welcome |
| **FAILED** | ABA declined | Back to Welcome |
| **DISPENSE_UNKNOWN** | Paid, but no result from the machine after 5 min (offline) | — (operator alerted, **no automatic refund**) |
| **REFUND_REVIEW** | Paid but no or partial water, or paid after expiry | — (operator decides) |
| **REFUNDED / REFUND_REJECTED** | Refund done / water was actually delivered | — |

Full state machine and rules: §C1.

---

## 3. Timeouts & Rules

| Rule | Value |
|---|---|
| QR lifetime | **3 minutes** (ABA minimum) + 60 s grace for late confirmations |
| Bottle placement after payment | **60 s**, then `BOTTLE_TIMEOUT` → refund review |
| Maximum dispense time | **60 s** (STM32 stops by itself) |
| Open payments per machine | **One** (a new request cancels an unpaid one; a paid one blocks new requests) |
| One payment dispenses | **At most once** |
| Paid after the QR expired | No water; **refund review** (100 %) |
| Late-payment check | Backend re-checks expired payments at +5 min, +1 h, +1 d, +3 d, +6 d |

---

## 4. Pricing & Volume Tiers

| Volume | Price (sandbox, USD) |
|---|---|
| 0.5 L (500 mL) | $0.15 |
| 0.75 L (750 mL) | $0.20 |
| 1.0 L (1000 mL) | $0.25 |

- Prices are set per machine from the dashboard and sent to the machine (`config` → `CFG`). No reflashing is needed.
- The sandbox account accepts **USD only**. KHR prices come with the live ABA account.

---

## 5. When Things Go Wrong

| Problem | Result |
|---|---|
| No internet when the customer presses a button | ESP32 retries 3 times, then the STM32 shows "Service unavailable" |
| ABA not responding | Same as above; nobody is charged |
| Internet lost after payment, during filling | STM32 finishes safely; result saved and sent later |
| Customer removes the bottle mid-fill | Safe stop; partial refund case created |
