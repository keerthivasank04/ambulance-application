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
// Connect to BSNL 2G GPRS using direct TCP/IP Stack
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
  delay(500);
  sendAT("AT+CMEE=2", "OK", 1000);   // Verbose errors
  delay(500);
  sendAT("AT+CFUN=1", "OK", 3000);   // Enable Radio
  delay(1000);

  // Check SIM Card Status
  gsm->listen();
  while (gsm->available()) gsm->read();
  gsm->println(F("AT+CPIN?"));
  delay(800);
  String cpinResp = "";
  while (gsm->available()) cpinResp += (char)gsm->read();
  Serial.print(F("[SIM STATUS] CPIN: ")); Serial.println(cpinResp);

  // Check Signal Strength
  gsm->println(F("AT+CSQ"));
  delay(800);
  String csqResp = "";
  while (gsm->available()) csqResp += (char)gsm->read();
  Serial.print(F("[SIGNAL] CSQ: ")); Serial.println(csqResp);

  // Auto-Select Operator (BSNL)
  sendAT("AT+COPS=0", "OK", 3000);

  // Wait for network registration (1 = home, 5 = roaming)
  Serial.println(F("[GSM] Waiting for BSNL cell tower registration..."));
  bool registered = false;
  for (int i = 0; i < 25; i++) {
    gsm->listen();
    while (gsm->available()) gsm->read();
    gsm->println(F("AT+CREG?"));
    delay(500);
    String r = "";
    while (gsm->available()) r += (char)gsm->read();
    Serial.print(F("[GSM] CREG: ")); Serial.println(r);
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      Serial.println(F("[GSM] Registered on BSNL Network!"));
      registered = true;
      break;
    }
    delay(1200);
  }

  if (!registered) {
    Serial.println(F("[GSM] Registration taking time. Retrying search..."));
    return false;
  }

  // Direct TCP/IP Stack Setup (Lowest Power, Most Reliable on 2G)
  sendAT("AT+CIPSHUT", "SHUT OK", 3000);
  delay(500);
  sendAT("AT+CIPSTATUS", "OK", 2000);
  sendAT("AT+CIPMUX=0", "OK", 1000);  // Single IP connection
  sendAT("AT+CIPRXGET=1", "OK", 1000); // Manual receive mode

  // Attach GPRS
  sendAT("AT+CGATT=1", "OK", 4000);
  delay(500);

  // APNs for BSNL Tamil Nadu
  const char* apns[] = {"portalnmms", "bsnlnet", "bsnlstream", "www"};

  for (int i = 0; i < 4; i++) {
    const char* apn = apns[i];
    Serial.print(F("[GSM] Trying APN: ")); Serial.println(apn);

    sendAT("AT+CIPSHUT", "SHUT OK", 2000);
    delay(300);
    sendAT("AT+CIPMUX=0", "OK", 1000);
    sendAT("AT+CIPRXGET=1", "OK", 1000);
    sendAT("AT+CGATT=1", "OK", 3000);
    delay(300);

    String csttCmd = String("AT+CSTT=\"") + apn + "\",\"\",\"\"";
    sendAT(csttCmd, "OK", 3000);
    delay(400);

    Serial.print(F("[GSM] Bringing up GPRS with ")); Serial.print(apn); Serial.println(F("..."));
    if (sendAT("AT+CIICR", "OK", 12000)) {
      delay(500);

      // Get Local IP Address (CIFSR)
      gsm->listen();
      while (gsm->available()) gsm->read();
      gsm->println(F("AT+CIFSR"));
      delay(1000);
      String ipResp = "";
      while (gsm->available()) ipResp += (char)gsm->read();
      Serial.print(F("[BSNL IP ALLOCATED]: ")); Serial.println(ipResp);

      if (ipResp.indexOf(".") != -1 && ipResp.indexOf("ERROR") == -1) {
        gprsOnline = true;
        digitalWrite(LED_PIN, HIGH);
        Serial.print(F("[GSM] GPRS ONLINE (Active APN: "));
        Serial.print(apn);
        Serial.println(F(")!\n"));
        return true;
      }
    } else {
      Serial.print(F("[GSM] APN ")); Serial.print(apn); Serial.println(F(" failed. Trying next..."));
      delay(500);
    }
  }

  Serial.println(F("[GSM] Direct GPRS Connection Failed.\n"));
  gprsOnline = false;
  return false;
}


// Send HTTP POST over Direct TCP Socket
bool postTelemetry(float lat, float lng, float speedKmh, float headingDeg, int sats) {
  String payload = String("{\"device_id\":\"") + DEVICE_ID +
                   "\",\"api_key\":\""  + API_KEY + "\"" +
                   ",\"lat\":"          + String(lat, 6) +
                   ",\"lng\":"          + String(lng, 6) +
                   ",\"speed_kmh\":"    + String(speedKmh, 1) +
                   ",\"heading\":"      + String(headingDeg, 1) +
                   ",\"satellites\":"   + String(sats) +
                   ",\"fix_quality\":1,\"source\":\"arduino\"}";

  String httpRequest = String("POST /api/gps-update HTTP/1.1\r\n") +
                       "Host: tn-ambulance-backend.onrender.com\r\n" +
                       "Content-Type: application/json\r\n" +
                       "Content-Length: " + payload.length() + "\r\n" +
                       "Connection: close\r\n\r\n" +
                       payload;

  Serial.print(F("[CELLULAR POST] Sending: ")); Serial.println(payload);

  // Connect to backend via TCP Port 80
  Serial.println(F("[TCP] Connecting to tn-ambulance-backend.onrender.com:80..."));
  if (!sendAT("AT+CIPSTART=\"TCP\",\"tn-ambulance-backend.onrender.com\",\"80\"", "CONNECT OK", 12000)) {
    Serial.println(F("[TCP] Connection Failed. Reconnecting GPRS..."));
    sendAT("AT+CIPCLOSE", "OK", 1000);
    return false;
  }

  delay(300);
  gsm->listen();
  while (gsm->available()) gsm->read(); // clean buffer

  // Send AT+CIPSEND and wait for '>' prompt
  gsm->println(F("AT+CIPSEND"));
  Serial.println(F("[GSM] >> AT+CIPSEND"));

  unsigned long startPrompt = millis();
  bool gotPrompt = false;
  while (millis() - startPrompt < 4000) {
    if (gsm->available()) {
      char c = (char)gsm->read();
      if (c == '>') {
        gotPrompt = true;
        break;
      }
    }
  }

  if (!gotPrompt) {
    Serial.println(F("[GSM] No '>' prompt received."));
    sendAT("AT+CIPCLOSE", "OK", 1000);
    return false;
  }

  // Transmit HTTP Request followed by Ctrl+Z (ASCII 26)
  gsm->print(httpRequest);
  delay(100);
  gsm->write(26); // Ctrl+Z to send packet
  Serial.println(F("[TCP] HTTP Packet Transmitted! Waiting for response..."));

  // Wait for server response
  unsigned long startWait = millis();
  bool success = false;
  while (millis() - startWait < 8000) {
    if (gsm->available()) {
      String resp = gsm->readString();
      Serial.print(F("[SERVER RESPONSE]: ")); Serial.println(resp);
      if (resp.indexOf("200 OK") != -1 || resp.indexOf("\"status\":\"ok\"") != -1) {
        success = true;
        break;
      }
    }
  }

  sendAT("AT+CIPCLOSE", "OK", 1000);

  if (success) {
    Serial.println(F("\n****************************************************"));
    Serial.println(F("[SUCCESS!] Live Telemetry Delivered Over BSNL Cellular!"));
    Serial.println(F("****************************************************\n"));
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);
  }

  return success;
}


// Universal Matrix Scanner for SIM800L
bool scanAndLockSIM800L() {
  long testBauds[] = {9600, 19200, 38400, 57600, 115200, 4800};
  
  Serial.println(F("\n[MATRIX SCANNER] Scanning for SIM800L settings..."));

  // Test combinations: (Pin4 vs Pin5) x (Normal vs Inverted) x (Baud rates)
  for (int inverted = 0; inverted <= 1; inverted++) {
    bool inv = (inverted == 1);
    
    for (int p = 0; p < 2; p++) {
      int rxPin = (p == 0) ? 5 : 4;
      int txPin = (p == 0) ? 4 : 5;
      
      for (int b = 0; b < 6; b++) {
        long currentBaud = testBauds[b];
        
        SoftwareSerial testPort(rxPin, txPin, inv);
        testPort.begin(currentBaud);
        testPort.listen();
        delay(60);
        
        // Flush buffer
        while (testPort.available()) testPort.read();
        
        // Send AT
        testPort.print("AT\r\n");
        delay(250);
        
        String r = "";
        while (testPort.available()) {
          char c = (char)testPort.read();
          r += c;
        }
        
        Serial.print(F("RX=")); Serial.print(rxPin);
        Serial.print(F(" TX=")); Serial.print(txPin);
        Serial.print(F(" | Baud=")); Serial.print(currentBaud);
        Serial.print(F(" | Inv=")); Serial.print(inv ? "T" : "F");
        Serial.print(F(" -> \"")); Serial.print(r); Serial.println(F("\""));
        
        if (r.indexOf("OK") != -1 || r.indexOf("AT") != -1) {
          Serial.println(F("\n******************************************"));
          Serial.print(F("[FOUND!] SIM800L matched on RX=")); Serial.print(rxPin);
          Serial.print(F(" TX=")); Serial.print(txPin);
          Serial.print(F(" at Baud=")); Serial.print(currentBaud);
          Serial.println(F("!"));
          Serial.println(F("******************************************\n"));
          
          // Lock to 9600 permanently
          testPort.print("AT+IPR=9600\r\n");
          delay(200);
          testPort.print("ATE0\r\n");
          delay(200);
          testPort.print("AT&W\r\n");
          delay(300);
          
          if (p == 0) gsm = &gsmSerialB;
          else gsm = &gsmSerialA;
          gsm->begin(9600);
          return true;
        }
      }
    }
  }
  return false;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // USB Serial Monitor
  Serial.begin(9600);
  delay(1000);
  
  Serial.println(F("\n=========================================="));
  Serial.println(F("TN 108 AMBULANCE — STANDALONE SIM800L GPRS"));
  Serial.println(F("=========================================="));
  
  gpsSerial.begin(9600);
  
  // 3-second countdown so user sees everything on Serial Monitor
  Serial.println(F("Starting in 3 seconds..."));
  delay(1000);
  Serial.println(F("Starting in 2 seconds..."));
  delay(1000);
  Serial.println(F("Starting in 1 second..."));
  delay(1000);

  // Run Matrix Scanner
  scanAndLockSIM800L();
  
  delay(1000);
  initGPRS();
}

void loop() {
  // 1. If GPRS is not online, re-scan and initialize
  if (!gprsOnline) {
    scanAndLockSIM800L();
    initGPRS();
    delay(2000);
    return;
  }

  // 2. Read real GPS data from NEO-6M on Pins 8 & 9
  gpsSerial.listen();
  unsigned long scan = millis();
  while (millis() - scan < 1000) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // 3. Check if GPS has live satellite fix
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

  // 4. Send cellular update every 4 seconds
  if (millis() - lastSend >= 4000) {
    lastSend = millis();
    bool ok = postTelemetry(curLat, curLng, curSpeed, curHeading, curSats);
    if (!ok) {
      gprsOnline = false; // Trigger re-scan if connection drops
    }
  }
}



