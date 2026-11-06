import React, { useEffect, useRef } from "react";
import { Headphones, Pause, Play, X } from "lucide-react";
import { ARTIFACT_PANEL_SECONDS } from "../hooks/useArtifactTimer.js";

const SOURCE_LABEL = {
  rfid: "RFID CARD",
  gesture: "HAND GESTURE",
  pinch: "HAND GESTURE",
  mouse: "SELECTED IN THE HALL",
  keyboard: "KEYBOARD",
  near: "FOCUSED IN THE HALL",
  scan: "MUSEUM SCAN"
};

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * The 3-minute floating artifact panel. It is deliberately a small, quiet
 * card anchored beside the selected model rather than a full sidebar: the
 * exhibit must stay visible while its story is on screen.
 */
export default function ArtifactInfoPanel({
  artifact,
  remaining,
  source,
  anchored,
  audioPlaying,
  onAudio,
  onClose,
  onPointerEnter,
  onPointerLeave
}) {
  const panelRef = useRef(null);
  const progress = Math.max(0, Math.min(1, remaining / ARTIFACT_PANEL_SECONDS));
  const circumference = 2 * Math.PI * 9;

  // Announce the panel politely for screen readers once per opening.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [artifact.id]);

  return (
    <div
      ref={panelRef}
      className={`artifact-chip ${anchored ? "is-anchored" : "is-pinned"}`}
      role="dialog"
      aria-label={`${artifact.name} — artifact information`}
      aria-live="polite"
      tabIndex={-1}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="chip-rule" aria-hidden="true" />

      <header className="chip-head">
        <div className="chip-heading">
          <span className="chip-eyebrow">
            {SOURCE_LABEL[source] || "ARTIFACT"}
            <span className="chip-dot" />
            EXHIBIT {artifact.index ? String(artifact.index).padStart(2, "0") : "—"}
          </span>
          <h3>{artifact.name}</h3>
          <p className="chip-period">{artifact.period}</p>
        </div>
        <div className="chip-timer" aria-label={`${formatClock(remaining)} remaining`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle className="chip-timer-track" cx="12" cy="12" r="9" />
            <circle
              className="chip-timer-progress"
              cx="12" cy="12" r="9"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
          <span>{formatClock(remaining)}</span>
        </div>
        <button className="chip-close" onClick={onClose} aria-label="Close artifact panel"><X size={14} /></button>
      </header>

      <dl className="chip-facts">
        <div><dt>ORIGIN</dt><dd>{artifact.origin}</dd></div>
        <div><dt>DATE</dt><dd>{artifact.date}</dd></div>
        {artifact.material && <div className="chip-fact-wide"><dt>MATERIAL</dt><dd>{artifact.material}</dd></div>}
      </dl>

      <p className="chip-description">{artifact.intro}</p>
      <p className="chip-significance">{artifact.significance}</p>

      <footer className="chip-foot">
        {onAudio ? (
          <button className="chip-audio" onClick={onAudio} aria-label={audioPlaying ? "Pause the audio guide" : "Play the audio guide"}>
            <span className="chip-audio-icon">{audioPlaying ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}</span>
            <Headphones size={13} />
            <span>{audioPlaying ? "PAUSE GUIDE" : "AUDIO GUIDE"}</span>
          </button>
        ) : (
          <span className="chip-no-audio">Audio guide not available for this exhibit</span>
        )}
        <span className="chip-auto">Closes automatically in {formatClock(remaining)}</span>
      </footer>
    </div>
  );
}
