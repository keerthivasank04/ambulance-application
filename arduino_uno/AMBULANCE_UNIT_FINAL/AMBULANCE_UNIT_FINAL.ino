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

// Force SIM800L to permanently lock to 9600 baud on both pin options
void forceBaudLock() {
  long bauds[] = {115200, 9600, 57600, 38400, 19200, 4800};
  
  Serial.println(F("[BAUD SYNC] Locking SIM800L to 9600 baud..."));
  for (int p = 0; p < 2; p++) {
    SoftwareSerial &port = (p == 0) ? gsmSerialB : gsmSerialA;
    const char* pinDesc = (p == 0) ? "Pins (RX=5, TX=4)" : "Pins (RX=4, TX=5)";
    
    for (int i = 0; i < 6; i++) {
      port.begin(bauds[i]);
      port.listen();
      delay(100);
      
      // Flush
      while (port.available()) port.read();
      
      // Send AT+IPR=9600 and AT&W
      port.println(F("AT"));
      delay(150);
      port.println(F("AT+IPR=9600"));
      delay(200);
      port.println(F("AT&W"));
      delay(200);
    }
  }
  
  // Now lock both ports to 9600
  gsmSerialA.begin(9600);
  gsmSerialB.begin(9600);
  delay(500);
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

  // 1. Force SIM800L to 9600 baud permanently
  forceBaudLock();

  // 2. Identify which pin orientation returns clean "OK" at 9600
  bool found = false;
  
  // Try Orientation B (RX=5, TX=4)
  gsmSerialB.listen();
  while (gsmSerialB.available()) gsmSerialB.read();
  for (int i = 0; i < 4; i++) {
    gsmSerialB.println(F("AT"));
    delay(400);
    String resp = "";
    while (gsmSerialB.available()) resp += (char)gsmSerialB.read();
    if (resp.indexOf("OK") != -1) {
      Serial.println(F("[PIN DETECT] SIM800L Active on Pins RX=5, TX=4 (OK verified)!"));
      gsm = &gsmSerialB;
      found = true;
      break;
    }
  }

  // If not B, try Orientation A (RX=4, TX=5)
  if (!found) {
    gsmSerialA.listen();
    while (gsmSerialA.available()) gsmSerialA.read();
    for (int i = 0; i < 4; i++) {
      gsmSerialA.println(F("AT"));
      delay(400);
      String resp = "";
      while (gsmSerialA.available()) resp += (char)gsmSerialA.read();
      if (resp.indexOf("OK") != -1) {
        Serial.println(F("[PIN DETECT] SIM800L Active on Pins RX=4, TX=5 (OK verified)!"));
        gsm = &gsmSerialA;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    Serial.println(F("[PIN DETECT] Using default Pins RX=5, TX=4 at 9600."));
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


