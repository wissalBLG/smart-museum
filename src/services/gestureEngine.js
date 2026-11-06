import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// The wasm runtime ships inside the npm package. The `.task` model file is not
// shipped by the package, so the page first looks for a locally hosted copy
// (public/models/hand_landmarker.task) and only then falls back to Google's
// published model URL. The status line tells the visitor which one is in use.
const CDN_WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${import.meta.env.VITE_MEDIAPIPE_VERSION || "0.10.17"}/wasm`;
const LOCAL_MODEL_PATH = "/mediapipe/models/hand_landmarker.task";
const CDN_MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const PINCH_ENTER = 0.34;   // thumb tip to index tip, relative to hand scale
const PINCH_EXIT = 0.46;

const PALM_ENTER = 0.82;    // thumb tip to index knuckle, relative to hand scale
const PALM_EXIT = 0.74;
const TRACK_LOST_FRAMES = 8;
const GESTURE_STABLE_FRAMES = 5;

const FINGER_JOINTS = [
  { tip: 8, pip: 6, mcp: 5 },
  { tip: 12, pip: 10, mcp: 9 },
  { tip: 16, pip: 14, mcp: 13 },
  { tip: 20, pip: 18, mcp: 17 }
];

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Hand scale = wrist to middle-finger knuckle. Every threshold is expressed as
// a ratio of it, so the gestures work at arm's length and close to the lens.
export function classifyHand(landmarks) {
  if (!landmarks || landmarks.length < 21) return { gesture: "none", landmarks: null, ratio: 0 };
  const [wrist] = landmarks;
  const scale = distance(wrist, landmarks[9]) || 0.0001;

  const extended = FINGER_JOINTS.map(({ tip, pip, mcp }) =>
    distance(landmarks[tip], wrist) > distance(landmarks[pip], wrist) && distance(landmarks[tip], wrist) > distance(landmarks[mcp], wrist)
  );
  const extendedCount = extended.filter(Boolean).length;

  const pinchRatio = distance(landmarks[4], landmarks[8]) / scale;
  const spreadRatio = distance(landmarks[4], landmarks[5]) / scale;
  const palmOpen = extended[0] && extended[1] && extended[2] && (extended[3] || distance(landmarks[20], wrist) > scale * 1.5);

  // Aiming point: midway between the index tip and the pinch midpoint, which
  // is stable both when pointing with one finger and when pinching.
  const aim = { x: (landmarks[8].x + landmarks[4].x) / 2, y: (landmarks[8].y + landmarks[4].y) / 2 };

  let gesture = "open";
  if (pinchRatio < PINCH_ENTER && extendedCount >= 2) gesture = "pinch";
  else if (palmOpen && extendedCount >= 4 && spreadRatio > 0.75) gesture = "palm";
  else if (extendedCount === 0 && pinchRatio > PINCH_EXIT) gesture = "fist";
  else if (extended[0] && !extended[0 + 1] && !extended[2] && !extended[3]) gesture = "point";
  else if (extended[0] && extended[1] && !extended[2] && !extended[3]) gesture = "point";

  return { gesture, extended, extendedCount, pinchRatio, spreadRatio, aim, scale, landmarks };
}

/**
 * Owns the camera, the model and the gesture state machine.
 *
 * The state machine is deliberately small and explicit:
 *   tracking  -> "point" aims at a pedestal and holds focus on it
 *             -> "palm"  commits only when a pedestal is already focused
 *   every commit is followed by a cooldown so a held hand cannot retrigger
 *   passive hand movement never reveals anything.
 */
export function createGestureEngine({ onStatus, onFocus, onReveal, onFrame, onLog }) {
  let landmarker = null;
  let video = null;
  let stream = null;
  let running = false;
  let rafId = 0;
  let lastVideoTime = -1;
  let missingFrames = 0;
  let currentGesture = "none";
  let pendingGesture = "none";
  let pendingCount = 0;
  let focusId = null;
  let cooldownUntil = 0;
  let aimHold = 0;
  let lastDetectAt = 0;
  let disposed = false;
  let assetSource = "";

  function status(next) {
    onStatus?.({ status: "idle", detail: "", tracking: false, model: assetSource, ...next });
  }

  async function fileExists(url) {
    try {
      const head = await fetch(url, { method: "HEAD" });
      return head.ok;
    } catch {
      return false;
    }
  }

  async function loadModel() {
    const fileset = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
    // استخدام رابط الـ CDN مباشرة لتجنب أخطاء قراءة الملف المحلي في بيئة التطوير Vite
    const modelAssetPath = CDN_MODEL_PATH;
    assetSource = "cdn";
    
    return HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    }).catch(async () => {
      const fallback = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
      return HandLandmarker.createFromOptions(fallback, {
        baseOptions: { modelAssetPath: CDN_MODEL_PATH, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 1
      });
    });
  }

  function setStableGesture(gesture) {
    if (gesture === pendingGesture) {
      pendingCount += 1;
    } else {
      pendingGesture = gesture;
      pendingCount = 1;
    }
    if (pendingCount >= GESTURE_STABLE_FRAMES) currentGesture = gesture;
  }

  function stepGestures(hand, now) {
    if (!hand.landmarks) {
      missingFrames += 1;
      if (missingFrames > TRACK_LOST_FRAMES) {
        if (currentGesture !== "none") {
          currentGesture = "none";
          pendingGesture = "none";
          pendingCount = 0;
        }
        if (focusId !== null) {
          focusId = null;
          aimHold = 0;
          onFocus?.(null, { reason: "lost" });
        }
      }
      return;
    }
    missingFrames = 0;
    setStableGesture(hand.gesture);

    if (now < cooldownUntil) return;

    if (currentGesture === "point") {
      const target = onFrame?.({ type: "aim", aim: hand.aim, hand });
      if (!target) return;
      if (target.id !== focusId) {
        aimHold = 0;
      }
      aimHold += 1;
      // Require ~0.25 s of steady pointing before the focus moves, so a hand
      // sweeping past a pedestal does not flash eight highlights.
      if (aimHold >= (focusId === null ? 9 : 6) && target.id !== focusId) {
        focusId = target.id;
        aimHold = 0;
        onFocus?.(focusId, { reason: "aim", hand });
      }
      return;
    }

    if (currentGesture === "fist") {
      // Move a closed fist to look around the gallery. The hook converts
      // these aim coordinates into small, clamped camera deltas.
      onFrame?.({ type: "navigate", aim: hand.aim, hand });
      return;
    }

    // Holding a non-pointing gesture keeps focus where it is; it does not move
    // it, which is what makes "point then palm" feel deliberate.
    if (currentGesture === "palm" && focusId) {
      const revealed = focusId;
      onReveal?.(revealed, { gesture: "palm", hand });
      cooldownUntil = now + 2600;   // no repeat while the palm stays up
      aimHold = 0;
      return;
    }

    if (currentGesture === "pinch" && focusId) {
      // Pinch is the second, alternative commit gesture.
      onReveal?.(focusId, { gesture: "pinch", hand });
      cooldownUntil = now + 2600;
      aimHold = 0;
    }
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    const now = performance.now();
    if (!video || video.readyState < 2 || now - lastDetectAt < 45) return;
    if (video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    lastDetectAt = now;

    let result = null;
    try {
      result = landmarker.detectForVideo(video, now);
    } catch (error) {
      onLog?.("detect", error?.message || "hand detection failed");
      return;
    }
    const hand = classifyHand(result?.landmarks?.[0]);
    stepGestures(hand, now);
    onFrame?.({ type: "frame", video, hand, gesture: currentGesture, focusId, pinchRatio: hand.pinchRatio });
  }

  return {
    getAssetSource: () => assetSource,

    async start(videoElement, { width = 640, height = 480 } = {}) {
      if (running) return true;
      status({ status: "starting", detail: "Requesting camera access…" });
      if (!navigator.mediaDevices?.getUserMedia) {
        status({
          status: "unsupported",
          detail: "This browser does not expose camera access (getUserMedia). Hand interaction needs HTTPS or localhost."
        });
        return false;
      }
      try {
        if (!stream || stream.getTracks().every((track) => track.readyState === "ended")) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: width }, height: { ideal: height }, facingMode: "user" },
            audio: false
          });
        }
      } catch (error) {
        const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
        status({
          status: denied ? "denied" : "error",
          detail: denied
            ? "Camera permission was denied. Allow camera access in the browser's site settings, then enable hand interaction again."
            : error?.name === "NotFoundError"
              ? "No camera was found on this device."
              : error?.message || "The camera could not be opened."
        });
        return false;
      }

      video = videoElement;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try {
        await video.play();
      } catch {
        // Autoplay with a muted stream is allowed; a rejection here means the
        // element is not mounted yet, which start() callers handle by retrying.
      }

      status({ status: "loading", detail: "Loading the hand-tracking model…" });
      try {
        if (!landmarker) landmarker = await loadModel();
      } catch (error) {
        // Keep the camera attached so a model/network error shows a live
        // preview instead of turning the panel black. The user can retry or
        // explicitly turn the camera off.
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        status({ status: "error", detail: error?.message || "The hand-tracking model could not be loaded." });
        return false;
      }
      if (disposed) return false;

      running = true;
      lastVideoTime = -1;
      status({
        status: "tracking",
        detail: assetSource === "local"
          ? "Tracking your hand. Point at an exhibit, then open your palm."
          : "Tracking your hand (model streamed from Google's CDN). Point at an exhibit, then open your palm.",
        tracking: true
      });
      loop();
      return true;
    },

    async stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
      if (video) {
        try { video.pause(); } catch { /* element may be gone */ }
        video.srcObject = null;
      }
      video = null;
      focusId = null;
      currentGesture = "none";
      pendingGesture = "none";
      pendingCount = 0;
      missingFrames = 0;
      aimHold = 0;
      status({ status: "idle", detail: "Camera is off. Enable hand interaction to use gestures." });
    },

    async dispose() {
      disposed = true;
      await this.stop();
      try { landmarker?.close?.(); } catch { /* already closed */ }
      landmarker = null;
    },

    setFocus(id) {
      focusId = id;
    },

    isRunning() {
      return running;
    },

    /** Lets a non-gesture input (mouse/keyboard) move the focus safely. */
    clearFocus() {
      focusId = null;
      aimHold = 0;
    },

    getCooldownRemaining() {
      return Math.max(0, cooldownUntil - performance.now());
    }
  };
}
