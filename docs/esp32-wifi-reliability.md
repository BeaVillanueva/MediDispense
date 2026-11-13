# ESP32 Wi-Fi reliability update

The installed Arduino-ESP32 core is 3.2.1, board target `esp32:esp32:esp32`. Its `WiFi.begin(ssid,password)` path reapplies station configuration, DHCP configuration and `esp_wifi_connect()`. The old firmware called this every ten seconds while also enabling automatic reconnect. That repeats configuration while association, a core retry, or DHCP may still be underway. This is a firmware retry-design fault, not proof of an incorrect password or a particular router failure. The previous generic message omitted the information needed to identify the physical network cause.

Changes are restricted to the sketch Wi-Fi section and new `WiFiConnection.h`:

- Initialize station mode explicitly; keep Wi-Fi configuration in RAM.
- Configure credentials once per boot. Use one application retry scheduler with automatic reconnect disabled. Allow the core's unavoidable first retry a 45-second grace window.
- Allow 45 seconds for association and 60 seconds after association for DHCP. A stalled attempt is disconnected without erasing configuration, then retried with 5–60 second backoff. There are no new wait/delay loops.
- Queue small Wi-Fi events from the SDK task; process events, Serial logging and reconnection in the main loop. The callback does not access payment state, NVS or HTTP.
- Keep the existing offline motor stop. The dedicated coin reader, event journal and retry/acknowledgement logic remain unchanged.
- Print numeric disconnect reasons, association/IP transitions, retries, device MAC, IP, gateway, RSSI and only the backend host. No passwords, API keys or full backend URLs are logged by the new code.

Typical serial output at 115200 baud:

```text
[WiFi] Station mode; connection attempt #1 (45s association window).
[WiFi] Station started.
[WiFi] Access point associated; waiting for DHCP (60s window).
[WiFi] Connected; device=2C:8C:6A:F3:AF:48 IP=<assigned IP> gateway=<router IP> RSSI=<signal> dBm backend_host=<configured host>
[WiFi] Disconnected: reason=201 (access point not found).
[WiFi] Allowing initial core retry to finish (45s window).
[WiFi] Retry scheduled in 5 seconds. Coin journal preserved.
[WiFi] Reconnection attempt #2 (45s association window).
```

Those are examples, not a claim that a real failure used reason 201. Reason 202 indicates authentication failure, 15 a security handshake timeout, 200 a beacon timeout, and 203 association failure. Other reasons retain the numeric code for diagnosis. Association without an IP points toward DHCP; successful IP assignment followed by stale backend reports requires a separate backend/network check.

Keep the existing 2.4 GHz network and credentials. After manually uploading, observe the actual reason codes and IP assignment, then verify backend diagnostics remain fresh through a supervised disconnect/reconnect. Do not insert test coins into an uncertain session. Compilation does not prove physical reconnection or payment safety. No firmware upload, board reset, NVS erasure, controller retirement, transaction change or inventory change is performed by this update.
