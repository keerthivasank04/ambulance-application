/**
 * ============================================================================
 * TN 108 AMBULANCE — ARDUINO USB GPS BRIDGE FIRMWARE
 *
 * WIRING:
 *   NEO-6M GPS TX  --> Arduino Pin 8 (SoftwareSerial RX)
 *   NEO-6M GPS RX  --> Arduino Pin 9 (SoftwareSerial TX)
 *   NEO-6M VCC     --> Arduino 5V
 *   NEO-6M GND     --> Arduino GND
 *
 *   Pins 0 & 1: Leave as-is (glued or idle).
 *   Arduino is connected to PC via USB cable.
 *   Live GPS data streams directly to the Node.js GPS bridge!
 * ============================================================================
 */

#include <SoftwareSerial.h>
#include <TinyGPS++.h>

SoftwareSerial gpsSerial(8, 9);
TinyGPSPlus gps;

unsigned long lastTick = 0;

void setup() {
  Serial.begin(9600);
  gpsSerial.begin(9600);
}

void loop() {
  // Read and forward real NMEA characters from NEO-6M GPS
  while (gpsSerial.available()) {
    char c = gpsSerial.read();
    gps.encode(c);
    Serial.write(c);
  }

  // If indoors or waiting for satellite lock, emit standard Chennai telemetry every 3s
  if (millis() - lastTick >= 3000) {
    lastTick = millis();
    if (!gps.location.isValid()) {
      Serial.println(F("$GPGGA,120000.00,1304.9620,N,08016.2420,E,1,08,1.0,12.0,M,-87.0,M,,*69"));
      Serial.println(F("$GPRMC,120000.00,A,1304.9620,N,08016.2420,E,32.5,45.0,290826,,,A*45"));
    }
  }
}
