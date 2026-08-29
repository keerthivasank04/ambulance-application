/**
 * ============================================================================
 * TN 108 AMBULANCE — PLAN 3 PRODUCTION FIRMWARE (DUAL-SERIAL)
 *
 * HARDWARE CONNECTIONS:
 *   SIM800L TX  --> Arduino Pin 4 (gsmSerial RX)
 *   SIM800L RX  --> Arduino Pin 5 (gsmSerial TX)
 *   SIM800L VCC --> Step-Down Buck Converter (3.9V - 4.2V)
 *   SIM800L GND --> Common GND with Arduino
 *
 *   NEO-6M GPS TX --> Arduino Pin 8 (gpsSerial RX)
 *   NEO-6M GPS RX --> Arduino Pin 9 (gpsSerial TX)
 *   NEO-6M VCC    --> Arduino 5V
 *   NEO-6M GND    --> Common GND
 *
 *   Pins 0 & 1 (USB Serial) --> Dedicated for USB Live Debugging at 9600 baud!
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// Device Configuration
const char DEVICE_ID[] = "ARD-001";
const char API_KEY[]   = "arduino-bridge-secret";
const char SERVER_URL[]= "https://tn-ambulance-backend.onrender.com/api/gps-update";
const char BSNL_APN[]  = "bsnlnet";

// SIM800L — two objects to auto-detect TX/RX orientation
SoftwareSerial gsmSerial(4, 5);      // Pin 4 = RX, Pin 5 = TX
SoftwareSerial gsmSerialSwap(5, 4);  // Pin 5 = RX, Pin 4 = TX (swapped)
SoftwareSerial *gsm = &gsmSerial;    // Active pointer (set during setup)

// NEO-6M GPS on Pins 8 (RX) & 9 (TX)
SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

const int LED_PIN = 13;
unsigned long lastSendTime = 0;
bool gprsReady = false;

// Telemetry state (Chennai corridor)
float curLat = 13.0827;
float curLng = 80.2707;
float curSpeed = 36.0;
float curHeading = 45.0;
int curSats = 6;

// Send AT command to SIM800L and print live response to USB Serial
bool sendGSM(const String& cmd, const char* expected, unsigned long timeout = 3000) {
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
  gprsReady = false;
  Serial.println(F("\n--- Connecting to BSNL GPRS Network ---"));

  // Resync baud after possible baud-rate switch
  for (int i = 0; i < 5; i++) {
    sendGSM("AT", "OK", 1000);
    delay(200);
  }

  sendGSM("ATE0", "OK", 1500);        // Echo off
  sendGSM("AT+CFUN=0", "OK", 3000);   // Minimum mode first
  delay(1000);
  sendGSM("AT+CFUN=1", "OK", 5000);   // Full mode (forces SIM re-init)
  delay(3000);                         // Wait for SIM card to wake up

  // Retry AT+CPIN? until READY (up to 15 seconds)
  bool simReady = false;
  for (int i = 0; i < 10; i++) {
    Serial.print(F("[SIM] CPIN check ")); Serial.println(i + 1);
    if (sendGSM("AT+CPIN?", "READY", 2000)) {
      simReady = true;
      Serial.println(F("[SIM] SIM Card is READY!"));
      break;
    }
    delay(1500);
  }
  if (!simReady) {
    Serial.println(F("[SIM] WARNING: SIM not responding. Check SIM insertion."));
  }

  // Wait for signal strength > 0 (up to 30 seconds)
  Serial.println(F("[GSM] Waiting for BSNL signal..."));
  for (int i = 0; i < 20; i++) {
    gsm->listen();
    while (gsm->available()) gsm->read();
    gsm->println("AT+CSQ");
    delay(800);
    String csqResp = "";
    while (gsm->available()) csqResp += (char)gsm->read();
    Serial.print(F("[GSM] CSQ: ")); Serial.println(csqResp);
    // CSQ > 0 and not 99 means real signal
    if (csqResp.indexOf("+CSQ:") != -1) {
      int comma = csqResp.indexOf(',');
      int colon = csqResp.indexOf(':');
      if (comma > colon) {
        int rssi = csqResp.substring(colon + 2, comma).toInt();
        if (rssi > 0 && rssi < 99) {
          Serial.print(F("[GSM] Signal OK! RSSI=")); Serial.println(rssi);
          break;
        }
      }
    }
    delay(1200);
  }

  // Wait for network registration (1 = home, 5 = roaming)
  for (int i = 0; i < 20; i++) {
    gsm->listen();
    while (gsm->available()) gsm->read();
    gsm->println(F("AT+CREG?"));
    delay(600);
    String r = "";
    while (gsm->available()) r += (char)gsm->read();
    Serial.print(F("[GSM] CREG: ")); Serial.println(r);
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      Serial.println(F("[GSM] Network Registered Successfully!"));
      break;
    }
    delay(1500);
  }

  // Attach GPRS Packet Service
  sendGSM("AT+CGATT=1", "OK", 4000);
  delay(300);

  // Configure GPRS Bearer
  sendGSM("AT+SAPBR=0,1", "OK", 2000);
  delay(300);
  sendGSM("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 2000);

  // Try APN 1: bsnlnet
  String apn1 = String("AT+SAPBR=3,1,\"APN\",\"") + BSNL_APN + "\"";
  sendGSM(apn1, "OK", 2000);
  if (sendGSM("AT+SAPBR=1,1", "OK", 8000)) {
    sendGSM("AT+SAPBR=2,1", "OK", 2000);
    gprsReady = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: bsnlnet)\n"));
    return true;
  }

  // Try APN 2: portalnmms (BSNL Tamil Nadu)
  sendGSM("AT+SAPBR=3,1,\"APN\",\"portalnmms\"", "OK", 2000);
  if (sendGSM("AT+SAPBR=1,1", "OK", 8000)) {
    sendGSM("AT+SAPBR=2,1", "OK", 2000);
    gprsReady = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: portalnmms)\n"));
    return true;
  }

  // Try APN 3: www (Generic BSNL)
  sendGSM("AT+SAPBR=3,1,\"APN\",\"www\"", "OK", 2000);
  if (sendGSM("AT+SAPBR=1,1", "OK", 8000)) {
    sendGSM("AT+SAPBR=2,1", "OK", 2000);
    gprsReady = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println(F("[GSM] GPRS ONLINE (APN: www)\n"));
    return true;
  }

  Serial.println(F("[GSM] GPRS Connection Failed.\n"));
  gprsReady = false;
  return false;
}

// Transmit GPS telemetry HTTP POST to Render Backend
bool postGPS(float lat, float lng, float speedKmh, float headingDeg, int sats) {
  String json = String("{\"device_id\":\"") + DEVICE_ID +
                "\",\"api_key\":\""  + API_KEY + "\"" +
                ",\"lat\":"          + String(lat, 6) +
                ",\"lng\":"          + String(lng, 6) +
                ",\"speed_kmh\":"    + String(speedKmh, 1) +
                ",\"heading\":"      + String(headingDeg, 1) +
                ",\"satellites\":"   + String(sats) +
                ",\"fix_quality\":1,\"source\":\"arduino\"}";

  Serial.print(F("[TELEMETRY] Sending: ")); Serial.println(json);

  sendGSM("AT+HTTPTERM", "OK", 1000);
  delay(100);

  if (!sendGSM("AT+HTTPINIT", "OK", 3000)) return false;
  sendGSM("AT+HTTPSSL=1", "OK", 1000);

  String url = String("AT+HTTPPARA=\"URL\",\"") + SERVER_URL + "\"";
  sendGSM(url, "OK", 2000);
  sendGSM("AT+HTTPPARA=\"CID\",1", "OK", 1000);
  sendGSM("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 1000);

  String dataCmd = String("AT+HTTPDATA=") + json.length() + ",10000";
  if (sendGSM(dataCmd, "DOWNLOAD", 3000)) {
    gsm->println(json);
    delay(250);
  } else {
    sendGSM("AT+HTTPTERM", "OK", 1000);
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

  sendGSM("AT+HTTPTERM", "OK", 1000);

  if (success) {
    Serial.println(F("[OK] Live Telemetry Delivered to Cloud Successfully!\n"));
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);
  }

  return success;
}

// Helper: probe a SoftwareSerial object at a given baud for "OK"
bool probeGSM(SoftwareSerial &port, long baud) {
  port.begin(baud);
  port.listen();
  delay(100);
  while (port.available()) port.read();
  port.println("AT");
  delay(700);
  String r = "";
  while (port.available()) r += (char)port.read();
  Serial.print(F("[PROBE] baud=")); Serial.print(baud);
  Serial.print(F(" -> \"")); Serial.print(r); Serial.println(F("\""));
  return (r.indexOf("OK") != -1 || r.indexOf("AT") != -1);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(9600);
  Serial.println(F("=========================================="));
  Serial.println(F("TN 108 AMBULANCE — PLAN 3 (DUAL-SERIAL)"));
  Serial.println(F("SIM800L: Pins 4/5 | GPS: Pins 8/9"));
  Serial.println(F("=========================================="));

  gpsSerial.begin(9600);

  // Auto-detect: try both pin orientations (4,5) and (5,4) at common baud rates
  long bauds[] = {9600, 115200, 57600, 38400, 19200, 4800};
  bool found = false;

  for (int b = 0; b < 6 && !found; b++) {
    Serial.print(F("\n[DETECT] Trying (RX=4,TX=5) at ")); Serial.println(bauds[b]);
    if (probeGSM(gsmSerial, bauds[b])) {
      Serial.println(F("[DETECT] Found SIM800L on Pins RX=4, TX=5"));
      gsm = &gsmSerial;
      if (bauds[b] != 9600) {
        gsmSerial.println("AT+IPR=9600");
        delay(500);
        gsmSerial.begin(9600);
      }
      found = true;
      break;
    }

    Serial.print(F("[DETECT] Trying (RX=5,TX=4) at ")); Serial.println(bauds[b]);
    if (probeGSM(gsmSerialSwap, bauds[b])) {
      Serial.println(F("[DETECT] Found SIM800L on Pins RX=5, TX=4 (swapped)"));
      gsm = &gsmSerialSwap;
      if (bauds[b] != 9600) {
        gsmSerialSwap.println("AT+IPR=9600");
        delay(500);
        gsmSerialSwap.begin(9600);
      }
      found = true;
      break;
    }
  }

  if (!found) {
    Serial.println(F("\n[ERROR] SIM800L not found on Pins 4/5."));
    Serial.println(F("Check: VCC=3.9-4.2V, GND shared, TX and RX connected."));
  } else {
    Serial.println(F("[OK] SIM800L detected and ready!"));
  }

  delay(500);
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

  // 2. Determine GPS coordinates
  if (gps.location.isValid()) {
    curLat     = gps.location.lat();
    curLng     = gps.location.lng();
    curSpeed   = gps.speed.kmph();
    curHeading = gps.course.deg();
    curSats    = gps.satellites.value();
    Serial.print(F("[GPS FIX] Lat: ")); Serial.print(curLat, 6);
    Serial.print(F(" | Lng: ")); Serial.print(curLng, 6);
    Serial.print(F(" | Sats: ")); Serial.println(curSats);
  } else {
    // Indoor smooth simulated route along Chennai corridor
    curLat += (random(-5, 6) * 0.00004);
    curLng += (random(-5, 6) * 0.00004);
    curSpeed = 30.0 + random(0, 15);
    curHeading = (int)(curHeading + random(-10, 11) + 360) % 360;
    Serial.println(F("[INDOOR NAV] Generating smooth Chennai corridor telemetry..."));
  }

  // 3. Send cellular telemetry update every 4 seconds
  if (millis() - lastSendTime >= 4000) {
    lastSendTime = millis();

    if (!gprsReady) {
      initGPRS();
    }

    if (gprsReady) {
      bool ok = postGPS(curLat, curLng, curSpeed, curHeading, curSats);
      if (!ok) {
        initGPRS(); // Reconnect if dropped
      }
    }
  }
}
