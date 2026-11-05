// ESP32 gateway for the Water Refill Machine.
//
//   STM32 (machine control)  <--UART2-->  ESP32 (this)  <--MQTT/TLS-->  EMQX Cloud  <-->  Backend
//
// UART protocol (one text line per message, '\n' terminated):
//   STM32 -> ESP32 : REQ_PAY,<volume_ml> | DONE,<tran_id>,<flow_ml>,<weight_g> | ERR,<code> | PING | PONG
//   ESP32 -> STM32 : QR,<tran_id>,<amount>,<currency>,<expires_s>,<qr_string>
//                    PAID,<tran_id> | EXPIRED,<tran_id> | FAILED,<tran_id> | NET,OK | NET,DOWN | PING | PONG
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

#define FW_VERSION          "0.2.0"
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
String currentTran, lastQrString, lastStatus;
int lastVolume = 0;

// ---------- helpers ----------
String topic(const char *suffix) { return String("wrm/") + MACHINE_ID + "/" + suffix; }

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
  Serial.println("|  q  Show the last QR again              |");
  Serial.println("|  d  Report dispense done (after PAID)   |");
  Serial.println("|  i  Invert QR colours (light/dark theme)|");
  Serial.println("|  s  Status                              |");
  Serial.println("|  h  Show this menu                      |");
  Serial.println("+-----------------------------------------+");
  Serial.println("Type a key and press Enter. Full STM32 commands also work (REQ_PAY,500).");
}

// Compact QR for the serial monitor: each character = 1 column x 2 rows of modules,
// using half blocks (top half, bottom half, full block). About 61 x 31 characters for a KHQR.
void printQr(const String &text) {
#if PRINT_QR_TO_USB
  static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(15)];
  static uint8_t tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(15)];
  if (!qrcodegen_encodeText(text.c_str(), tmp, qr, qrcodegen_Ecc_LOW, 1, 15, qrcodegen_Mask_AUTO, true)) {
    Serial.println("[qr] text too long to encode");
    return;
  }
  const int size = qrcodegen_getSize(qr), quiet = 2;
  Serial.println();
  for (int y = -quiet; y < size + quiet; y += 2) {
    String row;
    row.reserve((size + 2 * quiet) * 3 + 2);
    for (int x = -quiet; x < size + quiet; x++) {
      // "ink" = what the terminal draws in its text colour.
      // Dark theme: text is light -> draw the LIGHT modules. Light theme: draw the DARK modules.
      bool top = qrcodegen_getModule(qr, x, y) == qrInvert;
      bool bot = qrcodegen_getModule(qr, x, y + 1) == qrInvert;
      if (top && bot) row += "\xE2\x96\x88";       // full block
      else if (top) row += "\xE2\x96\x80";         // upper half
      else if (bot) row += "\xE2\x96\x84";         // lower half
      else row += ' ';
    }
    Serial.println(row);
  }
  Serial.println("Scan with the ABA app. Not scanning? type 'i' (invert) or open the backend /dev page.");
#endif
}

void printBanner(const char *title, const String &detail) {
  Serial.println();
  Serial.println("==========================================");
  Serial.printf("  %s  %s\n", title, detail.c_str());
  Serial.println("==========================================");
}

// ---------- MQTT -> STM32 ----------
void onMqttMessage(char *t, byte *payload, unsigned int len) {
  String tp(t);
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.printf("[mqtt] bad JSON on %s\n", t);
    return;
  }

  if (tp.endsWith("/pay/qr")) {
    currentTran = doc["tran_id"].as<String>();
    lastQrString = doc["qr_string"].as<String>();
    lastStatus = "pending";
    String amount = doc["amount"].as<String>() + " " + doc["currency"].as<String>();
    toStm32("QR," + currentTran + "," + doc["amount"].as<String>() + "," + doc["currency"].as<String>() + "," +
            doc["expires_in_s"].as<String>() + "," + lastQrString);
    printQr(lastQrString);
    printBanner("SCAN TO PAY", amount + "  |  tran " + currentTran + "  |  expires in " +
                                   doc["expires_in_s"].as<String>() + " s");
  } else if (tp.endsWith("/pay/status")) {
    String status = doc["status"].as<String>();
    String tran = doc["tran_id"].isNull() ? String("0") : doc["tran_id"].as<String>();
    if (tran == currentTran) lastStatus = status;
    if (status == "paid") {
      toStm32("PAID," + tran);
      printBanner("PAID", "tran " + tran + "  ->  type 'd' to report dispense done");
    } else if (status == "expired") {
      toStm32("EXPIRED," + tran);
      printBanner("EXPIRED", "tran " + tran + "  ->  type 1/2/3 for a new payment");
    } else if (status == "failed") {
      toStm32("FAILED," + tran);
      printBanner("FAILED", doc["error"].isNull() ? "tran " + tran : String(doc["error"].as<const char *>()));
    }
  }
}

// ---------- commands (STM32 or USB) ----------
void requestPayment(int volumeMl) {
  if (!mqtt.connected()) { toStm32("NET,DOWN"); Serial.println("  Not connected to MQTT yet - wait for NET,OK"); return; }
  lastVolume = volumeMl;
  JsonDocument doc;
  doc["volume_ml"] = volumeMl;
  publishJson("pay/request", doc);
  Serial.println("  Waiting for QR...");
}

void handleLine(String line, bool fromUsb) {
  // USB shortcuts (test menu)
  if (fromUsb) {
    if (line == "1") line = "REQ_PAY,500";
    else if (line == "2") line = "REQ_PAY,750";
    else if (line == "3") line = "REQ_PAY,1000";
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
  } else if (cmd == "DONE") {
    int a = rest.indexOf(','), b = rest.indexOf(',', a + 1);
    JsonDocument doc;
    doc["tran_id"] = rest.substring(0, a);
    doc["flow_ml"] = rest.substring(a + 1, b).toInt();
    doc["weight_g"] = rest.substring(b + 1).toInt();
    doc["status"] = "ok";
    publishJson("transaction", doc);
    if (fromUsb) lastStatus = "done";
  } else if (cmd == "ERR") {
    JsonDocument doc;
    doc["code"] = rest;
    doc["tran_id"] = currentTran;
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
  // cleanSession=false: QoS1 messages (e.g. PAID) sent while we were offline are delivered on reconnect
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
    mqtt.publish(topic("heartbeat").c_str(), out.c_str());   // silent: no log spam while typing
  }
}
