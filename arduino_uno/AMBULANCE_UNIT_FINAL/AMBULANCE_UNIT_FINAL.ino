/**
 * ============================================================================
 * PROJECT: TN 108 Emergency Ambulance Assistance & Live Dispatch System
 * MODULE : Master Telemetry Firmware for In-Vehicle Unit (ARD-001)
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

// Pin Mapping (Matches Soldered Board)
const int GPS_RX_PIN = 2;  // Arduino Pin 2 <-- GPS TX
const int GPS_TX_PIN = 3;  // Arduino Pin 3 --> GPS RX
const int GSM_RX_PIN = 7;  // Arduino Pin 7 <-- SIM800L TX
const int GSM_TX_PIN = 8;  // Arduino Pin 8 --> SIM800L RX
const int STATUS_LED = 13;

SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
SoftwareSerial gsmSerial(GSM_RX_PIN, GSM_TX_PIN);
TinyGPSPlus gps;

unsigned long lastPostTime = 0;
bool gprsReady = false;
float lastValidLat = 13.0827; // Default Chennai Coords
float lastValidLng = 80.2707;

// ── Send AT command and return response string ─────────────────────────────
String sendGsm(const String& cmd, unsigned long timeoutMs = 3000) {
  gsmSerial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      char c = gsmSerial.read();
      resp += c;
    }
  }
  return resp;
}

// ── Initialize BSNL 2G Cellular GPRS ──────────────────────────────────────
void initCellularGPRS() {
  gsmSerial.listen();
  Serial.println(F("\n[MODEM] Initializing SIM800L..."));

  // Check modem AT response
  String r1 = sendGsm("AT", 1500);
  if (r1.indexOf("OK") == -1) {
    Serial.println(F("[!] SIM800L not responding on Pins 7/8."));
    Serial.println(F("    Check LM2596 4.0V power and GND connection."));
    gprsReady = false;
    return;
  }

  sendGsm("ATE0", 1000);
  sendGsm("AT+CFUN=1", 1500);

  // Check SIM card status
  String r2 = sendGsm("AT+CPIN?", 2000);
  if (r2.indexOf("READY") != -1) {
    Serial.println(F("[MODEM] BSNL SIM Card Detected & Ready!"));
  } else {
    Serial.println(F("[!] SIM Card Error — check SIM insertion / recharge."));
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
      Serial.println(F("[!] GPRS Connection Failed. Verify 2G Data Balance."));
    }
  }

  // Query IP
  String ipResp = sendGsm("AT+SAPBR=2,1", 2000);
  Serial.print(F("[MODEM] GPRS IP: "));
  Serial.println(ipResp);
}

// ── Transmit Telemetry to Render Backend via HTTPS POST ────────────────────
bool transmitGprsHTTP(float lat, float lng, float speedKmh, float headingDeg, int sats, float alt) {
  gsmSerial.listen();

  String jsonBody = String(F("{\"device_id\":\"")) + DEVICE_ID +
                    String(F("\",\"lat\":")) + String(lat, 6) +
                    String(F(",\"lng\":")) + String(lng, 6) +
                    String(F(",\"speed_kmh\":")) + String(speedKmh, 1) +
                    String(F(",\"heading\":")) + String(headingDeg, 1) +
                    String(F(",\"altitude\":")) + String(alt, 1) +
                    String(F(",\"satellites\":")) + String(sats) +
                    String(F(",\"fix_quality\":1,\"source\":\"arduino\"}"));

  Serial.println(F("\n[UPLINK] Sending Telemetry to Render Server..."));

  sendGsm("AT+HTTPINIT", 2000);
  sendGsm("AT+HTTPSSL=1", 1000); // Enable SSL for HTTPS
  sendGsm(String("AT+HTTPPARA=\"URL\",\"https://") + SERVER_HOST + "/api/gps-update\"", 2000);
  sendGsm("AT+HTTPPARA=\"CID\",1", 1000);
  sendGsm("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  sendGsm(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"", 1000);

  // Send JSON Body
  sendGsm(String("AT+HTTPDATA=") + jsonBody.length() + ",10000", 2000);
  gsmSerial.print(jsonBody);
  delay(150);

  // Trigger POST Action
  String actionResp = sendGsm("AT+HTTPACTION=1", 8000);
  sendGsm("AT+HTTPTERM", 1000);

  Serial.print(F("[SERVER RESPONSE] "));
  Serial.println(actionResp);

  if (actionResp.indexOf(",200,") != -1 || actionResp.indexOf(",201,") != -1) {
    Serial.println(F(">>> [SUCCESS 200 OK] Website updated live with Ambulance 1 location!"));
    digitalWrite(STATUS_LED, HIGH);
    return true;
  } else if (actionResp.indexOf(",401,") != -1) {
    Serial.println(F(">>> [ERROR 401] Invalid API Key."));
  } else if (actionResp.indexOf(",601,") != -1 || actionResp.indexOf(",603,") != -1) {
    Serial.println(F(">>> [ERROR 601] SSL/DNS Error. Check cellular network signal."));
  }
  return false;
}

void setup() {
  Serial.begin(9600);
  gpsSerial.begin(9600);
  gsmSerial.begin(9600);

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  Serial.println(F("\n============================================================"));
  Serial.println(F("  TN 108 AMBULANCE TELEMETRY — RENDER CLOUD CONNECTED       "));
  Serial.println(F("  Ambulance Device : ARD-001                                "));
  Serial.println(F("  Server Target    : https://tn-ambulance-backend.onrender.com"));
  Serial.println(F("============================================================"));

  // Initialize Cellular GPRS
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
      Serial.write(c); // Forward raw NMEA to PC USB for backup
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
