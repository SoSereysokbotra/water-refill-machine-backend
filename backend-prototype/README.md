# Water Refill Machine — Backend (ABA PayWay KHQR)

Small Node.js server that creates **ABA PayWay KHQR** payments for the machine and tells it when the customer has paid.

- **mock mode** — fake QR + "Simulate payment" button. No ABA account needed. Use this to test the QR on the LCD.
- **sandbox mode** — real ABA PayWay sandbox (scan with the ABA sandbox app).

## Run it

```bash
cd backend-prototype
npm install
cp .env.example .env      # then edit .env (DEVICE_API_KEY, prices, PAYWAY_MODE)
npm run dev               # http://localhost:3000
```

Open **http://localhost:3000/dev** in a browser: shows every QR created, its status, and (mock mode) a **Simulate payment** button.

The ESP32 must reach your PC: use your PC's LAN IP (e.g. `http://192.168.1.20:3000`, find it with `ipconfig`) with both on the same Wi-Fi, and allow Node.js through Windows Firewall. Over 4G (SIM7600) the server needs a public URL (deploy it, or use a tunnel such as ngrok for testing).

### Switch to the real ABA sandbox

1. Register: https://sandbox.payway.com.kh/register-sandbox/ — ABA emails a **merchant ID** and **API key**.
2. In `.env`: `PAYWAY_MODE=sandbox`, `PAYWAY_MERCHANT_ID=...`, `PAYWAY_API_KEY=...`
3. Restart. The device code does not change.

Payment confirmation uses **polling** (Check Transaction API) by default. A PayWay callback (`PAYWAY_CALLBACK_URL` → `POST /api/payment/callback`) only works on a public HTTPS URL whitelisted by ABA.

## API for the machine (hardware side)

All machine requests send header `X-API-Key: <DEVICE_API_KEY>`.

### 1. Create payment → get QR
`POST /api/payment/create`
```json
{ "machine_id": "WRM-001", "volume_ml": 750 }
```
`201 Created`
```json
{
  "tran_id": "1793716097165480",
  "status": "pending",
  "volume_ml": 750,
  "amount": 700,
  "currency": "KHR",
  "expires_at": "2026-11-03T14:31:17.165Z",
  "expires_in_s": 180,
  "qr_string": "000201010212..."
}
```
**Render `qr_string` as a QR code on the TFT.** It is plain text (~150–250 chars for a real KHQR). The device does not download an image.

### 2. Poll status
`GET /api/payment/status/{tran_id}` — every 2–3 s
```json
{ "tran_id": "1793716097165480", "status": "pending", "expires_in_s": 142, ... }
```
`status`: `pending` → keep showing QR · `paid` → go to "place bottle" · `expired` / `failed` → back to idle.

Errors: `401` wrong/missing key · `400` bad `volume_ml` (must be 500, 750, 1000) · `404` unknown `tran_id` · `502` PayWay rejected the request (see `error`).

## ESP32 test sketch (Arduino / PlatformIO)

Libraries: `bodmer/TFT_eSPI`, `ricmoo/QRCode`, `bblanchon/ArduinoJson@^7`.

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <qrcode.h>

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-pass";
const char* API_BASE  = "http://192.168.1.20:3000";   // PC running the backend
const char* API_KEY   = "change-me";                   // same as DEVICE_API_KEY

TFT_eSPI tft;
String tranId;

void drawQR(const String& text) {
  static uint8_t buf[qrcode_getBufferSize(15)];
  QRCode qr;
  int v = 5;                                   // pick the smallest version that fits
  while (v <= 15 && qrcode_initText(&qr, buf, v, ECC_LOW, text.c_str()) != 0) v++;
  if (v > 15) { tft.drawString("QR too long", 10, 10); return; }

  int scale = min(220 / (qr.size + 8), 6);     // keep quiet zone, fit in 240 px height
  int size  = (qr.size + 8) * scale;
  int x0 = (tft.width() - size) / 2, y0 = (tft.height() - size) / 2;
  tft.fillRect(x0, y0, size, size, TFT_WHITE);
  for (int y = 0; y < qr.size; y++)
    for (int x = 0; x < qr.size; x++)
      if (qrcode_getModule(&qr, x, y))
        tft.fillRect(x0 + (x + 4) * scale, y0 + (y + 4) * scale, scale, scale, TFT_BLACK);
}

bool createPayment(int volumeMl) {
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/payment/create");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int code = http.POST("{\"machine_id\":\"WRM-001\",\"volume_ml\":" + String(volumeMl) + "}");
  if (code != 201) { Serial.printf("create failed %d\n", code); http.end(); return false; }
  JsonDocument doc;
  deserializeJson(doc, http.getString());
  http.end();
  tranId = doc["tran_id"].as<String>();
  drawQR(doc["qr_string"].as<String>());
  return true;
}

String pollStatus() {
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/payment/status/" + tranId);
  http.addHeader("X-API-Key", API_KEY);
  String status = "error";
  if (http.GET() == 200) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    status = doc["status"].as<String>();
  }
  http.end();
  return status;
}

void setup() {
  Serial.begin(115200);
  tft.init(); tft.setRotation(1); tft.fillScreen(TFT_BLACK);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  createPayment(750);
}

void loop() {
  if (tranId.isEmpty()) return;
  String s = pollStatus();
  Serial.println(s);
  if (s == "paid")    { tft.fillScreen(TFT_GREEN); tft.drawString("PAID - place bottle", 20, 110); tranId = ""; }
  if (s == "expired" || s == "failed") { tft.fillScreen(TFT_RED); tranId = ""; }
  delay(2500);
}
```

Test loop: flash → QR appears on the LCD → open `/dev` on the PC → click **Simulate payment** → LCD turns green.

## Not done yet
- Data is kept in memory (lost on restart). PostgreSQL comes later with transactions/alerts.
- `POST /api/transaction`, heartbeat and alert endpoints (see `docs/04-Cloud-and-Payment/api-and-database.md`).
