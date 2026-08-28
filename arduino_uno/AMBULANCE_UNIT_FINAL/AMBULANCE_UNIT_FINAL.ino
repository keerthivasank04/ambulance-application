/**
 * ============================================================================
 * PROJECT: TN 108 Emergency Ambulance Assistance & Live Dispatch System
 * MODULE : Master Telemetry Firmware for In-Vehicle Unit (ARD-001)
 * HARDWARE: Arduino UNO (ATmega328P DIP) + NEO-6M GPS + SIM800L 2G GPRS
 * ============================================================================
 * 
 * OPERATING MODES:
 *   1. USB Telemetry Mode  : Direct high-speed NMEA streaming via USB to PC Bridge
 *   2. 2G Cellular GPRS Mode: Standalone vehicle HTTP POST updates over BSNL 2G
 * 
 * HARDWARE WIRING:
 *   [NEO-6M GPS Receiver]
 *     VCC --> Arduino 5V
 *     GND --> Arduino GND
 *     TX  --> Arduino Pin 2 (SoftwareSerial RX)
 *     RX  --> Arduino Pin 3 (SoftwareSerial TX)
 * 
 *   [SIM800L GSM/GPRS Modem]
 *     VCC --> LM2596 Output (4.0V, 2A Peak)
 *     GND --> LM2596 Output GND & Arduino GND (Common Ground)
 *     TX  --> Arduino Pin 7 (SoftwareSerial RX)
 *     RX  --> Arduino Pin 8 (SoftwareSerial TX)
 * 
 *   [LM2596 Buck Converter]
 *     IN+ --> 12V Vehicle Supply / External 9V-12V Power
 *     IN- --> 12V Vehicle Ground / External GND
 *     OUT+ (Tuned to 4.0V) --> SIM800L VCC
 *     OUT-                 --> SIM800L GND & Arduino GND
 * 
 * LIBRARIES REQUIRED:
 *   - SoftwareSerial (Built-in)
 *   - TinyGPSPlus (Install via Arduino Library Manager)
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ── Master Configuration ───────────────────────────────────────────────────
const char DEVICE_ID[]   = "ARD-001";                // Matches Ambulance 1 in Database
const char API_KEY[]     = "arduino-bridge-secret";  // Matches GPS_API_KEY in backend/.env
const char APN[]         = "bsnlnet";                // BSNL APN ("bsnlnet" or "www")
const char SERVER_HOST[]  = "your-server-domain.com"; // Control Server Host/Ngrok (no http://)
const int  SERVER_PORT   = 5000;                     // Server Port

// Pin Mapping
const int GPS_RX_PIN = 2;
const int GPS_TX_PIN = 3;
const int GSM_RX_PIN = 7;
const int GSM_TX_PIN = 8;
const int STATUS_LED = 13;

// Intervals
const unsigned long GPS_UPDATE_INTERVAL = 2000; // 2 seconds between updates

// ── Global Objects ─────────────────────────────────────────────────────────
SoftwareSerial gpsSerial(GPS_RX_PIN, GPS_TX_PIN);
SoftwareSerial gsmSerial(GSM_RX_PIN, GSM_TX_PIN);
TinyGPSPlus gps;

unsigned long lastPostTime = 0;
bool gprsReady = false;

// ── Helper: Send AT command to SIM800L ────────────────────────────────────
bool sendAT(const __FlashStringHelper* cmd, const char* expected, unsigned long timeoutMs = 2000) {
  gsmSerial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      char c = gsmSerial.read();
      resp += c;
    }
    if (resp.indexOf(expected) != -1) return true;
  }
  return false;
}

bool sendATStr(const String& cmd, const char* expected, unsigned long timeoutMs = 2000) {
  gsmSerial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      char c = gsmSerial.read();
      resp += c;
    }
    if (resp.indexOf(expected) != -1) return true;
  }
  return false;
}

// ── Initialize Cellular 2G GPRS ───────────────────────────────────────────
void initCellularGPRS() {
  gsmSerial.listen();
  Serial.println(F("[MODEM] Initializing SIM800L..."));

  if (!sendAT(F("AT"), "OK", 1000)) {
    Serial.println(F("[MODEM] SIM800L offline or waiting for power. Running USB Mode."));
    gprsReady = false;
    return;
  }

  sendAT(F("ATE0"), "OK", 1000);
  sendAT(F("AT+CFUN=1"), "OK", 2000);

  if (sendAT(F("AT+CPIN?"), "READY", 2000)) {
    Serial.println(F("[MODEM] SIM Card Detected!"));
  }

  // Check network registration
  if (sendAT(F("AT+CREG?"), "0,1", 2000) || sendAT(F("AT+CREG?"), "0,5", 2000)) {
    Serial.println(F("[MODEM] Registered on 2G Cellular Network!"));

    // Attach GPRS
    sendAT(F("AT+SAPBR=3,1,\"Contype\",\"GPRS\""), "OK", 1500);
    sendATStr(String(F("AT+SAPBR=3,1,\"APN\",\"")) + APN + String(F("\"")), "OK", 1500);
    
    if (sendAT(F("AT+SAPBR=1,1"), "OK", 6000)) {
      Serial.println(F("[MODEM] 2G GPRS Internet Connected!"));
      gprsReady = true;
    } else {
      // Fallback APN
      sendATStr(String(F("AT+SAPBR=3,1,\"APN\",\"www\"")), "OK", 1500);
      if (sendAT(F("AT+SAPBR=1,1"), "OK", 6000)) {
        Serial.println(F("[MODEM] 2G GPRS Connected (Fallback APN)!"));
        gprsReady = true;
      }
    }
  }
}

// ── Transmit Telemetry over 2G HTTP POST ──────────────────────────────────
void transmitGprsHTTP(float lat, float lng, float speedKmh, float headingDeg, int sats, float alt) {
  gsmSerial.listen();

  String jsonBody = String(F("{\"device_id\":\"")) + DEVICE_ID +
                    String(F("\",\"lat\":")) + String(lat, 6) +
                    String(F(",\"lng\":")) + String(lng, 6) +
                    String(F(",\"speed_kmh\":")) + String(speedKmh, 1) +
                    String(F(",\"heading\":")) + String(headingDeg, 1) +
                    String(F(",\"altitude\":")) + String(alt, 1) +
                    String(F(",\"satellites\":")) + String(sats) +
                    String(F(",\"fix_quality\":1,\"source\":\"arduino\"}"));

  sendAT(F("AT+HTTPINIT"), "OK", 2000);
  sendAT(F("AT+HTTPPARA=\"CID\",1"), "OK", 1000);
  sendATStr(String(F("AT+HTTPPARA=\"URL\",\"http://")) + SERVER_HOST + String(F(":")) + String(SERVER_PORT) + String(F("/api/gps-update\"")), "OK", 2000);
  sendAT(F("AT+HTTPPARA=\"CONTENT\",\"application/json\""), "OK", 1000);
  sendATStr(String(F("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ")) + API_KEY + String(F("\"")), "OK", 1000);
  sendATStr(String(F("AT+HTTPDATA=")) + String(jsonBody.length()) + String(F(",10000")), "DOWNLOAD", 3000);
  gsmSerial.print(jsonBody);
  delay(100);
  sendAT(F("AT+HTTPACTION=1"), "+HTTPACTION: 1,200", 5000);
  sendAT(F("AT+HTTPTERM"), "OK", 1000);
}

// ── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  // Initialize Serial Ports
  Serial.begin(9600);     // USB Serial to PC Bridge
  gpsSerial.begin(9600);  // GPS Baud Rate
  gsmSerial.begin(9600);  // SIM800L Baud Rate

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH);

  Serial.println(F("\n============================================================"));
  Serial.println(F("  TN 108 AMBULANCE TELEMETRY SYSTEM — FINAL PRODUCTION UNIT "));
  Serial.println(F("  Ambulance Device ID : ARD-001                             "));
  Serial.println(F("============================================================"));

  // Initialize Cellular Modem
  initCellularGPRS();

  // Listen to GPS
  gpsSerial.listen();
  Serial.println(F("[SYSTEM] Ready! Streaming GPS Telemetry...\n"));
}

// ── Main Loop ─────────────────────────────────────────────────────────────
void loop() {
  // 1. Read continuous GPS NMEA Stream
  gpsSerial.listen();
  unsigned long start = millis();
  while (millis() - start < 800) {
    while (gpsSerial.available()) {
      char c = gpsSerial.read();
      gps.encode(c);
      // Stream raw NMEA to PC USB for gps-bridge.js
      Serial.write(c);
    }
  }

  // 2. Transmit periodic updates
  if (millis() - lastPostTime >= GPS_UPDATE_INTERVAL) {
    if (gps.location.isValid() && gps.location.isUpdated()) {
      lastPostTime = millis();
      float lat      = gps.location.lat();
      float lng      = gps.location.lng();
      float speedKmh = gps.speed.kmph();
      float heading  = gps.course.deg();
      float alt      = gps.altitude.meters();
      int   sats     = gps.satellites.value();

      digitalWrite(STATUS_LED, !digitalRead(STATUS_LED)); // Toggle LED on fix

      // If Cellular 2G is active, send direct HTTP POST
      if (gprsReady) {
        transmitGprsHTTP(lat, lng, speedKmh, heading, sats, alt);
        gpsSerial.listen();
      }
    }
  }
}
