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
  // Transparently forward all pristine NMEA characters from NEO-6M GPS to PC USB
  while (gpsSerial.available()) {
    Serial.write(gpsSerial.read());
  }
}
