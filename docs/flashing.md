# Flashing the ESP8266 on a Robotdyn WiFi UNO

This guide covers everything needed to program the ESP8266 co-processor on a
**Robotdyn WiFi UNO** (ATmega328P + ESP8266EX combo board) directly via USB,
so that the ESP8266 runs the `door_controller` firmware independently.

---

## 1. Board Identification

Look for the following to confirm you have a Robotdyn WiFi UNO:

| Feature | What to look for |
|---|---|
| Dual MCU silkscreen | Both "ATMEGA328P" and "ESP8266EX" chip labels on the PCB |
| 8-position DIP switch bank | Labeled SW1–SW8 (or 1–8) near the middle/edge of the board |
| Two USB-serial paths | Same USB port can talk to either MCU depending on DIP switches |
| CH340G USB-serial bridge | Chip labeled CH340G or CH340C near the USB connector |
| "WiFi UNO R3" text | Usually printed on the silkscreen near the board name |

If you see a single large DIP switch block with 8 individual switches and two
separate MCU chips (one 28/32-pin DIP or SMD for ATmega, one small module or
bare IC for ESP8266), you have the right board.

---

## 2. DIP Switch Configuration

The 8 DIP switches (SW1–SW8) route serial (TX/RX) signals between three actors:
- **USB**: the CH340 USB-to-serial bridge
- **ATmega**: the ATmega328P MCU
- **ESP8266**: the ESP8266EX WiFi MCU

> **Convention:** ON = switch lever toward the chip / "ON" marking; OFF = lever away.

### Mode A — Normal ATmega Operation (default / out-of-box)

| Switch | State | Function |
|--------|-------|----------|
| SW1 | ON | USB-TX → ATmega-RX |
| SW2 | ON | ATmega-TX → USB-RX |
| SW3 | OFF | ATmega-RX not bridged to ESP8266-TX |
| SW4 | OFF | ATmega-TX not bridged to ESP8266-RX |
| SW5 | OFF | |
| SW6 | OFF | |
| SW7 | OFF | USB-TX not connected to ESP8266-RX |
| SW8 | OFF | ESP8266-TX not connected to USB-RX |

Use this mode to program the ATmega or use it standalone with Arduino sketches.

---

### Mode B — Program ESP8266 Directly via USB ⬅ *Use this to flash door_controller*

| Switch | State | Function |
|--------|-------|----------|
| SW1 | OFF | Disconnect USB-TX from ATmega-RX |
| SW2 | OFF | Disconnect ATmega-TX from USB-RX |
| SW3 | OFF | Disconnect ATmega-RX from ESP8266-TX |
| SW4 | OFF | Disconnect ATmega-TX from ESP8266-RX |
| SW5 | OFF | |
| SW6 | OFF | |
| SW7 | ON  | USB-TX → ESP8266-RX (data path for flashing) |
| SW8 | ON  | ESP8266-TX → USB-RX (response path) |

> **Important:** Also pull GPIO0 LOW during boot to enter flash mode.
> See [Step-by-Step Upload Procedure](#5-step-by-step-upload-procedure) below.

---

### Mode C — ESP8266 as AT Co-Processor for ATmega

| Switch | State | Function |
|--------|-------|----------|
| SW1 | ON  | USB-TX → ATmega-RX (program ATmega normally) |
| SW2 | ON  | ATmega-TX → USB-RX |
| SW3 | ON  | ESP8266-TX → ATmega-RX bridge |
| SW4 | ON  | ATmega-TX → ESP8266-RX bridge |
| SW5 | OFF | |
| SW6 | OFF | |
| SW7 | OFF | |
| SW8 | OFF | |

Use this mode if you want the ATmega to control the ESP8266 via AT commands.
**Not used for this project.**

---

## 3. Arduino IDE Setup

### 3.1 Install ESP8266 Board Package

1. Open Arduino IDE → **File → Preferences**
2. In **"Additional Boards Manager URLs"**, add:
   ```
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Click **OK**
4. Open **Tools → Board → Boards Manager**
5. Search for **`esp8266`**
6. Install **"esp8266 by ESP8266 Community"** — version **3.1.x** or latest stable

### 3.2 Board Settings

After installation, configure the board via **Tools** menu:

| Setting | Value |
|---------|-------|
| Board | **Generic ESP8266 Module** |
| Flash Size | **4MB (FS:2MB OTA:~1MB)** |
| Flash Mode | **DIO** |
| Flash Frequency | **40MHz** |
| CPU Frequency | **80 MHz** |
| Upload Speed | **115200** |
| Reset Method | **nodemcu** |
| Debug Port | Disabled |
| Debug Level | None |
| lwIP Variant | v2 Lower Memory |
| Port | *(select your COM port)* |

> **Why "Generic ESP8266 Module"?** The Robotdyn board exposes the bare ESP8266EX;
> it is not a NodeMCU with an auto-reset circuit. Choose this board to avoid
> incorrect pin mappings. If auto-reset doesn't work, use manual flash mode
> (see Section 5).

---

## 4. Required Libraries

Install via **Sketch → Include Library → Manage Libraries...**:

| Library | Author | Version | Notes |
|---------|--------|---------|-------|
| ESP8266WiFi | ESP8266 Community | (bundled) | Included with the board package |
| ESP8266HTTPClient | ESP8266 Community | (bundled) | Included with the board package |
| **ArduinoJson** | Benoit Blanchon | **6.x** | Search "ArduinoJson"; install v6, NOT v5 or v7 |

> **ArduinoJson version matters.** The firmware uses v6 API (`StaticJsonDocument`,
> `deserializeJson`). If you accidentally install v7, the API differs slightly.
> Check the version shown in Library Manager.

---

## 5. Step-by-Step Upload Procedure

### Before you begin
- Edit `door_controller_config.h` with your WiFi credentials, API host, device key,
  and TLS fingerprint.
- Save all files.

### Upload steps

1. **Set DIP switches to Mode B** (SW7 ON, SW8 ON, all others OFF) as described above.

2. **Enter ESP8266 flash mode:**
   - The ESP8266 enters bootloader mode when **GPIO0 is LOW at power-on/reset**.
   - If your board has a **FLASH** button (connected to GPIO0), hold it now.
   - If not, temporarily bridge the GPIO0 pin to GND with a jumper wire.

3. **Reset the ESP8266:**
   - While holding GPIO0 LOW, press and release the **RESET** button (or briefly
     connect the RST pin to GND).
   - Then release GPIO0 (or remove the jumper).
   - The ESP8266 is now in bootloader mode. The blue LED may blink once.

4. **Select the correct COM port** in Arduino IDE → Tools → Port.
   - On Windows: check Device Manager under "Ports (COM & LPT)" for the CH340 port.
   - Install CH340 drivers if the port doesn't appear:
     `https://www.wch-ic.com/downloads/CH341SER_EXE.html`

5. **Click Upload** (→ button) in Arduino IDE.
   - You should see: `Connecting....` then progress bytes uploading.
   - If you see `connecting...` dots for more than 5 seconds, repeat the reset
     procedure (step 3) while the IDE shows "Connecting...".

6. **Wait for completion:**
   - IDE shows: `Leaving... Hard resetting via RTS pin...`
   - Upload is complete.

7. **Open Serial Monitor** (Tools → Serial Monitor, 115200 baud) to verify boot
   output. See [Section 7](#7-serial-monitor-verification) for expected output.

### Manual flash mode (if auto-reset fails)

Some Robotdyn boards lack the auto-reset circuit. Use this sequence:

```
1. Hold FLASH button (GPIO0 LOW)
2. Press RESET button → release RESET button
3. Release FLASH button
4. Immediately click Upload in Arduino IDE
```

---

## 6. Restoring ATmega Operation

After flashing the ESP8266, restore DIP switches to **Mode A** to use the ATmega:

| Switch | State |
|--------|-------|
| SW1 | ON  |
| SW2 | ON  |
| SW3 | OFF |
| SW4 | OFF |
| SW5 | OFF |
| SW6 | OFF |
| SW7 | OFF |
| SW8 | OFF |

The ATmega and ESP8266 are now electrically separated. The ESP8266 continues
running its firmware (door_controller) independently, powered from the 3.3V
regulator on the board.

---

## 7. Serial Monitor Verification

Open Serial Monitor at **115200 baud** immediately after upload. Expected output:

```
[BOOT] door_controller v1.0.0 starting...
[RELAY] Pin 5 set to OUTPUT, defaulting LOW (relay OFF)
[WIFI] Connecting to YOUR_WIFI_SSID
[WIFI] ....
[WIFI] Connected! IP: 192.168.1.XXX
[NTP] Synchronizing time...
[NTP] Time synchronized: 2025-01-15 12:00:00
[AUTH] Authenticating device...
[AUTH] Success. deviceId: dev_abc123
[HEARTBEAT] Sent. Free heap: 32400 bytes, uptime: 5s, RSSI: -62 dBm
[POLL] No pending command.
[POLL] No pending command.
...
```

If you see garbled text, confirm the baud rate is **115200**.

If WiFi doesn't connect, double-check `WIFI_SSID` and `WIFI_PASSWORD` in
`door_controller_config.h` and re-flash.

If TLS fails with a fingerprint mismatch, regenerate the fingerprint with:
```bash
openssl s_client -connect yourdomain.com:8443 </dev/null 2>/dev/null \
  | openssl x509 -fingerprint -sha1 -noout
```
and update `TLS_FINGERPRINT` in the config header.
