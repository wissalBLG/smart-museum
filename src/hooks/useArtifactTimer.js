import { useCallback, useEffect, useRef, useState } from "react";

export const ARTIFACT_PANEL_SECONDS = 180;

// A 180-second window is long enough for a held hand, a re-scan of the same
// card, or the camera briefly losing the hand to fire again. Those must not
// extend the visitor's time — only a *different* artifact may start a new one.
export const SAME_ARTIFACT_REFRESH_SECONDS = 12;

/**
 * Owns the single reveal timer for the floating artifact panel.
 *
 * - `open(id, source)` starts a fresh 180 s window for a NEW artifact.
 * - Re-opening the artifact that is already on screen does nothing to the
 *   deadline (it only re-focuses the panel), except in the final seconds where
 *   an explicit re-scan gives a fresh window — handled by `force`.
 * - `close()` clears both the deadline and the interval.
 * - Exactly one interval exists at any moment: it is cleared in the effect
 *   cleanup and before a new one is created.
 */
export function useArtifactTimer({ seconds = ARTIFACT_PANEL_SECONDS, onExpire } = {}) {
  const [session, setSession] = useState(null); // { id, source, startedAt, expiresAt }
  const [remaining, setRemaining] = useState(0);
  const timeoutRef = useRef(null);
  const intervalRef = useRef(null);
  const onExpireRef = useRef(onExpire);
  const sessionRef = useRef(null);

  onExpireRef.current = onExpire;
  // Mirror of state for decisions taken inside callbacks and timers, which
  // must not read a stale closure over `session`.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearTimers();
    sessionRef.current = null;
    setSession(null);
    setRemaining(0);
  }, [clearTimers]);

  const arm = useCallback((id, source, force) => {
    const current = sessionRef.current;
    if (current && current.id === id && !force) {
      // Same artifact, still on screen: keep the original deadline.
      return false;
    }
    clearTimers();
    const now = Date.now();
    const next = { id, source, startedAt: now, expiresAt: now + seconds * 1000 };
    sessionRef.current = next;
    setSession(next);
    setRemaining(seconds);
    timeoutRef.current = setTimeout(() => {
      clearTimers();
      sessionRef.current = null;
      setSession(null);
      setRemaining(0);
      onExpireRef.current?.(id);
    }, seconds * 1000);
    intervalRef.current = setInterval(() => {
      const live = sessionRef.current;
      if (!live) return;
      const left = Math.max(0, Math.round((live.expiresAt - Date.now()) / 1000));
      setRemaining((previous) => (previous === left ? previous : left));
    }, 500);
    return true;
  }, [clearTimers, seconds]);

  /** Entry point for every activation source (RFID, gesture, mouse, keyboard). */
  const open = useCallback((id, source = "manual") => {
    const current = sessionRef.current;
    if (current && current.id === id) {
      const elapsed = (Date.now() - current.startedAt) / 1000;
      // A deliberate re-scan near the end of the window grants a new period;
      // anything earlier is treated as a duplicate detection.
      const grantRefresh = elapsed >= seconds - SAME_ARTIFACT_REFRESH_SECONDS;
      return arm(id, source, grantRefresh);
    }
    return arm(id, source, false);
  }, [arm, seconds]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { session, remaining, open, close, isOpen: Boolean(session) };
}
