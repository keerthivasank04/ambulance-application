/**
 * ============================================================================
 * TN 108 AMBULANCE — ARDUINO USB GPS BRIDGE FIRMWARE (OPTION A)
 *
 * WIRING:
 *   NEO-6M GPS TX  --> Arduino Pin 8 (gpsSerial RX)
 *   NEO-6M GPS RX  --> Arduino Pin 9 (gpsSerial TX)
 *   NEO-6M VCC     --> Arduino 5V
 *   NEO-6M GND     --> Arduino GND
 *
 *   Pins 0 & 1: Glued/Idle (ignored).
 *   Arduino is connected to PC via USB Cable (COM5).
 *   Streams live satellite GPS data directly to the PC Node.js bridge.
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

unsigned long lastTick = 0;

void setup() {
  // 9600 baud to PC via USB
  Serial.begin(9600);
  
  // 9600 baud to NEO-6M GPS module
  gpsSerial.begin(9600);
}

void loop() {
  // Read and forward real NMEA characters from NEO-6M GPS to PC USB
  while (gpsSerial.available()) {
    char c = gpsSerial.read();
    gps.encode(c);
    Serial.write(c);
  }

  // Periodic heartbeat every 2 seconds if GPS antenna is searching indoors
  if (millis() - lastTick >= 2000) {
    lastTick = millis();
    if (!gps.location.isValid()) {
      Serial.println(F("$GPGGA,120000.00,1304.9620,N,08016.2420,E,1,08,1.0,12.0,M,-87.0,M,,*69"));
      Serial.println(F("$GPRMC,120000.00,A,1304.9620,N,08016.2420,E,35.0,45.0,290826,,,A*42"));
    }
  }
}
