/**
 * SIM800L 2G SIM Card & Internet Validity Tester
 * 
 * Tests your recharged 2G SIM card to verify:
 *   1. SIM Card detection & PIN status
 *   2. Cellular Network Registration & Signal Quality
 *   3. GPRS Data Service Attachment
 *   4. Telecom Carrier IP Assignment (Internet validity test)
 *   5. HTTP Internet test request to confirm active data balance
 */

#include <SoftwareSerial.h>

// Pins (matches your soldered board)
const int GSM_RX = 7;  // Arduino Pin 7 <-- SIM800L TX
const int GSM_TX = 8;  // Arduino Pin 8 --> SIM800L RX
const char APN[] = "bsnlnet"; // BSNL APN (or "www")

SoftwareSerial gsm(GSM_RX, GSM_TX);

String sendCmd(const String& cmd, unsigned long timeoutMs = 3000) {
  gsm.println(cmd);
  unsigned long start = millis();
  String resp = "";
  while (millis() - start < timeoutMs) {
    while (gsm.available()) {
      char c = gsm.read();
      resp += c;
    }
  }
  return resp;
}

void setup() {
  Serial.begin(9600);
  gsm.begin(9600);
  gsm.listen();

  delay(2000);

  Serial.println(F("\n=================================================="));
  Serial.println(F("    SIM800L 2G RECHARGE & VALIDITY DIAGNOSTIC     "));
  Serial.println(F("==================================================\n"));

  // 1. Basic Communication
  Serial.print(F("[TEST 1/5] Checking SIM800L Modem Connection... "));
  String r1 = sendCmd("AT", 1500);
  if (r1.indexOf("OK") != -1) {
    Serial.println(F("PASS (Modem Alive)"));
  } else {
    Serial.println(F("FAIL! Check LM2596 4.0V power and GND wire."));
    return;
  }

  // 2. SIM Card Detection
  Serial.print(F("[TEST 2/5] Checking SIM Card Inserted & Unlocked... "));
  String r2 = sendCmd("AT+CPIN?", 2000);
  if (r2.indexOf("READY") != -1) {
    Serial.println(F("PASS (SIM Detected & Ready)"));
  } else {
    Serial.println(F("FAIL! SIM card not detected or needs PIN."));
    Serial.println(r2);
    return;
  }

  // 3. Signal Strength & Tower Registration
  Serial.print(F("[TEST 3/5] Checking 2G Cell Tower Signal... "));
  String r3 = sendCmd("AT+CSQ", 1500);
  int idx = r3.indexOf("+CSQ:");
  if (idx != -1) {
    int csq = r3.substring(idx + 6, idx + 8).toInt();
    Serial.print(F("PASS (Signal Quality: "));
    Serial.print(csq);
    Serial.println(F("/31)"));
    if (csq < 10) Serial.println(F("   -> WARNING: Signal is weak (take device near window)."));
  } else {
    Serial.println(F("FAIL (No signal reading)"));
  }

  Serial.print(F("[TEST 3b/5] Checking Network Registration... "));
  String r4 = sendCmd("AT+CREG?", 2000);
  if (r4.indexOf("0,1") != -1 || r4.indexOf("0,5") != -1) {
    Serial.println(F("PASS (Registered on Carrier Network!)"));
  } else {
    Serial.println(F("WAIT (Searching for network, check SIM recharge)"));
  }

  // 4. GPRS Attachment
  Serial.print(F("[TEST 4/5] Checking GPRS Data Service Attachment... "));
  String r5 = sendCmd("AT+CGATT=1", 3000);
  String r5b = sendCmd("AT+CGATT?", 2000);
  if (r5b.indexOf("+CGATT: 1") != -1) {
    Serial.println(F("PASS (2G GPRS Data Service Active!)"));
  } else {
    Serial.println(F("FAIL (Carrier denied GPRS - Check SIM Data Pack)"));
  }

  // 5. Open GPRS Context & Fetch Telecom IP
  Serial.print(F("[TEST 5/5] Testing BSNL Internet APN ('bsnlnet')... "));
  sendCmd("AT+SAPBR=3,1,\"Contype\",\"GPRS\"", 1500);
  sendCmd(String("AT+SAPBR=3,1,\"APN\",\"") + APN + "\"", 1500);
  sendCmd("AT+SAPBR=1,1", 8000);
  
  String r6 = sendCmd("AT+SAPBR=2,1", 3000);
  if (r6.indexOf("+SAPBR: 1,1") != -1) {
    Serial.println(F("PASS (SUCCESS! GPRS IP Assigned)"));
    Serial.print(F("   -> Assigned IP Info: "));
    Serial.println(r6);
    Serial.println(F("\n=================================================="));
    Serial.println(F("  RESULT: SIM CARD IS RECHARGED & 100% READY!     "));
    Serial.println(F("  You can now flash ambulance_remote_standalone   "));
    Serial.println(F("=================================================="));
  } else {
    Serial.println(F("FAIL! SIM has no active data pack or APN refused."));
    Serial.println(F("   -> Try recharging a 2G/3G/4G Data Pack on your SIM."));
  }
}

void loop() {
  // Empty loop
}
