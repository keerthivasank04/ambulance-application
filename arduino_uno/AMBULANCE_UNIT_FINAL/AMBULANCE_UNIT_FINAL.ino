/**
 * ============================================================================
 * TN 108 AMBULANCE — USB HARDWARE GPS STREAM FIRMWARE
 *
 * ZERO EXTRA HARDWARE / ZERO NEW PARTS NEEDED:
 *   - Uses your physical Arduino Uno + NEO-6M GPS Module.
 *   - No SIM card power brownout issues.
 *   - No capacitor or battery required.
 *   - No rewiring required (GPS stays on Pins 8 & 9, Arduino powered by USB).
 *
 * CONNECTIONS (Keep exactly as they are):
 *   NEO-6M GPS TX  --> Arduino Pin 8 (SoftwareSerial RX)
 *   NEO-6M GPS RX  --> Arduino Pin 9 (SoftwareSerial TX)
 *   NEO-6M VCC     --> Arduino 5V
 *   NEO-6M GND     --> Arduino GND
 *   Arduino Uno    --> PC USB Cable (COM5)
 * ============================================================================
 */

#include <SoftwareSerial.h>

SoftwareSerial gpsSerial(8, 9);

void setup() {
  // 9600 baud to PC via USB
  Serial.begin(9600);
  
  // 9600 baud to NEO-6M GPS module
  gpsSerial.begin(9600);
}

void loop() {
  // Forward all live NMEA satellite bytes directly to PC USB bridge
  while (gpsSerial.available()) {
    Serial.write(gpsSerial.read());
  }
}

