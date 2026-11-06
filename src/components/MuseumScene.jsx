import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const lotusCapitalProfile = [
  new THREE.Vector2(0.43, 0), new THREE.Vector2(0.49, 0.09),
  new THREE.Vector2(0.62, 0.22), new THREE.Vector2(0.72, 0.39),
  new THREE.Vector2(0.66, 0.48), new THREE.Vector2(0.52, 0.56),
  new THREE.Vector2(0, 0.56)
];

class ModelErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <Html center><div className="loading-scene">This exhibit model could not be loaded.</div></Html>;
    }
    return this.props.children;
  }
}

function useStoneFloorTexture() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = "#827a68";
    context.fillRect(0, 0, 256, 256);
    const image = context.createImageData(256, 256);
    let seed = 1847;
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const grain = ((seed >>> 24) - 128) * 0.2;
      image.data[i] = 130 + grain;
      image.data[i + 1] = 122 + grain;
      image.data[i + 2] = 104 + grain;
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    for (let i = 0; i < 80; i += 1) {
      context.fillStyle = i % 3 ? "rgba(236,224,198,.035)" : "rgba(35,34,31,.04)";
      context.beginPath();
      context.ellipse((i * 83) % 256, (i * 137) % 256, 3 + (i % 9), 1 + (i % 3), i * 0.7, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 4);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, []);
}

function GltfArtifact({ id, modelPath, position, label, selected, onSelect, index, editMode, onPositionChange, rotationEnabled }) {
  const root = useRef();
  const pivot = useRef();
  const drag = useRef(null);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const { scene } = useGLTF(modelPath);
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.rotation.y = id === "nefertiti" ? 0 : Math.PI;
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const desiredHeight = id === "bastet" ? 2.25 : id === "nefertiti" ? 2.4 : 2.0;
    const scale = desiredHeight / Math.max(size.y, 0.001);
    clone.scale.setScalar(scale);
    clone.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    clone.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material = obj.material.clone();
          if (obj.material.roughness !== undefined) obj.material.roughness = Math.max(obj.material.roughness, 0.38);
          if (obj.material.metalness !== undefined) obj.material.metalness = Math.min(obj.material.metalness, 0.72);
        }
      }
    });
    return clone;
  }, [id, scene]);

  useFrame((_, delta) => {
    if (pivot.current && rotationEnabled && drag.current?.mode !== "rotate") pivot.current.rotation.y += delta * 0.16;
  });

  function onPointerDown(event) {
    event.stopPropagation();
    onSelect(id);
    if (editMode) {
      drag.current = { mode: "position", offsetX: position[0] - event.point.x, offsetZ: position[2] - event.point.z, pointerId: event.pointerId };
    } else {
      drag.current = { mode: "rotate", x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    }
    event.target.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    event.stopPropagation();
    if (drag.current.mode === "rotate" && pivot.current) {
      pivot.current.rotation.y += (event.clientX - drag.current.x) * 0.009;
      pivot.current.rotation.x = THREE.MathUtils.clamp(pivot.current.rotation.x + (event.clientY - drag.current.y) * 0.004, -0.22, 0.22);
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      return;
    }
    if (drag.current.mode === "position") {
      pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, event.camera);
      if (raycaster.ray.intersectPlane(dragPlane, hit)) {
        onPositionChange(id, [THREE.MathUtils.clamp(hit.x + drag.current.offsetX, -6.4, 6.4), 0, THREE.MathUtils.clamp(hit.z + drag.current.offsetZ, -1.6, 3.5)]);
      }
    }
  }

  function onPointerUp(event) {
    if (!drag.current) return;
    event.stopPropagation();
    event.target.releasePointerCapture?.(drag.current.pointerId);
    drag.current = null;
  }

  return (
    <group ref={root} position={position} onPointerOver={() => { document.body.style.cursor = editMode ? "grab" : "ew-resize"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <planeGeometry args={[2.2, 2.3]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <boxGeometry args={[id === "nefertiti" ? 1.8 : 1.55, 0.28, 1.35]} />
        <meshStandardMaterial color="#171b20" metalness={0.35} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[id === "nefertiti" ? 1.95 : 1.7, 0.08, 1.5]} />
        <meshStandardMaterial color="#111518" metalness={0.35} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <boxGeometry args={[id === "nefertiti" ? 1.86 : 1.61, 0.035, 1.41]} />
        <meshStandardMaterial color="#aa8a4f" metalness={0.55} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[id === "nefertiti" ? 1.72 : 1.47, 0.05, 1.27]} />
        <meshStandardMaterial color="#33312c" metalness={0.16} roughness={0.3} />
      </mesh>
      <group ref={pivot} position={[0, 0.36, 0]}>
        <primitive object={model} />
        {selected && <pointLight position={[0, 2.6, 1.2]} color="#c6a15b" intensity={18} distance={6} />}
      </group>
      {selected && <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.94, 0.97, 64]} /><meshBasicMaterial color="#e5c783" transparent opacity={0.72} side={THREE.DoubleSide} />
      </mesh>}
      <Html position={[0, id === "bastet" ? 2.72 : 2.8, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div className={`scene-label ${selected ? "scene-label-selected" : ""}`}><span>{index}</span> {label}</div>
      </Html>
      <Html position={[0, 0.18, 0.77]} center transform distanceFactor={7} style={{ pointerEvents: "none" }}>
        <div className="pedestal-number">AEGIS · {index}</div>
      </Html>
    </group>
  );
}

function PlaceholderArtifact({ id, position, selected, onSelect, kind, label, index }) {
  const group = useRef();
  const hovered = useRef(false);
  useFrame((state) => {
    if (group.current) {
      group.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.65 + index) * 0.018;
      const scale = hovered.current ? 1.035 : 1;
      group.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.12);
    }
  });
  return (
    <group ref={group} position={position} onPointerOver={() => { hovered.current = true; document.body.style.cursor = "pointer"; }} onPointerOut={() => { hovered.current = false; document.body.style.cursor = ""; }} onClick={(e) => { e.stopPropagation(); onSelect(id); }}>
      <mesh position={[0, -0.62, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.88, 0.22, 40]} />
        <meshStandardMaterial color="#171b20" metalness={0.55} roughness={0.28} />
      </mesh>
      <mesh position={[0, -0.5, 0]}>
        <ringGeometry args={[0.72, 0.79, 40]} />
        <meshBasicMaterial color={selected ? "#f0d08b" : "#8e713b"} side={THREE.DoubleSide} />
      </mesh>
      {kind === "mask" ? (
        <group position={[0, 0.1, 0]}>
          <mesh position={[0, 0.04, 0]} scale={[0.78, 1.08, 0.76]} castShadow>
            <sphereGeometry args={[0.48, 40, 40]} />
            <meshStandardMaterial color="#bd974d" metalness={0.78} roughness={0.22} />
          </mesh>
          <mesh position={[0, 0.47, -0.04]} scale={[1.18, 0.72, 0.88]} castShadow>
            <sphereGeometry args={[0.54, 32, 24]} />
            <meshStandardMaterial color="#d7b961" metalness={0.76} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.2, 0.3]} scale={[0.11, 0.22, 0.13]} castShadow>
            <sphereGeometry args={[1, 20, 20]} />
            <meshStandardMaterial color="#d5b45f" metalness={0.62} roughness={0.25} />
          </mesh>
          {[-1, 1].map((side) => <group key={side}>
            <mesh position={[side * 0.19, 0.23, 0.33]} scale={[0.12, 0.035, 0.035]}>
              <sphereGeometry args={[1, 20, 12]} />
              <meshStandardMaterial color="#171a1a" metalness={0.28} roughness={0.3} />
            </mesh>
            <mesh position={[side * 0.19, 0.29, 0.32]} scale={[0.13, 0.025, 0.03]}>
              <sphereGeometry args={[1, 20, 12]} />
              <meshStandardMaterial color="#e4c773" metalness={0.72} roughness={0.23} />
            </mesh>
            <mesh position={[side * 0.46, -0.05, 0.02]} rotation={[0, 0, side * -0.12]} scale={[0.3, 0.72, 0.42]} castShadow>
              <sphereGeometry args={[0.48, 24, 24]} />
              <meshStandardMaterial color="#d1ad54" metalness={0.72} roughness={0.24} />
            </mesh>
            {[0, 1, 2].map((stripe) => <mesh key={stripe} position={[side * (0.31 + stripe * 0.1), -0.05, 0.2]} rotation={[0, 0, side * -0.12]}>
              <boxGeometry args={[0.025, 0.92, 0.015]} />
              <meshBasicMaterial color={stripe === 1 ? "#304c59" : "#a77a32"} />
            </mesh>)}
          </group>)}
          <mesh position={[0, -0.2, 0.34]} scale={[0.13, 0.035, 0.035]}>
            <sphereGeometry args={[1, 18, 12]} />
            <meshStandardMaterial color="#8d4e36" metalness={0.25} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.83, 0.02]} scale={[0.46, 0.19, 0.42]} castShadow>
            <sphereGeometry args={[1, 32, 20]} />
            <meshStandardMaterial color="#d7b961" metalness={0.8} roughness={0.18} />
          </mesh>
          <mesh position={[0, 1.01, 0.12]} scale={[0.09, 0.2, 0.08]} castShadow>
            <sphereGeometry args={[1, 20, 16]} />
            <meshStandardMaterial color="#c49c4d" metalness={0.76} roughness={0.2} />
          </mesh>
        </group>
      ) : (
        <group position={[0, 0.1, 0]} rotation={[0, -0.08, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.95, 1.15, 0.22]} />
            <meshStandardMaterial color="#46413a" roughness={0.92} />
          </mesh>
          {[-0.3, 0, 0.3].map((x) => (
            <mesh key={x} position={[x, 0, 0.116]}>
              <boxGeometry args={[0.012, 0.9, 0.008]} />
              <meshBasicMaterial color="#b8a27b" />
            </mesh>
          ))}
          {[-0.3, -0.08, 0.14, 0.36].map((y) => (
            <mesh key={y} position={[0, y, 0.118]}>
              <boxGeometry args={[0.72, 0.012, 0.008]} />
              <meshBasicMaterial color="#b8a27b" />
            </mesh>
          ))}
        </group>
      )}
      {selected && <pointLight position={[0, 2.1, 1]} color="#c6a15b" intensity={13} distance={5} />}
      <Html position={[0, 1.55, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div className="scene-label"><span>0{index + 1}</span> {label.toUpperCase()}</div>
      </Html>
    </group>
  );
}

function Architecture() {
  const columns = [-5.6, -3.9, -0.3, 1.4, 5.0, 6.7];
  const floorTexture = useStoneFloorTexture();
  return (
    <group>
      <mesh position={[0, -0.2, -1.6]} receiveShadow>
        <boxGeometry args={[17, 0.35, 13]} />
        <meshStandardMaterial color="#d1c5aa" map={floorTexture} roughness={0.52} metalness={0.04} />
      </mesh>
      <mesh position={[0, 2.35, -7.35]} receiveShadow>
        <boxGeometry args={[17, 4.9, 0.42]} />
        <meshStandardMaterial color="#494337" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.35, -7.1]}>
        <boxGeometry args={[15.9, 4.4, 0.06]} />
        <meshStandardMaterial color="#272a2a" roughness={0.9} />
      </mesh>
      {[-6.6, -3.3, 0, 3.3, 6.6].map((x) => (
        <group key={`alcove-${x}`} position={[x, 2.3, -7.03]}>
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[2.75, 4.15, 0.12]} />
            <meshStandardMaterial color="#36352f" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0, 0.14]}>
            <boxGeometry args={[2.48, 3.86, 0.035]} />
            <meshStandardMaterial color="#202629" roughness={0.94} />
          </mesh>
          {[-1.32, 1.32].map((side) => (
            <mesh key={side} position={[side, 0, 0.2]}>
              <boxGeometry args={[0.07, 4.2, 0.12]} />
              <meshStandardMaterial color="#887653" roughness={0.72} />
            </mesh>
          ))}
          <mesh position={[0, 2.1, 0.2]}>
            <boxGeometry args={[2.7, 0.1, 0.12]} />
            <meshStandardMaterial color="#9b865e" roughness={0.68} />
          </mesh>
        </group>
      ))}
      {[-8.35, 8.35].map((x) => (
        <group key={`side-wall-${x}`} position={[x, 2.25, -1.2]}>
          <mesh receiveShadow>
            <boxGeometry args={[0.34, 4.5, 12.2]} />
            <meshStandardMaterial color="#403a30" roughness={0.9} />
          </mesh>
          {[-5, -2.5, 0, 2.5, 5].map((z) => (
            <mesh key={z} position={[-Math.sign(x) * 0.19, 0, z]}>
              <boxGeometry args={[0.08, 4.1, 0.08]} />
              <meshStandardMaterial color="#78674a" roughness={0.76} />
            </mesh>
          ))}
        </group>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={`floor-joint-${i}`} position={[-6.8 + i * 2.25, -0.012, -1.6]}>
          <boxGeometry args={[0.016, 0.008, 12.8]} />
          <meshStandardMaterial color="#575144" roughness={0.82} />
        </mesh>
      ))}
      {[-5, -1.6, 1.8, 5.2].map((z) => (
        <mesh key={`cross-joint-${z}`} position={[0, -0.012, z]}>
          <boxGeometry args={[17, 0.008, 0.016]} />
          <meshStandardMaterial color="#575144" roughness={0.82} />
        </mesh>
      ))}
      {columns.map((x, i) => (
        <group key={x} position={[x, 0, -3.5]}>
          <mesh position={[0, 1.82, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.43, 0.56, 3.42, 32]} />
            <meshStandardMaterial color={i % 2 ? "#81745e" : "#91836a"} roughness={0.76} />
          </mesh>
          {Array.from({ length: 8 }, (_, flute) => {
            const angle = (flute / 8) * Math.PI * 2;
            return <mesh key={`flute-${flute}`} position={[Math.sin(angle) * 0.43, 1.82, Math.cos(angle) * 0.43]} castShadow>
              <cylinderGeometry args={[0.018, 0.025, 3.12, 8]} />
              <meshStandardMaterial color="#a39272" roughness={0.7} />
            </mesh>;
          })}
          <mesh position={[0, 3.56, 0]} castShadow>
            <latheGeometry args={[lotusCapitalProfile, 32]} />
            <meshStandardMaterial color="#a18a62" roughness={0.62} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.62, 0.7, 0.28, 12]} />
            <meshStandardMaterial color="#a18a62" roughness={0.65} />
          </mesh>
          <mesh position={[0, 0.29, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.54, 0.025, 8, 32]} />
            <meshStandardMaterial color="#b59a66" metalness={0.25} roughness={0.48} />
          </mesh>
          <mesh position={[0, 3.23, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.44, 0.025, 8, 32]} />
            <meshStandardMaterial color="#b59a66" metalness={0.25} roughness={0.48} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 4.42, -3.4]} receiveShadow>
        <boxGeometry args={[17, 0.48, 0.9]} />
        <meshStandardMaterial color="#5d5140" roughness={0.78} />
      </mesh>
      <mesh position={[0, 5.0, -1.2]} receiveShadow>
        <boxGeometry args={[17, 0.28, 12.3]} />
        <meshStandardMaterial color="#282927" roughness={0.88} />
      </mesh>
      {[-6.8, -3.4, 0, 3.4, 6.8].map((x) => (
        <mesh key={`ceiling-beam-${x}`} position={[x, 4.81, -1.2]}>
          <boxGeometry args={[0.14, 0.18, 12.2]} />
          <meshStandardMaterial color="#78674a" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 4.72, 2.3]}>
        <boxGeometry args={[17, 0.08, 0.16]} />
        <meshStandardMaterial color="#a18a62" metalness={0.18} roughness={0.55} />
      </mesh>
      <fog attach="fog" args={["#080b10", 8, 22]} />
    </group>
  );
}

function SceneContents({ selectedId, discoveredIds, onSelect, resetToken, cameraActionsRef, onAimRef, autoTour, artifactRotation, editMode, onEditModeChange }) {
  const controls = useRef();
  const { camera, gl, size } = useThree();
  const cameraDestination = useRef(null);
  const originalPositions = useMemo(() => ({ bastet: [-3.4, 0, 0.45], nefertiti: [0, 0, 0.15], churchfont: [3.4, 0, 0.35] }), []);
  const [positions, setPositions] = React.useState(originalPositions);
  const editSnapshot = useRef(positions);

  useEffect(() => {
    gl.xr.enabled = true;
    window.__museumRenderer = gl;
    return () => {
      if (window.__museumRenderer === gl) delete window.__museumRenderer;
    };
  }, [gl]);

  useEffect(() => {
    if (editMode) editSnapshot.current = Object.fromEntries(Object.entries(positions).map(([id, point]) => [id, [...point]]));
  }, [editMode]);

  useEffect(() => {
    if (!cameraActionsRef) return undefined;
    cameraActionsRef.current = {
      zoomIn: () => { controls.current?.dollyIn(1.25); controls.current?.update(); },
      zoomOut: () => { controls.current?.dollyOut(1.25); controls.current?.update(); },
      turnView: (dx, dy) => {
        if (!controls.current || !dx && !dy) return;
        const target = controls.current.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta -= dx * 7;
        spherical.phi = THREE.MathUtils.clamp(
          spherical.phi + dy * 5,
          controls.current.minPolarAngle,
          controls.current.maxPolarAngle
        );
        camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
        camera.lookAt(target);
        controls.current.update();
      }
    };
    return () => { cameraActionsRef.current = null; };
  }, [camera, cameraActionsRef]);

  useEffect(() => {
    if (!onAimRef) return undefined;
    const exhibitIds = ["bastet", "nefertiti", "churchfont"];
    const resolveAim = (aimOrId) => {
      if (typeof aimOrId === "string") {
        const index = exhibitIds.indexOf(aimOrId);
        return index < 0 ? null : { id: aimOrId, lane: index };
      }
      if (typeof aimOrId === "number") {
        const id = exhibitIds[Math.min(exhibitIds.length - 1, Math.max(0, aimOrId))];
        return id ? { id, lane: exhibitIds.indexOf(id) } : null;
      }
      if (!aimOrId) return null;

      // Hand-camera video is mirrored for the visitor; mirror its aim back
      // into the 3D canvas before finding the nearest visible pedestal.
      const aimX = 1 - aimOrId.x * 2;
      const aimY = 1 - aimOrId.y * 2;
      let closest = null;
      exhibitIds.forEach((id, lane) => {
        const position = positions[id];
        const screen = new THREE.Vector3(position[0], 1.2, position[2]).project(camera);
        if (screen.z < -1 || screen.z > 1) return;
        const distance = Math.hypot(screen.x - aimX, screen.y - aimY);
        if (!closest || distance < closest.distance) closest = { id, lane, distance };
      });
      return closest && closest.distance < 0.48 ? { id: closest.id, lane: closest.lane } : null;
    };

    onAimRef(resolveAim);
    return () => onAimRef(null);
  }, [camera, onAimRef, positions]);

  useEffect(() => {
    if (controls.current) controls.current.enabled = !editMode;
  }, [editMode]);

  useEffect(() => {
    const destinations = {
      bastet: [-3.4, 1.2, 0.45],
      nefertiti: [0, 1.2, 0.15],
      churchfont: [3.4, 1.2, 0.35]
    };
    const target = destinations[selectedId];
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-motion");
    cameraDestination.current = target
      ? { target: new THREE.Vector3(...target), position: new THREE.Vector3(target[0], target[1] + 1.05, target[2] + 5.8), immediate: reducedMotion }
      : { target: new THREE.Vector3(0, 1.1, 0), position: new THREE.Vector3(0, 3.15, 11.5), immediate: reducedMotion };
  }, [camera, selectedId, resetToken]);

  useEffect(() => {
    if (selectedId) return;
    const aspect = Math.max(size.width / Math.max(size.height, 1), 0.5);
    const distance = Math.max(12.8, 10.8 / aspect);
    const position = new THREE.Vector3(0, 3.15, distance);
    if (cameraDestination.current) cameraDestination.current.position.copy(position);
    else camera.position.copy(position);
  }, [camera, selectedId, size.width, size.height]);

  function changePosition(id, nextPosition) {
    setPositions((current) => ({ ...current, [id]: nextPosition }));
  }

  function resetPositions() {
    setPositions(originalPositions);
  }

  function cancelPositionEdits() {
    setPositions(editSnapshot.current);
    onEditModeChange?.(false);
  }

  useFrame((_, delta) => {
    const destination = cameraDestination.current;
    if (!destination || !controls.current) return;
    const easing = destination.immediate ? 1 : 1 - Math.exp(-delta * 2.4);
    camera.position.lerp(destination.position, easing);
    controls.current.target.lerp(destination.target, easing);
    controls.current.update();
    if (camera.position.distanceTo(destination.position) < 0.018 && controls.current.target.distanceTo(destination.target) < 0.018) {
      camera.position.copy(destination.position);
      controls.current.target.copy(destination.target);
      cameraDestination.current = null;
    }
  });

  return (
    <>
      <color attach="background" args={["#080b10"]} />
      <ambientLight intensity={selectedId ? 0.32 : 0.43} />
      <hemisphereLight args={["#c5d0d7", "#211b12", selectedId ? 0.44 : 0.56]} />
      <directionalLight position={[0, 8, 5]} intensity={selectedId ? 0.72 : 0.88} color="#ffe2a4" castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <spotLight position={[-3.4, 7, 1]} angle={0.42} penumbra={0.72} intensity={selectedId === "bastet" ? 72 : selectedId ? 12 : 30} color="#e7c47a" distance={14} castShadow />
      <spotLight position={[0, 7, 1]} angle={0.38} penumbra={0.72} intensity={selectedId === "nefertiti" ? 72 : selectedId ? 12 : 30} color="#e7c47a" distance={14} castShadow />
      <spotLight position={[3.4, 7, 1]} angle={0.4} penumbra={0.7} intensity={selectedId === "churchfont" ? 72 : selectedId ? 12 : 28} color="#e5d2a2" distance={14} castShadow />
      <Architecture columns={[-6.6, -5.2, 5.2, 6.6]} />
      <ModelErrorBoundary><GltfArtifact id="bastet" modelPath="/models/bastet_cat_goddess_egypt.glb" position={positions.bastet} label={discoveredIds.includes("bastet") ? "BASTET · CAT GODDESS" : "ARTIFACT 01"} index="01" selected={selectedId === "bastet"} onSelect={onSelect} editMode={editMode} onPositionChange={changePosition} rotationEnabled={artifactRotation && !editMode} /></ModelErrorBoundary>
      <ModelErrorBoundary><GltfArtifact id="nefertiti" modelPath="/models/nefertitis_bust_like_in_the_museum.glb" position={positions.nefertiti} label={discoveredIds.includes("nefertiti") ? "BUST OF NEFERTITI" : "ARTIFACT 02"} index="02" selected={selectedId === "nefertiti"} onSelect={onSelect} editMode={editMode} onPositionChange={changePosition} rotationEnabled={artifactRotation && !editMode} /></ModelErrorBoundary>
      <ModelErrorBoundary><GltfArtifact id="churchfont" modelPath="/models/st_etheldredas_church_mortar.glb" position={positions.churchfont} label={discoveredIds.includes("churchfont") ? "ST ETHELDREDA’S CHURCH FONT" : "ARTIFACT 03"} index="03" selected={selectedId === "churchfont"} onSelect={onSelect} editMode={editMode} onPositionChange={changePosition} rotationEnabled={artifactRotation && !editMode} /></ModelErrorBoundary>
      <Environment preset="studio" environmentIntensity={0.48} />
      <OrbitControls ref={controls} makeDefault enabled={!editMode} autoRotate={autoTour && !selectedId} autoRotateSpeed={0.25} target={[0, 1.1, 0]} minDistance={4.2} maxDistance={15} maxPolarAngle={Math.PI / 2.05} minPolarAngle={Math.PI / 5} enableDamping dampingFactor={0.07} />
      {editMode && <Html fullscreen>
        <div className="edit-mode-banner" onPointerDown={(event) => event.stopPropagation()}>
          <span>EXHIBITION EDIT · DRAG AN EXHIBIT TO REPOSITION</span>
          <button onClick={() => onEditModeChange?.(false)}>Save for this visit</button>
          <button onClick={cancelPositionEdits}>Cancel</button>
          <button onClick={resetPositions}>Reset positions</button>
        </div>
      </Html>}
    </>
  );
}

export default function MuseumScene({ selectedId, discoveredIds = [], onSelect, resetToken, cameraActionsRef, onAimRef, autoTour, artifactRotation, editMode, onEditModeChange }) {
  return (
    <Canvas shadows camera={{ position: [0, 3.15, 13], fov: 44 }} gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.86 }} dpr={[1, 1.5]}>
      <Suspense fallback={<Html center><div className="loading-scene">Preparing the gallery…</div></Html>}>
        <SceneContents selectedId={selectedId} discoveredIds={discoveredIds} onSelect={onSelect} resetToken={resetToken} cameraActionsRef={cameraActionsRef} onAimRef={onAimRef} autoTour={autoTour} artifactRotation={artifactRotation} editMode={editMode} onEditModeChange={onEditModeChange} />
      </Suspense>
    </Canvas>
  );
}
useGLTF.preload("/models/bastet_cat_goddess_egypt.glb");
useGLTF.preload("/models/nefertitis_bust_like_in_the_museum.glb");
useGLTF.preload("/models/st_etheldredas_church_mortar.glb");
