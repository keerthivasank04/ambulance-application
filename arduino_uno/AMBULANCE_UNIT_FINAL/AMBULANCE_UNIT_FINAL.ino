/**
 * ============================================================================
 * PROJECT: TN 108 Emergency Ambulance Assistance & Live Dispatch System
 * MODULE : Master Telemetry Firmware with Universal Auto-Pin Modem Detector
 * HOST   : https://tn-ambulance-backend.onrender.com
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ── Master Cloud Configuration ─────────────────────────────────────────────
const char DEVICE_ID[]   = "ARD-001";                           // Ambulance 1 ID
const char API_KEY[]     = "arduino-bridge-secret";             // Universal API Key
const char APN[]         = "bsnlnet";                           // BSNL 2G APN ("bsnlnet" or "www")
const char SERVER_HOST[] = "tn-ambulance-backend.onrender.com"; // Render Backend Domain
const int  SERVER_PORT   = 443;                                 // HTTPS Port 443

// GPS on Pins 2 & 3
SoftwareSerial gpsSerial(2, 3);
SoftwareSerial* gsmSerial = nullptr;
TinyGPSPlus gps;

int gsmRx = -1;
int gsmTx = -1;
long gsmBaud = 9600;
bool gprsReady = false;
unsigned long lastPostTime = 0;
float lastValidLat = 13.0827; // Default Chennai Coords
float lastValidLng = 80.2707;

// Candidate Pin Pairs for SIM800L
const int candidatePairs[][2] = {
  {7, 8},   // D7, D8
  {8, 7},   // D8, D7
  {4, 5},   // D4, D5
  {5, 4},   // D5, D4
  {10, 11}, // D10, D11
  {11, 10}, // D11, D10
  {9, 10},  // D9, D10
  {6, 7},   // D6, D7
  {A0, A1}, // A0, A1
  {A1, A0}, // A1, A0
  {A2, A3}, // A2, A3
  {A4, A5}  // A4, A5
};
const int numPairs = sizeof(candidatePairs) / sizeof(candidatePairs[0]);
const long testBauds[] = {9600, 115200, 19200, 4800};
const int numBauds = sizeof(testBauds) / sizeof(testBauds[0]);

// ── Send AT command helper ─────────────────────────────────────────────────
String sendGsm(const String& cmd, unsigned long timeoutMs = 3000) {
  if (!gsmSerial) return "";
  gsmSerial->println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsmSerial->available()) {
      char c = gsmSerial->read();
      resp += c;
    }
  }
  return resp;
}

// ── Universal Auto-Detect for SIM800L Modem Pins & Baud ────────────────────
bool autoDetectModem() {
  Serial.println(F("[SCAN] Auto-probing Arduino pins for SIM800L modem..."));

  for (int p = 0; p < numPairs; p++) {
    int rx = candidatePairs[p][0];
    int tx = candidatePairs[p][1];

    for (int b = 0; b < numBauds; b++) {
      long baud = testBauds[b];

      SoftwareSerial testSerial(rx, tx);
      testSerial.begin(baud);
      testSerial.listen();

      // Send AT sync burst
      testSerial.print("AT\r\n");
      delay(80);
      testSerial.print("AT\r\n");
      delay(80);

      unsigned long start = millis();
      String resp = "";
      while (millis() - start < 300) {
        while (testSerial.available()) {
          char c = testSerial.read();
          resp += c;
        }
        if (resp.indexOf("OK") != -1) {
          Serial.print(F(">>> [FOUND!] SIM800L responding on RX: Pin "));
          if (rx >= 14) { Serial.print("A"); Serial.print(rx - 14); } else Serial.print(rx);
          Serial.print(F(", TX: Pin "));
          if (tx >= 14) { Serial.print("A"); Serial.print(tx - 14); } else Serial.print(tx);
          Serial.print(F(" @ "));
          Serial.print(baud);
          Serial.println(F(" baud!"));

          gsmRx = rx;
          gsmTx = tx;
          gsmBaud = baud;
          gsmSerial = new SoftwareSerial(rx, tx);
          gsmSerial->begin(baud);
          gsmSerial->listen();
          return true;
        }
      }
    }
  }
  return false;
}

// ── Initialize BSNL 2G GPRS Connection ────────────────────────────────────
void initCellularGPRS() {
  if (!autoDetectModem()) {
    Serial.println(F("\n[!] SIM800L did not reply on any probed pins."));
    Serial.println(F("    CHECKLIST:"));
    Serial.println(F("    1. Is the RED SIM800L NET LED blinking?"));
    Serial.println(F("       (If OFF: Plug 9V/12V DC power adapter into Arduino DC jack)"));
    Serial.println(F("    2. Is LM2596 GND connected to Arduino GND (Common Ground)?\n"));
    gprsReady = false;
    return;
  }

  gsmSerial->listen();
  sendGsm("ATE0", 1000);
  sendGsm("AT+CFUN=1", 1500);

  // Check SIM card status
  String r2 = sendGsm("AT+CPIN?", 2000);
  if (r2.indexOf("READY") != -1) {
    Serial.println(F("[MODEM] BSNL SIM Card Detected & Ready!"));
  } else {
    Serial.println(F("[!] SIM Card not detected — check SIM orientation."));
  }

  // Check 2G Signal Quality
  String r3 = sendGsm("AT+CSQ", 1500);
  int idx = r3.indexOf("+CSQ:");
  if (idx != -1) {
    int csq = r3.substring(idx + 6, idx + 8).toInt();
    Serial.print(F("[MODEM] Signal Quality: "));
    Serial.print(csq);
    Serial.println(F("/31"));
  }

  // Check Network Registration
  Serial.println(F("[MODEM] Registering on BSNL Cell Tower..."));
  for (int i = 0; i < 5; i++) {
    String reg = sendGsm("AT+CREG?", 2000);
    if (reg.indexOf("0,1") != -1 || reg.indexOf("0,5") != -1) {
      Serial.println(F("[MODEM] Registered on 2G Network!"));
      break;
    }
    delay(1000);
  }

  // Attach GPRS Bearer
  Serial.println(F("[MODEM] Attaching BSNL GPRS Internet ('bsnlnet')..."));
  sendGsm("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 1500);
  sendGsm(String("AT+SAPBR=3,1,\"APN\",\"") + APN + "\"", 1500);
  
  String bearer = sendGsm("AT+SAPBR=1,1", 8000);
  if (bearer.indexOf("OK") != -1) {
    Serial.println(F("[MODEM] BSNL GPRS Internet CONNECTED!"));
    gprsReady = true;
  } else {
    // Try fallback APN "www"
    sendGsm(String("AT+SAPBR=3,1,\"APN\",\"www\""), 1500);
    String b2 = sendGsm("AT+SAPBR=1,1", 8000);
    if (b2.indexOf("OK") != -1) {
      Serial.println(F("[MODEM] BSNL GPRS Connected via fallback APN (www)!"));
      gprsReady = true;
    } else {
      Serial.println(F("[!] GPRS Connection Failed. Check 2G Data Pack."));
    }
  }

  // Query IP
  String ipResp = sendGsm("AT+SAPBR=2,1", 2000);
  Serial.print(F("[MODEM] GPRS IP: "));
  Serial.println(ipResp);
}

// ── Transmit Telemetry to Render Backend via HTTPS POST ────────────────────
bool transmitGprsHTTP(float lat, float lng, float speedKmh, float headingDeg, int sats, float alt) {
  if (!gsmSerial) return false;
  gsmSerial->listen();

  String jsonBody = String(F("{\"device_id\":\"")) + DEVICE_ID +
                    String(F("\",\"lat\":")) + String(lat, 6) +
                    String(F(",\"lng\":")) + String(lng, 6) +
                    String(F(",\"speed_kmh\":")) + String(speedKmh, 1) +
                    String(F(",\"heading\":")) + String(headingDeg, 1) +
                    String(F(",\"altitude\":")) + String(alt, 1) +
                    String(F(",\"satellites\":")) + String(sats) +
                    String(F(",\"fix_quality\":1,\"source\":\"arduino\"}"));

  Serial.println(F("\n[UPLINK] Sending Telemetry to Render Cloud Server..."));

  sendGsm("AT+HTTPINIT", 2000);
  sendGsm("AT+HTTPSSL=1", 1000); // Enable SSL for HTTPS
  sendGsm(String("AT+HTTPPARA=\"URL\",\"https://") + SERVER_HOST + "/api/gps-update\"", 2000);
  sendGsm("AT+HTTPPARA=\"CID\",1", 1000);
  sendGsm("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  sendGsm(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"", 1000);

  // Send JSON Body
  sendGsm(String("AT+HTTPDATA=") + jsonBody.length() + ",10000", 2000);
  gsmSerial->print(jsonBody);
  delay(150);

  // Trigger POST Action
  String actionResp = sendGsm("AT+HTTPACTION=1", 8000);
  sendGsm("AT+HTTPTERM", 1000);

  Serial.print(F("[SERVER RESPONSE] "));
  Serial.println(actionResp);

  if (actionResp.indexOf(",200,") != -1 || actionResp.indexOf(",201,") != -1) {
    Serial.println(F(">>> [SUCCESS 200 OK] Website updated live with Ambulance 1 location!"));
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(9600);
  gpsSerial.begin(9600);

  Serial.println(F("\n============================================================"));
  Serial.println(F("  TN 108 AMBULANCE TELEMETRY — RENDER CLOUD CONNECTED       "));
  Serial.println(F("  Ambulance Device : ARD-001                                "));
  Serial.println(F("  Server Target    : https://tn-ambulance-backend.onrender.com"));
  Serial.println(F("============================================================"));

  // Initialize Cellular GPRS (Auto-probes all pins)
  initCellularGPRS();

  // Send Initial Boot Ping to Website
  if (gprsReady) {
    Serial.println(F("\n[BOOT] Sending initial connection ping to website..."));
    transmitGprsHTTP(lastValidLat, lastValidLng, 0.0, 0.0, 4, 12.0);
  }

  // Switch to GPS listening
  gpsSerial.listen();
  Serial.println(F("\n[GPS] Listening for NEO-6M satellite coordinates...\n"));
}

void loop() {
  // 1. Read GPS NMEA stream
  gpsSerial.listen();
  unsigned long start = millis();
  while (millis() - start < 1000) {
    while (gpsSerial.available()) {
      char c = gpsSerial.read();
      gps.encode(c);
      Serial.write(c); // Forward raw NMEA to PC USB
    }
  }

  unsigned long now = millis();

  // 2. Transmit periodic updates
  if (now - lastPostTime >= 3000) {
    lastPostTime = now;

    float lat = lastValidLat;
    float lng = lastValidLng;
    float speed = 0.0;
    float heading = 0.0;
    float alt = 12.0;
    int sats = gps.satellites.value();

    if (gps.location.isValid()) {
      lat = gps.location.lat();
      lng = gps.location.lng();
      speed = gps.speed.kmph();
      heading = gps.course.deg();
      alt = gps.altitude.meters();
      lastValidLat = lat;
      lastValidLng = lng;

      Serial.print(F("\n[GPS FIX] Lat: "));
      Serial.print(lat, 6);
      Serial.print(F(" | Lng: "));
      Serial.print(lng, 6);
      Serial.print(F(" | Sats: "));
      Serial.println(sats);
    } else {
      Serial.print(F("\n[GPS SEARCHING...] Sats in view: "));
      Serial.print(sats);
      Serial.println(F(" (Take antenna near window)"));
    }

    // Transmit to Render backend
    if (gprsReady) {
      transmitGprsHTTP(lat, lng, speed, heading, sats, alt);
      gpsSerial.listen();
    }
  }
}
