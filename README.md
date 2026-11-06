# AEGIS — Immersive Virtual Museum

A cinematic React + Three.js museum experience with full-screen spatial presentation, actual Bastet and Nefertiti GLB models, the third available St Etheldreda's Church Font GLB, card-gated artifact information, QR scanning, optional Web NFC, Web Serial integration for an ESP32-S3 reader, audio guide, collection progress, and VR capability checks.

## Requirements

- Node.js 18+ (Node.js 20 LTS recommended)
- npm
- A modern browser with WebGL
- Camera access works on `localhost` or a deployed HTTPS origin
- Web Serial requires a supported Chromium browser and a secure context (`localhost` or HTTPS).
- An ESP32-S3 needs a compatible RFID reader module; the MCU alone cannot read RFID cards.

## Run locally

1. Extract this folder.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the local URL printed by Vite, normally `http://localhost:5173`.

## Included 3D model

The gallery's three GLB models are included at:

`public/models/bastet_cat_goddess_egypt.glb`

`public/models/nefertitis_bust_like_in_the_museum.glb`

`public/models/st_etheldredas_church_mortar.glb`

The third asset's filename and embedded model name identify it as St Etheldreda's Church Font, not an Egyptian antiquity. The interface preserves that name rather than claiming it is a Rosetta Stone.

## QR scanning

The camera scanner uses `jsQR`. It recognizes these registry payloads:

- `AEGIS:bastet`
- `AEGIS:nefertiti`
- `AEGIS:churchfont`

It also accepts bare artifact IDs or `museum:<id>`. A QR camera reads visible codes only; it does not read RFID radio signals. Unknown card payloads do not unlock artifact details. Artifact information is hidden until a matching card is scanned; already-discovered artifacts can be revisited from the collection.

Camera access requires explicit browser permission and a secure context (`localhost` or HTTPS). If camera access is blocked, manual selection remains available.

## NFC / RFID: important distinction

- A webcam reads visible QR/barcodes. It cannot directly read ordinary RFID/NFC cards.
- Web NFC is experimental and device/browser dependent; it generally reads compatible NDEF tags rather than arbitrary UID-only readers.
- The ESP32-S3 integration uses a separate Web Serial transport and newline-delimited JSON events. See [docs/rfid-integration.md](docs/rfid-integration.md).
- A starter PlatformIO firmware project for ESP32-S3 DevKitC-1 + RC522 is in [firmware/rfid-esp32s3](firmware/rfid-esp32s3/platformio.ini); wire the module as described in the RFID guide.
- Connect the reader with the **Connect RFID** control in the top bar. The browser asks you to select the USB serial port; use desktop Chrome or Edge and close serial monitors such as Arduino Serial Monitor first.
- Physical UID mappings are blank until configured from the actual cards. Copy `.env.example` to `.env.local`, set each `VITE_RFID_UID_*` value (or set `card_uid` on the corresponding artifact in Supabase), then restart Vite.
- The app uses the local exhibit list if the museum API is offline. RFID still needs a real UID mapping and firmware that sends the documented serial JSON messages.
- Card UIDs are identifiers, not authentication credentials. This prototype has not been tested with physical hardware and makes no claim that a specific reader/module works.

## Audio guide

The guide uses browser `SpeechSynthesis` to speak the artifact description. The progress indicator is a UI approximation rather than a waveform or a streamed audio file. For a production experience, replace it with professionally recorded narration and a real media timeline.

## VR

The VR control requests a real immersive WebXR session if the current browser/device supports it. Otherwise, it toggles a desktop immersive presentation mode and explains the distinction. Headset VR requires HTTPS and compatible WebXR hardware/browser.

## Build

```bash
npm run build
npm run preview
```

## Structure

```text
src/
  App.jsx
  styles.css
  main.jsx
  components/
    MuseumScene.jsx
    Scanner.jsx
  data/
    artifacts.js
  services/
    webSerialCardTransport.js
public/
  models/
    bastet_cat_goddess_egypt.glb
    nefertitis_bust_like_in_the_museum.glb
    st_etheldredas_church_mortar.glb
```

## Next production steps

1. Configure real card UIDs and test the intended ESP32-S3 and compatible RFID reader; protocol setup is in [docs/rfid-integration.md](docs/rfid-integration.md).
2. Test full WebXR on the target headset/browser.
3. Replace the third reference asset if an Egyptian artifact model is later supplied.
4. Add localization, captioned audio, loading/error telemetry, and performance testing on target hardware.
