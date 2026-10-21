# Secure Telegram Door Control System

A complete, production-grade remote door-control system operated entirely through a private **Telegram bot** and an **ESP8266** microcontroller driving a relay in parallel with an existing door push-button switch.

> **Zero Cloud Dependencies:** Does not use Vercel, Neon, PostgreSQL, or any public web dashboard. The single Node.js/TypeScript application hosts the Telegram bot (via long polling) and an embedded HTTPS API for the ESP8266, persisting state locally in SQLite (WAL mode).

---

## Architecture Overview

```
                                      +-----------------------------------------+
                                      |            TELEGRAM CLOUD               |
                                      +--------------------+--------------------+
                                                           ^
                                           Long Polling    |
                                       (no webhook needed) |
                                                           v
+----------------------------------------------------------+--------------------+
|  HOST SERVER (VPS / Dedicated Linux / Raspberry Pi / Docker)                  |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | Node.js + TypeScript Service (PM2 Process Manager)                      |  |
|  |                                                                         |  |
|  |   +-----------------------+         +-------------------------------+   |  |
|  |   |  Telegram Bot Engine  | <-----> |   Command & Audit Service     |   |  |
|  |   |  (Long Polling)       |         |   - Rate Limiting (5/min)     |   |  |
|  |   |  - Auth Check         |         |   - Idempotency & Expiry      |   |  |
|  |   |  - Inline Keyboards   |         |   - State Machine             |   |  |
|  |   +-----------------------+         +---------------+---------------+   |  |
|  |                                                     ^                   |  |
|  |   +-----------------------+                         |                   |  |
|  |   | Embedded Express API  | <-----------------------+                   |  |
|  |   | (Port 8443, HTTPS)    |                                             |  |
|  |   | - /api/device/auth    |                 +-----------------------+   |  |
|  |   | - /api/device/hb      | <-------------> | SQLite Database (WAL) |   |  |
|  |   | - /api/device/pending |                 | data/door.db          |   |  |
|  |   | - /api/device/ack     |                 +-----------------------+   |  |
|  |   +-----------+-----------+                                             |  |
|  +---------------|---------------------------------------------------------+  |
+------------------|------------------------------------------------------------+
                   ^
                   | Outbound HTTPS Polling (TLS Fingerprint Verified)
                   | No inbound port forwarding on home router required!
                   v
+------------------+------------------------------------------------------------+
|  DOOR LOCATION                                                                |
|                                                                               |
|  +--------------------------------------------------+                         |
|  | Robotdyn WiFi UNO (ESP8266 4MB Subsystem)        |                         |
|  | Firmware: door_controller.ino                    |                         |
|  | GPIO5 ───> [ 5V Optocoupled Relay Module ]       |                         |
|  +---------------------------|----------------------+                         |
|                              | NO & COM Contacts in parallel                  |
|                              v                                                |
|  +--------------------------------------------------+                         |
|  | Existing Door Controller Wall Push Button        |                         |
|  | (Every pulse toggles: Open <───> Close)          |                         |
|  +--------------------------------------------------+                         |
+-------------------------------------------------------------------------------+
```

---

## 1. Hardware & Board Identification

### Target Board: Robotdyn WiFi UNO (ATmega328P + ESP8266 4MB)
This board integrates an ATmega328P and an ESP8266EX with 4MB flash on a single Arduino Uno form-factor PCB, interconnected through an 8-position DIP switch bank (SW1–SW8).

- **Execution Strategy:** The Wi-Fi firmware runs **directly on the ESP8266**. The ATmega328P is bypassed entirely during operation.
- **Relay Pin:** **GPIO5 (D1)** is chosen because:
  1. It is **not** a strapping pin (unlike GPIO0, GPIO2, GPIO15).
  2. It defaults to **LOW** at boot and reset, preventing spurious relay pulses.
  3. It is fully isolated from ESP8266 boot-mode selection.
- **Relay Module:** 5V single-channel relay with optocoupler isolation (SRD-05VDC-SL-C).
- **Wiring Rule:** The relay's Normally Open (NO) and Common (COM) terminals wire directly across the two existing wall button terminals.

---

## 2. Security Design Principles

1. **Numeric ID Authorization Only:** Only numeric Telegram User IDs explicitly listed in `ALLOWED_TELEGRAM_USER_IDS` are granted access. Usernames and display names are never trusted.
2. **Anti-Toggle Protection:** Physical door controllers toggle on every pulse. Sending duplicate pulses reverses state. The firmware:
   - Maintains an in-memory ring buffer of executed command IDs.
   - Requires explicit confirmation via Telegram inline buttons (expires in 30 seconds).
   - If network acknowledgment fails, flags the state as `uncertain` rather than blindly retrying.
3. **Outbound HTTPS Only:** The ESP8266 makes outbound HTTPS requests to the server. No port forwarding or public IP is required at the door location.
4. **Certificate Validation:** Firmware validates the server's TLS certificate using a SHA-1 fingerprint.
5. **Fail-Safe Startup:** GPIO5 is pulled LOW immediately in `setup()`, guaranteeing the relay stays OFF during reboot, power loss, and Wi-Fi disconnects.

---

## 3. Telegram Commands Reference

| Command | Action | Confirmation Required | Description |
|---|---|:---:|---|
| `/start` | Welcome & Auth Check | No | Validates numerical user ID and introduces commands. |
| `/help` | Usage & Safety Warning | No | Explains toggle behavior and safety warnings. |
| `/press` | Pulse Button | **Yes (30s)** | Sends a 300–500 ms contact closure to simulate button press. |
| `/open` | Request Door Open | **Yes (30s)** | Button-press simulation with warning that door open cannot be guaranteed. |
| `/close` | Request Door Close | **Yes (30s)** | Button-press simulation with warning that controller toggles. |
| `/status` | Telemetry & Connectivity | No | Reports ESP8266 connectivity, last heartbeat, and last command. |
| `/history` | Command Audit Trail | No | Displays recent command history and outcomes for the user. |
| `/cancel` | Cancel Pending | No | Cancels an unconfirmed command before it is picked up. |

---

## 4. Quick Start Deployment

### Prerequisites
- Linux VPS / Server / Raspberry Pi with **Node.js >= 18** and **npm**
- Domain name with public DNS pointing to your host server
- An active Telegram account

### Step 1: Create Your Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow instructions.
3. Copy the HTTP API token (e.g., `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ`).
4. Find your numeric Telegram ID by messaging `@userinfobot`. Note the numerical `Id` (e.g., `987654321`).

### Step 2: Configure Server Environment
Clone or place this repository on your server:

```bash
cd /opt/telegram-door-control
cp .env.example .env
nano .env
```

Set the variables in `.env`:
```ini
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
ALLOWED_TELEGRAM_USER_IDS=987654321
DEVICE_KEY=c7e5a84210d3e52fba4987120eac71624b5d23e198fa01b2
DB_PATH=./data/door.db
API_PORT=8443
PULSE_DURATION_MS=400
NODE_ENV=production
TLS_CERT_PATH=/etc/letsencrypt/live/door.yourdomain.com/fullchain.pem
TLS_KEY_PATH=/etc/letsencrypt/live/door.yourdomain.com/privkey.pem
```

### Step 3: Obtain Let's Encrypt TLS Certificate
```bash
sudo apt update && sudo apt install -y certbot
sudo certbot certonly --standalone -d door.yourdomain.com
```

### Step 4: Run Automated Setup & Install Dependencies
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### Step 5: Start Service with PM2
```bash
npm install -g pm2
cd bot
pm2 start dist/index.js --name "telegram-door-control"
pm2 save
pm2 startup
```

---

## 5. ESP8266 Firmware Setup & Flashing

Detailed flashing documentation is provided in [docs/flashing.md](file:///C:/Users/ASUS/.gemini/antigravity/scratch/telegram-door-control/docs/flashing.md).

### 1. Configure Firmware
Edit `firmware/door_controller/door_controller_config.h`:
- `WIFI_SSID` / `WIFI_PASSWORD`
- `API_HOST`: `door.yourdomain.com`
- `API_PORT`: `8443`
- `DEVICE_KEY`: Must match the plaintext secret configured in `.env`.
- `TLS_FINGERPRINT`: Extract SHA-1 fingerprint from your server:
  ```bash
  openssl s_client -connect door.yourdomain.com:8443 </dev/null 2>/dev/null \
    | openssl x509 -fingerprint -sha1 -noout
  ```

### 2. Set DIP Switches on Robotdyn WiFi UNO for Direct Flashing
Set DIP switches to **Mode B**:
```
SW1: OFF    SW5: OFF
SW2: OFF    SW6: OFF
SW3: OFF    SW7: ON   (USB-TX -> ESP-RX)
SW4: OFF    SW8: ON   (ESP-TX -> USB-RX)
```
Pull **GPIO0 LOW** during power-up or press and hold the **FLASH** button while tapping **RESET** to enter the bootloader.

### 3. Flash Using Arduino IDE
- Board: **Generic ESP8266 Module**
- Flash Size: **4MB (FS:2MB OTA:~1MB)**
- Upload Speed: **115200**
- Select Serial Port and click **Upload**.

---

## 6. Wiring & Bench Safety Testing

Complete step-by-step electrical safety guide is in [docs/wiring.md](file:///C:/Users/ASUS/.gemini/antigravity/scratch/telegram-door-control/docs/wiring.md).

```
ESP8266 (Robotdyn)                5V Relay Module                Door Controller
+------------------+             +-----------------+             +------------------+
|             5V   +────────────>| VCC             |             |                  |
|             GND  +────────────>| GND             |             | Existing Push-   |
|          GPIO5   +────────────>| IN           NO +────────────>| Button Terminals |
|                  |             |             COM +────────────>| (In Parallel)    |
+------------------+             +-----------------+             +------------------+
```

### Bench Testing with LED Before Connecting to Door:
1. Connect an LED in series with a 330Ω resistor across the relay **NO** and **COM** terminals powered by a 5V breadboard rail.
2. In Telegram, send `/press` and tap **✅ Confirm**.
3. Verify that the LED flashes ON for exactly ~400 ms and immediately shuts OFF.
4. Power-cycle the board; ensure the LED **never** flickers or pulses during boot.

---

## 7. Running Unit & Integration Tests

The test suite runs against an in-memory SQLite database (`:memory:`) verifying authorization, command lifecycles, duplicate protection, expiry, and device APIs:

```bash
cd bot
npm test
```

### Testing the Device API via cURL:
```bash
# 1. Health check
curl http://localhost:8443/health

# 2. Authenticate device
curl -X POST http://localhost:8443/api/device/auth \
  -H "Content-Type: application/json" \
  -d '{"deviceKey":"c7e5a84210d3e52fba4987120eac71624b5d23e198fa01b2"}'

# 3. Send Heartbeat
curl -X POST http://localhost:8443/api/device/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"deviceKey":"c7e5a84210d3e52fba4987120eac71624b5d23e198fa01b2","freeHeap":42000,"uptimeSeconds":60}'

# 4. Poll for Pending Command
curl -X POST http://localhost:8443/api/device/command/pending \
  -H "Content-Type: application/json" \
  -d '{"deviceKey":"c7e5a84210d3e52fba4987120eac71624b5d23e198fa01b2"}'
```

---

## 8. Directory Structure

```
telegram-door-control/
├── .env.example                               # Environment template
├── README.md                                  # Complete system documentation
├── database/
│   └── schema.sql                             # Complete SQLite DDL schema
├── docs/
│   ├── flashing.md                            # Robotdyn DIP switches & flashing manual
│   └── wiring.md                              # Electrical schematics & safety guide
├── firmware/
│   └── door_controller/
│       ├── door_controller.ino               # Production ESP8266 C++ firmware
│       └── door_controller_config.h          # Hardware & network parameters
├── scripts/
│   ├── setup.sh                               # Linux automated setup script
│   └── register_device.ts                     # Device provisioning CLI
└── bot/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts                           # Top-level entry point
    │   ├── api/
    │   │   ├── middleware.ts                  # Auth & rate-limiting middleware
    │   │   ├── routes.ts                      # Express device REST endpoints
    │   │   └── server.ts                      # Dual HTTP/HTTPS server setup
    │   ├── bot/
    │   │   ├── handlers.ts                    # Telegram command handlers
    │   │   └── notifications.ts               # Async user execution notifications
    │   ├── db/
    │   │   ├── database.ts                    # SQLite singleton & pragmas
    │   │   ├── users.ts                       # Authorized user repository
    │   │   ├── devices.ts                     # Device credentials & telemetry
    │   │   ├── commands.ts                    # Command lifecycle repository
    │   │   ├── audit.ts                       # Audit logging & rate-limiting
    │   │   └── seed.ts                        # Initial admin/device bootstrap
    │   ├── services/
    │   │   └── commandService.ts              # Core business logic orchestrator
    │   └── types/
    │       └── index.ts                       # Complete TypeScript declarations
    └── tests/
        ├── auth.test.ts                       # Telegram authorization tests
        ├── commands.test.ts                   # Command lifecycle tests
        ├── deviceApi.test.ts                  # Device HTTPS REST API tests
        ├── rateLimiting.test.ts               # Rate limit & audit tests
        └── jest.config.js
```
