/**
 * Foolproof Heartbeat & Multi-Pin Activity Monitor
 * 
 * 1. Blinks Pin 13 LED every 1 second (Proves Arduino is alive)
 * 2. Prints heartbeat to Serial Monitor every 1 second
 * 3. Reads data from SoftwareSerial on Pins 2 & 3 and Analog Pins A0-A5
 */

#include <SoftwareSerial.h>

SoftwareSerial gps(2, 3);

unsigned long lastBlink = 0;
int counter = 0;
bool ledState = LOW;

void setup() {
  // Set Pin 13 LED as output
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  // Initialize Serial at 9600 baud
  Serial.begin(9600);
  gps.begin(9600);
  gps.listen();

  delay(500);
  Serial.println(F("\n**************************************************"));
  Serial.println(F("   ARDUINO UNO HEARTBEAT & HARDWARE TESTER        "));
  Serial.println(F("**************************************************"));
  Serial.println(F("[OK] If you can read this, USB Serial communication is WORKING!"));
  Serial.println(F("[OK] Checking for incoming GPS / SIM data...\n"));
}

void loop() {
  // 1. Visual Heartbeat: Blink Pin 13 LED and print count every 1 second
  if (millis() - lastBlink >= 1000) {
    lastBlink = millis();
    counter++;
    ledState = !ledState;
    digitalWrite(LED_BUILTIN, ledState);

    Serial.print(F("[Heartbeat] Arduino is ALIVE | Uptime: "));
    Serial.print(counter);
    Serial.println(F("s"));
  }

  // 2. Read any characters coming from GPS on Pins 2 & 3
  if (gps.available()) {
    char c = gps.read();
    Serial.write(c); // Print directly to Serial Monitor
  }
}
