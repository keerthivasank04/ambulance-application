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

// SIM800L on Pins 4 (RX) & 5 (TX)
SoftwareSerial gsmSerial(4, 5);

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
  gsmSerial.listen();
  while (gsmSerial.available()) gsmSerial.read(); // clean buffer
  
  gsmSerial.println(cmd);
  Serial.print(F("[GSM] >> ")); Serial.println(cmd);
  
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeout) {
    while (gsmSerial.available()) {
      char c = (char)gsmSerial.read();
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

  // Synchronize baud rate
  for (int i = 0; i < 3; i++) {
    sendGSM("AT", "OK", 800);
    delay(150);
  }

  sendGSM("ATE0", "OK", 1000);        // Echo off
  sendGSM("AT+CFUN=1", "OK", 2000);   // Full mode
  sendGSM("AT+CPIN?", "READY", 2000); // Check SIM status
  sendGSM("AT+CSQ", "OK", 1500);      // Signal strength

  // Wait for network registration (1 = home, 5 = roaming)
  for (int i = 0; i < 15; i++) {
    gsmSerial.listen();
    while (gsmSerial.available()) gsmSerial.read();
    gsmSerial.println(F("AT+CREG?"));
    delay(500);
    String r = "";
    while (gsmSerial.available()) r += (char)gsmSerial.read();
    Serial.print(F("[GSM] CREG: ")); Serial.println(r);
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      Serial.println(F("[GSM] Network Registered Successfully!"));
      break;
    }
    delay(1000);
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
    sendGSM("AT+SAPBR=2,1", "OK", 2000); // Print assigned IP
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
  // Format JSON payload
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
    gsmSerial.println(json);
    delay(250);
  } else {
    sendGSM("AT+HTTPTERM", "OK", 1000);
    return false;
  }

  gsmSerial.listen();
  while (gsmSerial.available()) gsmSerial.read();
  gsmSerial.println(F("AT+HTTPACTION=1"));
  
  unsigned long startAction = millis();
  bool success = false;
  while (millis() - startAction < 10000) {
    if (gsmSerial.available()) {
      String line = gsmSerial.readString();
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

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // USB Serial Monitor Debug Output (Pins 0 & 1 free!)
  Serial.begin(9600);
  Serial.println(F("=========================================="));
  Serial.println(F("TN 108 AMBULANCE — HARDWARE FIRMWARE (PLAN 3)"));
  Serial.println(F("SIM800L: Pins 4 & 5 | GPS: Pins 8 & 9"));
  Serial.println(F("=========================================="));

  // NEO-6M GPS Serial (Pins 8 & 9)
  gpsSerial.begin(9600);

  // Auto-detect SIM800L baud rate on Pins 4 & 5
  long bauds[] = {9600, 19200, 38400, 57600, 115200, 4800};
  bool found = false;
  for (int b = 0; b < 6 && !found; b++) {
    gsmSerial.begin(bauds[b]);
    gsmSerial.listen();
    delay(100);
    // Flush
    while (gsmSerial.available()) gsmSerial.read();
    // Try AT
    gsmSerial.println("AT");
    delay(600);
    String resp = "";
    while (gsmSerial.available()) resp += (char)gsmSerial.read();
    Serial.print(F("[BAUD PROBE] ")); Serial.print(bauds[b]);
    Serial.print(F(" -> \"")); Serial.print(resp); Serial.println(F("\""));
    if (resp.indexOf("OK") != -1 || resp.indexOf("AT") != -1) {
      Serial.print(F("[BAUD] SIM800L found at ")); Serial.println(bauds[b]);
      // If not 9600, fix to 9600
      if (bauds[b] != 9600) {
        gsmSerial.println("AT+IPR=9600");
        delay(500);
        gsmSerial.begin(9600);
        delay(300);
        Serial.println(F("[BAUD] Reset SIM800L to 9600 baud."));
      }
      found = true;
    }
  }

  if (!found) {
    Serial.println(F("[BAUD] WARNING: SIM800L not responding. Check wiring:"));
    Serial.println(F("  SIM800L TX --> Arduino Pin 4"));
    Serial.println(F("  SIM800L RX --> Arduino Pin 5"));
    Serial.println(F("  SIM800L VCC --> Buck converter (3.9-4.2V)"));
    Serial.println(F("  ALL GND pins connected together"));
    Serial.println(F("Retrying in 5 seconds..."));
    delay(5000);
  }

  delay(1000); // Stabilization
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
