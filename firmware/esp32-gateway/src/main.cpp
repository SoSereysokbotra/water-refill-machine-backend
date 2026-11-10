// ESP32 gateway for the Water Refill Machine (v0.3.0).
//
//   STM32 (machine control)  <--UART2-->  ESP32 (this)  <--MQTT/TLS-->  EMQX Cloud  <-->  Backend
//
// UART protocol (one text line per message, '\n' terminated):
//   STM32 -> ESP32 : REQ_PAY,<volume_ml> | DONE,<tran_id>,<flow_ml>,<weight_g> | ERR,<code> | PING | PONG | CANCEL
//   ESP32 -> STM32 : QR,<tran_id>,<amount>,<currency>,<expires_s>,<qr_string>
//                    PAID,<tran_id> | EXPIRED,<tran_id> | FAILED,<tran_id> | CANCELLED,<tran_id>
//                    ACK,<tran_id> | NET,OK | NET,DOWN | PING | PONG
//
// TEST MODE (USB serial monitor): a numbered menu plus the same commands the STM32 sends,
// so the whole payment flow can be tested without the STM32 board.
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "qrcodegen.h"
#include "secrets.h"
#include "ca_cert.h"

#define FW_VERSION          "0.3.0"
#define STM32_RX_PIN        16      // ESP32 RX2  <- STM32 TX
#define STM32_TX_PIN        17      // ESP32 TX2  -> STM32 RX
#define STM32_BAUD          115200
#define PRINT_QR_TO_USB     1       // draw the QR in the serial monitor (for testing)
#define HEARTBEAT_MS        60000
#define STM32_PING_MS       5000
#define STM32_TIMEOUT_MS    15000
#define MAX_LINE            600

HardwareSerial &stm32 = Serial2;
WiFiClientSecure tls;
PubSubClient mqtt(tls);

// ---------- state ----------
int netState = -1;                 // -1 unknown, 0 down, 1 up (last state sent to STM32)
unsigned long lastHeartbeat = 0, lastPing = 0, lastPong = 0, lastMqttTry = 0;
unsigned long mqttBackoff = 2000;
bool stm32Lost = false;
bool qrInvert = false;             // false = dark terminal theme, true = light theme
String currentTran, currentRequestId, lastQrString, lastStatus;
int lastVolume = 0;

// Retry policy for pay/request (Plan B4.7)
bool awaitingQr = false;
unsigned long lastReqTime = 0;
int reqRetries = 0;

// ---------- helpers ----------
String topic(const char *suffix) { return String("wrm/") + MACHINE_ID + "/" + suffix; }

String generateRequestId() {
  char buf[17];
  snprintf(buf, sizeof(buf), "%08x%08x", (uint32_t)esp_random(), (uint32_t)esp_random());
  return String(buf);
}

// Reads '\n'-terminated lines; drops terminal junk (arrow-key escape codes, \r, control chars)
// and applies Backspace/DEL, so typed commands always arrive clean.
struct LineReader {
  String buf;
  uint8_t esc = 0;   // 0 = normal, 1 = after ESC, 2 = inside "ESC [ ..."
  bool read(Stream &s, String &out) {
    while (s.available()) {
      char c = (char)s.read();
      if (esc == 1) { esc = (c == '[') ? 2 : 0; continue; }
      if (esc == 2) { if (c >= 0x40 && c <= 0x7E) esc = 0; continue; }
      if (c == 0x1B) { esc = 1; continue; }
      if (c == '\n') {
        out = buf;
        buf = "";
        out.trim();
        out.toUpperCase();
        if (out.length()) return true;
        continue;
      }
      if (c == '\b' || c == 0x7F) { if (buf.length()) buf.remove(buf.length() - 1); continue; }
      if ((uint8_t)c < 0x20) continue;
      if (buf.length() < MAX_LINE) buf += c;
    }
    return false;
  }
};
LineReader usbReader, stmReader;

void toStm32(const String &line) {
  stm32.print(line);
  stm32.print('\n');
  Serial.print("  >> STM32: ");
  Serial.println(line.length() > 90 ? line.substring(0, 90) + "..." : line);
}

void setNet(bool up) {
  if ((int)up == netState) return;
  netState = up;
  toStm32(up ? "NET,OK" : "NET,DOWN");
}

void publishJson(const char *suffix, JsonDocument &doc, bool retain = false) {
  String out;
  serializeJson(doc, out);
  bool ok = mqtt.connected() && mqtt.publish(topic(suffix).c_str(), out.c_str(), retain);
  Serial.printf("  [mqtt] %s %s %s\n", ok ? "->" : "!! NOT SENT", suffix, out.c_str());
}

void printMenu() {
  Serial.println();
  Serial.println("+--------------- TEST MENU ---------------+");
  Serial.println("|  1  Pay for 500 mL                      |");
  Serial.println("|  2  Pay for 750 mL                      |");
  Serial.println("|  3  Pay for 1000 mL                     |");
  Serial.println("|  C  Cancel current payment              |");
  Serial.println("|  D  Report dispense done (after PAID)   |");
  Serial.println("|  S  Show network & system status        |");
  Serial.println("|  Q  Reprint last QR                     |");
  Serial.println("|  I  Invert QR colours                   |");
  Serial.println("+-----------------------------------------+");
  Serial.println("Or type raw STM32 commands: REQ_PAY,500 / DONE,<tran>,<flow>,<weight> / ERR,<code>");
  Serial.println();
}

void printBanner(const String &title, const String &body) {
  int w = max(title.length(), body.length()) + 4;
  w = max(w, 36);
  String bar = ""; for (int i = 0; i < w; i++) bar += "-";
  Serial.println("\n+" + bar + "+");
  Serial.printf("|  %-*s|\n", w - 2, title.c_str());
  if (body.length()) {
    Serial.printf("|  %-*s|\n", w - 2, body.c_str());
  }
  Serial.println("+" + bar + "+\n");
}

// Draws the QR to USB Serial using Unicode half-blocks (two module rows per text row)
void printQr(const String &text) {
  if (!PRINT_QR_TO_USB || text.length() == 0) return;
  uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(10)];
  uint8_t temp[qrcodegen_BUFFER_LEN_FOR_VERSION(10)];
  bool ok = qrcodegen_encodeText(text.c_str(), temp, qr, qrcodegen_Ecc_LOW, 1, 10, qrcodegen_Mask_AUTO, true);
  if (!ok) { Serial.println("  (QR too big for display buffer)"); return; }

  int size = qrcodegen_getSize(qr);
  Serial.println();
  for (int y = -2; y < size + 2; y += 2) {
    Serial.print("  ");
    for (int x = -2; x < size + 2; x++) {
      bool top = (x >= 0 && x < size && y >= 0 && y < size) ? qrcodegen_getModule(qr, x, y) : false;
      bool bot = (x >= 0 && x < size && (y + 1) >= 0 && (y + 1) < size) ? qrcodegen_getModule(qr, x, y + 1) : false;
      if (qrInvert) { top = !top; bot = !bot; }
      if (top && bot) Serial.print("\xE2\x96\x88");
      else if (top && !bot) Serial.print("\xE2\x96\x80");
      else if (!top && bot) Serial.print("\xE2\x96\x84");
      else Serial.print(' ');
    }
    Serial.println();
  }
  Serial.println();
}

// ---------- MQTT callbacks ----------
void onMqttMessage(char *t, byte *payload, unsigned int len) {
  String tp(t);
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.printf("[mqtt] bad JSON on %s\n", t);
    return;
  }

  if (tp.endsWith("/pay/qr")) {
    String reqId = doc["request_id"].as<String>();
    if (reqId.length() && currentRequestId.length() && reqId != currentRequestId) {
      Serial.printf("  [mqtt] discarding stale/foreign QR (got %s, expected %s)\n", reqId.c_str(), currentRequestId.c_str());
      return;
    }

    awaitingQr = false;
    currentTran = doc["tran_id"].as<String>();
    lastQrString = doc["qr_string"].as<String>();
    lastStatus = "pending";

    int remainingSec = 180;
    if (!doc["expires_in_s"].isNull()) {
      remainingSec = doc["expires_in_s"].as<int>();
    } else if (!doc["expires_at"].isNull()) {
      // remaining seconds default
      remainingSec = 180;
    }

    String amount = doc["amount"].as<String>() + " " + doc["currency"].as<String>();
    toStm32("QR," + currentTran + "," + doc["amount"].as<String>() + "," + doc["currency"].as<String>() + "," +
            String(remainingSec) + "," + lastQrString);
    printQr(lastQrString);
    printBanner("SCAN TO PAY", amount + "  |  tran " + currentTran + "  |  expires in " +
                                   String(remainingSec) + " s");
  } else if (tp.endsWith("/pay/status")) {
    String status = doc["status"].as<String>();
    String tran = doc["tran_id"].isNull() ? String("0") : doc["tran_id"].as<String>();
    String reqId = doc["request_id"].isNull() ? "" : doc["request_id"].as<String>();

    if (tran == currentTran || (reqId.length() && reqId == currentRequestId)) {
      awaitingQr = false;
      lastStatus = status;
    }

    if (status == "paid") {
      toStm32("PAID," + tran);
      printBanner("PAID", "tran " + tran + "  ->  type 'd' to report dispense done");
    } else if (status == "expired") {
      toStm32("EXPIRED," + tran);
      printBanner("EXPIRED", "tran " + tran + "  ->  type 1/2/3 for a new payment");
    } else if (status == "cancelled") {
      toStm32("CANCELLED," + tran);
      printBanner("CANCELLED", "tran " + tran);
    } else if (status == "failed") {
      toStm32("FAILED," + tran);
      printBanner("FAILED", doc["reason"].isNull() ? (doc["error"].isNull() ? "tran " + tran : String(doc["error"].as<const char *>())) : String(doc["reason"].as<const char *>()));
    }
  } else if (tp.endsWith("/transaction/ack")) {
    String tran = doc["tran_id"].as<String>();
    String status = doc["status"].as<String>();
    Serial.printf("  [mqtt] transaction/ack for %s: %s\n", tran.c_str(), status.c_str());
    toStm32("ACK," + tran);
  }
}

// ---------- commands (STM32 or USB) ----------
void requestPayment(int volumeMl) {
  if (!mqtt.connected()) { toStm32("NET,DOWN"); Serial.println("  Not connected to MQTT yet - wait for NET,OK"); return; }
  lastVolume = volumeMl;
  currentRequestId = generateRequestId();
  awaitingQr = true;
  lastReqTime = millis();
  reqRetries = 0;
  lastStatus = "requesting";

  JsonDocument doc;
  doc["v"] = 1;
  doc["request_id"] = currentRequestId;
  doc["volume_ml"] = volumeMl;
  publishJson("pay/request", doc);
  Serial.printf("  [req] Waiting for QR (request_id=%s)...\n", currentRequestId.c_str());
}

void cancelPayment() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["v"] = 1;
  if (currentTran.length()) doc["tran_id"] = currentTran;
  if (currentRequestId.length()) doc["request_id"] = currentRequestId;
  doc["reason"] = "USER_CANCELLED";
  publishJson("pay/cancel", doc);

  awaitingQr = false;
  currentTran = "";
  currentRequestId = "";
  lastStatus = "cancelled";
  toStm32("CANCELLED,OK");
  Serial.println("  Payment cancelled locally and cancel sent to backend");
}

void handleLine(String line, bool fromUsb) {
  // USB shortcuts (test menu)
  if (fromUsb) {
    if (line == "1") line = "REQ_PAY,500";
    else if (line == "2") line = "REQ_PAY,750";
    else if (line == "3") line = "REQ_PAY,1000";
    else if (line == "C" || line == "CANCEL") line = "CANCEL";
    else if (line == "H" || line == "HELP" || line == "?") { printMenu(); return; }
    else if (line == "I") {
      qrInvert = !qrInvert;
      Serial.printf("  QR colours: %s terminal theme\n", qrInvert ? "LIGHT" : "DARK");
      if (lastQrString.length()) printQr(lastQrString);
      return;
    } else if (line == "Q") {
      if (lastQrString.length()) printQr(lastQrString); else Serial.println("  No QR yet - type 1, 2 or 3");
      return;
    } else if (line == "S" || line == "STATUS") {
      Serial.printf("  wifi=%s (rssi %d)  mqtt=%s  stm32=%s  tran=%s (%s)  fw=%s\n",
                    WiFi.isConnected() ? "up" : "DOWN", WiFi.RSSI(), mqtt.connected() ? "up" : "DOWN",
                    stm32Lost ? "not connected" : "ok", currentTran.length() ? currentTran.c_str() : "-",
                    lastStatus.length() ? lastStatus.c_str() : "-", FW_VERSION);
      return;
    } else if (line == "D") {
      if (lastStatus != "paid") { Serial.println("  Nothing to report - wait for PAID first"); return; }
      line = "DONE," + currentTran + "," + String(lastVolume - 2) + "," + String(lastVolume + 1);
    }
  }

  Serial.printf("  << %s: %s\n", fromUsb ? "you" : "STM32", line.c_str());

  if (line == "PING") { toStm32("PONG"); return; }
  if (line == "PONG") { lastPong = millis(); stm32Lost = false; return; }

  int c1 = line.indexOf(',');
  String cmd = c1 < 0 ? line : line.substring(0, c1);
  String rest = c1 < 0 ? "" : line.substring(c1 + 1);

  if (cmd == "REQ_PAY") {
    requestPayment(rest.toInt());
  } else if (cmd == "CANCEL" || cmd == "REQ_CANCEL") {
    cancelPayment();
  } else if (cmd == "DONE") {
    int a = rest.indexOf(','), b = rest.indexOf(',', a + 1);
    JsonDocument doc;
    doc["v"] = 1;
    doc["tran_id"] = rest.substring(0, a);
    doc["result"] = "ok";
    doc["flow_ml"] = rest.substring(a + 1, b).toInt();
    doc["weight_g"] = rest.substring(b + 1).toInt();
    doc["ts"] = (unsigned long)time(nullptr);
    publishJson("transaction", doc);
    if (fromUsb) lastStatus = "done";
  } else if (cmd == "ERR") {
    JsonDocument doc;
    doc["v"] = 1;
    doc["fault"] = rest;
    if (currentTran.length()) doc["tran_id"] = currentTran;
    doc["ts"] = (unsigned long)time(nullptr);
    publishJson("error", doc);
  } else {
    Serial.println("  Unknown command - type h for the menu");
  }
}

// ---------- connectivity ----------
void syncTime() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.print("[time] syncing");
  for (int i = 0; i < 20 && time(nullptr) < 1700000000; i++) { delay(500); Serial.print('.'); }
  Serial.println(time(nullptr) >= 1700000000 ? " ok" : " failed (TLS may fail)");
}

void ensureWifi() {
  static bool timeSynced = false;
  if (WiFi.isConnected()) {
    if (!timeSynced) {
      timeSynced = true;
      Serial.printf("[wifi] connected, IP %s\n", WiFi.localIP().toString().c_str());
      syncTime();
    }
    return;
  }
  timeSynced = false;
  setNet(false);
}

void ensureMqtt() {
  if (!WiFi.isConnected() || mqtt.connected()) return;
  if (millis() - lastMqttTry < mqttBackoff) return;
  lastMqttTry = millis();

  Serial.printf("[mqtt] connecting to %s:%d ...\n", MQTT_HOST, MQTT_PORT);
  String willTopic = topic("online");
  bool ok = mqtt.connect(MACHINE_ID, MQTT_USERNAME, MQTT_PASSWORD, willTopic.c_str(), 1, true, "0", false);
  if (!ok) {
    Serial.printf("[mqtt] failed, state=%d (retry in %lus)\n", mqtt.state(), mqttBackoff / 1000);
    mqttBackoff = min(mqttBackoff * 2, 30000UL);
    setNet(false);
    return;
  }
  mqttBackoff = 2000;
  mqtt.publish(willTopic.c_str(), "1", true);
  mqtt.subscribe(topic("pay/qr").c_str(), 1);
  mqtt.subscribe(topic("pay/status").c_str(), 1);
  mqtt.subscribe(topic("transaction/ack").c_str(), 1);
  Serial.println("[mqtt] connected");
  setNet(true);
  static bool menuShown = false;
  if (!menuShown) { menuShown = true; printMenu(); }
}

// ---------- main ----------
void setup() {
  Serial.begin(115200);
  stm32.begin(STM32_BAUD, SERIAL_8N1, STM32_RX_PIN, STM32_TX_PIN);
  delay(300);
  Serial.printf("\n=== Water Refill ESP32 gateway v%s | machine %s ===\n", FW_VERSION, MACHINE_ID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  tls.setCACert(CA_CERT);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(1024);   // pay/qr messages are ~400 bytes
  mqtt.setKeepAlive(30);
  mqtt.setCallback(onMqttMessage);
  lastPong = millis();
}

void loop() {
  ensureWifi();
  ensureMqtt();
  mqtt.loop();

  String line;
  if (stmReader.read(stm32, line)) handleLine(line, false);
  if (usbReader.read(Serial, line)) handleLine(line, true);

  unsigned long now = millis();

  // Retry policy for pay/request (B4.7)
  if (awaitingQr && (now - lastReqTime > 5000)) {
    if (reqRetries < 3) {
      reqRetries++;
      lastReqTime = now;
      JsonDocument doc;
      doc["v"] = 1;
      doc["request_id"] = currentRequestId;
      doc["volume_ml"] = lastVolume;
      publishJson("pay/request", doc);
      Serial.printf("  [req] retry %d/3 for request_id=%s\n", reqRetries, currentRequestId.c_str());
    } else {
      awaitingQr = false;
      lastStatus = "failed";
      toStm32("FAILED,TIMEOUT");
      Serial.println("  [req] pay/request timed out after 3 retries");
    }
  }

  if (now - lastPing > STM32_PING_MS) { lastPing = now; stm32.print("PING\n"); }
  if (!stm32Lost && now - lastPong > STM32_TIMEOUT_MS) {
    stm32Lost = true;
    Serial.println("[uart] STM32 not answering (normal until it is wired up)");
  }

  if (mqtt.connected() && now - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = now;
    JsonDocument doc;
    doc["fw"] = FW_VERSION;
    doc["uptime_s"] = now / 1000;
    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();
    doc["stm32"] = stm32Lost ? "lost" : "ok";
    String out;
    serializeJson(doc, out);
    mqtt.publish(topic("heartbeat").c_str(), out.c_str());
  }
}
