/**
 * ============================================================================
 * TN 108 AMBULANCE — FINAL PRODUCTION FIRMWARE  (v2 — SoftwareSerial SIM)
 *
 * WIRING:
 *   SIM800L TX  →  Arduino Pin 4  (gsmSerial RX)
 *   SIM800L RX  →  Arduino Pin 5  (gsmSerial TX)
 *   NEO-6M  TX  →  Arduino Pin 8  (gpsSerial RX)
 *   NEO-6M  RX  →  Arduino Pin 9  (gpsSerial TX)
 *
 *   Pins 0 & 1 are LEFT FREE — USB upload works without unplugging anything.
 *
 * UPLOAD INSTRUCTIONS (no unplugging needed):
 *   1. Open this sketch in Arduino IDE
 *   2. Click Upload — done.
 *
 * Server : https://tn-ambulance-backend.onrender.com
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// Configuration
const char DEVICE_ID[]   = "ARD-001";
const char API_KEY[]     = "arduino-bridge-secret";
const char SERVER_HOST[] = "tn-ambulance-backend.onrender.com";

// SIM800L on SoftwareSerial Pins 4 (RX) & 5 (TX)
SoftwareSerial gsmSerial(4, 5);

// GPS on SoftwareSerial Pins 8 (RX) & 9 (TX)
SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

unsigned long lastPostTime = 0;
bool gprsReady = false;
float lastLat = 13.0827;
float lastLng = 80.2707;

// Send AT command via SoftwareSerial (Pins 4 & 5 = SIM800L)
String sendAT(const String& cmd, unsigned long timeoutMs = 3000) {
  gsmSerial.listen();
  gsmSerial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsmSerial.available()) {
      resp += (char)gsmSerial.read();
    }
    if (resp.indexOf("OK") != -1 || resp.indexOf("ERROR") != -1) break;
  }
  Serial.print("[AT] "); Serial.print(cmd); Serial.print(" => "); Serial.println(resp);
  return resp;
}

void initGPRS() {
  String r;

  // Try 9600 first, then 115200
  r = sendAT("AT", 1500);
  if (r.indexOf("OK") == -1) {
    gsmSerial.begin(115200);
    r = sendAT("AT", 1000);
    if (r.indexOf("OK") != -1) {
      sendAT("AT+IPR=9600", 500); // Lock to 9600
    }
    gsmSerial.begin(9600);
    sendAT("AT", 1000);
  }

  sendAT("ATE0", 1000);             // Echo off
  sendAT("AT+CFUN=1", 1500);        // Full function
  sendAT("AT+CPIN?", 2000);         // SIM check
  sendAT("AT+CSQ", 1500);           // Signal strength

  // Wait for network
  for (int i = 0; i < 5; i++) {
    r = sendAT("AT+CREG?", 2000);
    if (r.indexOf("0,1") != -1 || r.indexOf("0,5") != -1) break;
    delay(1000);
  }

  // Attach GPRS - try bsnlnet first, then www
  sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 1500);
  sendAT("AT+SAPBR=3,1,\"APN\",\"bsnlnet\"", 1500);
  r = sendAT("AT+SAPBR=1,1", 8000);
  if (r.indexOf("OK") != -1) {
    gprsReady = true;
  } else {
    sendAT("AT+SAPBR=3,1,\"APN\",\"www\"", 1500);
    r = sendAT("AT+SAPBR=1,1", 8000);
    if (r.indexOf("OK") != -1) gprsReady = true;
  }
  sendAT("AT+SAPBR=2,1", 2000); // Print assigned IP
}

void postGPS(float lat, float lng, float speed, float heading, int sats, float alt) {
  String body = String("{\"device_id\":\"") + DEVICE_ID +
                "\",\"lat\":"       + String(lat, 6) +
                ",\"lng\":"        + String(lng, 6) +
                ",\"speed_kmh\":"  + String(speed, 1) +
                ",\"heading\":"    + String(heading, 1) +
                ",\"altitude\":"   + String(alt, 1) +
                ",\"satellites\":" + String(sats) +
                ",\"fix_quality\":1,\"source\":\"arduino\"}";

  sendAT("AT+HTTPINIT", 2000);
  sendAT("AT+HTTPSSL=1", 1000);
  sendAT(String("AT+HTTPPARA=\"URL\",\"https://") + SERVER_HOST + "/api/gps-update\"", 2000);
  sendAT("AT+HTTPPARA=\"CID\",1", 1000);
  sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 1000);
  sendAT(String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"", 1000);
  sendAT(String("AT+HTTPDATA=") + body.length() + ",10000", 2000);
  gsmSerial.println(body);   // Send JSON body to SIM800L
  delay(200);
  sendAT("AT+HTTPACTION=1", 8000);
  sendAT("AT+HTTPTERM", 1000);
}

void setup() {
  Serial.begin(9600);      // Debug output via USB (Pin 0 & 1 — free for upload)
  gsmSerial.begin(9600);   // SIM800L on SoftwareSerial (Pin 4 & 5)
  gpsSerial.begin(9600);   // GPS on SoftwareSerial (Pin 8 & 9)
  gpsSerial.listen();
  delay(2000);
  Serial.println("[BOOT] TN Ambulance Arduino v2");

  initGPRS();

  // Immediately ping Render website on boot
  if (gprsReady) {
    postGPS(lastLat, lastLng, 0.0, 0.0, 4, 12.0);
  }

  gpsSerial.listen();
}

void loop() {
  // Read GPS from Pins 8 & 9
  gpsSerial.listen();
  unsigned long start = millis();
  while (millis() - start < 1000) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // Post every 3 seconds
  if (millis() - lastPostTime >= 3000) {
    lastPostTime = millis();

    float lat     = lastLat;
    float lng     = lastLng;
    float speed   = 0.0;
    float heading = 0.0;
    float alt     = 12.0;
    int   sats    = gps.satellites.value();

    if (gps.location.isValid()) {
      lat     = gps.location.lat();
      lng     = gps.location.lng();
      speed   = gps.speed.kmph();
      heading = gps.course.deg();
      alt     = gps.altitude.meters();
      lastLat = lat;
      lastLng = lng;
    }

    if (gprsReady) {
      postGPS(lat, lng, speed, heading, sats, alt);
      gpsSerial.listen();
    }
  }
}
