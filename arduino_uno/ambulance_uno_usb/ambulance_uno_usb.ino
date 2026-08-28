/**
 * Clean & Direct USB GPS Firmware for Arduino UNO (DIP)
 * 
 * Streams GPS NMEA data ($GPGGA, $GPRMC) from NEO-6M directly 
 * to PC over USB for the Node.js backend bridge.
 * 
 * Hardware:
 *   - NEO-6M GPS TX -> Arduino Pin 2 (RX)
 *   - NEO-6M GPS RX -> Arduino Pin 3 (TX)
 *   - NEO-6M GPS VCC -> 5V
 *   - NEO-6M GPS GND -> GND
 */

#include <SoftwareSerial.h>

// GPS Module Serial: Pin 2 (RX from GPS TX), Pin 3 (TX to GPS RX)
SoftwareSerial gpsSerial(2, 3);

void setup() {
  // USB Serial communication to PC (9600 baud matches backend/gps-bridge.js)
  Serial.begin(9600);
  
  // GPS module serial communication (9600 baud)
  gpsSerial.begin(9600);
  gpsSerial.listen();

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
}

void loop() {
  // Read from GPS and forward directly to PC via USB
  if (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    Serial.write(c);
  }
}
