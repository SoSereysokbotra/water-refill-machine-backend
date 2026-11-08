# STM32 QR Payment Integration (UART)

> For the **hardware developer**: how the STM32 gets a KHQR, shows it on the LCD, and knows when to dispense.
> The STM32 **never talks to the internet**. It talks **UART to the ESP32**, and the ESP32 does MQTT and the backend does ABA.
> Exact message list: Implementation Plan **§C3**; fault codes **§C8**.

## 1. Key Idea

```text
STM32  ──UART──▶  ESP32  ──MQTT──▶  Backend  ──HTTPS──▶  ABA PayWay
 shows QR          gateway           makes the payment      creates the KHQR
 dispenses         (no logic)        confirms "paid"
```

- The backend sends the **QR text** (about 240 characters), never an image. The STM32 turns the text into a QR on the LCD.
- The STM32 dispenses **only** after `PAID,<tran_id>` for the QR it is showing.

---

## 2. End-to-End Flow (STM32 view)

```text
1. Customer presses 500 mL        → STM32 sends   REQ_PAY,500
2. Wait for the QR (show "Please wait")
3. ESP32 sends                     QR,<tran_id>,<amount>,<currency>,<seconds>,<qr_text>
   → draw the QR, show amount and a countdown from <seconds>
4. ESP32 sends                     PAID,<tran_id>
   → tran_id matches the QR shown? reply PAID,ACK,<tran_id>  → "Place your bottle"
     otherwise                     reply PAID,REJECT,<tran_id>,PAID_NOT_ACCEPTED
5. Fill the bottle (two-stage)
6. Send                            DONE,<tran_id>,<flow_ml>,<weight_g>
   (or PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault> if stopped early)
   → save the result in flash, resend every 2 s until the ESP32 replies ACK,<tran_id>
7. Back to Welcome

Other endings while the QR is shown:
   EXPIRED,<tran_id> / FAILED,<tran_id> / CANCELLED,<tran_id>  → back to Welcome
   FAILED,0                                                     → "Service unavailable"
   Customer presses Cancel → send CANCEL,<tran_id> (or CANCEL before the QR arrives)
```

---

## 3. UART Messages Used for Payment

115200 baud, 8N1, one line per message ending with `\n`.

| Message | Direction | When |
|---|---|---|
| `REQ_PAY,<500\|750\|1000>` | STM32 → ESP32 | Volume button pressed |
| `CANCEL` / `CANCEL,<tran_id>` | STM32 → ESP32 | Cancel pressed |
| `QR,<tran_id>,<amount>,<currency>,<seconds>,<qr_text>` | ESP32 → STM32 | Show the QR |
| `PAID,<tran_id>` | ESP32 → STM32 | Payment confirmed (repeated every 2 s until acknowledged) |
| `PAID,ACK,<tran_id>` / `PAID,REJECT,<tran_id>,<fault>` | STM32 → ESP32 | Accept / refuse the payment |
| `EXPIRED,<tran_id>` / `FAILED,<tran_id\|0>` / `CANCELLED,<tran_id>` | ESP32 → STM32 | Go back to Welcome |
| `DONE,<tran_id>,<flow_ml>,<weight_g>` | STM32 → ESP32 | Fill finished |
| `PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>` | STM32 → ESP32 | Fill stopped early |
| `ACK,<tran_id>` | ESP32 → STM32 | Result saved; you may forget it |
| `NET,OK` / `NET,DOWN` | ESP32 → STM32 | Show or hide "Offline" |
| `PING` → `PONG,<state>,<tran_id\|0>,<tank>,<fault>` | both | Every 5 s |

Example lines:
```text
REQ_PAY,500
QR,m3k9x2a1123456,0.15,USD,178,00020101021230510016abaakhppxxx@abaa01151234567890...6304A1B2
PAID,m3k9x2a1123456
PAID,ACK,m3k9x2a1123456
DONE,m3k9x2a1123456,498,501
ACK,m3k9x2a1123456
PONG,IDLE,0,FULL,NONE
```

---

## 4. STM32 Implementation

### 4.1 Receive lines (interrupt + ring buffer)

```c
#define LINE_MAX 512                 /* QR line is ~300 chars */
static char line[LINE_MAX];
static uint16_t len = 0;

/* call for every received byte (from the UART RX interrupt / DMA ring buffer) */
void link_on_byte(char c) {
    if (c == '\r') return;
    if (c == '\n') { line[len] = '\0'; link_handle_line(line); len = 0; return; }
    if (len < LINE_MAX - 1) line[len++] = c;
    else len = 0;                    /* too long: drop the line */
}
```

### 4.2 Parse the QR line

`qr_text` is **always the last field** and may contain commas. Split only the first 5 commas and take the rest as the QR text.

```c
/* QR,<tran_id>,<amount>,<currency>,<seconds>,<qr_text> */
static int parse_qr(char *s, char **tran, char **amount, char **cur, int *secs, char **qr) {
    char *f[5];
    s += 3;                                   /* skip "QR," */
    for (int i = 0; i < 4; i++) {             /* tran, amount, currency, seconds */
        f[i] = s;
        s = strchr(s, ',');
        if (!s) return 0;
        *s++ = '\0';
    }
    *tran = f[0]; *amount = f[1]; *cur = f[2]; *secs = atoi(f[3]);
    *qr = s;                                  /* everything left = QR text */
    return **qr != '\0';
}
```

### 4.3 Draw the QR on the LCD

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

`LCD_FillRect` and `LCD_ShowString` are placeholders. Rename them to your ILI9341 driver's functions.

| Item | Value |
|---|---|
| KHQR length | ~240 characters |
| QR version | ~10 at ECC LOW → 57 × 57 modules |
| Scale on 320×240 | 3 px/module → ~195 px square including border |
| RAM | 2 × ~400 bytes (`static`, not on the stack) |

Keep the **white border** and **black on white**, or phones may fail to scan.

### 4.4 Payment handling (pseudo-code)

```c
void link_handle_line(char *l) {
    if (starts_with(l, "QR,") && state == WAIT_QR) {
        if (parse_qr(l, &tran, &amt, &cur, &secs, &qr)) {
            strcpy(shown_tran, tran);
            lcd_draw_qr(qr); show_amount(amt, cur); start_countdown(secs);
            state = QR;
        }
    } else if (starts_with(l, "PAID,")) {
        char *t = l + 5;
        if (state == QR && strcmp(t, shown_tran) == 0) {
            uart_printf("PAID,ACK,%s\n", t);
            state = WAIT_BOTTLE; start_bottle_timer(60);
        } else if (strcmp(t, accepted_tran) == 0) {
            uart_printf("PAID,ACK,%s\n", t);          /* repeat of an accepted payment */
        } else {
            uart_printf("PAID,REJECT,%s,PAID_NOT_ACCEPTED\n", t);
        }
    } else if (starts_with(l, "EXPIRED,") || starts_with(l, "FAILED,") || starts_with(l, "CANCELLED,")) {
        if (state == WAIT_QR || state == QR) go_welcome();
    } else if (starts_with(l, "ACK,")) {
        if (strcmp(l + 4, saved_result.tran) == 0) clear_saved_result();
    } else if (strcmp(l, "PING") == 0) {
        uart_printf("PONG,%s,%s,%s,%s\n", state_name(), current_tran_or_0(), tank_name(), fault_name());
        last_ping = now();
    } else if (strcmp(l, "NET,DOWN") == 0) { show_offline(true);
    } else if (strcmp(l, "NET,OK") == 0)   { show_offline(false); }
}
```

Safety rules (stop by itself, bottle timeout, keep result in flash) are in [state-machine-logic.md](../03-Firmware-Control/state-machine-logic.md) §4.

---

## 5. Testing Plan

| Step | What | How |
|---|---|---|
| 1 | **LCD only** | Hard-code a KHQR string, call `lcd_draw_qr()`, scan with a phone QR app. The decoded text must match exactly. |
| 2 | **UART with a PC** | USB-serial adapter on the STM32 UART. Type the lines from §3 by hand and check the STM32 replies. |
| 3 | **With the ESP32** | Wire STM32 ↔ ESP32 (TX→RX, RX→TX, GND). Backend running. Press 500 mL → QR on LCD. |
| 4 | **Real payment** | Pay the QR with the **ABA PayWay simulator app** → STM32 shows "Place your bottle" → `DONE` reaches the backend. |
| 5 | **Timeout & cancel** | Don't pay for 3 min → `EXPIRED` → Welcome. Press Cancel → Welcome. |
| 6 | **Offline** | Unplug the ESP32 → after 15 s the STM32 shows "Offline" and doesn't start payments. |
| 7 | **Result persistence** | Unplug the ESP32 during filling → STM32 finishes, keeps the result, sends it after reconnect. |

---

## 6. Current Status

| Item | Status |
|---|---|
| Backend + ABA sandbox | ✅ Working (USD, prices 0.15 / 0.20 / 0.25, QR lifetime 3 min) |
| ESP32 gateway v0.2.0 | ✅ Working: `REQ_PAY`, `QR`, `PAID`, `EXPIRED`, `FAILED`, `DONE`, `ERR`, `NET`, `PING` |
| ESP32 support for `PAID,ACK`, `ACK`, `CANCEL`, `PARTIAL`, `PONG,<fields>` | ⏳ Firmware v0.3/v0.4 (Phases 2–3) |
| STM32 UART + LCD QR | ⏳ Hardware developer |

**Testing with ESP32 v0.2.0 (until v0.3/v0.4):**
- v0.2.0 only understands a plain `PONG`. A full `PONG,IDLE,0,FULL,NONE` is printed as "Unknown command" and the ESP32 thinks the STM32 link is lost. Payments still work.
- v0.2.0 **never sends `ACK,<tran_id>`**. An STM32 that resends `DONE` every 2 s until ACK will repeat forever. For early tests, add a test switch in the STM32 code: send the result **once**, don't wait for ACK.
- `PAID,ACK`, `PAID,REJECT`, `CANCEL` and `PARTIAL` show "Unknown command" on the ESP32 monitor. That's harmless.

## Related
- [Implementation Plan §C3](backend-implementation-plan.md): full UART contract
- [ESP32 gateway README](../../esp32-gateway/README.md): wiring, test menu
- [State machine (STM32)](../03-Firmware-Control/state-machine-logic.md)
