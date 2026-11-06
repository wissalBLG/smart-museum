#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "*********";
const char* password = "*********";
const char* serverUrl = "http://192.168.100.7:3000/api/rfid"; // استبدلي X برقم الـ IP الخاص بجهازك
// أطراف التوصيل الخاصة بالـ ESP32-S3
#define SS_PIN    5   
#define RST_PIN   4 
#define SCK_PIN   6
#define MISO_PIN  8
#define MOSI_PIN  7
MFRC522 rfid(SS_PIN, RST_PIN);
void setupWiFi() {
  delay(1000);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected successfully!");
}
void setup() {
  Serial.begin(115200);
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init(); 
  setupWiFi();
  Serial.println("ESP32-S3 System Ready...");
  delay(100);

Serial.println("Checking RFID reader...");

rfid.PCD_DumpVersionToSerial();

Serial.println("Waiting for RFID card...");
delay(100);


}

void loop() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  String cardUID = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) cardUID += "0";
    cardUID += String(rfid.uid.uidByte[i], HEX);
  }
  cardUID.toUpperCase();

  Serial.print("Scanned Card UID: ");
  Serial.println(cardUID);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String httpRequestData = "{\"uid\":\"" + cardUID + "\"}";
    int httpResponseCode = http.POST(httpRequestData);
    
    if (httpResponseCode > 0) {
      Serial.print("HTTP Response code: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(1000);
}
