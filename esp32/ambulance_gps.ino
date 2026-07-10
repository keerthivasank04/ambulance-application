/**
 * TN 108 Ambulance GPS Firmware — ESP32 + NEO-6M GPS + SIM800L
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
 * Wiring:
 *   GPS (NEO-6M) TX  → ESP32 GPIO 16 (RX2)
 *   GPS (NEO-6M) RX  → ESP32 GPIO 17 (TX2)
 *   Buzzer           → ESP32 GPIO 25
 *   Patient Onboard Button → ESP32 GPIO 26 (INPUT_PULLUP)
 *   SIM800L / WiFi for HTTP posts
 *
 * Dependencies (Arduino Library Manager):
 *   TinyGPS++        — GPS NMEA parser
 *   ArduinoJson      — JSON serialization
 *   WebSockets       — Socket.io alarm relay (optional)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>

// ── Configuration ─────────────────────────────────────────────────────────
const char* WIFI_SSID       = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD   = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL      = "http://192.168.1.100:5000";  // Control Server IP
const char* GPS_API_KEY     = "arduino-bridge-secret";
const char* DEVICE_ID       = "ARD-001";  // Must match gps_device_id in DB

const int   GPS_RX_PIN      = 16;
const int   GPS_TX_PIN      = 17;
const int   BUZZER_PIN      = 25;
const int   ONBOARD_BTN_PIN = 26;

const float ARRIVAL_RADIUS_KM  = 0.08;   // 80 m geofence threshold
const int   GPS_POST_INTERVAL  = 1000;   // post GPS every 1 second
const int   ASSIGNMENT_POLL_MS = 5000;   // poll for assignment every 5 seconds

// ── Globals ───────────────────────────────────────────────────────────────
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);  // UART2

struct Assignment {
  bool   active       = false;
  char   requestId[64]= {};
  double patientLat   = 0, patientLng = 0;
  double hospitalLat  = 0, hospitalLng = 0;
  char   status[32]   = "pending";
};

Assignment current;
unsigned long lastGpsPost      = 0;
unsigned long lastPollTime     = 0;
bool         alarmActive       = false;
bool         onboardBtnHandled = false;

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

bool httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String(SERVER_URL) + path;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", GPS_API_KEY);
  http.setTimeout(3000);

  int code = http.POST(body);
  if (code == HTTP_CODE_OK || code == HTTP_CODE_CREATED) {
    response = http.getString();
    http.end();
    return true;
  }
  http.end();
  return false;
}

// ── GPS Post (steps 6, 7, 12, 13) ────────────────────────────────────────
void postGpsUpdate() {
  if (!gps.location.isValid() || !gps.location.isUpdated()) return;

  StaticJsonDocument<256> doc;
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

  String body;
  serializeJson(doc, body);
  String resp;
  httpPost("/api/gps-update", body, resp);
}

// ── Arrival Confirm (steps 10, 11, 16, 17) ───────────────────────────────
void confirmArrival(const char* event) {
  StaticJsonDocument<128> doc;
  doc["device_id"] = DEVICE_ID;
  doc["event"]     = event;

  String body, resp;
  serializeJson(doc, body);
  if (httpPost("/api/devices/arrival-confirm", body, resp)) {
    Serial.printf("[esp32] arrival confirmed: %s\n", event);
    buzz(2);
  }
}

// ── Assignment Poll ───────────────────────────────────────────────────────
void pollAssignment() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(SERVER_URL) + "/api/gps-update");  // use health or dedicated endpoint
  // Simpler: poll via a small endpoint or use the request status from GPS response
  // The GPS update response already includes request_id — use that to fetch details
  http.end();
}

// ── Geofence Check ────────────────────────────────────────────────────────
void checkGeofence() {
  if (!current.active || !gps.location.isValid()) return;

  double lat = gps.location.lat();
  double lng = gps.location.lng();

  if (strcmp(current.status, "enroute") == 0) {
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

  pinMode(BUZZER_PIN,      OUTPUT);
  pinMode(ONBOARD_BTN_PIN, INPUT_PULLUP);
  digitalWrite(BUZZER_PIN, LOW);

  Serial.println("[esp32] TN 108 Ambulance GPS Firmware starting...");
  Serial.printf("[esp32] Device: %s\n", DEVICE_ID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[wifi] connecting");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[wifi] connected — IP: %s\n", WiFi.localIP().toString().c_str());
    buzz(1, 100);
  } else {
    Serial.println("\n[wifi] connection failed — will retry in loop");
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────
void loop() {
  // Feed GPS data into TinyGPS++
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  unsigned long now = millis();

  // Post GPS update every second (steps 6, 7, 12, 13)
  if (now - lastGpsPost >= GPS_POST_INTERVAL) {
    lastGpsPost = now;
    postGpsUpdate();
  }

  // Check geofence on every loop tick (steps 10, 16)
  checkGeofence();

  // Check patient onboard button (step 11)
  checkOnboardButton();

  // Reconnect WiFi if dropped
  if (WiFi.status() != WL_CONNECTED && now - lastPollTime > 10000) {
    lastPollTime = now;
    Serial.println("[wifi] reconnecting...");
    WiFi.reconnect();
  }

  // Print GPS debug to Serial every 5 seconds
  static unsigned long lastDebug = 0;
  if (now - lastDebug > 5000) {
    lastDebug = now;
    if (gps.location.isValid()) {
      Serial.printf("[gps] lat=%.6f lng=%.6f spd=%.1f sats=%d\n",
        gps.location.lat(), gps.location.lng(),
        gps.speed.kmph(), gps.satellites.value());
    } else {
      Serial.printf("[gps] no fix — chars=%lu sentences=%lu failed=%lu\n",
        gps.charsProcessed(), gps.sentencesWithFix(), gps.failedChecksum());
    }
  }
}
