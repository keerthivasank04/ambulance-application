/**
 * TN 108 Ambulance GPS Firmware — ESP32 + NEO-6M GPS + SIM800L GPRS
 *
 * Architecture steps handled by this firmware:
 *   Step 6  — Sends GPS (initial fix posted to Control Server)
 *   Step 7  — GPS Update (continuous 1-second posts)
 *   Step 10 — Arrives at Accident Zone (geofence trigger → arrival-confirm)
 *   Step 11 — Patient Onboard (physical button → arrival-confirm)
 *   Step 12 — Sends Return GPS (continues posting during hospital trip)
 *   Step 13 — Return GPS continuous updates
 *   Step 16 — Arrives at Hospital (geofence trigger → arrival-confirm)
 *   Step 17 — Reached / Ride Completed (final arrival-confirm)
 *
 * Wiring (see the hardware blueprint for the full block diagram + power notes):
 *   GPS (NEO-6M) TX   → ESP32 GPIO 16 (RX2)
 *   GPS (NEO-6M) RX   → ESP32 GPIO 17 (TX2)
 *   SIM800L      TX   → ESP32 GPIO 5  (RX0)
 *   SIM800L      RX   → ESP32 GPIO 4  (TX0)
 *   SIM800L      VCC  → dedicated 4.0V / 2A buck — NOT the ESP32 3.3V pin.
 *                        SIM800L draws up to 2A in bursts while transmitting;
 *                        sharing a rail with the ESP32/GPS causes brownout
 *                        resets right in the middle of an HTTP post.
 *   Duty toggle       → ESP32 GPIO 27 (INPUT_PULLUP, closed-to-GND = on duty)
 *   Duty LED          → ESP32 GPIO 33
 *   Link LED          → ESP32 GPIO 32 (lit while GPRS is attached)
 *   Buzzer            → ESP32 GPIO 25
 *   Patient Onboard Button → ESP32 GPIO 26 (INPUT_PULLUP)
 *
 * Dependencies (Arduino Library Manager):
 *   TinyGPS++         — GPS NMEA parser
 *   ArduinoJson       — JSON serialization
 *   TinyGSM           — SIM800L modem driver + GPRS bearer
 *   ArduinoHttpClient — HTTP over the TinyGSM data connection
 */

#define TINY_GSM_MODEM_SIM800

#include <HardwareSerial.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>
#include <TinyGsmClient.h>
#include <ArduinoHttpClient.h>

// ── Configuration ─────────────────────────────────────────────────────────
const char* APN             = "YOUR_CARRIER_APN";   // e.g. "airtelgprs.com", "www" for BSNL
const char* GPRS_USER       = "";
const char* GPRS_PASS       = "";
const char* SERVER_HOST     = "192.168.1.100";       // Control Server IP/hostname, no scheme
const int   SERVER_PORT     = 5000;
const char* GPS_API_KEY     = "arduino-bridge-secret";
const char* DEVICE_ID       = "ARD-001";  // Must match gps_device_id in DB

const int GPS_RX_PIN      = 16;
const int GPS_TX_PIN      = 17;
const int MODEM_RX_PIN    = 5;   // ESP32 RX0 ← SIM800L TX
const int MODEM_TX_PIN    = 4;   // ESP32 TX0 → SIM800L RX
const int BUZZER_PIN      = 25;
const int ONBOARD_BTN_PIN = 26;
const int DUTY_TOGGLE_PIN = 27;
const int LINK_LED_PIN    = 32;
const int DUTY_LED_PIN    = 33;

const float         ARRIVAL_RADIUS_KM  = 0.08;   // 80 m geofence threshold
const unsigned long GPS_POST_INTERVAL  = 1000;   // post GPS every 1 second
const unsigned long ASSIGNMENT_POLL_MS = 5000;   // poll for assignment every 5 seconds
const unsigned long GPRS_RETRY_MS      = 10000;  // backoff between reconnect attempts

// ── Globals ───────────────────────────────────────────────────────────────
TinyGPSPlus    gps;
HardwareSerial gpsSerial(2);    // UART2 — GPS
HardwareSerial modemSerial(1);  // UART1 — SIM800L

TinyGsm       modem(modemSerial);
TinyGsmClient gsmClient(modem);
HttpClient    httpClient(gsmClient, SERVER_HOST, SERVER_PORT);

struct Assignment {
  bool   active      = false;
  char   requestId[64] = {};
  char   status[32]    = "";
  double patientLat  = 0, patientLng  = 0;
  double hospitalLat = 0, hospitalLng = 0;
};

Assignment    current;
unsigned long lastGpsPost   = 0;
unsigned long lastPollTime  = 0;
unsigned long lastGprsRetry = 0;
bool          onboardBtnHandled = false;
bool          dutyAvailable     = true;
bool          gprsReady         = false;

// ── Helpers ───────────────────────────────────────────────────────────────
float haversineKm(double lat1, double lng1, double lat2, double lng2) {
  const float R = 6371.0f;
  float dLat = radians(lat2 - lat1);
  float dLng = radians(lng2 - lng1);
  float a = sin(dLat/2)*sin(dLat/2)
          + cos(radians(lat1))*cos(radians(lat2))*sin(dLng/2)*sin(dLng/2);
  return R * 2.0f * atan2(sqrt(a), sqrt(1-a));
}

void buzz(int times, int durationMs = 200, int gapMs = 150) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < times - 1) delay(gapMs);
  }
}

void readDutyToggle() {
  dutyAvailable = (digitalRead(DUTY_TOGGLE_PIN) == LOW);  // closed to GND = on duty
  digitalWrite(DUTY_LED_PIN, dutyAvailable ? HIGH : LOW);
}

// ── GPRS connection management ───────────────────────────────────────────
bool ensureGprs() {
  if (modem.isGprsConnected()) return true;

  unsigned long now = millis();
  if (now - lastGprsRetry < GPRS_RETRY_MS) return false;
  lastGprsRetry = now;

  Serial.println("[gprs] (re)connecting...");
  if (!modem.waitForNetwork(15000)) {
    Serial.println("[gprs] no network");
    return false;
  }
  if (!modem.gprsConnect(APN, GPRS_USER, GPRS_PASS)) {
    Serial.println("[gprs] attach failed");
    return false;
  }
  Serial.println("[gprs] connected");
  return true;
}

bool httpPostJson(const char* path, const String& body, String& response) {
  if (!ensureGprs()) { gprsReady = false; return false; }

  httpClient.beginRequest();
  httpClient.post(path);
  httpClient.sendHeader("Content-Type", "application/json");
  httpClient.sendHeader("x-api-key", GPS_API_KEY);
  httpClient.sendHeader("Content-Length", body.length());
  httpClient.beginBody();
  httpClient.print(body);
  httpClient.endRequest();

  int statusCode = httpClient.responseStatusCode();
  response = httpClient.responseBody();
  httpClient.stop();

  gprsReady = true;
  return statusCode == 200 || statusCode == 201;
}

bool httpGetJson(const char* path, String& response) {
  if (!ensureGprs()) { gprsReady = false; return false; }

  httpClient.beginRequest();
  httpClient.get(path);
  httpClient.sendHeader("x-api-key", GPS_API_KEY);
  httpClient.endRequest();

  int statusCode = httpClient.responseStatusCode();
  response = httpClient.responseBody();
  httpClient.stop();

  gprsReady = true;
  return statusCode == 200;
}

// ── GPS Post (steps 6, 7, 12, 13) ────────────────────────────────────────
void postGpsUpdate() {
  if (!gps.location.isValid() || !gps.location.isUpdated()) return;

  StaticJsonDocument<320> doc;
  doc["device_id"]   = DEVICE_ID;
  doc["lat"]         = gps.location.lat();
  doc["lng"]         = gps.location.lng();
  doc["speed_kmh"]   = gps.speed.kmph();
  doc["heading"]     = gps.course.deg();
  doc["altitude"]    = gps.altitude.meters();
  doc["satellites"]  = gps.satellites.value();
  doc["fix_quality"] = 1;
  doc["hdop"]        = gps.hdop.hdop();
  doc["source"]      = "arduino";
  doc["available"]   = dutyAvailable;

  String body;
  serializeJson(doc, body);
  String resp;
  httpPostJson("/api/gps-update", body, resp);
}

// ── Arrival Confirm (steps 10, 11, 16, 17) ───────────────────────────────
void confirmArrival(const char* event) {
  StaticJsonDocument<128> doc;
  doc["device_id"] = DEVICE_ID;
  doc["event"]     = event;

  String body, resp;
  serializeJson(doc, body);
  if (httpPostJson("/api/devices/arrival-confirm", body, resp)) {
    Serial.printf("[esp32] arrival confirmed: %s\n", event);
    buzz(2);
  }
}

// ── Assignment Poll ───────────────────────────────────────────────────────
// Asks the server what this device is currently assigned to, so the geofence
// check below always has authoritative patient/hospital coordinates and status.
void pollAssignment() {
  String path = String("/api/devices/") + DEVICE_ID + "/assignment";
  String resp;
  if (!httpGetJson(path.c_str(), resp)) return;

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, resp) != DeserializationError::Ok) return;

  bool active = doc["active"] | false;
  current.active = active;
  if (!active) {
    current.status[0] = '\0';
    onboardBtnHandled = false;
    return;
  }

  const char* requestId = doc["request_id"] | "";
  const char* status    = doc["status"] | "";
  strncpy(current.requestId, requestId, sizeof(current.requestId) - 1);
  strncpy(current.status,    status,    sizeof(current.status) - 1);
  current.patientLat  = doc["patient_lat"]  | 0.0;
  current.patientLng  = doc["patient_lng"]  | 0.0;
  current.hospitalLat = doc["hospital_lat"] | 0.0;
  current.hospitalLng = doc["hospital_lng"] | 0.0;
}

// ── Geofence Check ────────────────────────────────────────────────────────
void checkGeofence() {
  if (!current.active || !gps.location.isValid()) return;

  double lat = gps.location.lat();
  double lng = gps.location.lng();

  if (strcmp(current.status, "assigned") == 0 || strcmp(current.status, "enroute") == 0) {
    float dist = haversineKm(lat, lng, current.patientLat, current.patientLng);
    if (dist < ARRIVAL_RADIUS_KM) {
      Serial.printf("[geofence] arrived at patient (%.4f km)\n", dist);
      confirmArrival("arrived_patient");
      strncpy(current.status, "arrived", sizeof(current.status));
      buzz(3);
    }
  } else if (strcmp(current.status, "enroute_hospital") == 0) {
    float dist = haversineKm(lat, lng, current.hospitalLat, current.hospitalLng);
    if (dist < ARRIVAL_RADIUS_KM) {
      Serial.printf("[geofence] arrived at hospital (%.4f km)\n", dist);
      confirmArrival("arrived_hospital");
      strncpy(current.status, "completed", sizeof(current.status));
      current.active = false;
      buzz(5);
    }
  }
}

// ── Patient Onboard Button (step 11) ─────────────────────────────────────
void checkOnboardButton() {
  if (!current.active) return;
  if (strcmp(current.status, "arrived") != 0) return;
  if (onboardBtnHandled) return;

  if (digitalRead(ONBOARD_BTN_PIN) == LOW) {  // active low
    Serial.println("[btn] patient onboard confirmed");
    onboardBtnHandled = true;
    confirmArrival("patient_onboard");
    strncpy(current.status, "enroute_hospital", sizeof(current.status));
    buzz(2, 300, 100);
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  modemSerial.begin(9600, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);

  pinMode(BUZZER_PIN,      OUTPUT);
  pinMode(ONBOARD_BTN_PIN, INPUT_PULLUP);
  pinMode(DUTY_TOGGLE_PIN, INPUT_PULLUP);
  pinMode(LINK_LED_PIN,    OUTPUT);
  pinMode(DUTY_LED_PIN,    OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("[esp32] TN 108 Ambulance GPS Firmware starting...");
  Serial.printf("[esp32] Device: %s\n", DEVICE_ID);

  readDutyToggle();

  Serial.println("[modem] restarting SIM800L...");
  if (!modem.restart()) {
    Serial.println("[modem] restart failed — check power rail and wiring");
  }
  Serial.printf("[modem] %s\n", modem.getModemInfo().c_str());

  if (ensureGprs()) {
    buzz(1, 100);
  } else {
    Serial.println("[gprs] initial connect failed — will retry in loop");
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────
void loop() {
  // Feed GPS data into TinyGPS++
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  unsigned long now = millis();

  // Duty toggle — read every loop, cheap digitalRead
  readDutyToggle();

  // Post GPS update every second (steps 6, 7, 12, 13); carries the duty flag too
  if (now - lastGpsPost >= GPS_POST_INTERVAL) {
    lastGpsPost = now;
    postGpsUpdate();
    digitalWrite(LINK_LED_PIN, gprsReady ? HIGH : LOW);
  }

  // Refresh assignment (patient/hospital coords + status) periodically
  if (now - lastPollTime >= ASSIGNMENT_POLL_MS) {
    lastPollTime = now;
    pollAssignment();
  }

  // Check geofence on every loop tick (steps 10, 16)
  checkGeofence();

  // Check patient onboard button (step 11)
  checkOnboardButton();

  // Print GPS debug to Serial every 5 seconds
  static unsigned long lastDebug = 0;
  if (now - lastDebug > 5000) {
    lastDebug = now;
    if (gps.location.isValid()) {
      Serial.printf("[gps] lat=%.6f lng=%.6f spd=%.1f sats=%d duty=%s gprs=%s\n",
        gps.location.lat(), gps.location.lng(),
        gps.speed.kmph(), gps.satellites.value(),
        dutyAvailable ? "on" : "off", gprsReady ? "up" : "down");
    } else {
      Serial.printf("[gps] no fix — chars=%lu sentences=%lu failed=%lu\n",
        gps.charsProcessed(), gps.sentencesWithFix(), gps.failedChecksum());
    }
  }
}
