/**
 * TN 108 Emergency Ambulance Assistance — Standalone Vehicle Tracker
 * Microcontroller: Arduino UNO (ATmega328P DIP)
 * Peripherals    : GY-NEO6MV2 GPS + SIM800L GSM (BSNL 2G) + LM2596 Buck Converter
 * 
 * Functions:
 *   - Standalone operation (no PC or USB cable needed in the vehicle)
 *   - Auto-connects to BSNL 2G GPRS data on vehicle startup
 *   - Reads continuous satellite coordinates from NEO-6M GPS receiver
 *   - Posts live GPS telemetry every 2 seconds directly to Control Server
 *   - Auto-recovers and reconnects if ambulance drives into a cellular blind spot
 * 
 * Hardware Wiring:
 *   GPS (NEO-6M):
 *     VCC --> Arduino 5V
 *     GND --> Arduino GND
 *     TX  --> Arduino Pin 2 (SoftwareSerial RX)
 *     RX  --> Arduino Pin 3 (SoftwareSerial TX)
 * 
 *   SIM800L:
 *     VCC --> LM2596 Output (4.0V, 2A peak)
 *     GND --> LM2596 GND & Arduino GND (Common Ground)
 *     TX  --> Arduino Pin 7 (SoftwareSerial RX)
 *     RX  --> Arduino Pin 8 (SoftwareSerial TX)
 * 
 *   Power Supply in Vehicle:
 *     12V Cigarette Lighter / Vehicle Battery (+) --> LM2596 IN+ & Arduino VIN
 *     12V Vehicle Battery (-)                     --> LM2596 IN- & Arduino GND
 *     LM2596 OUT+ (Adjusted to 4.0V)              --> SIM800L VCC
 *     LM2596 OUT-                                 --> SIM800L GND & Arduino GND
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// ── Configuration ──────────────────────────────────────────────────────────
const char APN[]         = "bsnlnet";                   // BSNL GPRS APN ("bsnlnet" or "www")
const char SERVER_HOST[] = "your-app-domain.com";       // Your public server host/domain or ngrok host (no http://)
const int  SERVER_PORT   = 5000;                        // Server port (or 80 / 443)
const char API_KEY[]     = "arduino-bridge-secret";     // Matches GPS_API_KEY in backend/.env
const char DEVICE_ID[]   = "ARD-001";                   // Matches Ambulance 1 in database

const unsigned long POST_INTERVAL_MS = 2000; // Send telemetry every 2 seconds
const unsigned long RETRY_INTERVAL_MS = 8000;

// ── Pins ───────────────────────────────────────────────────────────────────
const int GPS_RX = 2;
const int GPS_TX = 3;
const int GSM_RX = 7;
const int GSM_TX = 8;
const int STATUS_LED = 13; // Onboard status indicator

SoftwareSerial gpsSerial(GPS_RX, GPS_TX);
SoftwareSerial gsmSerial(GSM_RX, GSM_TX);
TinyGPSPlus gps;

unsigned long lastPost = 0;
unsigned long lastRetry = 0;
bool gprsAttached = false;

// ── Helper Functions ───────────────────────────────────────────────────────
bool sendGsmCmd(const __FlashStringHelper* cmd, const char* expected, unsigned long timeoutMs = 2000) {
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

bool sendGsmCmdStr(const String& cmd, const char* expected, unsigned long timeoutMs = 2000) {
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

// ── Connect or Reconnect to BSNL 2G GPRS ───────────────────────────────────
bool ensureGprsConnection() {
  if (gprsAttached) return true;

  unsigned long now = millis();
  if (now - lastRetry < RETRY_INTERVAL_MS) return false;
  lastRetry = now;

  gsmSerial.listen();
  Serial.println(F("[GPRS] Connecting to 2G cellular network..."));

  sendGsmCmd(F("AT"), "OK", 1000);
  sendGsmCmd(F("ATE0"), "OK", 1000);
  sendGsmCmd(F("AT+CFUN=1"), "OK", 2000);

  // Check network registration
  if (!sendGsmCmd(F("AT+CREG?"), "0,1", 2000) && !sendGsmCmd(F("AT+CREG?"), "0,5", 2000)) {
    Serial.println(F("[GPRS] Searching for BSNL signal..."));
    return false;
  }

  // Configure GPRS Bearer
  sendGsmCmd(F("AT+SAPBR=3,1,\"Contype\",\"GPRS\""), "OK", 1500);
  String apnCmd = String(F("AT+SAPBR=3,1,\"APN\",\"")) + APN + String(F("\""));
  sendGsmCmdStr(apnCmd, "OK", 1500);

  // Open GPRS Context
  if (sendGsmCmd(F("AT+SAPBR=1,1"), "OK", 8000)) {
    Serial.println(F("[GPRS] Connected to BSNL Internet successfully!"));
    gprsAttached = true;
    digitalWrite(STATUS_LED, HIGH);
    return true;
  } else {
    // Try fallback APN "www"
    sendGsmCmdStr(String(F("AT+SAPBR=3,1,\"APN\",\"www\"")), "OK", 1500);
    if (sendGsmCmd(F("AT+SAPBR=1,1"), "OK", 8000)) {
      Serial.println(F("[GPRS] Connected via fallback APN (www)!"));
      gprsAttached = true;
      digitalWrite(STATUS_LED, HIGH);
      return true;
    }
  }

  gprsAttached = false;
  digitalWrite(STATUS_LED, LOW);
  return false;
}

// ── HTTP POST GPS Telemetry to Backend Server ──────────────────────────────
void postTelemetryHTTP(float lat, float lng, float speedKmh, float headingDeg, int sats, float alt) {
  if (!ensureGprsConnection()) return;

  gsmSerial.listen();

  // Create JSON Payload
  String jsonBody = String(F("{\"device_id\":\"")) + DEVICE_ID +
                    String(F("\",\"lat\":")) + String(lat, 6) +
                    String(F(",\"lng\":")) + String(lng, 6) +
                    String(F(",\"speed_kmh\":")) + String(speedKmh, 1) +
                    String(F(",\"heading\":")) + String(headingDeg, 1) +
                    String(F(",\"altitude\":")) + String(alt, 1) +
                    String(F(",\"satellites\":")) + String(sats) +
                    String(F(",\"fix_quality\":1,\"source\":\"arduino\"}"));

  sendGsmCmd(F("AT+HTTPINIT"), "OK", 2000);
  sendGsmCmd(F("AT+HTTPPARA=\"CID\",1"), "OK", 1000);

  String urlCmd = String(F("AT+HTTPPARA=\"URL\",\"http://")) + SERVER_HOST + String(F(":")) + String(SERVER_PORT) + String(F("/api/gps-update\""));
  sendGsmCmdStr(urlCmd, "OK", 2000);

  sendGsmCmd(F("AT+HTTPPARA=\"CONTENT\",\"application/json\""), "OK", 1000);

  // Send API Key Header
  String authHeader = String(F("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ")) + API_KEY + String(F("\""));
  sendGsmCmdStr(authHeader, "OK", 1000);

  // Send JSON Body
  String dataCmd = String(F("AT+HTTPDATA=")) + String(jsonBody.length()) + String(F(",10000"));
  if (sendGsmCmdStr(dataCmd, "DOWNLOAD", 3000)) {
    gsmSerial.print(jsonBody);
    delay(100);
    sendGsmCmd(F("AT+HTTPACTION=1"), "+HTTPACTION: 1,200", 5000);
  }

  sendGsmCmd(F("AT+HTTPTERM"), "OK", 1000);
}

// ── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  gpsSerial.begin(9600);
  gsmSerial.begin(9600);

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  Serial.println(F("\n=================================================="));
  Serial.println(F("  TN 108 AMBULANCE TELEMETRY — REMOTE VEHICLE UNIT"));
  Serial.println(F("  Unit ID: ARD-001                                "));
  Serial.println(F("=================================================="));

  ensureGprsConnection();
  gpsSerial.listen();
}

// ── Main Loop ─────────────────────────────────────────────────────────────
void loop() {
  // 1. Read continuous GPS stream from NEO-6M
  gpsSerial.listen();
  unsigned long startWait = millis();
  while (millis() - startWait < 800) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // 2. Post telemetry every POST_INTERVAL_MS if fix is valid
  unsigned long now = millis();
  if (now - lastPost >= POST_INTERVAL_MS) {
    if (gps.location.isValid() && gps.location.isUpdated()) {
      lastPost = now;
      float lat      = gps.location.lat();
      float lng      = gps.location.lng();
      float speedKmh = gps.speed.kmph();
      float heading  = gps.course.deg();
      float alt      = gps.altitude.meters();
      int   sats     = gps.satellites.value();

      Serial.print(F("[LIVE GPS] Lat="));
      Serial.print(lat, 6);
      Serial.print(F(" Lng="));
      Serial.print(lng, 6);
      Serial.print(F(" Spd="));
      Serial.print(speedKmh, 1);
      Serial.print(F("km/h Sats="));
      Serial.println(sats);

      // Transmit directly to Control Server
      postTelemetryHTTP(lat, lng, speedKmh, heading, sats, alt);
    }
  }
}
