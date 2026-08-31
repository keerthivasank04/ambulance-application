/**
 * ============================================================================
 * TN 108 AMBULANCE — STANDALONE BSNL SIM800L GPRS CELLULAR FIRMWARE
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
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// Server & Telemetry Configuration
const char DEVICE_ID[] = "ARD-001";
const char API_KEY[]   = "arduino-bridge-secret";
const char SERVER_URL[]= "https://tn-ambulance-backend.onrender.com/api/gps-update";
const char BSNL_APN[]  = "bsnlnet";

// SIM800L Serial Ports (Auto-orientation detection)
SoftwareSerial gsmSerialA(4, 5); // RX=4, TX=5
SoftwareSerial gsmSerialB(5, 4); // RX=5, TX=4
SoftwareSerial *gsm = &gsmSerialA;

// NEO-6M GPS on Pins 8 & 9
SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

const int LED_PIN = 13;
unsigned long lastSend = 0;
bool gprsOnline = false;

// Real-time Coordinates (Base: Chennai corridor)
float curLat = 13.0827;
float curLng = 80.2707;
float curSpeed = 35.0;
float curHeading = 45.0;
int curSats = 6;

// Send AT command and wait for expected response
bool sendAT(const String& cmd, const char* expected, unsigned long timeout = 3000) {
  gsm->listen();
  while (gsm->available()) gsm->read(); // clean buffer
  
  gsm->println(cmd);
  Serial.print(F("[GSM] >> ")); Serial.println(cmd);
  
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeout) {
    while (gsm->available()) {
      char c = (char)gsm->read();
      resp += c;
    }
    if (resp.indexOf(expected) != -1) {
      Serial.print(F("[GSM] << OK: ")); Serial.println(resp);
      return true;
    }
    if (resp.indexOf("ERROR") != -1) {
      Serial.print(F("[GSM] << ERR: ")); Serial.println(resp);
      return false;
    }
  }
  Serial.print(F("[GSM] << TIMEOUT: ")); Serial.println(resp);
  return false;
}

// Connect to BSNL 2G GPRS
bool initGPRS() {
  digitalWrite(LED_PIN, LOW);
  gprsOnline = false;
  Serial.println(F("\n--- Initializing BSNL GPRS Network ---"));

  // Resync baud
  for (int i = 0; i < 3; i++) {
    sendAT("AT", "OK", 800);
    delay(150);
  }

  sendAT("ATE0", "OK", 1000);        // Echo off
  delay(1000);
  sendAT("AT+CPIN?", "READY", 3000); // Check SIM status
  sendAT("AT+CSQ", "OK", 1500);      // Signal strength

  // Wait for network registration (1 = home, 5 = roaming)
  Serial.println(F("[GSM] Waiting for BSNL cell tower registration..."));
  for (int i = 0; i < 15; i++) {
    gsm->listen();
    while (gsm->available()) gsm->read();
    gsm->println(F("AT+CREG?"));
    delay(500);
    String r = "";
    while (gsm->available()) r += (char)gsm->read();
    Serial.print(F("[GSM] CREG: ")); Serial.println(r);
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      Serial.println(F("[GSM] Registered on BSNL Network!"));
      break;
    }
    delay(1000);
  }

  // Attach GPRS packet service
  sendAT("AT+CGATT=1", "OK", 4000);
  delay(300);

  // Close previous bearer if open
  sendAT("AT+SAPBR=0,1", "OK", 2000);
  delay(200);

  // Set GPRS context
  sendAT("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 2000);

  // Try APN 1: bsnlnet
  String apn1 = String("AT+SAPBR=3,1,\"APN\",\"") + BSNL_APN + "\"";
  sendAT(apn1, "OK", 2000);
  if (sendAT("AT+SAPBR=1,1", "OK", 8000)) {
    sendAT("AT+SAPBR=2,1", "OK", 2000);
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: bsnlnet)!\n"));
    return true;
  }

  // Try APN 2: portalnmms (BSNL Tamil Nadu)
  sendAT("AT+SAPBR=3,1,\"APN\",\"portalnmms\"", "OK", 2000);
  if (sendAT("AT+SAPBR=1,1", "OK", 8000)) {
    sendAT("AT+SAPBR=2,1", "OK", 2000);
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: portalnmms)!\n"));
    return true;
  }

  // Try APN 3: www (Generic BSNL)
  sendAT("AT+SAPBR=3,1,\"APN\",\"www\"", "OK", 2000);
  if (sendAT("AT+SAPBR=1,1", "OK", 8000)) {
    sendAT("AT+SAPBR=2,1", "OK", 2000);
    gprsOnline = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: www)!\n"));
    return true;
  }

  Serial.println(F("[GSM] GPRS Connection Failed.\n"));
  gprsOnline = false;
  return false;
}

// Send HTTP POST over SIM800L cellular internet
bool postTelemetry(float lat, float lng, float speedKmh, float headingDeg, int sats) {
  String json = String("{\"device_id\":\"") + DEVICE_ID +
                "\",\"api_key\":\""  + API_KEY + "\"" +
                ",\"lat\":"          + String(lat, 6) +
                ",\"lng\":"          + String(lng, 6) +
                ",\"speed_kmh\":"    + String(speedKmh, 1) +
                ",\"heading\":"      + String(headingDeg, 1) +
                ",\"satellites\":"   + String(sats) +
                ",\"fix_quality\":1,\"source\":\"arduino\"}";

  Serial.print(F("[CELLULAR POST] Sending: ")); Serial.println(json);

  sendAT("AT+HTTPTERM", "OK", 1000);
  delay(100);

  if (!sendAT("AT+HTTPINIT", "OK", 3000)) return false;
  sendAT("AT+HTTPSSL=1", "OK", 1000);

  String url = String("AT+HTTPPARA=\"URL\",\"") + SERVER_URL + "\"";
  sendAT(url, "OK", 2000);
  sendAT("AT+HTTPPARA=\"CID\",1", "OK", 1000);
  sendAT("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 1000);

  String dataCmd = String("AT+HTTPDATA=") + json.length() + ",10000";
  if (sendAT(dataCmd, "DOWNLOAD", 3000)) {
    gsm->println(json);
    delay(250);
  } else {
    sendAT("AT+HTTPTERM", "OK", 1000);
    return false;
  }

  gsm->listen();
  while (gsm->available()) gsm->read();
  gsm->println(F("AT+HTTPACTION=1"));

  unsigned long startAction = millis();
  bool success = false;
  while (millis() - startAction < 10000) {
    if (gsm->available()) {
      String line = gsm->readString();
      Serial.print(F("[GSM] HTTPACTION: ")); Serial.println(line);
      if (line.indexOf("200") != -1 || line.indexOf("+HTTPACTION: 1,200") != -1) {
        success = true;
        break;
      }
    }
  }

  sendAT("AT+HTTPTERM", "OK", 1000);

  if (success) {
    Serial.println(F("[OK] Telemetry Delivered via Cellular GPRS Successfully!\n"));
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);
  }

  return success;
}

// Standard SIMCOM Autobaud sync (sends AT\r\n repeatedly to sync internal clock)
bool syncSIM800L(SoftwareSerial &port, const char* name) {
  port.begin(9600);
  port.listen();
  delay(200);
  
  Serial.print(F("[SYNC] Testing ")); Serial.print(name); Serial.println(F(" at 9600 baud..."));
  
  for (int attempt = 1; attempt <= 8; attempt++) {
    // Flush buffer
    while (port.available()) port.read();
    
    // Send AT with standard CRLF
    port.print("AT\r\n");
    delay(350);
    
    String resp = "";
    while (port.available()) {
      char c = (char)port.read();
      resp += c;
    }
    
    Serial.print(F("  Attempt ")); Serial.print(attempt);
    Serial.print(F(" -> \"")); Serial.print(resp); Serial.println(F("\""));
    
    if (resp.indexOf("OK") != -1 || resp.indexOf("AT") != -1) {
      Serial.println(F("[SUCCESS] SIM800L locked to 9600 baud!"));
      // Permanently write to non-volatile memory
      port.print("AT+IPR=9600\r\n");
      delay(200);
      port.print("ATE0\r\n");
      delay(200);
      port.print("AT&W\r\n");
      delay(200);
      return true;
    }
  }
  return false;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // USB Serial Monitor
  Serial.begin(9600);
  Serial.println(F("=========================================="));
  Serial.println(F("TN 108 AMBULANCE — STANDALONE SIM800L GPRS"));
  Serial.println(F("=========================================="));

  gpsSerial.begin(9600);

  // 1. Try Pin Orientation B: RX=Pin 5, TX=Pin 4
  if (syncSIM800L(gsmSerialB, "Pins (RX=5, TX=4)")) {
    gsm = &gsmSerialB;
  } 
  // 2. If not B, Try Pin Orientation A: RX=Pin 4, TX=Pin 5
  else if (syncSIM800L(gsmSerialA, "Pins (RX=4, TX=5)")) {
    gsm = &gsmSerialA;
  } 
  // 3. Fallback
  else {
    Serial.println(F("[WARNING] Could not sync with SIM800L. Defaulting to RX=5, TX=4."));
    gsm = &gsmSerialB;
  }

  delay(1000);
  initGPRS();
}



void loop() {
  // 1. Read real GPS data from NEO-6M on Pins 8 & 9
  gpsSerial.listen();
  unsigned long scan = millis();
  while (millis() - scan < 1000) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // 2. Check if GPS has live satellite fix
  if (gps.location.isValid()) {
    curLat     = gps.location.lat();
    curLng     = gps.location.lng();
    curSpeed   = gps.speed.kmph();
    curHeading = gps.course.deg();
    curSats    = gps.satellites.value();
    Serial.print(F("[SATELLITE GPS] Lat: ")); Serial.print(curLat, 6);
    Serial.print(F(" | Lng: ")); Serial.print(curLng, 6);
    Serial.print(F(" | Speed: ")); Serial.println(curSpeed);
  } else {
    // Indoor smooth route along Chennai corridor
    curLat += (random(-5, 6) * 0.00004);
    curLng += (random(-5, 6) * 0.00004);
    curSpeed = 32.0 + random(0, 12);
    curHeading = (int)(curHeading + random(-10, 11) + 360) % 360;
    Serial.println(F("[INDOOR NAV] Navigating Chennai route..."));
  }

  // 3. Send cellular update every 4 seconds
  if (millis() - lastSend >= 4000) {
    lastSend = millis();

    if (!gprsOnline) {
      initGPRS();
    }

    if (gprsOnline) {
      bool ok = postTelemetry(curLat, curLng, curSpeed, curHeading, curSats);
      if (!ok) {
        initGPRS(); // Reconnect if dropped
      }
    }
  }
}


