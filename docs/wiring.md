# Wiring Guide — Telegram Door Controller

This guide explains how to wire a relay module between the **Robotdyn WiFi UNO
ESP8266** and an **existing door push-button circuit** to simulate button presses
remotely.

---

## ⚠️ Safety Warnings

> **READ BEFORE TOUCHING ANY WIRES.**

1. **Mains voltage is lethal.** If your door controller (gate motor, electric
   strike, intercom) connects to 110V/220V AC mains, do NOT attempt this wiring
   unless you are a licensed electrician. Always hire a professional for
   mains-connected systems.

2. **Verify door controller voltage first.** Most residential door entry systems
   use **low-voltage DC** (5V, 12V, or 24V) for the button circuit. Use a
   multimeter to measure the voltage across the push-button terminals *before*
   connecting anything. If you measure more than 30V AC or 60V DC, do not
   proceed without professional help.

3. **Relay module isolation.** Use a relay module with **optocoupler isolation**
   between the ESP8266 signal side and the relay coil/contacts side. This
   protects the ESP8266 from voltage spikes from inductive loads.

4. **Never power the relay from the door controller.** Power the relay module
   from the board's 5V rail only.

5. **Test with an LED first.** Before connecting to any door hardware, complete
   the LED test in Section 5.

6. **The relay parallels the existing button.** The existing physical button
   continues to work normally. The relay simply bridges the same two contacts.

---

## 2. Relay Module Selection

Recommended: **5V single-channel relay module with optocoupler isolation**

| Spec | Requirement |
|------|-------------|
| Coil voltage | 5V DC |
| Signal logic | Active HIGH (IN pin HIGH → relay ON) |
| Isolation | Optocoupler between signal and coil |
| Contact rating | ≥ 10A / 250V AC (for future-proofing; actual load is tiny) |
| Example relay | SRD-05VDC-SL-C (the relay inside most blue Arduino relay modules) |

Look for modules labeled **"High Level Trigger"** or with a jumper to select
trigger polarity. This firmware uses **active HIGH** by default
(`RELAY_ACTIVE_HIGH true` in config).

If your module is active LOW (common for some blue relay boards with a 1N4148
diode), set `#define RELAY_ACTIVE_HIGH false` in `door_controller_config.h`.

---

## 3. Relay Module to ESP8266 Wiring

Wire the relay module to the ESP8266 side of the Robotdyn WiFi UNO:

| Relay Module Pin | Connect To | Notes |
|-----------------|------------|-------|
| **IN** (signal) | **GPIO5** (labeled D1 on NodeMCU; locate on Robotdyn header) | Control signal from firmware |
| **VCC** | **5V** pin on Robotdyn board | Powers the relay coil |
| **GND** | **GND** pin on Robotdyn board | Common ground |

> **Finding GPIO5 on the Robotdyn WiFi UNO:** The ESP8266 GPIO5 is typically
> broken out on the digital headers. Consult your board's pinout diagram.
> On the 5V side headers, GPIO5 may be shared with the ATmega D5 line — confirm
> with a multimeter that the pin toggles with the relay firmware running.

> **Do NOT use GPIO0, GPIO2, or GPIO15** — these are strapping pins that affect
> boot mode. GPIO5 defaults LOW at boot, ensuring the relay stays OFF during
> powerup and WiFi initialization.

---

## 4. Relay to Door Controller Wiring

Your door has an existing push-button (or a pair of wire terminals for an
external button). The relay's Normally Open (NO) contacts will parallel that button.

```
Door Controller Board
        │
   [Terminal A]──────────────────┬──────── Relay COM
        │                        │
   (Button normally open)    (Relay NO, closes on pulse)
        │                        │
   [Terminal B]──────────────────┘
```

| Relay Contact | Connect To |
|--------------|------------|
| **COM** (Common) | One terminal of the existing push-button wires |
| **NO** (Normally Open) | Other terminal of the existing push-button wires |
| **NC** (Normally Closed) | Leave unconnected |

**How it works:** When the firmware pulses GPIO5 HIGH for 400 ms, the relay coil
energizes, the NO contacts close, and the door controller sees exactly the same
signal as a physical button press. After 400 ms, GPIO5 goes LOW, the relay
de-energizes, and the contacts open.

### Finding the button terminals

1. Locate the physical push-button on your door system.
2. Trace the wires from the button back to the door controller PCB or terminal block.
3. Identify the two terminals (often labeled "OPEN", "GND", "BTN", or "COM/NO").
4. Measure DC voltage across them at rest — it should be low voltage (< 30V DC).

---

## 5. Testing Procedure — DO THIS BEFORE CONNECTING TO DOOR

Always verify the relay works correctly with a safe test load before wiring to
door hardware.

### 5.1 LED Test Circuit

```
Relay NO ──── [330Ω resistor] ──── LED anode
                                   LED cathode ──── Relay COM
```

Wire a 330Ω resistor and an LED in series across the relay NO/COM contacts.
The LED's anode (longer leg) goes to NO, cathode to COM, with the resistor on
either side.

Power the LED with a **3.3V or 5V** bench supply or a USB phone charger via
the relay contacts. Do NOT use mains voltage for this test.

### 5.2 Test Steps

1. Flash the firmware and open Serial Monitor (115200 baud).
2. Wait for `[AUTH] Success` — device is registered.
3. Send a door command via your Telegram bot.
4. Observe Serial Monitor: you should see `[RELAY] Pulse started` then
   `[RELAY] Pulse complete. ACK sent.`
5. Simultaneously, the LED should light for ~400 ms then turn off.
6. If the LED stays ON or stays OFF, check:
   - Wiring polarity (COM vs NO)
   - `RELAY_ACTIVE_HIGH` setting
   - GPIO5 is actually the pin being toggled (measure with multimeter)

### 5.3 Multimeter Verification

Set multimeter to DC voltage. Place probes on relay NO and COM contacts.
- At rest: 0V (contacts open)
- During pulse: measures supply voltage (contacts closed)
- After pulse: returns to 0V

If it reads supply voltage permanently, the relay is stuck ON — check firmware
and wiring immediately.

---

## 6. ASCII Wiring Diagram

```
┌──────────────────────────────────────────────────────────────┐
│              Robotdyn WiFi UNO (ESP8266 side)                │
│                                                              │
│  3.3V ─────────────────────────────────── (not used here)   │
│  5V   ──────────────────────────────────┐                    │
│  GND  ─────────────────────────────────┐│                    │
│  GPIO5 (D1) ──────────────────────────┐││                    │
└───────────────────────────────────────│││────────────────────┘
                                        │││
                               ┌────────┴┴┴────────┐
                               │   Relay Module     │
                               │  ┌──────────────┐  │
                               │  │ Optocoupler  │  │
                               │  │  isolation   │  │
                               │  └──────────────┘  │
                               │  IN   VCC   GND    │
                               │                    │
                               │  COM   NO   NC     │
                               └─────┬───┬──────────┘
                                     │   │
                          ┌──────────┘   └──────────┐
                          │                          │
                    [Terminal A]              [Terminal B]
                          │                          │
                          └──── Door push-button ────┘
                               (existing; still works
                                normally in parallel)
```

### Full system view:

```
[Telegram Bot] ──HTTPS──► [Your Server :8443]
                                   │
                               REST API
                                   │
                           (polls every 5s)
                                   │
[Robotdyn WiFi UNO] ◄─────────────┘
   ESP8266 firmware
       │
    GPIO5
       │
  [Relay Module]
   NO ──── COM
   │         │
[Door Controller terminal A] ── [terminal B]
   (same as physical push-button)
```

---

## 7. Quick Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Relay clicks but door doesn't respond | Wrong terminals used | Measure correct button terminals; try swapping COM/NO |
| Relay doesn't click on command | Wiring or firmware issue | Check Serial Monitor; verify GPIO5 with multimeter |
| Relay stuck ON at boot | Using wrong GPIO | Switch to GPIO5; avoid GPIO0/2/15 |
| LED test works, door doesn't | Door uses voltage relay can't pass | Check door voltage; ensure NO/COM not NC/COM |
| Relay clicks twice | Duplicate command sent | Check command deduplication in firmware logs |
| Serial Monitor shows fingerprint error | TLS cert changed (renewed) | Regenerate fingerprint and re-flash |
