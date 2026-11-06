# ESP32-S3 RFID reader integration

## Data path

`RFID card → compatible reader module → ESP32-S3 firmware → USB serial → Web Serial transport → artifact registry → 3D focus + information panel + collection`

The ESP32-S3 board does not read RFID by itself. This repository now includes a starter PlatformIO firmware project for an ESP32-S3 DevKitC-1 with an MFRC522/RC522 reader at `firmware/rfid-esp32s3`. If your PlatformIO project uses another board or RFID module, use the same serial JSON protocol but update its pins, library, and reader-specific code accordingly.

### Starter RC522 wiring

| RC522 pin | ESP32-S3 DevKitC-1 GPIO |
| --- | ---: |
| SDA / SS | 10 |
| SCK | 12 |
| MOSI | 11 |
| MISO | 13 |
| RST | 9 |
| GND | GND |
| 3.3V | 3V3 |

Use the reader module's 3.3V supply; do not connect its VCC to 5V unless that specific board explicitly supports it. GPIO assignments are starter defaults and can be overridden with PlatformIO build flags or edited in `firmware/rfid-esp32s3/src/main.cpp`.

Open the `firmware/rfid-esp32s3` folder in PlatformIO, build, and upload to the ESP32-S3. The web app connects directly to the board's USB serial port; close PlatformIO's Serial Monitor before clicking **Connect RFID** in the browser because a serial port can normally only be open in one program at a time.

## Serial protocol

The browser connects at the configured baud rate (default `115200`) after the visitor clicks **Connect RFID** and grants Web Serial port access. Send one JSON object per line, terminated with `\n`:

```json
{"type":"reader_status","status":"ready"}
{"type":"card_scanned","uid":"A1:B2:C3:D4"}
{"type":"card_removed","uid":"A1:B2:C3:D4"}
{"type":"read_error","message":"RFID read failed"}
```

The web app also accepts the `card_uid` field. UID matching is case-insensitive and ignores spaces, `:` and `-` separators. A held-card debounce emits once and suppresses repeated scan events while the same UID continues arriving; `card_removed` immediately clears that card's debounce lock. Without removal events, the lock expires after a short quiet interval.

## Configure the cards

Copy `.env.example` to `.env.local`, then enter the actual UIDs reported by your hardware:

- `VITE_RFID_UID_BASTET`
- `VITE_RFID_UID_NEFERTITI`
- `VITE_RFID_UID_CHURCHFONT`
- `VITE_RFID_BAUD_RATE` (optional; defaults to `115200`)

Restart the Vite development server after changing environment variables. Do not commit actual deployed card UIDs or `.env.local`. UIDs are identifiers, not secure authentication secrets; use signed credentials or a trusted backend if access control is security-sensitive.

QR cards continue to work independently using the registry payloads `AEGIS:bastet`, `AEGIS:nefertiti`, and `AEGIS:churchfont`. A webcam reads visible QR codes only; it does not read RFID radio signals.

## Browser and hardware testing

Web Serial requires a supporting desktop Chromium browser and a secure context (localhost or HTTPS). The Connect action must be initiated by a user gesture. The browser will prompt for a port. Test connection, actual configured cards, unknown UID behavior, disconnect/reconnect, and held-card debounce with the intended ESP32-S3 and RFID module. This code has not been validated against physical hardware yet.
