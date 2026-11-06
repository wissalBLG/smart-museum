import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, CameraOff, CheckCircle2, CreditCard, Hand, Loader2, Usb } from "lucide-react";

const READER_LABELS = {
  disconnected: ["CONNECT RFID", "Reader disconnected"],
  connecting: ["CONNECTING", "Opening serial link"],
  reconnecting: ["REATTACHING", "Reader link lost"],
  connected: ["RFID CONNECTED", "Reader on USB serial"],
  unsupported: ["SERIAL UNAVAILABLE", "No Web Serial in this browser"]
};

function readerTone(status) {
  if (status === "connected") return "good";
  if (status === "connecting" || status === "reconnecting") return "busy";
  if (status === "unsupported") return "warn";
  return "idle";
}

function cameraTone(status) {
  if (status === "tracking") return "good";
  if (status === "starting" || status === "loading") return "busy";
  if (status === "denied" || status === "error" || status === "unsupported") return "warn";
  return "idle";
}

export default function ExhibitInteraction({
  rfid,
  hand,
  focusArtifact,
  focusSource,
  onToggleReader,
  onToggleCamera,
  onFrame,
  onPickFocus,
  artifacts
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [expanded, setExpanded] = useState(false);

  // Hand the live <video> element to the gesture engine and paint the landmark
  // overlay from the frames it emits. The engine owns the stream; this
  // component only renders it.
  useEffect(() => {
    if (hand.status === "starting" || hand.status === "loading") {
      onFrame?.({ type: "mount", video: videoRef.current, canvas: canvasRef.current });
    }
  }, [hand.status, onFrame]);

  useEffect(() => {
    onFrame?.({ type: "mount", video: videoRef.current, canvas: canvasRef.current });
  }, [onFrame]);

  const readerLabel = READER_LABELS[rfid.status] || READER_LABELS.disconnected;
  const bound = artifacts.filter((item) => item.cardUid).length;
  const cameraOn = hand.status === "tracking" || hand.status === "starting" || hand.status === "loading";

  return (
    <section className={`interaction-dock ${expanded ? "is-expanded" : ""}`} aria-label="Visitor interaction">
      <div className="dock-buttons">
        <button
          className={`dock-button tone-${readerTone(rfid.status)}`}
          onClick={onToggleReader}
          title={rfid.detail}
          aria-label={rfid.status === "connected" ? "Disconnect the RFID reader" : "Connect the ESP32 RFID reader over USB serial"}
        >
          <Usb size={15} />
          <span className="dock-label"><strong>{readerLabel[0]}</strong><small>{readerLabel[1]}</small></span>
          <i className="dock-dot" />
        </button>

        <button
          className={`dock-button tone-${cameraTone(hand.status)}`}
          onClick={onToggleCamera}
          title={hand.detail}
          aria-label={cameraOn ? "Disable hand interaction" : "Enable hand interaction"}
        >
          {hand.status === "starting" || hand.status === "loading" ? <Loader2 size={15} className="spin" /> : cameraOn ? <CameraOff size={15} /> : <Hand size={15} />}
          <span className="dock-label">
            <strong>{cameraOn ? "HAND INTERACTION ON" : hand.status === "unsupported" ? "CAMERA UNAVAILABLE" : "ENABLE HAND INTERACTION"}</strong>
            <small>{hand.status === "tracking" ? "Point, then open your palm" : hand.status === "denied" ? "Camera permission denied" : "Use your webcam to select"}</small>
          </span>
          <i className="dock-dot" />
        </button>

        <button className="dock-expand" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "Hide reader details" : "Show reader details"} aria-expanded={expanded}>
          {expanded ? "−" : "?"}
        </button>
      </div>

      {expanded && (
        <div className="dock-details">
          <div className="dock-detail-row">
            <span className="dock-detail-key">READER</span>
            <span className={`dock-detail-value tone-${readerTone(rfid.status)}`}>{rfid.status.toUpperCase()}</span>
          </div>
          <p className="dock-detail-text">{rfid.detail}</p>
          <div className="dock-detail-row">
            <span className="dock-detail-key">SOURCE</span>
            <span className="dock-detail-value">
              {rfid.status === "connected" ? "ESP32-S3 · RC522 over USB serial" : "No reader attached"}
            </span>
          </div>
          <div className="dock-detail-row">
            <span className="dock-detail-key">CARDS BOUND</span>
            <span className="dock-detail-value">{bound} of {artifacts.length}</span>
          </div>
          {rfid.lastCard && <p className="dock-detail-text">{rfid.lastCard}</p>}
          {rfid.firmware && <p className="dock-detail-text mono">{rfid.firmware}</p>}
          {rfid.status !== "connected" && (
            <p className="dock-detail-note">
              <AlertCircle size={13} /> With no reader attached no card can be read — the museum never simulates a scan.
            </p>
          )}

          <div className="dock-divider" />

          <div className="dock-detail-row">
            <span className="dock-detail-key">HAND TRACKING</span>
            <span className={`dock-detail-value tone-${cameraTone(hand.status)}`}>{hand.status.toUpperCase()}</span>
          </div>
          <p className="dock-detail-text">{hand.detail}</p>
          <p className="dock-detail-note">
            <Hand size={13} /> Point at an exhibit to focus it, then open your palm (or pinch) to reveal it.
            No artifact details appear until you ask for them.
          </p>

          <div className="dock-divider" />

          <div className="dock-detail-row">
            <span className="dock-detail-key">FOCUSED NOW</span>
            <span className="dock-detail-value">{focusArtifact ? `${focusArtifact.name} · ${focusSource}` : "Nothing"}</span>
          </div>
          <div className="dock-focus-list">
            {artifacts.map((item, index) => (
              <button key={item.id} className={focusArtifact?.id === item.id ? "is-focused" : ""} onClick={() => onPickFocus(item.id)}>
                <span>0{index + 1}</span>{item.name}
              </button>
            ))}
          </div>
          <p className="dock-detail-note">
            No camera? Click an exhibit in the 3D hall, then press <kbd>R</kbd> (or the Reveal button) to open its panel.
          </p>
        </div>
      )}

      <div className={`hand-preview ${cameraOn ? "is-live" : ""}`} aria-hidden={!cameraOn}>
        {/* Mirrored so moving right moves the cursor right on screen. */}
        <video ref={videoRef} className="hand-video" muted playsInline />
        <canvas ref={canvasRef} className="hand-overlay" width={320} height={240} />
        <div className="hand-chips">
          {hand.status === "tracking" && <span className={`hand-chip gesture-${hand.gesture}`}>{hand.gesture === "none" ? "SEARCHING" : hand.gesture.toUpperCase()}</span>}
          {hand.focusName && <span className="hand-chip focus">{hand.focusName}</span>}
          {hand.status !== "tracking" && hand.status !== "starting" && hand.status !== "loading" && (
            <span className="hand-chip muted">{hand.status === "denied" ? "PERMISSION DENIED" : "CAMERA OFF"}</span>
          )}
        </div>
        {(hand.status === "denied" || hand.status === "error" || hand.status === "unsupported") && (
          <div className="hand-preview-error">
            <AlertCircle size={16} />
            <span>{hand.detail}</span>
          </div>
        )}
      </div>

      <div className="dock-status" aria-live="polite">
        {hand.status === "tracking" ? <CheckCircle2 size={12} /> : rfid.status === "connected" ? <CheckCircle2 size={12} /> : <CreditCard size={12} />}
        <span>{hand.status === "tracking" ? "Hands free · point to focus, palm to reveal" : focusArtifact ? `Focused · ${focusArtifact.name}` : "Present a card or raise a hand to begin"}</span>
      </div>
    </section>
  );
}
