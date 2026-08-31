/**
 * ============================================================================
 * TN 108 AMBULANCE — STANDALONE BSNL SIM800L GPRS CELLULAR FIRMWARE
 * TRANSPORT: MQTT over Plain TCP Port 1883 (NO TLS required!)
 *
 * WHY MQTT instead of HTTPS:
 *   SIM800L's SSL library only supports TLS 1.0. Render.com requires TLS 1.2.
 *   Solution: Publish to HiveMQ public broker via plain TCP port 1883.
 *   The Render backend subscribes to MQTT and processes GPS data identically.
 *
 * HARDWARE CONNECTIONS:
 *   SIM800L TX  --> Arduino Pin 4 (or Pin 5 - auto-detected)
 *   SIM800L RX  --> Arduino Pin 5 (or Pin 4 - auto-detected)
 *   SIM800L VCC --> Step-Down Converter (Adjusted to 4.1V - 4.2V)
 *   SIM800L GND --> Step-Down GND AND Arduino GND (Common Ground)
 *
 *   NEO-6M GPS TX --> Arduino Pin 8 (SoftwareSerial RX)
 *   NEO-6M GPS RX --> Arduino Pin 9 (SoftwareSerial TX)
 *   NEO-6M VCC    --> Arduino 5V
 *   NEO-6M GND    --> Arduino GND
 *
 *   Pins 0 & 1 (USB Serial) --> Real-time Debug Monitor (9600 baud)
 *
 * MQTT CONFIG:
 *   Broker : broker.hivemq.com
 *   Port   : 1883 (plain TCP, NO TLS!)
 *   Topic  : ambulance/ARD-001/gps
 *   QoS    : 0
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ── Configuration ─────────────────────────────────────────────────────────────
const char DEVICE_ID[] = "ARD-001";
const char API_KEY[]   = "arduino-bridge-secret";

// MQTT Broker — plain TCP, no SSL, SIM800L compatible
const char MQTT_HOST[] = "broker.hivemq.com";
const int  MQTT_PORT   = 1883;
char       MQTT_TOPIC[40];   // built at runtime: ambulance/ARD-001/gps
// Unique MQTT client ID (must be unique per connection)
char       MQTT_CLIENT_ID[30];

// ── Serial Ports ──────────────────────────────────────────────────────────────
SoftwareSerial gsmSerialA(4, 5); // RX=4, TX=5
SoftwareSerial gsmSerialB(5, 4); // RX=5, TX=4
SoftwareSerial *gsm = &gsmSerialA;

SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

// ── State ─────────────────────────────────────────────────────────────────────
const int LED_PIN = 13;
unsigned long lastSend = 0;
bool gprsOnline = false;

// Indoor Chennai simulation coordinates
float curLat     = 13.0827;
float curLng     = 80.2707;
float curSpeed   = 35.0;
float curHeading = 45.0;
int   curSats    = 6;

// ── AT Command Helper ─────────────────────────────────────────────────────────
bool sendAT(const char* cmd, const char* expected, unsigned long timeout = 3000) {
  gsm->listen();
  while (gsm->available()) gsm->read();

  gsm->println(cmd);
  Serial.print(F("[GSM] >> ")); Serial.println(cmd);

  unsigned long start = millis();
  static char resp[120];
  uint8_t ri = 0;
  memset(resp, 0, sizeof(resp));

  while (millis() - start < timeout) {
    while (gsm->available() && ri < 119) {
      resp[ri++] = (char)gsm->read();
    }
    if (strstr(resp, expected) != NULL) {
      Serial.print(F("[GSM] << OK: ")); Serial.println(resp);
      return true;
    }
    if (strstr(resp, "ERROR") != NULL) {
      Serial.print(F("[GSM] << ERR: ")); Serial.println(resp);
      return false;
    }
  }
  Serial.print(F("[GSM] << TIMEOUT: ")); Serial.println(resp);
  return false;
}

// Safe version — ignores ERROR (for CIPCLOSE, CIPSHUT on closed connection)
void sendATSafe(const char* cmd, unsigned long timeout = 1500) {
  gsm->listen();
  while (gsm->available()) gsm->read();
  gsm->println(cmd);
  Serial.print(F("[GSM] >> ")); Serial.println(cmd);
  unsigned long start = millis();
  static char resp[80];
  uint8_t ri = 0;
  memset(resp, 0, sizeof(resp));
  while (millis() - start < timeout) {
    while (gsm->available() && ri < 79) resp[ri++] = (char)gsm->read();
    if (strstr(resp, "OK") != NULL || strstr(resp, "ERROR") != NULL ||
        strstr(resp, "SHUT OK") != NULL) break;
  }
  Serial.print(F("[GSM] << ")); Serial.println(resp);
}

// ── GPRS Initialization ───────────────────────────────────────────────────────
bool initGPRS() {
  digitalWrite(LED_PIN, LOW);
  gprsOnline = false;
  Serial.println(F("\n--- Initializing BSNL GPRS Network ---"));

  for (int i = 0; i < 3; i++) { sendAT("AT", "OK", 800); delay(150); }
  sendAT("ATE0",    "OK", 1000);
  sendAT("AT+CMEE=2","OK", 1000);
  sendAT("AT+CFUN=1","OK", 3000);
  delay(1000);

  // Check SIM
  gsm->listen(); while (gsm->available()) gsm->read();
  gsm->println(F("AT+CPIN?"));
  delay(800);
  static char cpin[60]; uint8_t ci = 0; memset(cpin, 0, 60);
  while (gsm->available() && ci < 59) cpin[ci++] = (char)gsm->read();
  Serial.print(F("[SIM] CPIN: ")); Serial.println(cpin);

  // Signal strength
  gsm->println(F("AT+CSQ"));
  delay(800);
  static char csq[40]; uint8_t qi = 0; memset(csq, 0, 40);
  while (gsm->available() && qi < 39) csq[qi++] = (char)gsm->read();
  Serial.print(F("[SIGNAL] CSQ: ")); Serial.println(csq);

  sendAT("AT+COPS=0", "OK", 3000);

  // Wait for BSNL registration
  Serial.println(F("[GSM] Waiting for BSNL cell tower..."));
  bool registered = false;
  for (int i = 0; i < 25 && !registered; i++) {
    gsm->listen(); while (gsm->available()) gsm->read();
    gsm->println(F("AT+CREG?"));
    delay(500);
    static char creg[60]; uint8_t cr = 0; memset(creg, 0, 60);
    while (gsm->available() && cr < 59) creg[cr++] = (char)gsm->read();
    Serial.print(F("[CREG] ")); Serial.println(creg);
    if (strstr(creg, ",1") || strstr(creg, ",5")) {
      registered = true;
      Serial.println(F("[GSM] Registered on BSNL!"));
    } else delay(1200);
  }
  if (!registered) return false;

  // ── GPRS via Direct TCP/IP Stack (CIICR) ──────────────────────────────────
  sendATSafe("AT+CIPSHUT");
  delay(300);
  sendAT("AT+CIPMUX=0",  "OK", 1000);
  sendAT("AT+CIPRXGET=0","OK", 1000);
  sendAT("AT+CGATT=1",   "OK", 4000);
  delay(500);

  const char* apns[] = {"portalnmms", "bsnlnet", "bsnlstream", "www"};
  for (int i = 0; i < 4; i++) {
    const char* apn = apns[i];
    Serial.print(F("[GSM] Trying APN: ")); Serial.println(apn);

    sendATSafe("AT+CIPSHUT");
    delay(300);
    sendAT("AT+CIPMUX=0","OK", 1000);
    sendAT("AT+CGATT=1", "OK", 3000);
    delay(300);

    // Build AT+CSTT command in a char buffer
    static char csttCmd[50];
    strcpy(csttCmd, "AT+CSTT=\"");
    strcat(csttCmd, apn);
    strcat(csttCmd, "\",\"\",\"\"");
    sendAT(csttCmd, "OK", 3000);
    delay(400);

    Serial.print(F("[GPRS] Bringing up with ")); Serial.println(apn);
    if (sendAT("AT+CIICR", "OK", 12000)) {
      delay(500);
      gsm->listen(); while (gsm->available()) gsm->read();
      gsm->println(F("AT+CIFSR"));
      delay(1000);
      static char ipbuf[40]; uint8_t ip = 0; memset(ipbuf, 0, 40);
      while (gsm->available() && ip < 39) ipbuf[ip++] = (char)gsm->read();
      Serial.print(F("[BSNL IP]: ")); Serial.println(ipbuf);

      if (strchr(ipbuf, '.') && !strstr(ipbuf, "ERROR")) {
        gprsOnline = true;
        digitalWrite(LED_PIN, HIGH);
        Serial.print(F("[GPRS] ONLINE! APN: ")); Serial.println(apn);
        return true;
      }
    }
    Serial.print(F("[GPRS] APN failed: ")); Serial.println(apn);
    delay(500);
  }
  Serial.println(F("[GPRS] All APNs failed."));
  return false;
}

// ── MQTT CONNECT Packet Builder ───────────────────────────────────────────────
// Builds a minimal MQTT v3.1.1 CONNECT packet into buf, returns length
uint16_t buildMqttConnect(uint8_t* buf) {
  const char* proto    = "MQTT";
  uint8_t     protoLen = 4;
  uint8_t     clientIdLen = strlen(MQTT_CLIENT_ID);

  // Variable header: protocol name + level + flags + keepalive
  uint16_t varLen = 2 + protoLen + 1 + 1 + 2 + 2 + clientIdLen;

  buf[0] = 0x10;              // CONNECT packet type
  buf[1] = (uint8_t)varLen;   // Remaining length
  buf[2] = 0x00; buf[3] = protoLen;
  buf[4] = 'M'; buf[5] = 'Q'; buf[6] = 'T'; buf[7] = 'T';
  buf[8] = 0x04;  // Protocol level 4 = MQTT 3.1.1
  buf[9] = 0x02;  // Connect flags: Clean Session only
  buf[10] = 0x00; buf[11] = 0x3C;   // Keep-alive 60s
  buf[12] = 0x00; buf[13] = clientIdLen;
  memcpy(buf + 14, MQTT_CLIENT_ID, clientIdLen);

  return 14 + clientIdLen;
}

// Builds MQTT PUBLISH packet, returns length
uint16_t buildMqttPublish(uint8_t* buf, const char* topic, const char* payload) {
  uint8_t  topicLen   = strlen(topic);
  uint16_t payloadLen = strlen(payload);
  uint16_t remaining  = 2 + topicLen + payloadLen;  // QoS 0 — no packet ID

  buf[0] = 0x30;  // PUBLISH, QoS 0, no retain
  // Remaining length (variable-length encoding)
  uint8_t ri = 1;
  uint16_t rem = remaining;
  do {
    uint8_t enc = rem % 128;
    rem /= 128;
    if (rem > 0) enc |= 0x80;
    buf[ri++] = enc;
  } while (rem > 0);

  buf[ri++] = 0x00;
  buf[ri++] = topicLen;
  memcpy(buf + ri, topic, topicLen);
  ri += topicLen;
  memcpy(buf + ri, payload, payloadLen);
  ri += payloadLen;

  return ri;
}

// ── Publish GPS via MQTT over Plain TCP ───────────────────────────────────────
bool postTelemetry(float lat, float lng, float speedKmh, float headingDeg, int sats) {
  // Build JSON payload in static char buffer
  static char payload[200];
  static char numBuf[12];

  strcpy(payload, "{\"device_id\":\"");
  strcat(payload, DEVICE_ID);
  strcat(payload, "\",\"api_key\":\"");
  strcat(payload, API_KEY);
  strcat(payload, "\",\"lat\":");
  dtostrf(lat, 1, 6, numBuf);   strcat(payload, numBuf);
  strcat(payload, ",\"lng\":");
  dtostrf(lng, 1, 6, numBuf);   strcat(payload, numBuf);
  strcat(payload, ",\"speed_kmh\":");
  dtostrf(speedKmh, 1, 1, numBuf); strcat(payload, numBuf);
  strcat(payload, ",\"heading\":");
  dtostrf(headingDeg, 1, 1, numBuf); strcat(payload, numBuf);
  strcat(payload, ",\"satellites\":");
  itoa(sats, numBuf, 10);        strcat(payload, numBuf);
  strcat(payload, ",\"fix_quality\":1,\"source\":\"arduino\"}");

  Serial.print(F("[MQTT] Publishing: ")); Serial.println(payload);

  // ── 1. Open TCP to HiveMQ MQTT broker (port 1883, NO SSL!) ────────────────
  sendATSafe("AT+CIPCLOSE");   // Close any stale connection
  delay(200);

  static char cipstart[80];
  strcpy(cipstart, "AT+CIPSTART=\"TCP\",\"");
  strcat(cipstart, MQTT_HOST);
  strcat(cipstart, "\",\"1883\"");

  Serial.println(F("[TCP] Connecting to broker.hivemq.com:1883..."));
  if (!sendAT(cipstart, "CONNECT OK", 12000)) {
    Serial.println(F("[TCP] Connect failed!"));
    sendATSafe("AT+CIPCLOSE");
    return false;
  }
  Serial.println(F("[TCP] Connected to HiveMQ!"));
  delay(200);

  // ── 2. Send MQTT CONNECT packet ───────────────────────────────────────────
  static uint8_t mqttBuf[100];
  uint16_t len = buildMqttConnect(mqttBuf);
  gsm->listen();
  while (gsm->available()) gsm->read();

  // AT+CIPSEND=<len> for exact-length binary packet
  static char cipsend[20];
  strcpy(cipsend, "AT+CIPSEND=");
  itoa(len, numBuf, 10);
  strcat(cipsend, numBuf);
  if (!sendAT(cipsend, ">", 3000)) {
    Serial.println(F("[MQTT] No > prompt for CONNECT!"));
    sendATSafe("AT+CIPCLOSE");
    return false;
  }
  gsm->write(mqttBuf, len);
  delay(600);

  // Read CONNACK (should be 0x20 0x02 0x00 0x00)
  { unsigned long t = millis(); bool ok = false;
    while (millis() - t < 3000) {
      if (gsm->available()) {
        uint8_t b = gsm->read();
        if (b == 0x20) ok = true;  // CONNACK packet type
      }
    }
    if (!ok) {
      Serial.println(F("[MQTT] No CONNACK from broker!"));
      sendATSafe("AT+CIPCLOSE");
      return false;
    }
    // Drain remaining CONNACK bytes
    while (gsm->available()) gsm->read();
    Serial.println(F("[MQTT] CONNACK received — broker accepted!"));
  }

  // ── 3. Send MQTT PUBLISH packet ───────────────────────────────────────────
  static uint8_t pubBuf[250];
  uint16_t pubLen = buildMqttPublish(pubBuf, MQTT_TOPIC, payload);

  strcpy(cipsend, "AT+CIPSEND=");
  itoa(pubLen, numBuf, 10);
  strcat(cipsend, numBuf);
  if (!sendAT(cipsend, ">", 3000)) {
    Serial.println(F("[MQTT] No > prompt for PUBLISH!"));
    sendATSafe("AT+CIPCLOSE");
    return false;
  }
  gsm->write(pubBuf, pubLen);
  delay(500);

  // Drain any remaining bytes (no ACK for QoS 0)
  while (gsm->available()) gsm->read();
  sendATSafe("AT+CIPCLOSE");

  Serial.println(F("\n****************************************************"));
  Serial.println(F("[SUCCESS!] GPS Published via MQTT over BSNL Cellular!"));
  Serial.print(F("  Topic : ")); Serial.println(MQTT_TOPIC);
  Serial.println(F("****************************************************\n"));

  digitalWrite(LED_PIN, LOW); delay(100); digitalWrite(LED_PIN, HIGH);
  return true;
}

// ── Universal Matrix Scanner ──────────────────────────────────────────────────
bool scanAndLockSIM800L() {
  long testBauds[] = {9600, 19200, 38400, 57600, 115200, 4800};
  Serial.println(F("\n[MATRIX SCANNER] Scanning for SIM800L..."));

  for (int inverted = 0; inverted <= 1; inverted++) {
    bool inv = (inverted == 1);
    for (int p = 0; p < 2; p++) {
      int rxPin = (p == 0) ? 5 : 4;
      int txPin = (p == 0) ? 4 : 5;
      for (int b = 0; b < 6; b++) {
        long baud = testBauds[b];
        SoftwareSerial testPort(rxPin, txPin, inv);
        testPort.begin(baud);
        testPort.listen();
        delay(60);
        while (testPort.available()) testPort.read();
        testPort.print("AT\r\n");
        delay(250);
        static char r[40]; uint8_t ri = 0; memset(r, 0, 40);
        while (testPort.available() && ri < 39) r[ri++] = (char)testPort.read();
        Serial.print(F("RX=")); Serial.print(rxPin);
        Serial.print(F(" TX=")); Serial.print(txPin);
        Serial.print(F(" Baud=")); Serial.print(baud);
        Serial.print(F(" Inv=")); Serial.print(inv ? "T" : "F");
        Serial.print(F(" -> \"")); Serial.print(r); Serial.println(F("\""));

        if (strstr(r, "OK") || strstr(r, "AT")) {
          Serial.println(F("\n[FOUND!] SIM800L locked!"));
          testPort.print("AT+IPR=9600\r\n"); delay(200);
          testPort.print("ATE0\r\n");        delay(200);
          testPort.print("AT&W\r\n");        delay(300);
          gsm = (p == 0) ? &gsmSerialB : &gsmSerialA;
          gsm->begin(9600);
          return true;
        }
      }
    }
  }
  return false;
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(9600);
  delay(1000);

  // Build MQTT topic and client ID at startup
  strcpy(MQTT_TOPIC, "ambulance/");
  strcat(MQTT_TOPIC, DEVICE_ID);
  strcat(MQTT_TOPIC, "/gps");

  strcpy(MQTT_CLIENT_ID, "ard-amb-");
  strcat(MQTT_CLIENT_ID, DEVICE_ID);

  Serial.println(F("\n=========================================="));
  Serial.println(F("TN 108 AMBULANCE — SIM800L MQTT FIRMWARE"));
  Serial.println(F("=========================================="));
  Serial.print(F("MQTT topic: ")); Serial.println(MQTT_TOPIC);

  gpsSerial.begin(9600);

  Serial.println(F("Starting in 3 seconds..."));
  delay(1000);
  Serial.println(F("Starting in 2 seconds..."));
  delay(1000);
  Serial.println(F("Starting in 1 second..."));
  delay(1000);

  scanAndLockSIM800L();
  delay(1000);
  initGPRS();
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  if (!gprsOnline) {
    scanAndLockSIM800L();
    initGPRS();
    delay(2000);
    return;
  }

  // Read NEO-6M GPS
  gpsSerial.listen();
  unsigned long scan = millis();
  while (millis() - scan < 1000) {
    while (gpsSerial.available()) gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid()) {
    curLat     = gps.location.lat();
    curLng     = gps.location.lng();
    curSpeed   = gps.speed.kmph();
    curHeading = gps.course.deg();
    curSats    = gps.satellites.value();
    Serial.print(F("[GPS SAT] Lat:")); Serial.print(curLat, 6);
    Serial.print(F(" Lng:")); Serial.println(curLng, 6);
  } else {
    // Indoor Chennai simulation
    curLat    += (random(-5, 6) * 0.00004f);
    curLng    += (random(-5, 6) * 0.00004f);
    curSpeed   = 32.0 + random(0, 12);
    curHeading = (int)(curHeading + random(-10, 11) + 360) % 360;
    Serial.println(F("[INDOOR NAV] Simulating Chennai route..."));
  }

  // Send every 4 seconds
  if (millis() - lastSend >= 4000) {
    lastSend = millis();
    bool ok = postTelemetry(curLat, curLng, curSpeed, curHeading, curSats);
    if (!ok) {
      gprsOnline = false;  // trigger re-init
    }
  }
}
