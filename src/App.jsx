import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture, ArrowDownRight, ArrowLeft, ArrowRight, AudioLines, Cat, Check, ChevronDown, Compass, Library,
  CircleHelp, CreditCard, Headphones, Info, Maximize, Menu, Minus, Move3d,
  Hand, Pause, Pencil, Play, Plus, RotateCcw, RotateCw, ScanLine, Settings2, ShieldCheck, Sparkles, Volume2,
  Usb, VolumeX, X
} from "lucide-react";
import MuseumScene from "./components/MuseumScene.jsx";
import Scanner from "./components/Scanner.jsx";
import fallbackArtifacts from "./data/artifacts.js";
import { useHandGestureAccess } from "./hooks/useHandGestureAccess.js";
import { normalizeIdentifier, reverseBytePair } from "./services/artifactId.js";
import { createRfidReader, RFID_BAUD_RATE } from "./services/rfidReader.js";
import { io } from "socket.io-client";

const RFID_SOCKET_URL = import.meta.env.VITE_RFID_SOCKET_URL;

function findArtifactByIdentifier(artifacts, identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;
  const reversed = reverseBytePair(normalized);

  return artifacts.find((item) => [item.id, item.card_uid, item.sceneId].some((candidate) => {
    const key = normalizeIdentifier(candidate);
    return key && (key === normalized || key === reversed || reverseBytePair(key) === normalized);
  })) || null;
}

export default function App() {
  const [artifacts, setArtifacts] = useState(fallbackArtifacts);
  const [selectedId, setSelectedId] = useState(null);
  const [infoArtifactId, setInfoArtifactId] = useState(null);
  const [discovered, setDiscovered] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("aegis-discovered-artifacts-v2") || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  const [readerStatus, setReaderStatus] = useState({ status: "disconnected", detail: "RFID reader is not connected." });
  const [activeTab, setActiveTab] = useState("explore");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [vrMode, setVrMode] = useState(false);
  const [autoTour, setAutoTour] = useState(false);
  const [artifactRotation, setArtifactRotation] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [toast, setToast] = useState("");
  const audioTimer = useRef(null);
  const cameraActionsRef = useRef(null);
  const cardTransportRef = useRef(null);
  const artifactsRef = useRef(artifacts);
  const discoverArtifactRef = useRef(null);
  artifactsRef.current = artifacts;

  const hand = useHandGestureAccess(handleHandGesture, ({ dx, dy }) => {
    cameraActionsRef.current?.turnView(dx, dy);
  });

  // جلب القطع الأثرية من جدول Supabase عند تحميل الصفحة
 // جلب القطع الأثرية من السيرفر الخلفي عبر الـ API
useEffect(() => {
    async function fetchArtifacts() {
      try {
        const response = await fetch("http://localhost:3000/api/artifacts");
        const data = await response.json();
        console.log("Data received from backend:", data); // طباعة البيانات في Console المتصفح

        const items = Array.isArray(data) ? data : (Array.isArray(data.artifacts) ? data.artifacts : []);
        if (!items.length) return;

        const formatted = items.map((item) => {
          const fallback = findArtifactByIdentifier(fallbackArtifacts, item.card_uid || item.id)
            || fallbackArtifacts.find((candidate) => normalizeIdentifier(candidate.name) === normalizeIdentifier(item.name || item.title));
          return {
            ...fallback,
            ...item,
            id: item.id || item.card_uid?.toLowerCase() || fallback?.id,
            sceneId: fallback?.id || item.sceneId || item.id,
            card_uid: item.card_uid || fallback?.card_uid || ""
          };
        });
        setArtifacts(formatted);
      } catch (error) {
        console.error("Error fetching artifacts:", error);
      }
    }
    fetchArtifacts();
  }, []);

  
// ربط الـ Socket.io للاستماع لأحداث المسح الحية من السيرفر
  // ربط الـ Socket.io للاستماع لأحداث المسح الحية من السيرفر
useEffect(() => {
  if (!RFID_SOCKET_URL) return undefined;
  const socket = io(RFID_SOCKET_URL);

  socket.on("connect", () => {
    console.log("Connected to Socket.io server!");
  });

  socket.on("rfid_scanned", (scannedArtifact) => {
    console.log("RFID scanned event received:", scannedArtifact);
    if (scannedArtifact) {
      // البحث عن القطعة باستخدام دالة المطابقة المتاحة لدك لضمان إيجاد المعرف الصحيح للثري دي
      const found = findArtifactByIdentifier(
        artifacts, 
        scannedArtifact.card_uid || scannedArtifact.id || scannedArtifact.uid
      ) || scannedArtifact;

      const targetId = found?.id || found?.sceneId || scannedArtifact.card_uid;

      if (targetId) {
        console.log("Triggering discovery/focus for targetId:", targetId);
        // استدعاء الدالة المباشرة أو الـ Ref المعتمدة للتركيز
        if (typeof discoverArtifact === 'function') {
          discoverArtifact(targetId);
        } else {
          discoverArtifactRef.current?.(targetId);
        }
      }
    }
  });

  return () => {
    socket.disconnect();
  };
}, [artifacts]); // سيعمل بكفاءة عالية الآن مع تحديث الـ artifacts
 

  useEffect(() => {
    const reader = createRfidReader({
      baudRate: RFID_BAUD_RATE,
      onStatus: setReaderStatus,
      onEvent: (event) => {
        if (event.type === "card_scanned") {
          const found = findArtifactByIdentifier(artifactsRef.current, event.uid);
          if (!found) {
            setReaderStatus((current) => ({ ...current, lastCard: `Unrecognized card · ${event.uid}` }));
            notify(`Unrecognized RFID card · ${event.uid}`);
            return;
          }
          setReaderStatus((current) => ({ ...current, lastCard: `Recognized · ${found.name}` }));
          discoverArtifactRef.current?.(found.id);
        } else if (event.type === "read_error") {
          notify(event.message || "The RFID reader reported a read error.");
        } else if (event.type === "reader_status" && event.message) {
          setReaderStatus((current) => ({ ...current, firmware: event.state, detail: event.message }));
        }
      }
    });

    cardTransportRef.current = reader;
    return () => {
      cardTransportRef.current = null;
      void reader.disconnect();
    };
  }, []);

  const artifact = useMemo(() => artifacts.find((item) => item.id === infoArtifactId) || null, [infoArtifactId, artifacts]);
  const collectionPercent = artifacts.length ? Math.round((discovered.length / artifacts.length) * 100) : 0;

  useEffect(() => {
    try {
      window.localStorage.setItem("aegis-discovered-artifacts-v2", JSON.stringify(discovered));
    } catch {}
  }, [discovered]);

  useEffect(() => {
    if (!audioPlaying || !artifact) return;
    audioTimer.current = setInterval(() => setAudioProgress((p) => {
      if (p >= 100) {
        clearInterval(audioTimer.current);
        setAudioPlaying(false);
        return 100;
      }
      return p + 1;
    }), 420);
    return () => clearInterval(audioTimer.current);
  }, [audioPlaying, artifact]);

  useEffect(() => () => {
    if (audioTimer.current) clearInterval(audioTimer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  function notify(text) {
    setToast(text);
    window.setTimeout(() => setToast(""), 2600);
  }

  function handleHandGesture(event) {
    if (event.gesture === "focus") {
      const item = artifactsRef.current.find((candidate) => candidate.sceneId === event.lane || candidate.id === event.lane);
      if (!item) return;
      setSelectedId(item.sceneId || item.id);
      setAutoTour(false);
      return;
    }

    if (event.gesture === "open_palm" || event.gesture === "pinch") {
      discoverArtifact(event.lane);
    }
  }

  async function toggleHandTracking() {
    if (["ready", "requesting", "loading"].includes(hand.status)) {
      hand.disable();
      return;
    }
    await hand.enable();
  }

  function selectSceneArtifact(id) {
    setSelectedId(id);
    setInfoArtifactId(null);
    setAutoTour(false);
    const selectedArtifact = artifacts.find((item) => item.sceneId === id || item.id === id);
    if (selectedArtifact && discovered.includes(selectedArtifact.id)) {
      notify("Open your collection to revisit this artifact’s story.");
      return;
    }
    notify("Present this exhibit’s artifact card to reveal its story.");
  }

 function discoverArtifact(id) {
    const found = findArtifactByIdentifier(artifacts, id);
    if (!found) return;
    const realId = found.id || found.card_uid;
    setSelectedId(found.sceneId || realId);
    setInfoArtifactId(realId);
    setAutoTour(false);
    setDiscovered((old) => old.includes(realId) ? old : [...old, realId]);
    setScannerOpen(false);
    setActiveTab("explore");
    setAudioPlaying(false);
    setAudioProgress(0);
    notify(`Artifact discovered · ${found.name}`);
  }

  discoverArtifactRef.current = discoverArtifact;

  async function toggleRfidReader() {
    const reader = cardTransportRef.current;
    if (!reader) return;
    if (["connected", "connecting", "reconnecting"].includes(readerStatus.status)) {
      await reader.disconnect();
      return;
    }
    await reader.connect();
  }

  function revisitArtifact(id) {
    if (!discovered.includes(id)) return;
    const item = artifacts.find((artifactItem) => artifactItem.id === id);
    setSelectedId(item?.sceneId || id);
    setInfoArtifactId(id);
    setActiveTab("explore");
    setAutoTour(false);
  }

  function toggleAudio() {
    if (!artifact) {
      notify("Select an artifact to open its audio guide.");
      return;
    }
    if (audioPlaying) {
      setAudioPlaying(false);
      if ("speechSynthesis" in window) window.speechSynthesis.pause();
      return;
    }
    if (audioProgress >= 100) setAudioProgress(0);
    setAudioPlaying(true);
    if ("speechSynthesis" in window && !muted) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`${artifact.name}. ${artifact.intro || ""} ${artifact.significance || ""}`);
      utterance.rate = 0.88;
      utterance.pitch = 0.9;
      utterance.onend = () => { setAudioPlaying(false); setAudioProgress(100); };
      window.speechSynthesis.speak(utterance);
    } else if (muted) {
      notify("Audio is muted. Turn sound on to hear the guide.");
    } else {
      notify("Speech synthesis is not available in this browser.");
    }
  }

  function resetMuseum() {
    setSelectedId(null);
    setInfoArtifactId(null);
    setAutoTour(false);
    setAudioPlaying(false);
    setAudioProgress(0);
    setResetToken((v) => v + 1);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    notify("Returned to the main gallery");
  }

  async function enterVr() {
    const canvas = document.querySelector("canvas");
    try {
      if (navigator.xr && canvas) {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        if (supported) {
          const renderer = window.__museumRenderer;
          if (renderer?.xr) {
            const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "bounded-floor"] });
            await renderer.xr.setSession(session);
            setVrMode(true);
            session.addEventListener("end", () => setVrMode(false), { once: true });
            return;
          }
        }
      }
    } catch {}
    setVrMode((old) => !old);
    notify("Desktop immersive view toggled. Headset VR requires WebXR support, a compatible headset, and HTTPS.");
  }

  return (
    <main className={`museum-app ${vrMode ? "vr-mode" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); resetMuseum(); }} aria-label="Aegis Museum home">
          <span className="brand-mark"><Aperture size={22} strokeWidth={1.3} /></span>
          <span className="brand-copy"><strong>AEGIS</strong><small>MUSEUM OF ANTIQUITIES</small></span>
        </a>
        <div className="room-indicator"><span className="live-indicator"><span /> EXHIBITION LIVE</span><span>GRAND EGYPTIAN HALL</span></div>
        <nav className="main-nav" aria-label="Museum controls">
          <button className={activeTab === "explore" ? "nav-active" : ""} onClick={() => { setActiveTab("explore"); resetMuseum(); }} aria-label="Explore the museum"><Compass size={14} /><span>Explore</span></button>
          <button className={activeTab === "collection" ? "nav-active" : ""} onClick={() => setActiveTab("collection")} aria-label={`My collection, ${discovered.length} discovered`}><Library size={14} /><span>Collection</span><span className="nav-count">{discovered.length}</span></button>
          <button onClick={() => { if (artifact) toggleAudio(); else notify("Select an artifact to hear its curator guide."); }} aria-label="Audio guide"><Headphones size={14} /><span>Audio</span></button>
          <button className="scanner-nav" onClick={() => setScannerOpen(true)} aria-label="Open artifact card scanner"><ScanLine size={14} /><span>Scan card</span></button>
        </nav>
        <div className="top-actions">
          <button className={`gesture-link gesture-${hand.status}`} onClick={toggleHandTracking} title={hand.detail} aria-label={["ready", "requesting", "loading"].includes(hand.status) ? "Disable hand tracking" : "Enable hand tracking controls"}>
            <Hand size={14} /><span>{hand.status === "ready" ? "HAND ON" : ["requesting", "loading"].includes(hand.status) ? "STARTING" : "HAND CONTROL"}</span><i />
          </button>
          <button className={`reader-link reader-${readerStatus.status}`} onClick={toggleRfidReader} title={readerStatus.detail} aria-label={readerStatus.status === "connected" ? "Disconnect RFID reader" : "Connect RFID reader over USB serial"}>
            <Usb size={14} /><span>{readerStatus.status === "connected" ? "RFID CONNECTED" : readerStatus.status === "connecting" ? "CONNECTING" : readerStatus.status === "reconnecting" ? "RECONNECTING" : readerStatus.status === "unsupported" ? "SERIAL UNAVAILABLE" : "CONNECT RFID"}</span><i />
          </button>
          <button className="vr-button" onClick={enterVr}><Move3d size={15} /> VR mode</button>
          <button className="icon-button settings-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={18} /></button>
        </div>
      </header>

      <section className="museum-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> PERMANENT COLLECTION <span className="eyebrow-separator">/</span> ANCIENT EGYPT</div>
          <h1>Where history <em>becomes</em> presence.</h1>
          <p>Walk among the stories that shaped a civilization.</p>
        </div>
        <div className="heading-meta"><span className="meta-label">GALLERY 01</span><span className="meta-divider" /><span>THE ROYAL DYNASTIES</span><span className="meta-divider" /><span>EST. 3100 BCE</span></div>
      </section>

      <section className="experience-layout">
        <div className="scene-panel">
          <div className="scene-topline">
            <div className="scene-location"><Compass size={14} /><span>THE GRAND EGYPTIAN HALL</span><span className="scene-dot">·</span><span className="scene-muted">ROOM 01 / 04</span></div>
            <div className="scene-top-actions"><span className="scene-live"><i /> REAL-TIME 3D</span><button className="scene-icon-button" onClick={() => setHelpOpen(true)} aria-label="Museum controls help"><CircleHelp size={16} /></button></div>
          </div>
          <div className="scene-canvas">
            <MuseumScene selectedId={selectedId} discoveredIds={discovered} onSelect={selectSceneArtifact} resetToken={resetToken} cameraActionsRef={cameraActionsRef} onAimRef={hand.setLaneResolver} autoTour={autoTour} artifactRotation={artifactRotation} editMode={editMode} onEditModeChange={setEditMode} />
            <div className="scene-vignette" />
            <div className="scene-side-label"><span>AEGIS</span><span>·</span><span>ANCIENT EGYPT</span></div>
            {!artifact && <div className="card-invitation"><CreditCard size={14} /><span>Present an artifact card to reveal its story</span><small>{readerStatus.lastCard || (readerStatus.status === "connected" ? "RFID reader connected · present a card" : "Connect the RFID reader or scan a museum QR card")}</small></div>}
            {artifact && <div className="scene-caption">
              <span className="caption-rule" />
              <div><span className="eyebrow">NOW EXHIBITING</span><strong>{artifact.name}</strong><small>{artifact.period}</small></div>
            </div>}
            <div className="scene-controls" aria-label="Museum camera controls">
              <button className={autoTour ? "control-active" : ""} onClick={() => setAutoTour((value) => !value)} aria-label="Toggle auto-tour"><Move3d size={16} /></button>
              <button className={artifactRotation ? "control-active" : ""} onClick={() => setArtifactRotation((value) => !value)} aria-label="Toggle rotation"><RotateCw size={15} /></button>
              <button className={editMode ? "control-active" : ""} onClick={() => setEditMode((value) => !value)} aria-label="Toggle edit mode"><Pencil size={15} /></button>
              <span className="control-divider" />
              <button onClick={() => cameraActionsRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={16} /></button>
              <button onClick={() => cameraActionsRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={16} /></button>
              <span className="control-divider" />
              <button onClick={resetMuseum} aria-label="Reset camera"><RotateCcw size={15} /></button>
              <span className="control-divider" />
              <button onClick={enterVr} aria-label="Toggle immersive view"><Maximize size={15} /></button>
            </div>
            {vrMode && <div className="vr-banner"><Move3d size={16} /> IMMERSIVE VIEW<button onClick={() => setVrMode(false)}>Exit <X size={14} /></button></div>}
          </div>
          <div className="scene-footer"><span><span className="key-hint">DRAG</span> ROTATE VIEW</span><span><span className="key-hint">SCROLL</span> MOVE CLOSER</span><span><span className="key-hint">SELECT</span> DISCOVER ARTIFACT</span><span className="scene-footer-right"><span className="tiny-gold-dot" /> {autoTour ? "AUTO-TOUR ACTIVE" : "EXPERIENCE ENGINE / 01.0"}</span></div>
        </div>

        {activeTab === "collection" && <aside className="side-panel collection-overlay" aria-label="My collection">
          <button className="overlay-close" onClick={() => setActiveTab("explore")} aria-label="Close collection"><X size={17} /></button>
          <CollectionPanel artifacts={artifacts} discovered={discovered} onSelect={revisitArtifact} onExplore={() => setActiveTab("explore")} />
        </aside>}
        {artifact && activeTab === "explore" && <aside className="side-panel artifact-overlay" aria-label={`${artifact.name} details`}>
          <button className="overlay-close" onClick={resetMuseum} aria-label="Close artifact details"><X size={17} /></button>
          <div className="panel-section artifact-section">
            <div className="eyebrow">EXHIBIT · {String(artifacts.findIndex((item) => item.id === artifact.id) + 1).padStart(2, "0")}</div>
            <ArtifactDetails artifact={artifact} discovered={discovered.includes(artifact.id)} audioPlaying={audioPlaying} audioProgress={audioProgress} onAudio={toggleAudio} onReturn={resetMuseum} />
          </div>
        </aside>}
      </section>

      <footer className="bottom-bar"><div className="bottom-brand"><span className="bottom-mark">𓋹</span><span>THE PAST, PRESENT.</span></div><button className="help-link" onClick={() => setHelpOpen(true)}><Info size={14} /> CONTROLS</button></footer>

      <aside className={`hand-interaction-panel ${hand.status === "disabled" ? "is-hidden" : ""}`} aria-label="Hand tracking status" aria-hidden={hand.status === "disabled"}>
        <div className="hand-panel-head">
          <span className={`hand-status-dot hand-status-${hand.status}`} />
          <strong>{hand.status === "ready" ? "HAND TRACKING ACTIVE" : `CAMERA ${hand.status.toUpperCase()}`}</strong>
          <button onClick={hand.disable} aria-label="Turn off hand tracking"><X size={14} /></button>
        </div>
        <div className="hand-preview-wrap">
          <video ref={hand.videoRef} className="hand-preview" muted playsInline autoPlay aria-label="Hand tracking camera preview" />
          <canvas ref={hand.canvasRef} className="hand-overlay" width={320} height={240} aria-hidden="true" />
        </div>
        <p className="hand-panel-message">{hand.status === "ready" ? "Point at an exhibit to focus it, then open your palm or pinch to reveal it. Make a fist and move your hand to look around." : hand.detail}</p>
        {hand.status === "ready" && <span className="gesture-current">GESTURE · {hand.gesture === "none" ? "POINT, OPEN PALM OR MAKE A FIST" : hand.gesture.replaceAll("_", " ").toUpperCase()}</span>}
      </aside>

      {scannerOpen && <Scanner onRecognized={discoverArtifact} onManualSelect={() => setScannerOpen(false)} onClose={() => setScannerOpen(false)} />}
      {settingsOpen && <SettingsModal muted={muted} setMuted={setMuted} onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {toast && <div className="toast" role="status"><Check size={15} /> {toast}</div>}
    </main>
  );
}

function ArtifactDetails({ artifact, discovered, audioPlaying, audioProgress, onAudio, onReturn }) {
  return (
    <div className="artifact-details">
      <div className="artifact-tags"><span>{artifact.civilization}</span><span>{artifact.date || artifact.details?.date}</span></div>
      <h3>{artifact.name}</h3>
      <p className="artifact-period">{artifact.period}</p>
      <p className="artifact-intro">{artifact.intro || artifact.description}</p>
      <div className="fact-grid">
        <div><span>ORIGIN</span><strong>{artifact.origin}</strong></div>
        <div><span>MATERIAL</span><strong>{artifact.material}</strong></div>
      </div>
      <div className="significance-block"><span className="eyebrow">WHY IT MATTERS</span><p>{artifact.significance}</p></div>
      <div className="facts-list">{artifact.facts?.map((fact, i) => <div key={fact}><span>0{i + 1}</span>{fact}</div>)}</div>
      <div className="audio-player">
        <button className="audio-play" onClick={onAudio} aria-label="Play audio guide">{audioPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}</button>
        <div className="audio-info"><div><strong>Curator's audio guide</strong><span>{audioPlaying ? "NOW PLAYING" : "LISTEN · APPROX. 1 MIN"}</span></div><div className="audio-track"><span style={{ width: `${audioProgress}%` }} /></div></div>
        <span className="audio-time">{audioProgress === 100 ? "1:00" : `0:${String(Math.floor(audioProgress * 0.6)).padStart(2, "0")}`}</span>
      </div>
      <div className="detail-actions">
        <span className={`discovery-state ${discovered ? "is-discovered" : ""}`}>{discovered ? <><Check size={13} /> DISCOVERED</> : <><Sparkles size={13} /> IN EXHIBITION</>}</span>
        <button className="return-button" onClick={onReturn}><ArrowLeft size={14} /> Return to gallery</button>
      </div>
    </div>
  );
}

function CollectionPanel({ artifacts, discovered, onSelect, onExplore }) {
  return <div className="collection-page-panel">
    <div className="eyebrow">YOUR PERSONAL ARCHIVE</div><h2>My collection<span className="gold-period">.</span></h2>
    <p className="collection-page-intro">Every discovery brings another fragment of history into focus.</p>
    <div className="collection-big-stat"><strong>{String(discovered.length).padStart(2, "0")}<small> / {String(artifacts.length).padStart(2, "0")}</small></strong><span>ARTIFACTS DISCOVERED</span><div className="progress-track"><span style={{ width: `${artifacts.length ? (discovered.length / artifacts.length) * 100 : 0}%` }} /></div><small>{artifacts.length ? Math.round((discovered.length / artifacts.length) * 100) : 0}% of this collection explored</small></div>
    <div className="collection-page-list">{artifacts.map((item, i) => {
      const open = discovered.includes(item.id);
      return <button key={item.id} className={`collection-row ${open ? "unlocked" : "locked"}`} onClick={() => open && onSelect(item.id)} disabled={!open}>
        <span className="collection-row-art">{open ? <Cat size={23} /> : <ShieldCheck size={17} />}</span>
        <span className="collection-row-info"><strong>{open ? item.name : "Artifact not yet discovered"}</strong><small>{open ? item.period : "Scan its museum card to unlock its story"}</small></span>
        <span className="collection-row-state">{open ? <><Check size={13} /> FOUND</> : "LOCKED"}</span>
      </button>;
    })}</div>
    <button className="button button-gold collection-explore" onClick={onExplore}><Compass size={15} /> Return to the museum</button>
  </div>;
}

function SettingsModal({ muted, setMuted, onClose }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("reduce-motion", reducedMotion); return () => document.documentElement.classList.remove("reduce-motion"); }, [reducedMotion]);
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="small-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><div className="eyebrow">PERSONAL EXPERIENCE</div><h2>Museum settings</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <button className="setting-row" onClick={() => setMuted(!muted)}><span><Volume2 size={17} /><span><strong>Audio guide sound</strong><small>Browser speech synthesis</small></span></span><span className={`toggle ${!muted ? "on" : ""}`} /></button>
    <button className="setting-row" onClick={() => setReducedMotion(!reducedMotion)}><span><Sparkles size={17} /><span><strong>Reduce motion</strong><small>Reduce decorative transitions</small></span></span><span className={`toggle ${reducedMotion ? "on" : ""}`} /></button>
  </section></div>;
}

function HelpModal({ onClose }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="small-modal help-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><div className="eyebrow">A SHORT FIELD GUIDE</div><h2>Explore the museum</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <div className="help-step"><span>01</span><div><strong>Move through the gallery</strong><p>Drag to orbit around the hall; use mouse wheel or trackpad to zoom.</p></div></div>
    <div className="help-step"><span>02</span><div><strong>Use hand tracking</strong><p>Enable Hand Control and allow camera access. Point at an exhibit to focus it, open your palm or pinch to reveal it, and move a closed fist to look around the hall.</p></div></div>
  </section></div>;
}