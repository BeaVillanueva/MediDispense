#pragma once
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Wi-Fi callbacks run on another task. Only copy small diagnostic events here.
// All retries and Serial output belong to loop(); no payment/NVS work here.
struct KioskWiFiEvent { arduino_event_id_t id; uint8_t reason; };
static QueueHandle_t kioskWiFiEvents=nullptr;
static bool kioskWiFiInitialized=false,kioskWiFiAttempting=false,kioskWiFiAssociated=false;
static uint32_t kioskWiFiStarted=0,kioskWiFiNextAttempt=0,kioskWiFiBackoff=5000,kioskWiFiAttempts=0;
static bool kioskWiFiFirstDisconnectSeen=false;
static uint32_t kioskWiFiCoreRetryStarted=0;

static const char* kioskWiFiReason(uint8_t reason) {
  switch(reason) {
    case WIFI_REASON_NO_AP_FOUND:return "access point not found";
    case WIFI_REASON_AUTH_FAIL:return "authentication failed";
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:return "security handshake timeout";
    case WIFI_REASON_BEACON_TIMEOUT:return "access point beacon timeout";
    case WIFI_REASON_ASSOC_FAIL:return "association failed";
    default:return "see ESP32 disconnect reason code";
  }
}

static void kioskWiFiEvent(arduino_event_id_t id,arduino_event_info_t info) {
  if(id!=ARDUINO_EVENT_WIFI_STA_START&&id!=ARDUINO_EVENT_WIFI_STA_STOP&&
     id!=ARDUINO_EVENT_WIFI_STA_CONNECTED&&id!=ARDUINO_EVENT_WIFI_STA_DISCONNECTED&&
     id!=ARDUINO_EVENT_WIFI_STA_GOT_IP&&id!=ARDUINO_EVENT_WIFI_STA_LOST_IP)return;
  KioskWiFiEvent event{id,static_cast<uint8_t>(id==ARDUINO_EVENT_WIFI_STA_DISCONNECTED?info.wifi_sta_disconnected.reason:0)};
  // A full diagnostics queue never blocks Wi-Fi or coin capture. The loop's
  // status/attempt timeout still provides recovery if a diagnostic is dropped.
  if(kioskWiFiEvents)xQueueSend(kioskWiFiEvents,&event,0);
}

static void kioskWiFiSchedule(uint32_t now) {
  kioskWiFiAttempting=false;kioskWiFiAssociated=false;
  kioskWiFiNextAttempt=now+kioskWiFiBackoff;
  Serial.printf("[WiFi] Retry scheduled in %lu seconds. Coin journal preserved.\n",(unsigned long)(kioskWiFiBackoff/1000));
  kioskWiFiBackoff=kioskWiFiBackoff<30000?kioskWiFiBackoff*2:60000;
}

static void kioskWiFiConnected() {
  String host(BACKEND_BASE_URL);
  int scheme=host.indexOf("://");if(scheme>=0)host=host.substring(scheme+3);
  int end=host.indexOf('/');if(end>=0)host=host.substring(0,end);
  end=host.indexOf('?');if(end>=0)host=host.substring(0,end);
  end=host.indexOf('#');if(end>=0)host=host.substring(0,end);
  int auth=host.lastIndexOf('@');if(auth>=0)host=host.substring(auth+1);
  Serial.printf("[WiFi] Connected; device=%s IP=%s gateway=%s RSSI=%d dBm backend_host=%s\n",
    WiFi.macAddress().c_str(),WiFi.localIP().toString().c_str(),WiFi.gatewayIP().toString().c_str(),WiFi.RSSI(),host.c_str());
}

void connectWiFi() {
  const uint32_t now=millis();
  if(!kioskWiFiInitialized) {
    kioskWiFiEvents=xQueueCreate(16,sizeof(KioskWiFiEvent));
    if(!kioskWiFiEvents){Serial.println("[WiFi] Diagnostic queue unavailable; retry initialization later.");return;}
    WiFi.onEvent(kioskWiFiEvent);
    WiFi.persistent(false); // Radio config in RAM; never erase coin Preferences.
    WiFi.setAutoReconnect(false); // This scheduler is the only retry owner.
    WiFi.mode(WIFI_STA);
    kioskWiFiInitialized=true;kioskWiFiAttempting=true;kioskWiFiStarted=now;
    ++kioskWiFiAttempts;
    Serial.println("[WiFi] Station mode; connection attempt #1 (45s association window).");
    WiFi.begin(WIFI_SSID,WIFI_PASSWORD); // Configure credentials once per boot.
    return;
  }
  KioskWiFiEvent event;
  while(xQueueReceive(kioskWiFiEvents,&event,0)==pdTRUE) {
    switch(event.id) {
      case ARDUINO_EVENT_WIFI_STA_START:Serial.println("[WiFi] Station started.");break;
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        kioskWiFiAssociated=true;kioskWiFiStarted=now;
        Serial.println("[WiFi] Access point associated; waiting for DHCP (60s window).");break;
      case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        kioskWiFiAttempting=false;kioskWiFiAssociated=true;kioskWiFiBackoff=5000;
        kioskWiFiConnected();break;
      case ARDUINO_EVENT_WIFI_STA_LOST_IP:
        kioskWiFiAttempting=true;kioskWiFiStarted=now;
        Serial.println("[WiFi] IP address lost; waiting for DHCP recovery.");break;
      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
        Serial.printf("[WiFi] Disconnected: reason=%u (%s).\n",event.reason,kioskWiFiReason(event.reason));
        // Core 3.2.1 performs one initial retry even with auto-reconnect off.
        // Do not compete with that hidden attempt (or its disconnect events).
        if(!kioskWiFiFirstDisconnectSeen){kioskWiFiFirstDisconnectSeen=true;kioskWiFiCoreRetryStarted=now;}
        if(now-kioskWiFiCoreRetryStarted<45000){
          kioskWiFiAttempting=true;kioskWiFiAssociated=false;kioskWiFiStarted=kioskWiFiCoreRetryStarted;
          Serial.println("[WiFi] Allowing initial core retry to finish (45s window).");break;
        }
        kioskWiFiSchedule(now);break;
      case ARDUINO_EVENT_WIFI_STA_STOP:
        Serial.println("[WiFi] Station stopped.");kioskWiFiSchedule(now);break;
      default:break;
    }
  }
  if(WiFi.isConnected())return;
  if(kioskWiFiAttempting) {
    const uint32_t limit=kioskWiFiAssociated?60000:45000;
    if(now-kioskWiFiStarted<limit)return;
    Serial.println("[WiFi] Connection/DHCP deadline exceeded; ending stalled attempt, not erasing settings.");
    WiFi.disconnect(false,false);
    kioskWiFiSchedule(now);
    return;
  }
  if(static_cast<int32_t>(now-kioskWiFiNextAttempt)<0)return;
  kioskWiFiAttempting=true;kioskWiFiAssociated=false;kioskWiFiStarted=now;
  ++kioskWiFiAttempts;
  Serial.printf("[WiFi] Reconnection attempt #%lu (45s association window).\n",(unsigned long)kioskWiFiAttempts);
  if(!WiFi.reconnect())Serial.println("[WiFi] Driver did not accept reconnect; waiting for event or attempt deadline.");
}
