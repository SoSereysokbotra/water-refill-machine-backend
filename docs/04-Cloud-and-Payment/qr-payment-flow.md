# Cashless QR Payment Flow

## 1. Payment Sequence Overview

The machine operates in a completely cashless model. Customers scan a dynamic QR code displayed on the 2.8" TFT screen or a static QR code registered with the payment gateway:

```text
CUSTOMER MOBILE                ESP32-S3 MACHINE                 CLOUD BACKEND
      │                               │                               │
      │── 1. Scans QR Code on Screen ─▶                               │
      │                               │                               │
      │── 2. Authorizes Payment ─────────────────────────────────────▶│
      │      (PromptPay/GCash/Card)   │                               │
      │                               │                               │ (Gateway verifies funds)
      │                               │◀── 3. Webhook / Polling Push ─│
      │                               │    {"status": "PAID",         │
      │                               │     "credit": 1.00,           │
      │                               │     "txn_id": "TXN_8812"}     │
      │                               │                               │
      │◀── 4. Screen Unlocks Menu ────│                               │
      │    "Select Volume"            │                               │
```

---

## 2. Dynamic vs. Static QR Architecture

### Mode A: Dynamic QR Code (Recommended)
1. Customer approaches the machine and touches the screen.
2. ESP32-S3 makes an HTTP POST request to `/api/payment/generate-qr` with `{ machine_id, price }`.
3. Backend creates a transaction record and returns a QR string payload (e.g., EMVCo PromptPay / QR Ph standard).
4. ESP32 renders the QR code on the 2.8" ILI9341 display.
5. Machine polls `/api/payment/verify?txn_id=...` every 2 seconds (or receives push notification via MQTT).
6. **Timeout**: If no payment is detected within 90 seconds, the QR code expires and the machine returns to Idle.

### Mode B: Static QR Code (Fallback)
1. A permanent physical QR sticker is affixed above the dispensing nozzle with a fixed `Machine_ID`.
2. Customer scans with their banking app, selects the refill tier, and completes payment.
3. The bank webhook hits the Cloud Backend, which emits an MQTT message on `machines/{machine_id}/payment_credit`.
4. The ESP32 receives the credit event and unlocks the touchscreen volume selection.

---

## 3. Pricing & Volume Tiers
- **0.5 L (500 ml)**: ฿1.00 / ₱2.00 / $0.05
- **0.75 L (750 ml)**: ฿1.50 / ₱3.00 / $0.08
- **1.0 L (1000 ml)**: ฿2.00 / ₱4.00 / $0.10

*(Prices are configurable remotely from the admin dashboard via MQTT config push).*

