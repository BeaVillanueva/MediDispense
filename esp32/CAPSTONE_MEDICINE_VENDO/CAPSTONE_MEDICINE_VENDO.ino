#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> // ArduinoJson 7 (Arduino IDE Library Manager)
#include "secrets.h"
#include "BackendClient.h" // TLS for https:// backends, plain HTTP for local XAMPP

// =====================================================
// WIFI
// =====================================================
const char* WIFI_SSID = "CONFIGURE_PRIVATE_WIFI_SSID";
const char* WIFI_PASSWORD = "CONFIGURE_PRIVATE_WIFI_PASSWORD";

// =====================================================
// FIREBASE
// =====================================================
const char* FIREBASE_URL =
"https://medidispense-e4883-default-rtdb.asia-southeast1.firebasedatabase.app";

// =====================================================
// MOTOR 1
// =====================================================
#define M1_ENB 14
#define M1_IN3 27
#define M1_IN4 26

// =====================================================
// MOTOR 2
// =====================================================
#define M2_ENB 25
#define M2_IN3 33
#define M2_IN4 32

// =====================================================
// MOTOR 3
// =====================================================
#define M3_ENB 13
#define M3_IN3 18
#define M3_IN4 19

// =====================================================
// IR SENSORS
// =====================================================
#define IR1 23
#define IR2 22
#define IR3 21

// =====================================================
// COIN ACCEPTOR
// =====================================================

#define COIN_PIN 4

#include "ReliableCoinPayment.h"

// =====================================================
// SETTINGS
// =====================================================

// Maximum quantity allowed per transaction
#define MAX_QUANTITY 3

// Maximum time waiting for ONE tablet
#define TABLET_TIMEOUT 10000

// Maximum time waiting for sensor to clear after a tablet
#define SENSOR_CLEAR_TIMEOUT 5000

// RAM-only tracking; retained through a cycle, including failure/reset writes.
int64_t activeRequestId = 0;
int64_t lastStartedRequestId = 0;
bool dispenseInProgress = false;

// =====================================================
// MOTOR CONTROL
// =====================================================

void stopMotor(int motor) {

  if (motor == 1) {
    digitalWrite(M1_ENB, LOW);
    digitalWrite(M1_IN3, LOW);
    digitalWrite(M1_IN4, LOW);
  }

  else if (motor == 2) {
    digitalWrite(M2_ENB, LOW);
    digitalWrite(M2_IN3, LOW);
    digitalWrite(M2_IN4, LOW);
  }

  else if (motor == 3) {
    digitalWrite(M3_ENB, LOW);
    digitalWrite(M3_IN3, LOW);
    digitalWrite(M3_IN4, LOW);
  }
}


void startMotor(int motor) {

  if (motor == 1) {
    digitalWrite(M1_IN3, HIGH);
    digitalWrite(M1_IN4, LOW);
    digitalWrite(M1_ENB, HIGH);
  }

  else if (motor == 2) {
    digitalWrite(M2_IN3, HIGH);
    digitalWrite(M2_IN4, LOW);
    digitalWrite(M2_ENB, HIGH);
  }

  else if (motor == 3) {
    digitalWrite(M3_IN3, HIGH);
    digitalWrite(M3_IN4, LOW);
    digitalWrite(M3_ENB, HIGH);
  }
}


void stopAllMotors() {
  stopMotor(1);
  stopMotor(2);
  stopMotor(3);
}


// =====================================================
// GET SENSOR PIN
// =====================================================

int getSensorPin(int slot) {

  if (slot == 1) return IR1;
  if (slot == 2) return IR2;
  if (slot == 3) return IR3;

  return -1;
}


// =====================================================
// FIREBASE PUT HELPERS
// =====================================================

bool firebasePutRaw(String path, String jsonValue) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Firebase write failed: WiFi disconnected.");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url =
    String(FIREBASE_URL) +
    path +
    ".json";

  if (!https.begin(client, url)) {
    Serial.println("Firebase connection failed.");
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  int responseCode = https.PUT(jsonValue);

  https.end();

  return responseCode >= 200 && responseCode < 300;
}


void setStatus(String status) {

  firebasePutRaw(
    "/dispense/status",
    "\"" + status + "\""
  );
}


void setDispensed(int amount) {

  firebasePutRaw(
    "/dispense/dispensed",
    String(amount)
  );
}


void resetCommand() {

  firebasePutRaw(
    "/dispense/slot",
    "0"
  );

  firebasePutRaw(
    "/dispense/quantity",
    "0"
  );
}


// =====================================================
// FIREBASE GET COMPLETE COMMAND (one consistent snapshot)
// =====================================================

bool firebaseGetCommand(JsonDocument& command) {

  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;

  String url =
    String(FIREBASE_URL) +
    "/dispense.json";

  if (!https.begin(client, url)) {
    return false;
  }

  int responseCode = https.GET();

  if (responseCode >= 200 && responseCode < 300) {

    String value = https.getString();
    https.end();

    DeserializationError error = deserializeJson(command, value);
    if (error || !command.is<JsonObject>()) {
      Serial.println("Rejected malformed Firebase command JSON.");
      return false;
    }
    return true;
  }

  https.end();

  return false;
}


// =====================================================
// WAIT FOR ONE TABLET
// =====================================================

bool waitForTablet(int motor, int sensorPin) {

  unsigned long startTime = millis();

  startMotor(motor);

  while (millis() - startTime < TABLET_TIMEOUT) {

    // LOW = medicine detected
    if (digitalRead(sensorPin) == LOW) {

      stopMotor(motor);

      Serial.println("Medicine detected!");

      return true;
    }

    delay(10);
  }

  stopMotor(motor);

  Serial.println("Tablet detection timeout!");

  return false;
}


// =====================================================
// WAIT UNTIL TABLET LEAVES SENSOR
// =====================================================

bool waitForSensorClear(int sensorPin) {

  unsigned long startTime = millis();

  while (millis() - startTime < SENSOR_CLEAR_TIMEOUT) {

    // HIGH = no object
    if (digitalRead(sensorPin) == HIGH) {
      return true;
    }

    delay(10);
  }

  Serial.println("Sensor remained blocked!");

  return false;
}


// =====================================================
// DISPENSE QUANTITY
// =====================================================

bool reportSensorResult(int64_t requestId, int unitNumber, bool success) {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("PHP CALLBACK FAILED: WiFi disconnected.");
    return false;
  }

  BackendClient client;
  HTTPClient http;
  http.setConnectTimeout(backendConnectTimeoutMs());
  http.setTimeout(backendResponseTimeoutMs());

  String url =
    String(BACKEND_BASE_URL) +
    "/api/dispense/" +
    String((long long)requestId) +
    "/sensor";

  Serial.print("Reporting sensor result to PHP for unit ");
  Serial.println(unitNumber);

  http.begin(client.get(), url);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Hardware-Key", HARDWARE_API_KEY);

  StaticJsonDocument<128> payload;

  payload["unit_number"] = unitNumber;
  payload["success"] = success;

  String body;
  serializeJson(payload, body);

  int httpCode = http.POST(body);

  if (httpCode <= 0) {
    Serial.print("PHP CALLBACK CONNECTION ERROR: ");
    Serial.println(http.errorToString(httpCode));

    http.end();
    return false;
  }

  String response = http.getString();

  Serial.print("PHP callback HTTP status: ");
  Serial.println(httpCode);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.println("PHP SENSOR CALLBACK SUCCESS.");
    http.end();
    return true;
  }

  Serial.println("PHP SENSOR CALLBACK REJECTED.");
  Serial.println(response);

  http.end();
  return false;
}

void dispenseQuantity(int slot, int quantity) {

  int sensorPin = getSensorPin(slot);

  // Safety validation
  if (
    slot < 1 ||
    slot > 3 ||
    quantity < 1 ||
    quantity > MAX_QUANTITY ||
    sensorPin == -1
  ) {

    Serial.println("INVALID DISPENSE COMMAND!");

    stopAllMotors();

    setStatus("failed");
    setDispensed(0);
    resetCommand();

    return;
  }


  Serial.println();
  Serial.println("============================");
  Serial.println("NEW DISPENSE REQUEST");
  Serial.print("Slot: ");
  Serial.println(slot);
  Serial.print("Quantity: ");
  Serial.println(quantity);
  Serial.println("============================");

  setDispensed(0);
  setStatus("dispensing");

  int actualDispensed = 0;


  for (int i = 1; i <= quantity; i++) {

    Serial.println();
    Serial.print("Waiting for tablet ");
    Serial.print(i);
    Serial.print("/");
    Serial.println(quantity);


    // =================================================
    // SENSOR MUST BE CLEAR BEFORE STARTING
    // =================================================

    if (digitalRead(sensorPin) == LOW) {

      Serial.println("Sensor already blocked. Waiting to clear...");

      if (!waitForSensorClear(sensorPin)) {

        stopAllMotors();

        Serial.println("SENSOR BLOCKED - DISPENSE ABORTED!");

        // Report failure for the tablet we were about to dispense
        bool failureReported = reportSensorResult(
          activeRequestId,
          i,
          false
        );

        if (!failureReported) {
          Serial.println(
            "WARNING: Failed to report sensor-block failure to PHP."
          );
        }

        setDispensed(actualDispensed);
        setStatus("failed");
        resetCommand();

        return;
      }
    }


    // =================================================
    // START MOTOR AND WAIT FOR TABLET
    // =================================================

    bool detected = waitForTablet(
      slot,
      sensorPin
    );


    // =================================================
    // TABLET WAS NOT DETECTED
    // =================================================

    if (!detected) {

      stopAllMotors();

      Serial.println("DISPENSE FAILED!");

      // Report failed tablet to PHP/MySQL
      bool failureReported = reportSensorResult(
        activeRequestId,
        i,
        false
      );

      if (!failureReported) {
        Serial.println(
          "WARNING: Failed to report dispense failure to PHP."
        );
      }

      setDispensed(actualDispensed);
      setStatus("failed");
      resetCommand();

      return;
    }


    // =================================================
    // ONE TABLET PHYSICALLY CONFIRMED BY IR SENSOR
    // =================================================

    actualDispensed++;

    Serial.print("CONFIRMED: ");
    Serial.print(actualDispensed);
    Serial.print("/");
    Serial.println(quantity);

    setDispensed(actualDispensed);


    // =================================================
    // REPORT SUCCESS TO PHP / MYSQL
    // =================================================

    bool reported = reportSensorResult(
      activeRequestId,
      actualDispensed,
      true
    );

    if (!reported) {

      stopAllMotors();

      Serial.println("PHP CALLBACK FAILED!");
      Serial.println(
        "Stopping dispense to prevent inventory mismatch."
      );

      setStatus("failed");
      resetCommand();

      return;
    }


    // =================================================
    // PREPARE FOR NEXT TABLET
    // =================================================

    if (actualDispensed < quantity) {

      // Current tablet must leave the sensor first
      if (!waitForSensorClear(sensorPin)) {

        stopAllMotors();

        Serial.println("SENSOR CLEAR TIMEOUT!");

        /*
          The current tablet was already successfully
          reported above.

          The NEXT tablet has not been dispensed yet,
          therefore report the next unit as failed.
        */
        bool failureReported = reportSensorResult(
          activeRequestId,
          actualDispensed + 1,
          false
        );

        if (!failureReported) {
          Serial.println(
            "WARNING: Failed to report sensor-clear failure to PHP."
          );
        }

        setDispensed(actualDispensed);
        setStatus("failed");
        resetCommand();

        return;
      }

      // Small separation between tablets
      delay(250);
    }
  }


  // =================================================
  // ALL REQUESTED TABLETS CONFIRMED
  // =================================================

  stopAllMotors();

  Serial.println();
  Serial.println("============================");
  Serial.println("DISPENSE SUCCESS!");
  Serial.print("Total dispensed: ");
  Serial.println(actualDispensed);
  Serial.println("============================");

  setDispensed(actualDispensed);
  setStatus("success");

  // Clear Firebase command but keep result/status visible
  resetCommand();
}


// =====================================================
// CHECK DISPENSE COMMAND
// =====================================================

void checkDispenseCommand() {

  if (dispenseInProgress) return;

  JsonDocument command;
  if (!firebaseGetCommand(command)) return;

  // Require real JSON integers; do not coerce missing fields or strings to zero.
  if (!command["request_id"].is<int64_t>() ||
      !command["slot"].is<int>() ||
      !command["quantity"].is<int>() ||
      !command["dispensed"].is<int>() ||
      !command["status"].is<const char*>()) {
    Serial.println("Rejected incomplete or incorrectly typed Firebase command.");
    return;
  }

  const int64_t requestId = command["request_id"].as<int64_t>();
  const int slot = command["slot"].as<int>();
  const int quantity = command["quantity"].as<int>();
  const int dispensed = command["dispensed"].as<int>();
  const String status = command["status"].as<String>();

  // Ignore results and retries of the last started cycle, even if writes failed.
  if (status != "pending" || requestId == lastStartedRequestId) return;


  // Reject anything outside our allowed range
  if (
    requestId <= 0 ||
    slot < 1 ||
    slot > 3 ||
    quantity < 1 ||
    quantity > MAX_QUANTITY ||
    dispensed != 0
  ) {

    Serial.println("Rejected invalid Firebase command.");

    stopAllMotors();

    setDispensed(0);
    setStatus("failed");
    resetCommand();

    return;
  }


  // Claim locally before starting any motor or making result/status writes.
  activeRequestId = requestId;
  lastStartedRequestId = requestId;
  dispenseInProgress = true;

  dispenseQuantity(
    slot,
    quantity
  );

  dispenseInProgress = false;
  activeRequestId = 0;
}
// =====================================================
// CHECK PENDING DISPENSE REQUEST FROM PHP
// =====================================================

void checkPendingDispense() {

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  // Do not request another dispense while one is running
  if (dispenseInProgress) {
    return;
  }

  BackendClient client;
  HTTPClient http;
  http.setConnectTimeout(backendConnectTimeoutMs());
  http.setTimeout(backendResponseTimeoutMs());

  String url =
    String(BACKEND_BASE_URL) +
    "/api/dispense/pending";

  http.begin(client.get(), url);
  http.addHeader("X-Hardware-Key", HARDWARE_API_KEY);

  int httpCode = http.GET();

  if (httpCode <= 0) {
    Serial.print("PENDING DISPENSE CONNECTION ERROR: ");
    Serial.println(http.errorToString(httpCode));
    http.end();
    return;
  }

  String response = http.getString();

  if (httpCode != 200) {
    Serial.print("PENDING DISPENSE HTTP ERROR: ");
    Serial.println(httpCode);
    Serial.println(response);
    http.end();
    return;
  }

  JsonDocument doc;

  DeserializationError error =
    deserializeJson(doc, response);

  if (error) {
    Serial.print("PENDING DISPENSE JSON ERROR: ");
    Serial.println(error.c_str());
    http.end();
    return;
  }

  bool active =
    doc["data"]["active"] | false;

  if (!active) {
    http.end();
    return;
  }

  int64_t requestId =
    doc["data"]["request_id"] | 0;

  if (requestId <= 0) {
    Serial.println("INVALID PENDING DISPENSE REQUEST ID.");
    http.end();
    return;
  }

  http.end();

  Serial.println();
  Serial.println("============================");
  Serial.println("PENDING DISPENSE FOUND");
  Serial.print("Request ID: ");
  Serial.println((long long)requestId);
  Serial.println("Dispatching automatically...");
  Serial.println("============================");

  // Tell PHP to mark the request as sent
  // and publish the command to Firebase
  BackendClient dispatchClient;
  HTTPClient dispatchHttp;
  dispatchHttp.setConnectTimeout(backendConnectTimeoutMs());
  dispatchHttp.setTimeout(backendResponseTimeoutMs());

  String dispatchUrl =
    String(BACKEND_BASE_URL) +
    "/api/dispense/" +
    String((long long)requestId);

  dispatchHttp.begin(dispatchClient.get(), dispatchUrl);
  dispatchHttp.addHeader("X-Hardware-Key", HARDWARE_API_KEY);
  dispatchHttp.addHeader("Content-Type", "application/json");

  int dispatchCode =
    dispatchHttp.POST("{}");

  String dispatchResponse =
    dispatchHttp.getString();

  Serial.print("AUTO DISPATCH HTTP STATUS: ");
  Serial.println(dispatchCode);

  if (dispatchCode >= 200 && dispatchCode < 300) {
    Serial.println("AUTO DISPATCH SUCCESS.");
  }
  else {
    Serial.println("AUTO DISPATCH FAILED:");
    Serial.println(dispatchResponse);
  }

  dispatchHttp.end();
}

// =====================================================
// PAYMENT SESSION
// =====================================================

// =====================================================
// COIN PULSE READER TASK
// =====================================================

// =====================================================
// WIFI CONNECTION
// =====================================================

#include "WiFiConnection.h"

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  // Motor pins
  pinMode(M1_ENB, OUTPUT);
  pinMode(M1_IN3, OUTPUT);
  pinMode(M1_IN4, OUTPUT);

  pinMode(M2_ENB, OUTPUT);
  pinMode(M2_IN3, OUTPUT);
  pinMode(M2_IN4, OUTPUT);

  pinMode(M3_ENB, OUTPUT);
  pinMode(M3_IN3, OUTPUT);
  pinMode(M3_IN4, OUTPUT);

  // IR sensors
  pinMode(IR1, INPUT);
  pinMode(IR2, INPUT);
  pinMode(IR3, INPUT);

  // Coin acceptor signal from optocoupler
  pinMode(COIN_PIN, INPUT_PULLUP);

  initializeCoinPayments();

  // Start dedicated coin pulse reader
  BaseType_t coinTaskCreated = xTaskCreatePinnedToCore(
    coinReaderTask,       // Task function
    "CoinReader",         // Task name
    4096,                 // Stack size
    NULL,                 // Parameter
    2,                    // Priority
    NULL,                 // Task handle
    1                     // ESP32 core
  );

  if (coinTaskCreated != pdPASS) flagCoinTaskFailure();

  // Safety: all motors OFF at boot
  stopAllMotors();

  Serial.println();
  Serial.println("============================");
  Serial.println("MEDIDISPENSE");
  Serial.println("QUANTITY DISPENSING SYSTEM");
  Serial.println("============================");

  connectWiFi();

  Serial.println("Firebase monitoring started.");
  Serial.println("Maximum quantity: 3");
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  if (WiFi.status() != WL_CONNECTED) {

    stopAllMotors();
    // Reconnect diagnostics are event-driven and rate-limited below.

  }

  connectWiFi();

  processDetectedCoin();

  checkPaymentSession();

  reportCoinDiagnostics();
  handleCoinMaintenance();

  checkPendingDispense();

  checkDispenseCommand();

  delay(1000);
}
