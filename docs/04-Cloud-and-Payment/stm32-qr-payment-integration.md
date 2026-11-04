# STM32 ↔ Backend: QR Payment Integration

> How the backend creates an ABA PayWay KHQR, sends it to the STM32 over 4G (SIM7600), and how the STM32 draws it on the 2.8" LCD and detects payment.

| | |
|---|---|
| **Backend owner** | Backend (Node.js server in `backend/`) |
| **Device owner** | Hardware (STM32 + SIM7600 + ILI9341 LCD, Keil) |
| **Payment provider** | ABA PayWay — KHQR (sandbox for now) |
| **Status** | Backend done and tested against ABA sandbox. Device side to implement. |

---

## 1. Key idea

**The backend never sends an image.** It sends a line of **text** (`qr_string`, ~240 characters). The STM32 turns that text into a QR pattern with a small C library and draws black squares on the LCD.

Any QR encoder produces the same scannable code from the same text, so nothing image-related travels over 4G.

---

## 2. End-to-end flow

```text
 STM32 + LCD            SIM7600 (4G)          Backend (Node.js)             ABA PayWay
 ───────────            ────────────          ─────────────────             ──────────
 1. User picks volume
 2. POST /api/payment/create ─────────────────▶ 3. Make tran_id + price
                                                4. Call ABA generate-qr ──────▶
                                                                          5. Create KHQR
                                                ◀──────── qrString (text) ──
 7. Receive JSON ◀───────────────────────────── 6. Reply with qr_string
 8. Text → QR matrix (C library)
 9. Draw squares on LCD
10. Customer scans with ABA app and pays ──────────────────────────────────────▶
11. Every 2–3 s: GET /api/payment/status/{tran_id} ▶ 12. Ask ABA check-transaction ▶
                                                ◀──────────────── APPROVED ──
13. "status":"paid" ◀────────────────────────── 14. Reply paid
15. LCD: "Place your bottle" → dispense
```

---

## 3. What the backend gives the device

Both teammates must use the same values:

| Item | Example | Who provides |
|---|---|---|
| Server base URL | `https://<public-server>` (testing: ngrok URL) | Backend |
| Device API key | `wrm-dev-2026` | Backend (`DEVICE_API_KEY` in `backend/.env`) |
| Machine ID | `WRM-001` | Agreed together |

> The STM32 reaches the server through 4G, so it **cannot** use `localhost` or a PC's LAN IP. The backend must have a public URL (cloud server, or ngrok tunnel during testing).

---

## 4. API contract

All device requests send the header `X-API-Key: <device key>`.

### 4.1 Create payment → get QR text

**Request**
```http
POST /api/payment/create
X-API-Key: wrm-dev-2026
Content-Type: application/json

{"machine_id":"WRM-001","volume_ml":500}
```

`volume_ml` must be `500`, `750` or `1000`.

**Response — `201 Created`**
```json
{
  "tran_id": "1793716844389942",
  "status": "pending",
  "machine_id": "WRM-001",
  "volume_ml": 500,
  "amount": 0.15,
  "currency": "USD",
  "expires_at": "2026-11-03T14:43:44.389Z",
  "expires_in_s": 180,
  "paid_at": null,
  "qr_string": "00020101021230510016abaakhppxxx@abaa0115...6304ABCD"
}
```

### 4.2 Check payment status (poll every 2–3 s)

**Request**
```http
GET /api/payment/status/1793716844389942
X-API-Key: wrm-dev-2026
```

**Response — `200 OK`** (same fields, without `qr_string`)
```json
{ "tran_id": "1793716844389942", "status": "paid", "expires_in_s": 142, "amount": 0.15, "currency": "USD", ... }
```

### 4.3 Fields the STM32 uses

| Field | Use on the device |
|---|---|
| `qr_string` | **Encode as QR and draw on LCD** (plain text, ~240 chars) |
| `tran_id` | Store it; used in the status URL (max 20 chars) |
| `amount`, `currency` | Show under the QR, e.g. `0.15 USD` |
| `expires_in_s` | Countdown on screen |
| `status` | Decide what to do next (below) |

### 4.4 Status values

| `status` | Device action |
|---|---|
| `pending` | Keep showing the QR, keep polling |
| `paid` | Clear QR → "Place your bottle" → dispense |
| `expired` | QR timed out (3 min) → back to welcome screen |
| `failed` | Payment declined/cancelled → back to welcome screen |

### 4.5 Errors

| HTTP code | Meaning | Device action |
|---|---|---|
| `401` | Wrong or missing `X-API-Key` | Check key in firmware |
| `400` | Bad `volume_ml` or missing `machine_id` | Firmware bug |
| `404` | Unknown `tran_id` (e.g. server restarted) | Start over |
| `502` | ABA rejected the request | Show "Payment unavailable", retry later |
| no reply | 4G / server down | Retry 3×, then show "Offline" |

---

## 5. STM32 implementation

### 5.1 Send the request through the SIM7600 (UART AT commands)

**Create payment (POST):**
```text
AT+HTTPINIT
AT+HTTPPARA="URL","https://<server>/api/payment/create"
AT+HTTPPARA="CONTENT","application/json"
AT+HTTPPARA="USERDATA","X-API-Key: wrm-dev-2026"
AT+HTTPDATA=41,10000          → wait for "DOWNLOAD", then send the body:
{"machine_id":"WRM-001","volume_ml":500}
AT+HTTPACTION=1               → wait for "+HTTPACTION: 1,201,<len>"
AT+HTTPREAD=0,<len>           → JSON reply arrives on UART
AT+HTTPTERM
```

**Check status (GET):**
```text
AT+HTTPINIT
AT+HTTPPARA="URL","https://<server>/api/payment/status/<tran_id>"
AT+HTTPPARA="USERDATA","X-API-Key: wrm-dev-2026"
AT+HTTPACTION=0               → wait for "+HTTPACTION: 0,200,<len>"
AT+HTTPREAD=0,<len>
AT+HTTPTERM
```

> `AT+HTTPDATA` length must equal the exact body length in bytes (`41` for the example body). Check the SIM7600 AT manual for the exact HTTPS setup of your module/firmware.

### 5.2 Extract values from the JSON (no parser needed)

```c
#include <stdio.h>
#include <string.h>

/* Copy the value of "key":"value" from json into out. Returns 1 if found. */
int json_get_str(const char *json, const char *key, char *out, int out_size) {
    char pattern[40];
    snprintf(pattern, sizeof pattern, "\"%s\":\"", key);
    const char *start = strstr(json, pattern);
    if (!start) return 0;
    start += strlen(pattern);
    const char *end = strchr(start, '"');
    if (!end || end - start >= out_size) return 0;
    memcpy(out, start, end - start);
    out[end - start] = '\0';
    return 1;
}

char qr_text[300], tran_id[24], status[16];

json_get_str(http_reply, "qr_string", qr_text, sizeof qr_text);
json_get_str(http_reply, "tran_id",  tran_id, sizeof tran_id);
json_get_str(http_reply, "status",   status,  sizeof status);
```

Numbers (`amount`, `expires_in_s`) are not in quotes; read them with `strstr` + `atof`/`atoi`, or use a small parser such as **jsmn** or **cJSON**.

### 5.3 Turn the text into a QR and draw it

Library: **[nayuki QR-Code-generator](https://github.com/nayuki/QR-Code-generator)** (C version). Add `qrcodegen.c` and `qrcodegen.h` to the Keil project.

```c
#include "qrcodegen.h"

void lcd_draw_qr(const char *text) {
    static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(12)];
    static uint8_t tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(12)];

    if (!qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_LOW,
                              1, 12, qrcodegen_Mask_AUTO, true)) {
        LCD_ShowString(10, 10, "QR error");
        return;
    }

    int size  = qrcodegen_getSize(qr);          /* ~57 modules for a KHQR */
    int scale = 220 / (size + 8);               /* fit in 240 px height   */
    int px    = (size + 8) * scale;             /* + 4-module white border each side */
    int x0 = (320 - px) / 2, y0 = (240 - px) / 2;

    LCD_FillRect(x0, y0, px, px, WHITE);        /* white background + quiet zone */
    for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
            if (qrcodegen_getModule(qr, x, y))
                LCD_FillRect(x0 + (x + 4) * scale, y0 + (y + 4) * scale,
                             scale, scale, BLACK);
}
```

`LCD_FillRect` / `LCD_ShowString` are placeholders — rename them to the functions of your ILI9341 driver.

**Sizing notes**

| Item | Value |
|---|---|
| KHQR length | ~240 characters |
| QR version needed | ~10 at ECC LOW → 57 × 57 modules |
| Scale on 320×240 LCD | 3 px/module → ~195 px square incl. border |
| RAM for buffers | 2 × ~400 bytes (`static`, not on the stack) |

Keep the **white border (quiet zone)** and black-on-white colours, or phones may fail to scan.

### 5.4 Payment loop (pseudo-code)

```c
void payment_screen(int volume_ml) {
    char reply[1024];

    if (!http_post_create(volume_ml, reply, sizeof reply)) { show_offline(); return; }
    json_get_str(reply, "qr_string", qr_text, sizeof qr_text);
    json_get_str(reply, "tran_id",  tran_id, sizeof tran_id);

    lcd_draw_qr(qr_text);
    lcd_show_amount_and_timer(reply);

    for (;;) {
        HAL_Delay(2500);
        if (!http_get_status(tran_id, reply, sizeof reply)) continue;   /* retry */
        json_get_str(reply, "status", status, sizeof status);

        if (strcmp(status, "paid") == 0)    { lcd_show("Place your bottle"); start_dispense(volume_ml); return; }
        if (strcmp(status, "expired") == 0 ||
            strcmp(status, "failed")  == 0) { lcd_show("Payment cancelled"); return; }
        /* "pending": update countdown and keep waiting */
    }
}
```

---

## 6. Testing plan

| Step | What | How |
|---|---|---|
| 1 | **LCD only** | Hard-code a KHQR string in firmware, call `lcd_draw_qr()`. Scan with a phone camera / QR reader app — the decoded text must match exactly. |
| 2 | **4G + backend, mock mode** | Backend `PAYWAY_MODE=mock`. STM32 calls the public URL, draws the QR. Backend person opens `/dev` and clicks **Simulate payment** → STM32 must show "Place your bottle". |
| 3 | **Real ABA sandbox** | Backend `PAYWAY_MODE=sandbox`. Pay the QR with the **ABA PayWay Simulator app** (requested from ABA Integration Team). STM32 must detect `paid`. |
| 4 | **Timeout** | Don't pay for 3 min → status `expired` → back to welcome screen. |
| 5 | **Offline** | Unplug antenna during polling → retries, then "Offline", no dispensing. |

---

## 7. Current backend settings (sandbox)

| Setting | Value | Note |
|---|---|---|
| Currency | USD | Sandbox profile rejects KHR (error 12) until ABA enables it |
| Prices | 500 mL = 0.15 · 750 mL = 0.20 · 1000 mL = 0.25 | Placeholders — final prices TBD |
| QR lifetime | 3 minutes | PayWay minimum |
| Payment detection | Backend polls ABA `check-transaction-2` | No callback URL needed |

---

## 8. Open items

- [ ] Backend: deploy to a public URL (or ngrok) so the SIM7600 can reach it
- [ ] Backend: change `DEVICE_API_KEY` from `change-me` and share it with the hardware member
- [ ] Both: confirm final prices and currency (KHR needs ABA approval)
- [ ] Backend: receive ABA Simulator app + test account from `digitalsupport@ababank.com`
- [ ] Hardware: SIM7600 HTTPS POST/GET working on STM32
- [ ] Hardware: `lcd_draw_qr()` verified by scanning
- [ ] Both: end-to-end test (Section 6, steps 2–5)

---

## Related

- **API Design** — full backend API
- **QR Payment Module** — original firmware design (ESP32 version)
- **SIM7600 4G Network Module** — AT command details
- `backend/README.md` — how to run the backend
