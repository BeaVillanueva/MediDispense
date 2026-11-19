#pragma once
// Chooses the transport for PHP backend calls from BACKEND_BASE_URL (secrets.h):
// https:// (hosted, e.g. Railway) uses TLS; http:// (local XAMPP) stays plain.
// Include after secrets.h.
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <string.h>

static inline bool backendUsesTls() {
  return strncmp(BACKEND_BASE_URL, "https://", 8) == 0;
}
// TLS over the internet needs more time than a LAN request.
static inline uint32_t backendConnectTimeoutMs() { return backendUsesTls() ? 8000 : 3000; }
static inline uint32_t backendResponseTimeoutMs() { return backendUsesTls() ? 10000 : 5000; }

class BackendClient {
 public:
  BackendClient() {
    // Same certificate policy as the existing Firebase requests in this sketch.
    secure_.setInsecure();
  }
  WiFiClient &get() { return backendUsesTls() ? static_cast<WiFiClient &>(secure_) : plain_; }

 private:
  WiFiClient plain_;
  WiFiClientSecure secure_;
};
