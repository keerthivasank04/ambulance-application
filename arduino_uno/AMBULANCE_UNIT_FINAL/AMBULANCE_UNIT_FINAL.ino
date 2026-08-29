/**
 * ============================================================================
 * TN 108 AMBULANCE — STANDALONE BSNL SIM800L GPRS TELEMETRY FIRMWARE
 *
 * HARDWARE CONNECTIONS:
 *   SIM800L TX  --> Arduino Pin 0 (RX)
 *   SIM800L RX  --> Arduino Pin 1 (TX)
 *   SIM800L VCC --> External Power / 5V (SIM800L power LED steady)
 *   SIM800L GND --> Common GND with Arduino
 *
 *   NEO-6M GPS TX --> Arduino Pin 8 (SoftwareSerial RX)
 *   NEO-6M GPS RX --> Arduino Pin 9 (SoftwareSerial TX)
 *   NEO-6M VCC    --> Arduino 5V
 *   NEO-6M GND    --> Common GND
 *
 * BEHAVIOR:
 *   - Connects to BSNL 2G GPRS via APN "bsnlnet" / "portalnmms"
 *   - Reads live NEO-6M satellite coordinates if available.
 *   - If testing indoors without sky view, calculates smooth Chennai route telemetry.
 *   - Transmits HTTP POST to Render backend every 4 seconds.
 *   - Built-in Pin 13 LED turns ON when connected to GPRS and blinks on each POST!
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// Server & Device Configuration
const char DEVICE_ID[] = "ARD-001";
const char API_KEY[]   = "arduino-bridge-secret";
const char SERVER_URL[]= "https://tn-ambulance-backend.onrender.com/api/gps-update";
const char BSNL_APN[]  = "bsnlnet";

// NEO-6M GPS on Pins 8 & 9
SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

const int LED_PIN = 13;
unsigned long lastSend = 0;
bool gprsOnline = false;

// Real-time Coordinates (Base: Chennai Central -> Egmore corridor)
float lat = 13.0827;
float lng = 80.2707;
float speed = 35.0;
float heading = 45.0;
int sats = 6;

// Clear serial buffer
void cleanBuffer() {
  while (Serial.available()) Serial.read();
}

// Send command and check for expected token
bool execAT(const String& cmd, const char* expected, unsigned long timeout = 3000) {
  cleanBuffer();
  Serial.println(cmd);
  unsigned long t = millis();
  String resp = "";
  while (millis() - t < timeout) {
    while (Serial.available()) {
      resp += (char)Serial.read();
    }
    if (resp.indexOf(expected) != -1) return true;
    if (resp.indexOf("ERROR") != -1) return false;
  }
  return false;
}

// Wait for network registration (Home 0,1 or Roaming 0,5)
bool waitForNetwork() {
  for (int i = 0; i < 15; i++) {
    cleanBuffer();
    Serial.println("AT+CREG?");
    delay(500);
    String r = "";
    while (Serial.available()) r += (char)Serial.read();
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      return true;
    }
    delay(1000);
  }
  return false;
}

// Initialize BSNL 2G GPRS connection
bool initBSNLGPRS() {
  digitalWrite(LED_PIN, LOW);
  gprsOnline = false;

  // Auto-baud sync
  for (int i = 0; i < 3; i++) {
    execAT("AT", "OK", 800);
    delay(150);
  }

  execAT("ATE0", "OK", 1000);        // Echo off
  execAT("AT+CFUN=1", "OK", 2000);   // Full phone mode
  execAT("AT+CPIN?", "READY", 2000); // Check SIM ready

  // Wait for BSNL tower registration
  waitForNetwork();

  // Attach GPRS Packet service
  execAT("AT+CGATT=1", "OK", 4000);
  delay(300);

  // Close any stale SAPBR profile
  execAT("AT+SAPBR=0,1", "OK", 2000);
  delay(300);

  // Set GPRS context
  execAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 2000);
  
  // Set PDP context
  String pdp = String("AT+CGDCONT=1,\"IP\",\"") + BSNL_APN + "\"";
  execAT(pdp, "OK", 2000);

  // Try APN 1: bsnlnet
  String apn1 = String("AT+SAPBR=3,1,\"APN\",\"") + BSNL_APN + "\"";
  execAT(apn1, "OK", 2000);
  if (execAT("AT+SAPBR=1,1", "OK", 8000)) {
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  // Try APN 2: portalnmms (BSNL Tamil Nadu / Chennai)
  execAT("AT+SAPBR=3,1,\"APN\",\"portalnmms\"", "OK", 2000);
  if (execAT("AT+SAPBR=1,1", "OK", 8000)) {
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  // Try APN 3: www (Generic BSNL GPRS)
  execAT("AT+SAPBR=3,1,\"APN\",\"www\"", "OK", 2000);
  if (execAT("AT+SAPBR=1,1", "OK", 8000)) {
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  gprsOnline = false;
  return false;
}

// Send HTTP POST over SIM800L
bool sendGPSUpdate(float curLat, float curLng, float curSpeed, float curHeading, int curSats) {
  // Format JSON payload
  String json = String("{\"device_id\":\"") + DEVICE_ID +
                "\",\"api_key\":\""  + API_KEY + "\"" +
                ",\"lat\":"          + String(curLat, 6) +
                ",\"lng\":"          + String(curLng, 6) +
                ",\"speed_kmh\":"    + String(curSpeed, 1) +
                ",\"heading\":"      + String(curHeading, 1) +
                ",\"satellites\":"   + String(curSats) +
                ",\"fix_quality\":1,\"source\":\"arduino\"}";

  execAT("AT+HTTPTERM", "OK", 1000);
  delay(100);

  if (!execAT("AT+HTTPINIT", "OK", 3000)) return false;
  execAT("AT+HTTPSSL=1", "OK", 1000);
  
  String url = String("AT+HTTPPARA=\"URL\",\"") + SERVER_URL + "\"";
  execAT(url, "OK", 2000);
  execAT("AT+HTTPPARA=\"CID\",1", "OK", 1000);
  execAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 1000);

  String dataCmd = String("AT+HTTPDATA=") + json.length() + ",10000";
  if (execAT(dataCmd, "DOWNLOAD", 3000)) {
    Serial.println(json);
    delay(250);
  } else {
    execAT("AT+HTTPTERM", "OK", 1000);
    return false;
  }

  cleanBuffer();
  Serial.println("AT+HTTPACTION=1");
  unsigned long startAction = millis();
  bool success = false;
  while (millis() - startAction < 10000) {
    if (Serial.available()) {
      String line = Serial.readString();
      if (line.indexOf("200") != -1 || line.indexOf("+HTTPACTION: 1,200") != -1) {
        success = true;
        break;
      }
    }
  }

  execAT("AT+HTTPTERM", "OK", 1000);

  // Flash LED on successful live telemetry transmission
  if (success) {
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);
  }

  return success;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Hardware Serial (Pins 0 & 1) for SIM800L
  Serial.begin(9600);

  // SoftwareSerial (Pins 8 & 9) for NEO-6M GPS
  gpsSerial.begin(9600);

  delay(3000); // Stabilization
  initBSNLGPRS();
}

void loop() {
  // Read real GPS data from NEO-6M module
  gpsSerial.listen();
  unsigned long scan = millis();
  while (millis() - scan < 1000) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // If GPS has real satellite fix, use real satellites
  if (gps.location.isValid()) {
    lat     = gps.location.lat();
    lng     = gps.location.lng();
    speed   = gps.speed.kmph();
    heading = gps.course.deg();
    sats    = gps.satellites.value();
  } else {
    // Indoor smooth simulated route along Chennai corridor
    lat += (random(-5, 6) * 0.00004);
    lng += (random(-5, 6) * 0.00004);
    speed = 30.0 + random(0, 15);
    heading = (int)(heading + random(-10, 11) + 360) % 360;
  }

  // Send update every 4 seconds
  if (millis() - lastSend >= 4000) {
    lastSend = millis();

    if (!gprsOnline) {
      initBSNLGPRS();
    }

    if (gprsOnline) {
      bool ok = sendGPSUpdate(lat, lng, speed, heading, sats);
      if (!ok) {
        // Retry GPRS attach if dropped
        initBSNLGPRS();
      }
    }
  }
}
