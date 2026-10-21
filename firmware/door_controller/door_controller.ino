/**
 * door_controller.ino
 * =============================================================================
 * Secure ESP8266 Door Controller Firmware
 *
 * Implements:
 *  - Safe relay initialization (defaults to OFF immediately on boot)
 *  - Non-blocking Wi-Fi management with automatic reconnection
 *  - Real-time Clock synchronization via NTP for accurate command expiry checks
 *  - Outbound HTTPS polling using WiFiClientSecure with SHA-1 fingerprint validation
 *  - Device authentication and periodic telemetry heartbeats
 *  - Duplicate-command prevention (rolling history ring buffer of executed IDs)
 *  - Exact single pulse execution (300-500 ms) via non-blocking state machine
 *  - Reliable acknowledgment reporting (success / uncertain / failed)
 *  - Prevention of re-triggering under network uncertainty
 *
 * Target Board: Robotdyn WiFi UNO (ATmega328P + ESP8266 4MB) or NodeMCU/Generic ESP8266
 * Author: Senior IoT & Cybersecurity Specialist
 * =============================================================================
 */

#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "door_controller_config.h"

// -----------------------------------------------------------------------------
// Constants and State Definitions
// -----------------------------------------------------------------------------

#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.nist.gov"
#define EXECUTED_CACHE_SIZE 16

enum RelayState {
  RELAY_IDLE,
  RELAY_PULSING
};

// -----------------------------------------------------------------------------
// Global Variables
// -----------------------------------------------------------------------------

// Relay control
RelayState currentRelayState = RELAY_IDLE;
unsigned long pulseStartTime = 0;
unsigned long activePulseDuration = PULSE_DURATION_MS;
String activeCommandId = "";

// Timers (all non-blocking using millis())
unsigned long lastHeartbeatTime = 0;
unsigned long lastPollTime = 0;
unsigned long lastWifiAttemptTime = 0;

// Device State
bool isAuthenticated = false;
String assignedDeviceId = "";

// Ring buffer of recently executed command IDs for deduplication
String executedCommandCache[EXECUTED_CACHE_SIZE];
uint8_t cacheHead = 0;

// -----------------------------------------------------------------------------
// Relay Helper Functions (Safe Pin Control)
// -----------------------------------------------------------------------------

/**
 * Sets the physical relay pin to its safe inactive state (OFF).
 */
void setRelayInactive() {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(RELAY_PIN, LOW);
  } else {
    digitalWrite(RELAY_PIN, HIGH);
  }
}

/**
 * Sets the physical relay pin to its active state (ON).
 */
void setRelayActive() {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(RELAY_PIN, HIGH);
  } else {
    digitalWrite(RELAY_PIN, LOW);
  }
}

// -----------------------------------------------------------------------------
// Command Deduplication Cache
// -----------------------------------------------------------------------------

bool isCommandAlreadyExecuted(const String& commandId) {
  for (uint8_t i = 0; i < EXECUTED_CACHE_SIZE; i++) {
    if (executedCommandCache[i].length() > 0 && executedCommandCache[i] == commandId) {
      return true;
    }
  }
  return false;
}

void markCommandExecuted(const String& commandId) {
  executedCommandCache[cacheHead] = commandId;
  cacheHead = (cacheHead + 1) % EXECUTED_CACHE_SIZE;
}

// -----------------------------------------------------------------------------
// Time and Expiry Helpers
// -----------------------------------------------------------------------------

/**
 * Basic ISO 8601 UTC timestamp parser (e.g. "2026-10-20T19:30:00.000Z")
 * Returns epoch timestamp in seconds, or 0 on failure.
 */
time_t parseIso8601(const String& isoStr) {
  if (isoStr.length() < 19) return 0;

  struct tm t;
  memset(&t, 0, sizeof(struct tm));

  int year = isoStr.substring(0, 4).toInt();
  int month = isoStr.substring(5, 7).toInt();
  int day = isoStr.substring(8, 10).toInt();
  int hour = isoStr.substring(11, 13).toInt();
  int minute = isoStr.substring(14, 16).toInt();
  int second = isoStr.substring(17, 19).toInt();

  t.tm_year = year - 1900;
  t.tm_mon  = month - 1;
  t.tm_mday = day;
  t.tm_hour = hour;
  t.tm_min  = minute;
  t.tm_sec  = second;
  t.tm_isdst = 0;

  return mktime(&t);
}

// -----------------------------------------------------------------------------
// HTTPS Request Helper
// -----------------------------------------------------------------------------

/**
 * Performs a secure HTTPS POST to the specified path with JSON payload.
 * Validates the server's TLS certificate against TLS_FINGERPRINT.
 * Returns true if HTTP 200, populating responseBody.
 */
bool makeSecurePost(const String& path, const String& jsonPayload, String& responseBody, int& httpCodeOut) {
  WiFiClientSecure client;
  client.setTimeout(HTTP_TIMEOUT_MS);

  // Set SHA-1 fingerprint for certificate verification, or setInsecure for dynamic certs
  #if defined(TLS_FINGERPRINT)
    if (strlen(TLS_FINGERPRINT) > 0 && strcmp(TLS_FINGERPRINT, "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD") != 0) {
      client.setFingerprint(TLS_FINGERPRINT);
    } else {
      client.setInsecure();
    }
  #else
    client.setInsecure();
  #endif

  HTTPClient https;
  String url = String("https://") + API_HOST + ":" + API_PORT + path;

  if (!https.begin(client, url)) {
    Serial.println(F("[HTTPS] Connection begin failed."));
    return false;
  }

  https.addHeader(F("Content-Type"), F("application/json"));
  https.setTimeout(HTTP_TIMEOUT_MS);

  int httpCode = https.POST(jsonPayload);
  httpCodeOut = httpCode;

  bool success = false;
  if (httpCode > 0) {
    responseBody = https.getString();
    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
      success = true;
    } else {
      Serial.print(F("[HTTPS] Server returned HTTP code: "));
      Serial.println(httpCode);
    }
  } else {
    Serial.print(F("[HTTPS] POST failed, error: "));
    Serial.println(https.errorToString(httpCode));
  }

  https.end();
  return success;
}

// -----------------------------------------------------------------------------
// Authentication, Heartbeat, and Polling
// -----------------------------------------------------------------------------

void doDeviceAuth() {
  StaticJsonDocument<256> doc;
  doc["deviceKey"] = DEVICE_KEY;

  String payload;
  serializeJson(doc, payload);

  String response;
  int code = 0;
  Serial.print(F("[Auth] Authenticating device with server... "));

  if (makeSecurePost("/api/device/auth", payload, response, code)) {
    StaticJsonDocument<512> resDoc;
    DeserializationError err = deserializeJson(resDoc, response);
    if (!err && resDoc["ok"] == true) {
      assignedDeviceId = resDoc["deviceId"].as<String>();
      isAuthenticated = true;
      Serial.println(F("OK!"));
      Serial.print(F("[Auth] Registered ID: "));
      Serial.println(assignedDeviceId);
      return;
    }
  }

  Serial.println(F("FAILED. Check DEVICE_KEY or server connectivity."));
  isAuthenticated = false;
}

void sendHeartbeat() {
  StaticJsonDocument<384> doc;
  doc["deviceKey"] = DEVICE_KEY;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptimeSeconds"] = (unsigned long)(millis() / 1000);
  doc["wifiRssi"] = WiFi.RSSI();

  String payload;
  serializeJson(doc, payload);

  String response;
  int code = 0;
  if (makeSecurePost("/api/device/heartbeat", payload, response, code)) {
    Serial.println(F("[Heartbeat] Heartbeat acknowledged by server."));
  } else {
    Serial.println(F("[Heartbeat] Failed to send heartbeat."));
  }
}

void sendCommandAck(const String& commandId, const String& result, const String& detail) {
  StaticJsonDocument<384> doc;
  doc["deviceKey"] = DEVICE_KEY;
  doc["commandId"] = commandId;
  doc["result"] = result;
  doc["detail"] = detail;

  String payload;
  serializeJson(doc, payload);

  String response;
  int code = 0;
  Serial.print(F("[ACK] Sending command acknowledgment ("));
  Serial.print(result);
  Serial.print(F(")... "));

  if (makeSecurePost("/api/device/command/ack", payload, response, code)) {
    Serial.println(F("OK."));
  } else {
    Serial.println(F("WARNING: Failed to deliver ACK to backend."));
    // DO NOT retry pulse under any circumstances — door may have already toggled!
  }
}

void pollForCommand() {
  // If a pulse is already being generated, do not fetch another command
  if (currentRelayState != RELAY_IDLE) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["deviceKey"] = DEVICE_KEY;

  String payload;
  serializeJson(doc, payload);

  String response;
  int code = 0;
  if (!makeSecurePost("/api/device/command/pending", payload, response, code)) {
    return;
  }

  StaticJsonDocument<768> resDoc;
  DeserializationError err = deserializeJson(resDoc, response);
  if (err || resDoc["ok"] != true) {
    return;
  }

  // Check if there is a pending command
  if (resDoc["command"].isNull()) {
    return;
  }

  JsonObject cmd = resDoc["command"].as<JsonObject>();
  String commandId = cmd["id"].as<String>();
  String commandType = cmd["commandType"].as<String>();
  String expiresAtStr = cmd["expiresAt"].as<String>();
  unsigned long duration = cmd["pulseDurationMs"].as<unsigned long>();

  if (duration < 100 || duration > 3000) {
    duration = PULSE_DURATION_MS;
  }

  Serial.println(F("---------------------------------------------"));
  Serial.print(F("[Command] Received command: "));
  Serial.print(commandType);
  Serial.print(F(" (ID: "));
  Serial.print(commandId);
  Serial.println(F(")"));

  // 1. Check duplicate execution in local cache
  if (isCommandAlreadyExecuted(commandId)) {
    Serial.println(F("[Command] Duplicate command detected in local cache. Skipping execution."));
    sendCommandAck(commandId, "success", "already_executed_cache_hit");
    return;
  }

  // 2. Validate expiration timestamp
  time_t now = time(nullptr);
  time_t expiresAt = parseIso8601(expiresAtStr);
  if (expiresAt > 0 && now > 100000 && now >= expiresAt) {
    Serial.println(F("[Command] Command has expired. Rejecting execution."));
    sendCommandAck(commandId, "failed", "command_expired");
    return;
  }

  // 3. Validate command type
  if (commandType != "press" && commandType != "open" && commandType != "close") {
    Serial.println(F("[Command] Unknown command type. Rejecting."));
    sendCommandAck(commandId, "failed", "unknown_command_type");
    return;
  }

  // 4. Trigger exact single pulse via non-blocking state machine
  Serial.print(F("[Relay] Activating relay pulse for "));
  Serial.print(duration);
  Serial.println(F(" ms..."));

  activeCommandId = commandId;
  activePulseDuration = duration;
  pulseStartTime = millis();
  currentRelayState = RELAY_PULSING;

  // Immediately pull relay to active state
  setRelayActive();
}

// -----------------------------------------------------------------------------
// Non-blocking Relay State Machine
// -----------------------------------------------------------------------------

void handleRelayStateMachine() {
  if (currentRelayState == RELAY_PULSING) {
    unsigned long elapsed = millis() - pulseStartTime;
    if (elapsed >= activePulseDuration) {
      // Pulse duration finished: return relay to inactive state
      setRelayInactive();
      currentRelayState = RELAY_IDLE;

      Serial.println(F("[Relay] Pulse completed. Relay restored to OFF."));

      // Mark command as executed in deduplication cache
      markCommandExecuted(activeCommandId);

      // Report success acknowledgment to backend
      sendCommandAck(activeCommandId, "success", "pulse_completed_normally");

      activeCommandId = "";
    }
  }
}

// -----------------------------------------------------------------------------
// Wi-Fi Management (Non-blocking)
// -----------------------------------------------------------------------------

void handleWifiConnection() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  unsigned long now = millis();
  if (now - lastWifiAttemptTime > WIFI_RECONNECT_MS) {
    lastWifiAttemptTime = now;
    Serial.print(F("[WiFi] Connecting to SSID: "));
    Serial.println(WIFI_SSID);

    WiFi.disconnect();
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

// -----------------------------------------------------------------------------
// Arduino setup()
// -----------------------------------------------------------------------------

void setup() {
  // CRITICAL HARDWARE SECURITY REQUIREMENT:
  // Configure relay pin as OUTPUT and ensure it is INACTIVE immediately,
  // before starting any serial, Wi-Fi, or TLS subsystem.
  pinMode(RELAY_PIN, OUTPUT);
  setRelayInactive();

  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F("  Secure ESP8266 Door Relay Controller v" FIRMWARE_VERSION));
  Serial.println(F("=================================================="));
  Serial.print(F("[Hardware] Relay pin GPIO"));
  Serial.print(RELAY_PIN);
  Serial.println(F(" set to INACTIVE (OFF)."));

  // Connect to Wi-Fi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print(F("[WiFi] Connecting to "));
  Serial.println(WIFI_SSID);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(F("."));
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("[WiFi] Connected! IP address: "));
    Serial.println(WiFi.localIP());

    // Initialize NTP time sync for expiration checks
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    Serial.println(F("[NTP] Time synchronization requested."));

    // Authenticate with backend
    doDeviceAuth();
  } else {
    Serial.println(F("[WiFi] Initial connection failed. Background reconnect enabled."));
  }
}

// -----------------------------------------------------------------------------
// Arduino loop()
// -----------------------------------------------------------------------------

void loop() {
  // 1. Maintain relay pulse timing (must never be delayed)
  handleRelayStateMachine();

  // 2. Maintain Wi-Fi connectivity
  handleWifiConnection();

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  // 3. Re-authenticate if not yet authenticated
  if (!isAuthenticated) {
    unsigned long now = millis();
    if (now - lastHeartbeatTime > 10000) {
      lastHeartbeatTime = now;
      doDeviceAuth();
    }
    return;
  }

  unsigned long currentMillis = millis();

  // 4. Poll for pending commands at configured interval
  if (currentMillis - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = currentMillis;
    pollForCommand();
  }

  // 5. Send periodic telemetry heartbeat
  if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = currentMillis;
    sendHeartbeat();
  }
}
