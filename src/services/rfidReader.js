import { normalizeIdentifier } from "./artifactId.js";

const DEFAULT_BAUD_RATE = 115200;
const CARD_HOLD_GAP_MS = 1500;      // same UID re-fires only after the card left the field
const HEARTBEAT_TIMEOUT_MS = 12000; // a connected-but-silent reader is reported as stale

/**
 * Web Serial bridge to the ESP32-S3 + RC522 exhibit reader.
 *
 * Honesty rules baked in here:
 *  - there is no simulated scan path: with no port open, the status is
 *    "disconnected" and nothing can ever produce a card event;
 *  - a card event is only emitted for a line the firmware actually sent;
 *  - if the port disappears (cable pulled, board reset) the UI is told
 *    immediately and the bridge tries to reattach to the same port, because
 *    the board has no way to know the page is still watching.
 *
 * The bridge never decides which artifact a UID belongs to — that stays the
 * registry's job so QR / NFC / RFID share one mapping.
 */
export function createRfidReader({ baudRate = DEFAULT_BAUD_RATE, onStatus, onEvent }) {
  let port = null;
  let reader = null;
  let writer = null;
  let closing = false;
  let lastLineAt = 0;
  let connecting = false;
  let retryTimer = null;
  let retryRound = 0;
  let watchdog = null;
  const heldCards = new Map(); // normalized UID -> { timer, released }
  const listeners = new Set();

  function setStatus(next) {
    const status = {
      status: "disconnected",
      detail: "RFID reader is not connected.",
      firmware: "",
      lastCard: "",
      lastScanAt: 0,
      cardCount: 0,
      autoRetry: false,
      simulated: false, // never true; present so the UI can state it plainly
      ...next
    };
    onStatus?.(status);
  }

  function disableAutoRetry(reason) {
    retryRound = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    setStatus({ status: "disconnected", detail: reason, autoRetry: false });
  }

  function clearHeldCards() {
    heldCards.forEach(({ timer }) => clearTimeout(timer));
    heldCards.clear();
  }

  function releaseCard(uid) {
    const key = normalizeIdentifier(uid);
    if (!key) return;
    const held = heldCards.get(key);
    if (held) {
      clearTimeout(held.timer);
      // A card that was lifted keeps its "released" mark briefly so a
      // re-presentation counts as a second, intentional scan.
      held.released = true;
      held.timer = setTimeout(() => heldCards.delete(key), CARD_HOLD_GAP_MS);
    }
  }

  function shouldEmit(uid) {
    const key = normalizeIdentifier(uid);
    const held = heldCards.get(key);
    if (held && !held.released) {
      // Same card still sitting on the reader: suppress, and restart the hold
      // timer so the window is measured from the last time we saw it.
      clearTimeout(held.timer);
      held.timer = setTimeout(() => { held.released = true; }, CARD_HOLD_GAP_MS);
      return false;
    }
    const entry = { released: false, timer: null };
    entry.timer = setTimeout(() => { entry.released = true; }, CARD_HOLD_GAP_MS);
    heldCards.set(key, entry);
    return true;
  }

  function emitLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    // Human diagnostics from the firmware ("[BOOT] ...", "[RFID] ...") are
    // shown in the reader console but never invent a scan.
    if (!trimmed.startsWith("{")) {
      emitEvent({ type: "firmware_log", line: trimmed });
      return;
    }
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      emitEvent({ type: "malformed_message", raw: trimmed });
      return;
    }
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      emitEvent({ type: "malformed_message", raw: trimmed });
      return;
    }

    lastLineAt = Date.now();

    if (message.type === "card_scanned") {
      const uid = String(message.uid ?? message.card_uid ?? "").trim();
      if (!uid) {
        emitEvent({ type: "read_error", message: "Reader reported a card without a UID." });
        return;
      }
      if (!shouldEmit(uid)) return;
      emitEvent({ type: "card_scanned", uid, at: lastLineAt, source: "rfid" });
      return;
    }

    if (message.type === "card_removed") {
      releaseCard(message.uid ?? message.card_uid);
      return;
    }

    if (message.type === "reader_status") {
      emitEvent({
        type: "reader_status",
        state: message.status || "ready",
        message: message.message || "",
        at: lastLineAt
      });
      return;
    }

    if (message.type === "read_error") {
      emitEvent({ type: "read_error", message: message.message || "RFID read error." });
      return;
    }

    emitEvent({ type: "reader_event", message });
  }

  function emitEvent(event) {
    listeners.forEach((listener) => {
      try { listener(event); } catch { /* one bad listener must not stop the stream */ }
    });
    onEvent?.(event);
  }

  async function readLoop(activeReader) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!closing && reader === activeReader) {
        const { value, done } = await activeReader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(emitLine);
        // A firmware line that never terminates must not grow without bound.
        if (buffer.length > 8192) {
          emitLine(buffer.slice(0, 160));
          buffer = "";
        }
      }
      if (buffer.trim()) emitLine(buffer);
    } catch (error) {
      if (!closing) {
        emitEvent({ type: "link_lost", message: error?.message || "Serial link dropped." });
      }
    } finally {
      try { activeReader.releaseLock?.(); } catch { /* already released */ }
      if (reader === activeReader) reader = null;
      if (!closing) await handleLinkLost();
    }
  }

  async function closePort() {
    try { writer?.releaseLock?.(); } catch { /* ignore */ }
    writer = null;
    if (port) {
      try { await port.close(); } catch { /* already closed */ }
    }
    port = null;
  }

  async function handleLinkLost() {
    clearHeldCards();
    if (closing) return;
    await closePort();
    if (retryRound >= 5) {
      disableAutoRetry("The reader stopped responding and could not be reattached. Reconnect the USB cable, then connect again.");
      return;
    }
    retryRound += 1;
    setStatus({
      status: "reconnecting",
      detail: `Reader link lost — reattaching automatically (attempt ${retryRound} of 5).`,
      autoRetry: true
    });
    scheduleRetry(1200 + retryRound * 600);
  }

  function scheduleRetry(delay) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void attach(true);
    }, delay);
  }

  async function attach(isRetry) {
    if (!("serial" in navigator)) {
      setStatus({
        status: "unsupported",
        detail: "This browser has no Web Serial support. Use desktop Chrome or Edge over HTTPS or localhost, or use the QR/NFC scanner."
      });
      return false;
    }
    if (connecting) return false;
    connecting = true;
    try {
      if (!port) {
        // On a retry there is nothing to prompt with: navigator.serial.getPorts()
        // only returns ports the visitor already granted access to.
        const granted = isRetry ? await navigator.serial.getPorts() : [];
        port = granted[0] || await navigator.serial.requestPort();
      }
      setStatus({ status: "connecting", detail: isRetry ? "Reattaching to the reader…" : "Opening the reader serial link…", autoRetry: isRetry });
      await port.open({ baudRate });
      reader = port.readable.getReader();
      try { writer = port.writable?.getWriter() ?? null; } catch { writer = null; }
      closing = false;
      retryRound = 0;
      lastLineAt = Date.now();
      setStatus({
        status: "connected",
        detail: `Serial link open at ${baudRate} baud. Waiting for the reader to report in.`,
        firmware: ""
      });
      void readLoop(reader);
      // Ask the firmware to re-announce itself; ignored by firmware without
      // a command handler, which is why it is not required for anything.
      try { await writer?.write(new TextEncoder().encode("STATUS\n")); } catch { /* optional */ }
      return true;
    } catch (error) {
      await closePort();
      const denied = error?.name === "NotFoundError" || error?.name === "SecurityError";
      if (isRetry) {
        if (retryRound < 5) {
          retryRound += 1;
          scheduleRetry(1500 + retryRound * 700);
          setStatus({ status: "reconnecting", detail: `Still reattaching (attempt ${retryRound} of 5).`, autoRetry: true });
        } else {
          disableAutoRetry("The reader could not be reattached. Reconnect the USB cable, then connect again.");
        }
      } else if (denied) {
        disableAutoRetry("No serial port was selected, so the reader stays disconnected.");
      } else {
        disableAutoRetry(error?.message || "The serial port could not be opened. Close any other program using it (Arduino IDE, PlatformIO monitor) and try again.");
      }
      return false;
    } finally {
      connecting = false;
    }
  }

  function startWatchdog() {
    if (watchdog) clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (!port || closing) return;
      if (Date.now() - lastLineAt > HEARTBEAT_TIMEOUT_MS) {
        // Say it, do not act on it: a firmware that simply is not chatty must
        // not be disconnected behind the operator's back.
        emitEvent({ type: "link_quiet", silentForMs: Date.now() - lastLineAt });
      }
    }, 4000);
  }

  return {
    async connect() {
      retryRound = 0;
      startWatchdog();
      return attach(false);
    },

    async disconnect() {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (watchdog) clearInterval(watchdog);
      watchdog = null;
      clearHeldCards();
      try { await reader?.cancel(); } catch { /* reader may already be gone */ }
      reader = null;
      await closePort();
      setStatus({ status: "disconnected", detail: "Reader disconnected by the operator." });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (watchdog) clearInterval(watchdog);
      clearHeldCards();
      listeners.clear();
      try { void reader?.cancel(); } catch { /* ignore */ }
    }
  };
}

export const RFID_BAUD_RATE = Number(import.meta.env.VITE_RFID_BAUD_RATE) || DEFAULT_BAUD_RATE;
