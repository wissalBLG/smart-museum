import { useCallback, useEffect, useRef, useState } from "react";
import { createGestureEngine } from "../services/gestureEngine.js";

// There is exactly one hand-tracking implementation in this project: the
// engine in services/gestureEngine.js (camera, model loading, gesture
// classification and the focus/reveal state machine). This hook is only a thin
// adapter that owns the <video> element, maps engine statuses onto the dock
// statuses the UI already speaks, and forwards aim frames in the shape
// MuseumScene expects ({ type: "aim", lane, aim, hand }).

const LANE_COUNT = 3;
const OVERLAY_WIDTH = 320;
const OVERLAY_HEIGHT = 240;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const GESTURE_ALIASES = {
  palm: "open_palm",
  pinch: "pinch",
  fist: "fist",
  point: "point",
  none: "none",
  open: "none"
};

const STATUS_MAP = {
  starting: "requesting",
  loading: "loading",
  tracking: "ready"
};

// The engine reports aim in normalised camera coordinates; the video is
// mirrored for the visitor, so x is flipped before splitting the frame into
// three pick-up lanes.
function laneFromAim(aim) {
  if (!aim) return 1;
  return Math.min(LANE_COUNT - 1, Math.max(0, Math.floor((1 - aim.x) * LANE_COUNT)));
}

function paintOverlay(canvas, video, hand) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
  const landmarks = hand?.landmarks;
  if (!video || !landmarks) return;
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 480;
  // Cover-fit the frame, mirrored, exactly like the CSS transform on the video.
  const scale = Math.max(OVERLAY_WIDTH / sourceWidth, OVERLAY_HEIGHT / sourceHeight);
  const offsetX = (OVERLAY_WIDTH - sourceWidth * scale) / 2;
  const offsetY = (OVERLAY_HEIGHT - sourceHeight * scale) / 2;
  const point = (landmark) => ({
    x: OVERLAY_WIDTH - (offsetX + landmark.x * sourceWidth * scale),
    y: offsetY + landmark.y * sourceHeight * scale
  });
  context.lineWidth = 2;
  context.strokeStyle = hand.gesture === "pinch" ? "#f0d08b" : "rgba(240, 208, 139, .65)";
  HAND_CONNECTIONS.forEach(([from, to]) => {
    const a = point(landmarks[from]);
    const b = point(landmarks[to]);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  });
  context.fillStyle = "#f0d08b";
  landmarks.forEach((landmark) => {
    const dot = point(landmark);
    context.beginPath();
    context.arc(dot.x, dot.y, 2, 0, Math.PI * 2);
    context.fill();
  });
}

export function useHandGestureAccess(onGesture, onNavigation) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const mountCheckRef = useRef(null);
  const onGestureRef = useRef(onGesture);
  const onNavigationRef = useRef(onNavigation);
  const laneArtifactRef = useRef(null);
  const previousNavigationAimRef = useRef(null);
  const [status, setStatus] = useState("disabled");
  const [detail, setDetail] = useState("Camera is off.");
  const [gesture, setGesture] = useState("none");
  const [targetLane, setTargetLane] = useState(1);

  useEffect(() => { onGestureRef.current = onGesture; }, [onGesture]);
  useEffect(() => { onNavigationRef.current = onNavigation; }, [onNavigation]);

  function ensureEngine() {
    if (engineRef.current) return engineRef.current;
    engineRef.current = createGestureEngine({
      onStatus: (next) => {
        setStatus(STATUS_MAP[next.status] || next.status);
        if (next.detail) setDetail(next.detail);
      },
      // The engine asks for the pedestal under the aim point and expects a
      // target with an id, so the adapter resolves the aim to a lane and lets
      // the scene decide what is actually under it.
      onFrame: (frame) => {
        if (frame.type === "aim") {
          const target = laneArtifactRef.current?.(frame.aim) || null;
          const lane = target?.lane ?? laneFromAim(frame.aim);
          setTargetLane((previous) => (previous === lane ? previous : lane));
          return target;
        }
        if (frame.type === "navigate") {
          const previous = previousNavigationAimRef.current;
          previousNavigationAimRef.current = frame.aim;
          if (previous && frame.aim) {
            onNavigationRef.current?.({
              dx: Math.max(-0.08, Math.min(0.08, frame.aim.x - previous.x)),
              dy: Math.max(-0.08, Math.min(0.08, frame.aim.y - previous.y))
            });
          }
          return undefined;
        }
        if (frame.type === "frame") {
          setGesture(frame.hand?.landmarks ? GESTURE_ALIASES[frame.gesture] || "none" : "none");
          if (frame.gesture !== "fist") previousNavigationAimRef.current = null;
          paintOverlay(canvasRef.current, frame.video, frame.hand);
        }
        return undefined;
      },
      onFocus: (targetId) => {
        const target = laneArtifactRef.current?.(targetId);
        if (target) onGestureRef.current?.({ gesture: "focus", lane: target.id, confidence: 1 });
      },
      onReveal: (targetId, info) => {
        const mapped = info?.gesture === "palm" ? "open_palm" : GESTURE_ALIASES[info?.gesture] || "pinch";
        const target = laneArtifactRef.current?.(targetId);
        onGestureRef.current?.({ gesture: mapped, lane: target?.id ?? targetId, confidence: 1 });
      },
      onLog: (scope, message) => {
        if (scope === "detect") setDetail(`Hand tracking problem: ${message}`);
      }
    });
    return engineRef.current;
  }

  const disable = useCallback(() => {
    if (mountCheckRef.current) clearInterval(mountCheckRef.current);
    mountCheckRef.current = null;
    void engineRef.current?.stop();
    setGesture("none");
    previousNavigationAimRef.current = null;
    setStatus("disabled");
    setDetail("Camera is off.");
  }, []);

  const enable = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setDetail("Camera access is unavailable in this browser. Try localhost or HTTPS.");
      return false;
    }
    if (!videoRef.current) {
      setStatus("error");
      setDetail("The gesture preview is not mounted.");
      return false;
    }

    setStatus("requesting");
    setDetail("Waiting for camera permission…");
    const started = await ensureEngine().start(videoRef.current, { width: 640, height: 480 });
    if (!started) return false;

    // The engine's stop() drops the <video> it was given; if React remounts the
    // preview (e.g. the panel was closed and reopened) it must be handed back.
    if (mountCheckRef.current) clearInterval(mountCheckRef.current);
    mountCheckRef.current = setInterval(() => {
      const engine = engineRef.current;
      if (!engine || !videoRef.current) return;
      if (!videoRef.current.srcObject) void engine.start(videoRef.current, { width: 640, height: 480 });
    }, 1500);
    return true;
  }, []);

  useEffect(() => () => {
    if (mountCheckRef.current) clearInterval(mountCheckRef.current);
    void engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  // The scene owns the camera and exhibit positions, so it supplies the
  // lane -> artifact lookup the engine needs to focus and reveal.
  const setLaneResolver = useCallback((resolver) => { laneArtifactRef.current = resolver; }, []);
  const getEngine = useCallback(() => engineRef.current, []);

  return { videoRef, canvasRef, status, detail, gesture, targetLane, enable, disable, getEngine, setLaneResolver };
}
