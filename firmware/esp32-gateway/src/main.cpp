// ESP32 gateway for the Water Refill Machine (v0.4.1).
//
//   STM32 (machine control)  <--UART2-->  ESP32 (this)  <--MQTT/TLS-->  EMQX Cloud  <-->  Backend
//
// UART protocol (one text line per message, '\n' terminated):
// Contract: Implementation Plan section C3 (UART v1).
//   STM32 -> ESP32 : REQ_PAY,<volume_ml> | CANCEL | CANCEL,<tran_id> | DONE,<tran_id>,<flow_ml>,<weight_g>
//                    PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault> | ERR,<fault>[,<tran_id>]
//                    PAID,ACK,<tran_id> | PAID,REJECT,<tran_id>,<fault> | PONG,<state>,<tran_id|0>,<tank>,<fault>
//   ESP32 -> STM32 : QR,<tran_id>,<amount>,<currency>,<remaining_s>,<qr_string>
//                    PAID,<tran_id> | EXPIRED,<tran_id> | FAILED,<tran_id|0> | CANCELLED,<tran_id>
//                    ACK,<tran_id> | NET,OK | NET,DOWN | PING
//
// v0.4.1 fixes:
//   - STM32 lines are no longer upper-cased (tran_ids are lowercase; DONE,<tran_id> was rejected)
//   - QR countdown = expires_at - now (NTP); expired / foreign / locally-cancelled QRs are not shown
//   - pay/status forwarded only for the current payment (PAID always: the STM32 checks the tran_id)
//   - PONG with fields parsed; heartbeat in the C2 format (stm32 state, tank, fault)
//   - ERR without tran_id is a fault report only (error topic), never a dispense outcome
//   - pay/request retry per B4.7 (8 s, then +2 s, +5 s, +10 s) then FAILED,0
//
// v0.4.0 enhancements:
//   - Non-Volatile Storage (NVS / Preferences) outcome queue (capacity 64, max age 7d)
//   - ACK,<tran_id> to STM32 only AFTER outcome is written to NVS
//   - Exponential backoff retry (5s -> 5min + jitter) until transaction/ack ok or rejected
//   - Periodic PAID repeat every 2s until PAID,ACK or PAID,REJECT
//   - Heartbeat telemetry counters: pending_outcomes, rejected_outcomes, dropped_outcomes
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "qrcodegen.h"
#include "secrets.h"
#include "ca_cert.h"

#define FW_VERSION          "0.4.1"
#define STM32_RX_PIN        16      // ESP32 RX2  <- STM32 TX
#define STM32_TX_PIN        17      // ESP32 TX2  -> STM32 RX
#define STM32_BAUD          115200
#define PRINT_QR_TO_USB     1       // draw the QR in the serial monitor (for testing)
#define HEARTBEAT_MS        60000
#define STM32_PING_MS       5000
#define STM32_TIMEOUT_MS    15000
#define MAX_LINE            600

#define OUTCOME_QUEUE_CAP   64
#define MAX_OUTCOME_AGE_S   (7UL * 86400UL) // 7 days per Plan E Phase 3

HardwareSerial &stm32 = Serial2;
WiFiClientSecure tls;
PubSubClient mqtt(tls);
Preferences prefs;

// ---------- NVS Outcome Queue ----------
struct QueuedOutcome {
  char tranId[21];
  char result[10];   // "ok", "partial", "error"
  int flowMl;
  int weightG;
  char fault[32];
  uint32_t ts;
  uint32_t queuedTs;
  uint32_t nextRetryMs;
  uint16_t attempts;
};

QueuedOutcome outcomeQueue[OUTCOME_QUEUE_CAP];
int outcomeCount = 0;
uint32_t rejectedOutcomes = 0;
uint32_t droppedOutcomes = 0;

// ---------- state ----------
int netState = -1;                 // -1 unknown, 0 down, 1 up (last state sent to STM32)
unsigned long lastHeartbeat = 0, lastPing = 0, lastPong = 0, lastMqttTry = 0;
unsigned long mqttBackoff = 2000;
bool stm32Lost = false;
bool qrInvert = false;             // false = dark terminal theme, true = light theme
String currentTran, currentRequestId, lastQrString, lastStatus;
int lastVolume = 0;

// Retry policy for pay/request (Plan B4.7): no answer within 8 s -> resend after 2 s, 5 s, 10 s -> FAILED,0
// Gap before resend 1, 2, 3, then the final wait for an answer after resend 3.
const unsigned long REQ_WAIT_MS[] = {8000UL + 2000UL, 5000UL, 10000UL, 8000UL};
bool awaitingQr = false;
unsigned long lastReqTime = 0;
int reqRetries = 0;
String cancelledRequestId;          // request cancelled locally before its QR arrived (B4.7)

// Last PONG from the STM32 (C3): PONG,<state>,<tran_id|0>,<tank>,<fault>
String stm32State, stm32Tran, stm32Tank, stm32Fault;

// Repeating PAID until PAID,ACK or PAID,REJECT
bool repeatingPaid = false;
String repeatingPaidTran = "";
unsigned long lastPaidRepeatTime = 0;

// ---------- helpers ----------
String topic(const char *suffix) { return String("wrm/") + MACHINE_ID + "/" + suffix; }

String generateRequestId() {
  char buf[17];
  snprintf(buf, sizeof(buf), "%08x%08x", (uint32_t)esp_random(), (uint32_t)esp_random());
  return String(buf);
}

// Reads '\n'-terminated lines; drops terminal junk (arrow-key escape codes, \r, control chars)
struct LineReader {
  String buf;
  uint8_t esc = 0;
  bool read(Stream &s, String &out) {
    while (s.available()) {
      char c = (char)s.read();
      if (esc == 1) { esc = (c == '[') ? 2 : 0; continue; }
      if (esc == 2) { if (c >= 0x40 && c <= 0x7E) esc = 0; continue; }
      if (c == 0x1B) { esc = 1; continue; }
      if (c == '\n') {
        out = buf;
        buf = "";
        out.trim();   // never change case: tran_ids are lowercase (C3)
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

// Parse "YYYY-MM-DDTHH:MM:SS(.sss)Z" (UTC) to Unix seconds; returns 0 if not parseable.
time_t parseIsoUtc(const char *s) {
  int y, mo, d, h, mi, se;
  if (!s || sscanf(s, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &se) != 6) return 0;
  // days from civil date (H. Hinnant), independent of the TZ setting
  y -= mo <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const long days = (long)era * 146097L + (long)doe - 719468L;
  return (time_t)(days * 86400L + h * 3600L + mi * 60L + se);
}

// ---------- NVS Queue Storage Functions ----------
void saveNvsQueue() {
  prefs.begin("wrm_outcomes", false);
  prefs.putInt("cnt", outcomeCount);
  prefs.putUInt("rej", rejectedOutcomes);
  prefs.putUInt("drop", droppedOutcomes);
  for (int i = 0; i < outcomeCount; i++) {
    char key[16];
    snprintf(key, sizeof(key), "o_%d", i);
    prefs.putBytes(key, &outcomeQueue[i], sizeof(QueuedOutcome));
  }
  prefs.end();
}

void loadNvsQueue() {
  prefs.begin("wrm_outcomes", true);
  outcomeCount = prefs.getInt("cnt", 0);
  if (outcomeCount < 0 || outcomeCount > OUTCOME_QUEUE_CAP) outcomeCount = 0;
  rejectedOutcomes = prefs.getUInt("rej", 0);
  droppedOutcomes = prefs.getUInt("drop", 0);

  for (int i = 0; i < outcomeCount; i++) {
    char key[16];
    snprintf(key, sizeof(key), "o_%d", i);
    prefs.getBytes(key, &outcomeQueue[i], sizeof(QueuedOutcome));
    outcomeQueue[i].nextRetryMs = millis() + 1000UL * (i + 1); // Stagger retries upon boot
  }
  prefs.end();
  Serial.printf("[nvs] loaded %d queued outcomes (rejected=%u, dropped=%u)\n",
                outcomeCount, rejectedOutcomes, droppedOutcomes);
}

uint32_t calculateBackoffMs(uint16_t attempts) {
  uint32_t base = 5000UL * (1UL << min((int)attempts, 6)); // 5s -> 10s -> 20s -> 40s -> 80s -> 160s -> 320s
  uint32_t capped = min(base, (uint32_t)300000UL);        // max 5 min per Plan E Phase 3
  uint32_t jitter = esp_random() % 1000UL;
  return capped + jitter;
}

void enqueueOutcome(const char *tranId, const char *result, int flowMl, int weightG, const char *fault, uint32_t ts) {
  // Check if tranId is already queued
  for (int i = 0; i < outcomeCount; i++) {
    if (strcmp(outcomeQueue[i].tranId, tranId) == 0) {
      Serial.printf("  [nvs] outcome for %s already queued\n", tranId);
      toStm32(String("ACK,") + tranId);
      return;
    }
  }

  // If queue full, drop oldest
  if (outcomeCount >= OUTCOME_QUEUE_CAP) {
    droppedOutcomes++;
    Serial.printf("  [nvs] queue full! Dropping oldest outcome %s\n", outcomeQueue[0].tranId);
    for (int i = 0; i < OUTCOME_QUEUE_CAP - 1; i++) {
      outcomeQueue[i] = outcomeQueue[i + 1];
    }
    outcomeCount--;
  }

  QueuedOutcome &item = outcomeQueue[outcomeCount];
  memset(&item, 0, sizeof(QueuedOutcome));
  strncpy(item.tranId, tranId, sizeof(item.tranId) - 1);
  strncpy(item.result, result, sizeof(item.result) - 1);
  item.flowMl = flowMl;
  item.weightG = weightG;
  if (fault) strncpy(item.fault, fault, sizeof(item.fault) - 1);
  item.ts = ts;
  item.queuedTs = (uint32_t)time(nullptr);
  item.attempts = 0;
  item.nextRetryMs = millis(); // Send immediately if connected

  outcomeCount++;
  saveNvsQueue();
  Serial.printf("  [nvs] stored outcome for %s in NVS (queue size: %d)\n", tranId, outcomeCount);

  // Hard safety rule: send ACK to STM32 only AFTER writing to NVS
  toStm32(String("ACK,") + tranId);
}

void removeOutcome(const char *tranId, bool isRejected) {
  int found = -1;
  for (int i = 0; i < outcomeCount; i++) {
    if (strcmp(outcomeQueue[i].tranId, tranId) == 0) {
      found = i;
      break;
    }
  }
  if (found < 0) return;

  if (isRejected) {
    rejectedOutcomes++;
    Serial.printf("  [nvs] outcome for %s was permanently REJECTED by backend\n", tranId);
  } else {
    Serial.printf("  [nvs] outcome for %s confirmed OK by backend; removed from queue\n", tranId);
  }

  for (int i = found; i < outcomeCount - 1; i++) {
    outcomeQueue[i] = outcomeQueue[i + 1];
  }
  outcomeCount--;
  saveNvsQueue();
}

void processOutcomeQueue() {
  if (!mqtt.connected()) return;
  unsigned long now = millis();
  time_t nowTs = time(nullptr);

  for (int i = 0; i < outcomeCount; i++) {
    QueuedOutcome &item = outcomeQueue[i];

    // Check 7-day expiration policy
    if (nowTs > 1700000000 && item.queuedTs > 1700000000) {
      if ((uint32_t)nowTs - item.queuedTs > MAX_OUTCOME_AGE_S) {
        Serial.printf("  [nvs] dropping outcome %s (expired > 7 days)\n", item.tranId);
        droppedOutcomes++;
        removeOutcome(item.tranId, false);
        i--;
        continue;
      }
    }

    if (now >= item.nextRetryMs) {
      JsonDocument doc;
      doc["v"] = 1;
      doc["tran_id"] = item.tranId;
      doc["result"] = item.result;
      doc["flow_ml"] = item.flowMl;
      doc["weight_g"] = item.weightG;
      if (strlen(item.fault) > 0) doc["fault"] = item.fault;
      doc["ts"] = item.ts;

      publishJson("transaction", doc);
      item.attempts++;
      item.nextRetryMs = now + calculateBackoffMs(item.attempts);
      Serial.printf("  [nvs] dispatched outcome %s (attempt %d, next in %lums)\n",
                    item.tranId, item.attempts, item.nextRetryMs - now);
    }
  }
}

void printMenu() {
  Serial.println();
  Serial.println("+--------------- TEST MENU ---------------+");
  Serial.println("|  1  Pay for 500 mL                      |");
  Serial.println("|  2  Pay for 750 mL                      |");
  Serial.println("|  3  Pay for 1000 mL                     |");
  Serial.println("|  C  Cancel current payment              |");
  Serial.println("|  D  Report dispense done (after PAID)   |");
  Serial.println("|  S  Show network & queue status         |");
  Serial.println("|  Q  Reprint last QR                     |");
  Serial.println("|  I  Invert QR colours                   |");
  Serial.println("+-----------------------------------------+");
  Serial.println("Or type raw STM32 commands: REQ_PAY,500 / DONE,<tran>,<flow>,<weight> / PAID,ACK,<tran>");
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
    String reqId = doc["request_id"].isNull() ? "" : doc["request_id"].as<String>();
    String tranId = doc["tran_id"].as<String>();

    // B4.7: the customer cancelled before this QR arrived -> tell the backend, never show it
    if (reqId.length() && reqId == cancelledRequestId) {
      JsonDocument c;
      c["v"] = 1;
      c["tran_id"] = tranId;
      c["reason"] = "USER_CANCELLED";
      publishJson("pay/cancel", c);
      Serial.printf("  [mqtt] QR %s arrived after local cancel -> pay/cancel sent\n", tranId.c_str());
      return;
    }
    // B4.7: only the QR for the request we are waiting for (legacy QR without request_id: only while waiting)
    if (reqId.length() ? (reqId != currentRequestId) : !awaitingQr) {
      Serial.printf("  [mqtt] discarding stale/foreign QR %s (request %s)\n", tranId.c_str(), reqId.c_str());
      return;
    }

    // C3: the STM32 gets the REMAINING seconds; B4.7: drop a QR that has already expired
    int remainingSec = 180;
    time_t nowTs = time(nullptr);
    if (!doc["expires_in_s"].isNull()) {
      remainingSec = doc["expires_in_s"].as<int>();      // prototype backend
    } else {
      time_t expTs = parseIsoUtc(doc["expires_at"].as<const char *>());
      if (expTs > 0 && nowTs > 1700000000) {
        remainingSec = (int)(expTs - nowTs);
      } else {
        Serial.println("  [mqtt] cannot compute QR expiry (no expires_at or no NTP time); using 180 s");
      }
    }
    if (remainingSec <= 0) {
      Serial.printf("  [mqtt] discarding expired QR %s\n", tranId.c_str());
      return;
    }

    awaitingQr = false;
    currentTran = tranId;
    lastQrString = doc["qr_string"].as<String>();
    lastStatus = "pending";

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

    bool isCurrent = (currentTran.length() && tran == currentTran) || (reqId.length() && reqId == currentRequestId);
    if (isCurrent) {
      awaitingQr = false;
      lastStatus = status;
    } else if (status != "paid") {
      // e.g. CANCELLED for a QR superseded by a newer request: must not reset the screen showing the new QR
      Serial.printf("  [mqtt] ignoring %s for %s (not the current payment)\n", status.c_str(), tran.c_str());
      return;
    }
    // "paid" is always forwarded: the STM32 accepts it only for the QR it shows (C3 safety rule 3)

    if (status == "paid") {
      repeatingPaid = true;
      repeatingPaidTran = tran;
      lastPaidRepeatTime = millis();
      toStm32("PAID," + tran);
      printBanner("PAID", "tran " + tran + "  ->  type 'd' to report dispense done");
    } else if (status == "expired") {
      repeatingPaid = false;
      toStm32("EXPIRED," + tran);
      printBanner("EXPIRED", "tran " + tran + "  ->  type 1/2/3 for a new payment");
    } else if (status == "cancelled") {
      repeatingPaid = false;
      toStm32("CANCELLED," + tran);
      printBanner("CANCELLED", "tran " + tran);
    } else if (status == "failed") {
      repeatingPaid = false;
      toStm32("FAILED," + tran);
      printBanner("FAILED", doc["reason"].isNull() ? "tran " + tran : String(doc["reason"].as<const char *>()));
    }
  } else if (tp.endsWith("/transaction/ack")) {
    String tran = doc["tran_id"].as<String>();
    String status = doc["status"].as<String>();
    Serial.printf("  [mqtt] transaction/ack for %s: %s\n", tran.c_str(), status.c_str());
    removeOutcome(tran.c_str(), status == "rejected");
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

  cancelledRequestId = currentRequestId;   // a QR still in flight for it will be cancelled, not shown
  awaitingQr = false;
  repeatingPaid = false;
  currentTran = "";
  currentRequestId = "";
  lastStatus = "cancelled";
  // No reply line: the STM32 already returned to idle when it sent CANCEL (C3 has no CANCELLED,OK)
  Serial.println("  Payment cancelled locally and cancel sent to backend");
}

void handleLine(String line, bool fromUsb) {
  if (fromUsb) {
    // Test menu: case-insensitive shortcuts and keywords. Never upper-case tran_ids.
    String key = line;
    key.toUpperCase();
    int kc = line.indexOf(',');
    if (kc > 0) {
      String kw = line.substring(0, kc);
      kw.toUpperCase();
      String rest = line.substring(kc + 1);
      // PAID,ACK / PAID,REJECT: the sub-keyword is a keyword too
      int kc2 = rest.indexOf(',');
      if (kw == "PAID" && kc2 > 0) {
        String sub = rest.substring(0, kc2);
        sub.toUpperCase();
        rest = sub + rest.substring(kc2);
      }
      line = kw + "," + rest;
    } else {
      line = key;
    }
    if (key == "1") line = "REQ_PAY,500";
    else if (key == "2") line = "REQ_PAY,750";
    else if (key == "3") line = "REQ_PAY,1000";
    else if (key == "C" || key == "CANCEL") line = "CANCEL";
    else if (key == "H" || key == "HELP" || key == "?") { printMenu(); return; }
    else if (key == "I") {
      qrInvert = !qrInvert;
      Serial.printf("  QR colours: %s terminal theme\n", qrInvert ? "LIGHT" : "DARK");
      if (lastQrString.length()) printQr(lastQrString);
      return;
    } else if (key == "Q") {
      if (lastQrString.length()) printQr(lastQrString); else Serial.println("  No QR yet - type 1, 2 or 3");
      return;
    } else if (key == "S" || key == "STATUS") {
      Serial.printf("  wifi=%s  mqtt=%s  stm32=%s  tran=%s (%s)  fw=%s\n",
                    WiFi.isConnected() ? "up" : "DOWN", mqtt.connected() ? "up" : "DOWN",
                    stm32Lost ? "not connected" : "ok", currentTran.length() ? currentTran.c_str() : "-",
                    lastStatus.length() ? lastStatus.c_str() : "-", FW_VERSION);
      Serial.printf("  [nvs queue] pending=%d  rejected=%u  dropped=%u\n",
                    outcomeCount, rejectedOutcomes, droppedOutcomes);
      Serial.printf("  [stm32] state=%s tran=%s tank=%s fault=%s\n", stm32State.length() ? stm32State.c_str() : "-",
                    stm32Tran.length() ? stm32Tran.c_str() : "-", stm32Tank.length() ? stm32Tank.c_str() : "-",
                    stm32Fault.length() ? stm32Fault.c_str() : "-");
      return;
    } else if (key == "D") {
      if (lastStatus != "paid") { Serial.println("  Nothing to report - wait for PAID first"); return; }
      line = "DONE," + currentTran + "," + String(lastVolume - 2) + "," + String(lastVolume + 1);
    }
  }

  Serial.printf("  << %s: %s\n", fromUsb ? "you" : "STM32", line.c_str());

  if (line == "PING") { toStm32("PONG"); return; }
  if (line == "PONG" || line.startsWith("PONG,")) {
    lastPong = millis();
    stm32Lost = false;
    // PONG,<state>,<tran_id|0>,<tank>,<fault>
    if (line.length() > 5) {
      String f[4];
      int start = 5;
      for (int i = 0; i < 4; i++) {
        int comma = line.indexOf(',', start);
        f[i] = comma < 0 ? line.substring(start) : line.substring(start, comma);
        if (comma < 0) break;
        start = comma + 1;
      }
      stm32State = f[0];
      stm32Tran = (f[1] == "0") ? "" : f[1];
      stm32Tank = f[2];
      stm32Fault = f[3];
    }
    return;
  }

  int c1 = line.indexOf(',');
  String cmd = c1 < 0 ? line : line.substring(0, c1);
  String rest = c1 < 0 ? "" : line.substring(c1 + 1);

  if (cmd == "REQ_PAY") {
    requestPayment(rest.toInt());
  } else if (cmd == "CANCEL" || cmd == "REQ_CANCEL") {
    cancelPayment();
  } else if (cmd == "PAID") {
    // STM32 responses to repeated PAID: PAID,ACK,<tran> or PAID,REJECT,<tran>,<fault>
    int a = rest.indexOf(',');
    String sub = a < 0 ? rest : rest.substring(0, a);
    if (sub == "ACK") {
      repeatingPaid = false;
      Serial.println("  STM32 acknowledged receipt of PAID");
    } else if (sub == "REJECT") {
      repeatingPaid = false;
      int b = rest.indexOf(',', a + 1);
      String tranId = b < 0 ? rest.substring(a + 1) : rest.substring(a + 1, b);
      String fault = b < 0 ? "PAID_NOT_ACCEPTED" : rest.substring(b + 1);
      enqueueOutcome(tranId.c_str(), "error", 0, 0, fault.c_str(), (uint32_t)time(nullptr));
    }
  } else if (cmd == "DONE") {
    int a = rest.indexOf(','), b = rest.indexOf(',', a + 1);
    String tranId = rest.substring(0, a);
    int flow = rest.substring(a + 1, b).toInt();
    int weight = rest.substring(b + 1).toInt();
    enqueueOutcome(tranId.c_str(), "ok", flow, weight, nullptr, (uint32_t)time(nullptr));
    if (fromUsb) lastStatus = "done";
  } else if (cmd == "PARTIAL") {
    // PARTIAL,<tran_id>,<flow_ml>,<weight_g>,<fault>
    int a = rest.indexOf(','), b = rest.indexOf(',', a + 1), c = rest.indexOf(',', b + 1);
    String tranId = rest.substring(0, a);
    int flow = rest.substring(a + 1, b).toInt();
    int weight = rest.substring(b + 1, c).toInt();
    String fault = rest.substring(c + 1);
    enqueueOutcome(tranId.c_str(), "partial", flow, weight, fault.c_str(), (uint32_t)time(nullptr));
  } else if (cmd == "ERR") {
    // C3: ERR,<fault>[,<tran_id>] - only an ERR that names a tran_id is a dispense outcome.
    int a = rest.indexOf(',');
    String fault = a < 0 ? rest : rest.substring(0, a);
    String tranId = a < 0 ? String("") : rest.substring(a + 1);
    if (tranId.length()) {
      enqueueOutcome(tranId.c_str(), "error", 0, 0, fault.c_str(), (uint32_t)time(nullptr));
    } else {
      // Standalone error with no transaction
      JsonDocument doc;
      doc["v"] = 1;
      doc["fault"] = fault;
      doc["ts"] = (unsigned long)time(nullptr);
      publishJson("error", doc);
    }
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

  loadNvsQueue();

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

  processOutcomeQueue();

  String line;
  if (stmReader.read(stm32, line)) handleLine(line, false);
  if (usbReader.read(Serial, line)) handleLine(line, true);

  unsigned long now = millis();

  // Repeating PAID every 2 seconds until acknowledged by STM32
  if (repeatingPaid && (now - lastPaidRepeatTime > 2000)) {
    lastPaidRepeatTime = now;
    toStm32("PAID," + repeatingPaidTran);
  }

  // Retry policy for pay/request (B4.7)
  if (awaitingQr && (now - lastReqTime > REQ_WAIT_MS[reqRetries])) {
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
      toStm32("FAILED,0");   // B4.7 / C3: request failed -> STM32 shows "Service unavailable"
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
    // C2 heartbeat
    JsonDocument doc;
    doc["v"] = 1;
    doc["fw"] = FW_VERSION;
    doc["uptime_s"] = now / 1000;
    doc["rssi"] = WiFi.RSSI();
    doc["heap"] = ESP.getFreeHeap();
    JsonObject s32 = doc["stm32"].to<JsonObject>();
    s32["link"] = stm32Lost ? "lost" : "ok";
    if (!stm32Lost && stm32State.length()) {
      s32["state"] = stm32State;
      if (stm32Tran.length()) s32["tran_id"] = stm32Tran;
      if (stm32Tank.length()) s32["tank"] = stm32Tank;
      if (stm32Fault.length()) s32["fault"] = stm32Fault;
    }
    doc["pending_outcomes"] = outcomeCount;
    doc["rejected_outcomes"] = rejectedOutcomes;
    doc["dropped_outcomes"] = droppedOutcomes;
    if (time(nullptr) > 1700000000) doc["ts"] = (unsigned long)time(nullptr);
    String out;
    serializeJson(doc, out);
    mqtt.publish(topic("heartbeat").c_str(), out.c_str());
  }
}
