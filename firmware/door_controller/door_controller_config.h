#pragma once

// ============================================================
//  door_controller_config.h — USER CONFIGURATION
//  Edit this file before flashing. Do NOT put your Telegram
//  bot token here — use the DEVICE_KEY for device auth only.
// ============================================================

// ------------------------------------------------------------
// WiFi credentials
// ------------------------------------------------------------
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"

// ------------------------------------------------------------
// Server connection
// ------------------------------------------------------------
#define API_HOST          "yourdomain.com"
#define API_PORT          8443

// ------------------------------------------------------------
// Device authentication
// NEVER put the Telegram bot token here.
// Generate a long random key (e.g. openssl rand -hex 32)
// and register it in your backend.
// ------------------------------------------------------------
#define DEVICE_KEY        "YOUR_LONG_RANDOM_DEVICE_KEY"

// ------------------------------------------------------------
// TLS: SHA-1 fingerprint of your server's TLS certificate.
// How to get it (run on Linux/Mac):
//
//   openssl s_client -connect yourdomain.com:8443 </dev/null 2>/dev/null \
//     | openssl x509 -fingerprint -sha1 -noout
//
// Example output:
//   SHA1 Fingerprint=AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD
//
// Copy the part after "SHA1 Fingerprint=" and paste below.
// NOTE: This fingerprint changes every time you renew your certificate.
//       Remember to re-flash after renewal.
// ------------------------------------------------------------
#define TLS_FINGERPRINT   "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD"

// ------------------------------------------------------------
// Hardware
// ------------------------------------------------------------
// GPIO5 = D1 on NodeMCU pinout.
// Safe choice: not a strapping pin, defaults LOW at boot,
// so relay stays OFF until explicitly commanded.
#define RELAY_PIN         5
// true  = relay module activates when pin is HIGH (most optocoupler modules)
// false = relay module activates when pin is LOW  (active-LOW modules)
#define RELAY_ACTIVE_HIGH true

// ------------------------------------------------------------
// Timing (milliseconds)
// ------------------------------------------------------------
#define PULSE_DURATION_MS      400    // Default relay pulse; server can override per-command
#define HEARTBEAT_INTERVAL_MS  30000  // How often to POST /api/device/heartbeat
#define POLL_INTERVAL_MS       5000   // How often to POST /api/device/command/pending
#define WIFI_RECONNECT_MS      10000  // How often to retry WiFi if disconnected
#define HTTP_TIMEOUT_MS        8000   // Timeout for each HTTP request

// ------------------------------------------------------------
// Firmware version — update when flashing a new build
// ------------------------------------------------------------
#define FIRMWARE_VERSION  "1.0.0"
