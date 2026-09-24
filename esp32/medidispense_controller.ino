// MediDispense ESP32 hardware contract reference.
// The PHP API remains the source of truth for payment, transaction state, and stock.
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* API_BASE = "http://YOUR-XAMPP-IP/medidispense/backend/public";
const char* HARDWARE_KEY = "replace-with-the-same-hardware-key";
const int MOTOR_PINS[] = {26, 27, 25, 33}; // Slots 1-4; slot 4 is reserved for expansion.
const int IR_PINS[] = {34, 35, 32, 39};

void sendHeartbeat() {
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/machine/heartbeat");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Hardware-Key", HARDWARE_KEY);
  http.POST("{\"machine_id\":1,\"esp32_status\":\"Ready\",\"motor_status\":\"Idle\",\"sensor_status\":\"Monitoring\",\"coin_acceptor_status\":\"Ready\"}");
  http.end();
}

// Production firmware should receive a command through a queued endpoint or MQTT/WebSocket bridge.
// After activating the motor, post to /api/dispense/{requestId}/sensor with {success:true} only
// after the IR sensor or limit switch confirms that the item crossed the chute.
void reportSensorConfirmation(long requestId, bool success, int slotNumber) {
  HTTPClient http;
  http.begin(String(API_BASE) + "/api/dispense/" + requestId + "/sensor");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Hardware-Key", HARDWARE_KEY);
  String body = String("{\"success\":") + (success ? "true" : "false") +
                ",\"slot_number\":" + slotNumber +
                ",\"motor_status\":\"Idle\",\"sensor_event\":\"IR_DROP\"}";
  http.POST(body);
  http.end();
}

void setup() { Serial.begin(115200); for (int pin : MOTOR_PINS) pinMode(pin, OUTPUT); for (int pin : IR_PINS) pinMode(pin, INPUT); }
void loop() { if (WiFi.status() == WL_CONNECTED) sendHeartbeat(); delay(30000); }
