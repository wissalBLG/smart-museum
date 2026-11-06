import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CreditCard, ScanLine, Usb, X } from "lucide-react";
import jsQR from "jsqr";

function getArtifactIdentifier(payload) {
  const value = String(payload || "").trim();
  if (!value) return "";

  try {
    const parsed = JSON.parse(value);
    const identifier = parsed.id || parsed.card_uid || parsed.uid;
    if (identifier) return String(identifier).trim();
  } catch {
    // QR/NFC payloads are commonly plain text rather than JSON.
  }

  try {
    const url = new URL(value);
    const identifier = url.searchParams.get("id") || url.searchParams.get("card_uid") || url.searchParams.get("uid");
    if (identifier) return identifier.trim();
  } catch {
    // The value is not a URL; continue with the plain-text formats below.
  }

  return value.replace(/^(?:AEGIS|MUSEUM)\s*[:/]+/i, "").trim();
}

export default function Scanner({ onRecognized, onManualSelect, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const nfcReaderRef = useRef(null);
  const [status, setStatus] = useState("ready");
  const [message, setMessage] = useState("Present a museum QR code to the camera.");
  const [error, setError] = useState("");
  const [nfcAvailable, setNfcAvailable] = useState(false);

  useEffect(() => {
    setNfcAvailable("NDEFReader" in window);
    return stopReaders;
  }, []);

  function stopReaders() {
    if (scanTimerRef.current) window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    nfcReaderRef.current = null;
  }

  function recognize(payload, source) {
    const identifier = getArtifactIdentifier(payload);
    if (!identifier) {
      setStatus("invalid");
      setMessage("This card did not contain an artifact identifier.");
      return;
    }

    stopReaders();
    setStatus("recognized");
    setMessage(`Card recognized · ${identifier}`);
    onRecognized?.(identifier, source);
  }

  function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
    if (result?.data) recognize(result.data, "qr");
  }

  async function startCamera() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is unavailable here. Use localhost or HTTPS, or connect an RFID reader.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      setStatus("scanning");
      setMessage("Camera active · Looking for a museum QR code");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      scanTimerRef.current = window.setInterval(scanFrame, 350);
    } catch (cameraError) {
      setError(cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings, or use the RFID reader."
        : "Could not open the camera. Try localhost or HTTPS, or use the RFID reader.");
    }
  }

  async function startNfc() {
    setError("");
    if (!nfcAvailable) {
      setError("Web NFC is not supported by this browser. Use a QR card or connect the RFID reader instead.");
      return;
    }

    try {
      const reader = new window.NDEFReader();
      nfcReaderRef.current = reader;
      await reader.scan();
      setStatus("scanning");
      setMessage("NFC reader active · Present a compatible card");
      reader.onreading = (event) => {
        const payload = [];
        for (const record of event.message.records) {
          if (record.recordType === "text" && typeof record.toText === "function") {
            payload.push(record.toText());
          } else if (record.data) {
            payload.push(new TextDecoder().decode(record.data));
          }
        }
        if (payload.length) recognize(payload.join(" "), "nfc");
        else setMessage("Card read, but it did not contain a text artifact identifier.");
      };
      reader.onreadingerror = () => setError("The NFC card could not be read. Try again or use a QR card.");
    } catch (nfcError) {
      setError(nfcError.name === "NotAllowedError"
        ? "NFC permission was denied. Allow NFC access if your device supports Web NFC."
        : "Could not start NFC. Check device/browser compatibility, or use a QR card.");
    }
  }

  function closeScanner() {
    stopReaders();
    onClose?.();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeScanner()}>
      <section className="scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
        <div className="modal-head">
          <div>
            <div className="eyebrow">ARTIFACT ACCESS TERMINAL</div>
            <h2 id="scanner-title">Present your artifact card</h2>
          </div>
          <button className="icon-button" onClick={closeScanner} aria-label="Close scanner"><X size={18} /></button>
        </div>

        <div className={`camera-frame status-${status}`}>
          <video ref={videoRef} muted playsInline aria-label="Live QR scanner camera preview" />
          <canvas ref={canvasRef} hidden />
          <div className="corner tl" /><div className="corner tr" />
          <div className="corner bl" /><div className="corner br" />
          {status === "scanning" && <div className="scan-beam" />}
          {(status === "ready" || status === "error") && (
            <div className="camera-placeholder">
              <CreditCard size={28} />
              <span>Camera preview</span>
              <small>Start the camera to scan QR codes</small>
            </div>
          )}
          <div className="camera-tag"><ScanLine size={13} /> VISUAL CODE READER</div>
        </div>

        <div className={`scan-status ${status}`} aria-live="polite">
          {status === "recognized" ? <Check size={16} /> : status === "invalid" ? <AlertCircle size={16} /> : <span className="status-dot" />}
          <span>{message}</span>
        </div>
        {error && <p className="error-note" role="alert">{error}</p>}

        <div className="scanner-actions">
          <button className="button button-gold" onClick={startCamera}><ScanLine size={15} /> Start QR camera</button>
          <button className="button button-outline" onClick={startNfc}><CreditCard size={15} /> Read NFC card</button>
        </div>

        <div className="hardware-note">
          <Usb size={18} />
          <div>
            <strong>Know your reader</strong>
            <p>A webcam reads visible QR codes, not most RFID cards. NFC requires a compatible device and browser; otherwise use a connected RFID reader.</p>
          </div>
        </div>

        {onManualSelect && (
          <div className="manual-select">
            <span className="eyebrow">NO CARD?</span>
            <button className="text-action" onClick={() => { stopReaders(); onManualSelect(); }}>Return to the exhibition</button>
          </div>
        )}
      </section>
    </div>
  );
}
