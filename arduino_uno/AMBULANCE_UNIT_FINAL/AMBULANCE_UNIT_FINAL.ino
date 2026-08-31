/**
 * ============================================================================
 * TN 108 AMBULANCE — SIM800L BSNL MQTT + NEO-6M GPS LIVE FIRMWARE
 *
 * TRANSPORT : MQTT over Plain TCP port 1883 (NO TLS — SIM800L compatible!)
 * BROKER    : broker.hivemq.com:1883
 * TOPIC     : ambulance/ARD-001/gps
 *
 * HARDWARE CONNECTIONS:
 *   SIM800L TX   --> Arduino Pin 5 (SoftSerial RX)
 *   SIM800L RX   --> Arduino Pin 4 (SoftSerial TX)
 *   SIM800L VCC  --> Step-Down 4.1V-4.2V
 *   SIM800L GND  --> Arduino GND (common ground)
 *
 *   NEO-6M GPS TX --> Arduino Pin 8 (SoftSerial RX)
 *   NEO-6M GPS RX --> Arduino Pin 9 (SoftSerial TX)
 *   NEO-6M VCC    --> Arduino 5V
 *   NEO-6M GND    --> Arduino GND
 *
 *   Pins 0/1     --> USB Serial Monitor (9600 baud)
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ── Pin Configuration ────────────────────────────────────────────────────────
SoftwareSerial gsm(5, 4);        // SIM800L: RX=5, TX=4
SoftwareSerial gpsSerial(8, 9);  // NEO-6M GPS: RX=8 (GPS TX), TX=9 (GPS RX)
TinyGPSPlus    gps;

// ── Configuration Constants ──────────────────────────────────────────────────
#define DEVICE_ID   "ARD-001"
#define API_KEY     "arduino-bridge-secret"
#define MQTT_HOST   "broker.hivemq.com"
#define MQTT_TOPIC  "ambulance/ARD-001/gps"
#define MQTT_CID    "ard-ARD-001"

// ── Shared Global Buffers (Zero heap fragmentation) ──────────────────────────
char    gBuf[180];
uint8_t pktBuf[210];

// ── State ─────────────────────────────────────────────────────────────────────
#define LED_PIN 13
bool          gprsOnline    = false;
bool          mqttConnected = false;
unsigned long lastSend      = 0;

// Live Coordinates (Updated in real-time from NEO-6M satellite lock)
float curLat     = 0.0f;
float curLng     = 0.0f;
float curSpeed   = 0.0f;
float curHeading = 0.0f;
int   curSats    = 0;
bool  hasFix     = false;

// ── AT Command Helper ─────────────────────────────────────────────────────────
bool sendAT(const __FlashStringHelper* cmd, const char* expected, uint16_t timeout = 3000) {
  gsm.listen();
  while (gsm.available()) gsm.read();

  gsm.println(cmd);
  Serial.print(F("[>>] ")); Serial.println(cmd);

  uint8_t ri = 0;
  memset(gBuf, 0, sizeof(gBuf));
  unsigned long t = millis();
  while (millis() - t < timeout) {
    while (gsm.available() && ri < (sizeof(gBuf) - 1)) gBuf[ri++] = (char)gsm.read();
    if (strstr(gBuf, expected))  { Serial.print(F("[OK] ")); Serial.println(gBuf); return true; }
    if (strstr(gBuf, "ERROR"))   { Serial.print(F("[ER] ")); Serial.println(gBuf); return false; }
  }
  Serial.print(F("[TO] ")); Serial.println(gBuf);
  return false;
}

bool sendATBuf(const char* expected, uint16_t timeout = 3000) {
  gsm.listen();
  while (gsm.available()) gsm.read();

  gsm.println(gBuf);
  Serial.print(F("[>>] ")); Serial.println(gBuf);

  uint8_t ri = 0;
  memset(gBuf, 0, sizeof(gBuf));
  unsigned long t = millis();
  while (millis() - t < timeout) {
    while (gsm.available() && ri < (sizeof(gBuf) - 1)) gBuf[ri++] = (char)gsm.read();
    if (strstr(gBuf, expected))  { Serial.print(F("[OK] ")); Serial.println(gBuf); return true; }
    if (strstr(gBuf, "ERROR"))   { Serial.print(F("[ER] ")); Serial.println(gBuf); return false; }
  }
  Serial.print(F("[TO] ")); Serial.println(gBuf);
  return false;
}

void sendATSafe(const __FlashStringHelper* cmd) {
  gsm.listen();
  while (gsm.available()) gsm.read();
  gsm.println(cmd);
  Serial.print(F("[>>] ")); Serial.println(cmd);
  uint8_t ri = 0;
  memset(gBuf, 0, sizeof(gBuf));
  unsigned long t = millis();
  while (millis() - t < 1500) {
    while (gsm.available() && ri < (sizeof(gBuf) - 1)) gBuf[ri++] = (char)gsm.read();
    if (strstr(gBuf, "OK") || strstr(gBuf, "ERROR") || strstr(gBuf, "SHUT OK")) break;
  }
  Serial.print(F("[<<] ")); Serial.println(gBuf);
}

// ── GPRS Initialization ───────────────────────────────────────────────────────
bool initGPRS() {
  gprsOnline = false;
  mqttConnected = false;
  digitalWrite(LED_PIN, LOW);
  Serial.println(F("\n--- BSNL GPRS Init ---"));

  for (int i = 0; i < 3; i++) { sendAT(F("AT"), "OK", 800); delay(100); }
  sendAT(F("ATE0"),     "OK", 1000);
  sendAT(F("AT+CFUN=1"),"OK", 3000);
  delay(800);

  sendAT(F("AT+CPIN?"), "READY", 2000);
  sendAT(F("AT+CSQ"),   "OK",    1000);
  sendAT(F("AT+COPS=0"),"OK",    3000);

  Serial.println(F("[REG] Waiting for BSNL cell tower..."));
  for (int i = 0; i < 25; i++) {
    sendAT(F("AT+CREG?"), "OK", 1500);
    if (strstr(gBuf, ",1") || strstr(gBuf, ",5")) {
      Serial.println(F("[REG] Registered on BSNL!"));
      break;
    }
    if (i == 24) { Serial.println(F("[REG] Network search timeout.")); return false; }
    delay(1200);
  }

  sendATSafe(F("AT+CIPSHUT"));
  delay(300);
  sendAT(F("AT+CIPMUX=0"),   "OK", 1000);
  sendAT(F("AT+CIPRXGET=0"), "OK", 1000);
  sendAT(F("AT+CGATT=1"),    "OK", 4000);
  delay(500);

  const char* apns[] = {"portalnmms", "bsnlnet", "bsnlstream"};
  for (int i = 0; i < 3; i++) {
    sendATSafe(F("AT+CIPSHUT"));
    delay(300);
    sendAT(F("AT+CIPMUX=0"), "OK", 1000);
    sendAT(F("AT+CGATT=1"),  "OK", 3000);
    delay(300);

    strcpy(gBuf, "AT+CSTT=\"");
    strcat(gBuf, apns[i]);
    strcat(gBuf, "\",\"\",\"\"");
    sendATBuf("OK", 3000);
    delay(400);

    Serial.print(F("[APN] Trying: ")); Serial.println(apns[i]);
    if (sendAT(F("AT+CIICR"), "OK", 12000)) {
      delay(500);
      sendAT(F("AT+CIFSR"), ".", 2000);
      if (strstr(gBuf, ".") && !strstr(gBuf, "ERROR")) {
        gprsOnline = true;
        digitalWrite(LED_PIN, HIGH);
        Serial.print(F("[GPRS] ONLINE! Allocated IP: ")); Serial.println(gBuf);
        return true;
      }
    }
    Serial.println(F("[APN] Failed, trying next..."));
    delay(500);
  }
  Serial.println(F("[GPRS] All APNs failed."));
  return false;
}

// ── MQTT Packet Builders ──────────────────────────────────────────────────────
uint16_t buildConnect() {
  const uint8_t cidLen = sizeof(MQTT_CID) - 1;
  const uint8_t rem    = 10 + 2 + cidLen;
  pktBuf[0] = 0x10; pktBuf[1] = rem;
  pktBuf[2] = 0x00; pktBuf[3] = 4;
  pktBuf[4] = 'M';  pktBuf[5] = 'Q'; pktBuf[6] = 'T'; pktBuf[7] = 'T';
  pktBuf[8] = 0x04; pktBuf[9] = 0x02;
  pktBuf[10] = 0x00; pktBuf[11] = 0x3C;
  pktBuf[12] = 0x00; pktBuf[13] = cidLen;
  memcpy(pktBuf + 14, MQTT_CID, cidLen);
  return 14 + cidLen;
}

uint16_t buildPublish(const char* payload) {
  const uint8_t  topLen  = sizeof(MQTT_TOPIC) - 1;
  const uint16_t payLen  = strlen(payload);
  const uint16_t rem     = 2 + topLen + payLen;

  pktBuf[0] = 0x30;
  uint8_t ri = 1;
  uint16_t r = rem;
  do {
    uint8_t enc = r % 128;
    r /= 128;
    if (r) enc |= 0x80;
    pktBuf[ri++] = enc;
  } while (r);
  pktBuf[ri++] = 0x00;
  pktBuf[ri++] = topLen;
  memcpy(pktBuf + ri, MQTT_TOPIC, topLen); ri += topLen;
  memcpy(pktBuf + ri, payload, payLen);    ri += payLen;
  return ri;
}

// ── Telemetry Transmission ───────────────────────────────────────────────────
bool postTelemetry(float lat, float lng, float spd, float hdg, int sats) {
  char nb[14];

  // 1. Ensure TCP/MQTT Connected
  if (!mqttConnected) {
    sendATSafe(F("AT+CIPCLOSE"));
    delay(200);

    char cs[60];
    strcpy(cs, "AT+CIPSTART=\"TCP\",\"");
    strcat(cs, MQTT_HOST);
    strcat(cs, "\",\"1883\"");
    strcpy(gBuf, cs);
    Serial.println(F("[TCP] Connecting to broker.hivemq.com:1883..."));
    if (!sendATBuf("CONNECT OK", 12000)) {
      Serial.println(F("[TCP] Connect failed!"));
      return false;
    }
    Serial.println(F("[TCP] Connected to MQTT Broker!"));
    delay(300);

    uint16_t cLen = buildConnect();
    strcpy(gBuf, "AT+CIPSEND=");
    itoa(cLen, gBuf + strlen(gBuf), 10);
    if (!sendATBuf(">", 3000)) {
      Serial.println(F("[MQTT] No > for CONNECT"));
      sendATSafe(F("AT+CIPCLOSE"));
      return false;
    }
    gsm.write(pktBuf, cLen);
    delay(500);

    bool connack = false;
    unsigned long t = millis();
    while (millis() - t < 4000) {
      if (gsm.available() && (uint8_t)gsm.read() == 0x20) { connack = true; break; }
    }
    while (gsm.available()) gsm.read();

    if (!connack) {
      Serial.println(F("[MQTT] No CONNACK from broker!"));
      sendATSafe(F("AT+CIPCLOSE"));
      return false;
    }
    mqttConnected = true;
    Serial.println(F("[MQTT] ✅ Broker accepted CONNECT!"));
  }

  // 2. Build JSON Payload
  strcpy(gBuf, "{\"device_id\":\"" DEVICE_ID "\",\"api_key\":\"" API_KEY "\"");
  strcat(gBuf, ",\"lat\":"); dtostrf(lat, 1, 6, nb); strcat(gBuf, nb);
  strcat(gBuf, ",\"lng\":"); dtostrf(lng, 1, 6, nb); strcat(gBuf, nb);
  strcat(gBuf, ",\"speed_kmh\":"); dtostrf(spd, 1, 1, nb); strcat(gBuf, nb);
  strcat(gBuf, ",\"heading\":"); dtostrf(hdg, 1, 1, nb); strcat(gBuf, nb);
  strcat(gBuf, ",\"satellites\":"); itoa(sats, nb, 10); strcat(gBuf, nb);
  strcat(gBuf, ",\"fix_quality\":1,\"source\":\"arduino\"}");

  uint16_t pLen = buildPublish(gBuf);

  // 3. Send MQTT PUBLISH Packet
  char cs2[22];
  strcpy(cs2, "AT+CIPSEND=");
  itoa(pLen, cs2 + strlen(cs2), 10);
  strcpy(gBuf, cs2);
  if (!sendATBuf(">", 3000)) {
    Serial.println(F("[MQTT] Connection dropped. Reconnecting..."));
    mqttConnected = false;
    sendATSafe(F("AT+CIPCLOSE"));
    return false;
  }

  gsm.write(pktBuf, pLen);

  // 4. Wait for SEND OK from SIM800L
  unsigned long tSend = millis();
  bool sentOk = false;
  memset(gBuf, 0, sizeof(gBuf));
  uint8_t gi = 0;
  while (millis() - tSend < 6000) {
    while (gsm.available() && gi < (sizeof(gBuf) - 1)) {
      char c = (char)gsm.read();
      gBuf[gi++] = c;
      Serial.write(c);
    }
    if (strstr(gBuf, "SEND OK")) { sentOk = true; break; }
    if (strstr(gBuf, "CLOSED") || strstr(gBuf, "ERROR")) { mqttConnected = false; break; }
  }
  Serial.println();

  if (sentOk) {
    Serial.println(F("****************************************************"));
    Serial.print(F("[SUCCESS!] Live GPS Delivered (Lat: "));
    Serial.print(lat, 6);
    Serial.print(F(", Lng: "));
    Serial.print(lng, 6);
    Serial.println(F(")"));
    Serial.println(F("****************************************************\n"));
    digitalWrite(LED_PIN, LOW); delay(100); digitalWrite(LED_PIN, HIGH);
    return true;
  } else {
    Serial.println(F("[MQTT] Send timeout."));
    mqttConnected = false;
    sendATSafe(F("AT+CIPCLOSE"));
    return false;
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(9600);
  gsm.begin(9600);
  gpsSerial.begin(9600);
  delay(1000);

  Serial.println(F("\n=========================================="));
  Serial.println(F("TN 108 AMBULANCE — SIM800L MQTT + GPS"));
  Serial.println(F("  SIM800L: RX=5, TX=4 (9600 baud)"));
  Serial.println(F("  NEO-6M:  RX=8, TX=9 (9600 baud)"));
  Serial.println(F("  Broker:  broker.hivemq.com:1883"));
  Serial.println(F("==========================================\n"));

  delay(3000);
  initGPRS();
}

// ── Main Loop ─────────────────────────────────────────────────────────────────
void loop() {
  if (!gprsOnline) {
    initGPRS();
    delay(4000);
    return;
  }

  // 1. Read real satellite data from NEO-6M GPS on Pins 8 & 9
  gpsSerial.listen();
  unsigned long scanStart = millis();
  while (millis() - scanStart < 1000) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // 2. Check if NEO-6M GPS has a real satellite lock
  if (gps.location.isValid() && gps.location.age() < 5000) {
    hasFix     = true;
    curLat     = gps.location.lat();
    curLng     = gps.location.lng();
    curSpeed   = gps.speed.kmph();
    curHeading = gps.course.deg();
    curSats    = gps.satellites.value();

    Serial.print(F("[SATELLITE FIX 🛰️] Lat: ")); Serial.print(curLat, 6);
    Serial.print(F(" | Lng: ")); Serial.print(curLng, 6);
    Serial.print(F(" | Speed: ")); Serial.print(curSpeed, 1);
    Serial.print(F(" km/h | Sats: ")); Serial.println(curSats);
  } else {
    // If waiting for satellite fix
    Serial.print(F("[GPS] Searching for satellites (Sats in view: "));
    Serial.print(gps.satellites.value());
    Serial.println(F(")... Place GPS antenna near window / open sky."));
  }

  // 3. Send cellular update every 4 seconds
  if (millis() - lastSend >= 4000) {
    lastSend = millis();

    // Only send if we have a real fix or valid coordinates
    if (curLat != 0.0f && curLng != 0.0f) {
      if (!postTelemetry(curLat, curLng, curSpeed, curHeading, curSats)) {
        gprsOnline = false;
      }
    } else {
      Serial.println(F("[GPS] Waiting for initial satellite fix before posting..."));
    }
  }
}
