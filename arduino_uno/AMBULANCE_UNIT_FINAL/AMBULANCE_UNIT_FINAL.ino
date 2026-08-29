/**
 * ============================================================================
 * TN 108 AMBULANCE — STANDALONE BSNL SIM800L + NEO-6M GPS FIRMWARE
 *
 * HARDWARE CONNECTIONS:
 *   SIM800L TX  --> Arduino Pin 0 (RX)
 *   SIM800L RX  --> Arduino Pin 1 (TX)
 *   SIM800L VCC --> External 3.7V - 4.2V Power (or 5V with diode/regulator)
 *   SIM800L GND --> Common GND with Arduino
 *
 *   NEO-6M GPS TX --> Arduino Pin 8 (gpsSerial RX)
 *   NEO-6M GPS RX --> Arduino Pin 9 (gpsSerial TX)
 *   NEO-6M VCC    --> Arduino 5V
 *   NEO-6M GND    --> Common GND
 *
 * NETWORK:
 *   SIM Card: BSNL (APN: bsnlnet)
 *   Server  : https://tn-ambulance-backend.onrender.com/api/gps-update
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

// Device Credentials
const char DEVICE_ID[] = "ARD-001";
const char API_KEY[]   = "arduino-bridge-secret";
const char SERVER[]    = "https://tn-ambulance-backend.onrender.com/api/gps-update";
const char APN[]       = "bsnlnet";

// SoftwareSerial for NEO-6M GPS
SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

const int LED_PIN = 13;
unsigned long lastSendTime = 0;
bool gprsConnected = false;

// Coordinates
float currentLat = 13.0827;
float currentLng = 80.2707;
float currentSpeed = 0.0;
float currentHeading = 0.0;
int currentSats = 0;

// Flush hardware serial buffer
void flushSerial() {
  while (Serial.available()) Serial.read();
}

// Send AT command and wait for expected response
bool sendCmd(const char* cmd, const char* expected, unsigned long timeoutMs = 3000) {
  flushSerial();
  Serial.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (Serial.available()) {
      char c = (char)Serial.read();
      resp += c;
    }
    if (resp.indexOf(expected) != -1) return true;
    if (resp.indexOf("ERROR") != -1) return false;
  }
  return false;
}

// Connect to BSNL GPRS network
bool setupGPRS() {
  digitalWrite(LED_PIN, LOW);
  gprsConnected = false;
  
  // Synchronize baud rate
  for (int i = 0; i < 3; i++) {
    sendCmd("AT", "OK", 1000);
    delay(200);
  }

  sendCmd("ATE0", "OK", 1000);        // Echo off
  sendCmd("AT+CFUN=1", "OK", 2000);   // Full phone functionality
  sendCmd("AT+CPIN?", "READY", 2000); // Check SIM status
  sendCmd("AT+CSQ", "OK", 1500);      // Check signal strength

  // Wait for network registration (home network 1 or roaming 5)
  for (int i = 0; i < 15; i++) {
    flushSerial();
    Serial.println("AT+CREG?");
    delay(500);
    String r = "";
    while (Serial.available()) r += (char)Serial.read();
    if (r.indexOf(",1") != -1 || r.indexOf(",5") != -1) {
      break;
    }
    delay(1000);
  }

  // 1. Attach to GPRS service (Required for BSNL 2G)
  sendCmd("AT+CGATT=1", "OK", 4000);
  delay(500);

  // 2. Configure GPRS Bearer profile
  sendCmd("AT+SAPBR=0,1", "OK", 2000); // Close old bearer if active
  delay(500);
  sendCmd("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", "OK", 2000);
  
  // Try APN 1: bsnlnet
  String apnCmd = String("AT+SAPBR=3,1,\"APN\",\"") + APN + "\"";
  sendCmd(apnCmd.c_str(), "OK", 2000);
  if (sendCmd("AT+SAPBR=1,1", "OK", 8000)) {
    sendCmd("AT+SAPBR=2,1", "OK", 2000); // Print assigned IP
    gprsConnected = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  // Try APN 2: portalnmms (BSNL South India)
  sendCmd("AT+SAPBR=3,1,\"APN\",\"portalnmms\"", "OK", 2000);
  if (sendCmd("AT+SAPBR=1,1", "OK", 8000)) {
    sendCmd("AT+SAPBR=2,1", "OK", 2000);
    gprsConnected = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  // Try APN 3: www (Generic BSNL)
  sendCmd("AT+SAPBR=3,1,\"APN\",\"www\"", "OK", 2000);
  if (sendCmd("AT+SAPBR=1,1", "OK", 8000)) {
    sendCmd("AT+SAPBR=2,1", "OK", 2000);
    gprsConnected = true;
    digitalWrite(LED_PIN, HIGH);
    return true;
  }

  gprsConnected = false;
  return false;
}

// Send GPS telemetry HTTP POST over SIM800L
bool postTelemetry(float lat, float lng, float speedKmh, float headingDeg, int sats) {
  // Construct JSON body with embedded api_key for universal SIM800L compatibility
  String body = String("{\"device_id\":\"") + DEVICE_ID +
                "\",\"api_key\":\""  + API_KEY + "\"" +
                ",\"lat\":"          + String(lat, 6) +
                ",\"lng\":"          + String(lng, 6) +
                ",\"speed_kmh\":"    + String(speedKmh, 1) +
                ",\"heading\":"      + String(headingDeg, 1) +
                ",\"satellites\":"   + String(sats) +
                ",\"fix_quality\":1,\"source\":\"arduino\"}";

  sendCmd("AT+HTTPTERM", "OK", 1000); // Terminate previous HTTP session
  delay(100);

  if (!sendCmd("AT+HTTPINIT", "OK", 3000)) return false;
  sendCmd("AT+HTTPSSL=1", "OK", 1000); // Enable SSL for HTTPS
  
  String urlCmd = String("AT+HTTPPARA=\"URL\",\"") + SERVER + "\"";
  sendCmd(urlCmd.c_str(), "OK", 2000);
  sendCmd("AT+HTTPPARA=\"CID\",1", "OK", 1000);
  sendCmd("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 1000);
  
  String keyCmd = String("AT+HTTPPARA=\"USERDATA\",\"x-api-key: ") + API_KEY + "\"";
  sendCmd(keyCmd.c_str(), "OK", 1000);

  // Send body length
  String dataCmd = String("AT+HTTPDATA=") + body.length() + ",10000";
  if (sendCmd(dataCmd.c_str(), "DOWNLOAD", 3000)) {
    Serial.println(body);
    delay(300);
  } else {
    sendCmd("AT+HTTPTERM", "OK", 1000);
    return false;
  }

  // Execute POST action
  flushSerial();
  Serial.println("AT+HTTPACTION=1");
  unsigned long start = millis();
  bool postSuccess = false;
  while (millis() - start < 12000) {
    if (Serial.available()) {
      String resp = Serial.readString();
      if (resp.indexOf("200") != -1 || resp.indexOf("+HTTPACTION: 1,200") != -1) {
        postSuccess = true;
        break;
      }
    }
  }

  sendCmd("AT+HTTPTERM", "OK", 1000);

  // Blink LED to indicate successful transmission
  if (postSuccess) {
    digitalWrite(LED_PIN, LOW);
    delay(100);
    digitalWrite(LED_PIN, HIGH);
  }

  return postSuccess;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // SIM800L on Hardware Serial (Pins 0 & 1)
  Serial.begin(9600);

  // NEO-6M GPS on SoftwareSerial (Pins 8 & 9)
  gpsSerial.begin(9600);
  gpsSerial.listen();

  delay(3000); // Allow SIM800L power-on stabilization

  // Connect to GPRS
  setupGPRS();
}

void loop() {
  // Continuously read GPS characters from NEO-6M (Pins 8 & 9)
  gpsSerial.listen();
  unsigned long gpsScanStart = millis();
  while (millis() - gpsScanStart < 1500) {
    while (gpsSerial.available()) {
      gps.encode(gpsSerial.read());
    }
  }

  // Check if GPS satellite fix is valid
  if (gps.location.isValid()) {
    currentLat     = gps.location.lat();
    currentLng     = gps.location.lng();
    currentSpeed   = gps.speed.kmph();
    currentHeading = gps.course.deg();
    currentSats    = gps.satellites.value();
  }

  // Transmit every 4 seconds
  if (millis() - lastSendTime >= 4000) {
    lastSendTime = millis();

    if (!gprsConnected) {
      setupGPRS();
    }

    if (gprsConnected) {
      bool ok = postTelemetry(currentLat, currentLng, currentSpeed, currentHeading, currentSats);
      if (!ok) {
        // Re-check GPRS status if post failed
        setupGPRS();
      }
    }
  }
}
