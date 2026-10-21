#pragma once

// ============================================================
//  door_controller_config.h — USER CONFIGURATION
//  Edit this file before flashing. Do NOT put your Telegram
//  bot token here — use the DEVICE_KEY for device auth only.
// ============================================================

// ------------------------------------------------------------
// WiFi credentials (defined in door_controller.ino or here)
// ------------------------------------------------------------
#ifndef WIFI_SSID
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"
#endif

// ------------------------------------------------------------
// Server connection
// ------------------------------------------------------------
#define API_HOST          "telegram-door-control.onrender.com"
#define API_PORT          443

// ------------------------------------------------------------
// Device authentication
// NEVER put the Telegram bot token here.
// ------------------------------------------------------------
#define DEVICE_KEY        "d9c72e91a03f4826b1582e3c098a123f"

// ------------------------------------------------------------
// TLS: SHA-1 fingerprint of your server's TLS certificate.
// Leave empty ("") when using Render / cloud hosting (Render auto-renews
// Let's Encrypt certificates every 60-90 days).
// ------------------------------------------------------------
#define TLS_FINGERPRINT   ""

// ------------------------------------------------------------
// Hardware
// ------------------------------------------------------------
// GPIO5 = D1 on NodeMCU pinout.
// Safe choice: not a strapping pin, defaults LOW at boot,
// so relay stays OFF until explicitly commanded.
#define RELAY_PIN         5
// true  = relay module activates when pin is HIGH
// false = relay module activates when pin is LOW  (most 5V optocoupled relay modules)
#define RELAY_ACTIVE_HIGH false

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
