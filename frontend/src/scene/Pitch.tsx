import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../state/store.js";
import { PITCH } from "./sceneUtils.js";

/**
 * FIFA-standard pitch markings drawn once into a canvas texture (base albedo
 * with mowing stripes + a black/white emissive variant so only the lines glow
 * faintly). 1 scene unit = 1 meter, pitch centered on origin.
 */

const LINE = "#E8F1EA";
const GRASS_A = "#071B10";
const GRASS_B = "#0A2415";

function drawPitch(emissiveOnly: boolean): HTMLCanvasElement {
  const W = 2048;
  const H = Math.round((W * PITCH.width) / PITCH.length); // ~1326
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const sx = W / PITCH.length;
  const sz = H / PITCH.width;
  const X = (x: number) => (x + PITCH.halfX) * sx;
  const Z = (z: number) => (z + PITCH.halfZ) * sz;

  if (emissiveOnly) {
    ctx.fillStyle = "#000000";
  } else {
    ctx.fillStyle = GRASS_A;
    ctx.fillRect(0, 0, W, H);
    // alternating mowing stripes, ~5.25m bands along x
    ctx.fillStyle = GRASS_B;
    const bands = 20;
    for (let i = 0; i < bands; i += 2) {
      ctx.fillRect((i * W) / bands, 0, W / bands, H);
    }
  }

  const lw = 0.12 * sx; // 0.12m lines
  ctx.strokeStyle = emissiveOnly ? "#FFFFFF" : LINE;
  ctx.fillStyle = emissiveOnly ? "#FFFFFF" : LINE;
  ctx.lineWidth = lw;

  // boundary
  ctx.strokeRect(X(-PITCH.halfX), Z(-PITCH.halfZ), W - 2 * lw, H - 2 * lw);
  // halfway line
  ctx.beginPath();
  ctx.moveTo(X(0), Z(-PITCH.halfZ));
  ctx.lineTo(X(0), Z(PITCH.halfZ));
  ctx.stroke();
  // center circle + spot
  ctx.beginPath();
  ctx.arc(X(0), Z(0), 9.15 * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(0), Z(0), Math.max(1.5, 0.11 * sx), 0, Math.PI * 2);
  ctx.fill();

  for (const side of [-1, 1] as const) {
    const goalX = side * PITCH.halfX;
    // penalty area: 16.5m deep, 40.32m wide
    const boxX = side === 1 ? goalX - 16.5 : goalX;
    ctx.strokeRect(X(boxX), Z(-20.16), 16.5 * sx, 40.32 * sz);
    // goal area: 5.5m deep, 18.32m wide
    const sixX = side === 1 ? goalX - 5.5 : goalX;
    ctx.strokeRect(X(sixX), Z(-9.16), 5.5 * sx, 18.32 * sz);
    // penalty spot, 11m from goal line
    const spotX = goalX - side * 11;
    ctx.beginPath();
    ctx.arc(X(spotX), Z(0), Math.max(1.5, 0.11 * sx), 0, Math.PI * 2);
    ctx.fill();
    // penalty arc, r 9.15 around the spot, outside the box only
    const alpha = Math.acos(5.5 / 9.15);
    ctx.beginPath();
    if (side === 1) {
      ctx.arc(X(spotX), Z(0), 9.15 * sx, Math.PI - alpha, Math.PI + alpha);
    } else {
      ctx.arc(X(spotX), Z(0), 9.15 * sx, -alpha, alpha);
    }
    ctx.stroke();
    // corner arcs, r 1m (canvas +z is downward, so corner=+1 arcs from PI)
    for (const corner of [-1, 1] as const) {
      const start =
        side === 1
          ? corner === 1
            ? Math.PI
            : Math.PI / 2
          : corner === 1
            ? -Math.PI / 2
            : 0;
      ctx.beginPath();
      ctx.arc(X(goalX), Z(corner * PITCH.halfZ), 1 * sx, start, start + Math.PI / 2);
      ctx.stroke();
    }
  }

  return canvas;
}

function GoalFrame({ side }: { side: 1 | -1 }) {
  const x = side * PITCH.halfX;
  const post: [number, number, number] = [0.12, 2.44, 0.12];
  const material = (
    <meshStandardMaterial color={LINE} emissive={LINE} emissiveIntensity={0.35} />
  );
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 1.22, -3.66]}>{/* left post */}
        <boxGeometry args={post} />
        {material}
      </mesh>
      <mesh position={[0, 1.22, 3.66]}>
        <boxGeometry args={post} />
        {material}
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[0.12, 0.12, 7.44]} />
        {material}
      </mesh>
    </group>
  );
}

function Floodlight({ position }: { position: [number, number, number] }) {
  const head = useRef<THREE.Mesh>(null);
  return (
    <group position={position}>
      <mesh position={[0, 14, 0]}>
        <cylinderGeometry args={[0.25, 0.35, 28, 8]} />
        <meshStandardMaterial color="#10151F" />
      </mesh>
      <mesh ref={head} position={[0, 28.5, 0]} rotation={[-0.5, Math.atan2(-position[0], -position[2]), 0]}>
        <boxGeometry args={[4.5, 1.8, 0.4]} />
        <meshStandardMaterial color="#0C0F16" emissive="#DFE8FF" emissiveIntensity={1.6} />
      </mesh>
    </group>
  );
}

function Dust() {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(200 * 3);
    for (let i = 0; i < 200; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 130;
      arr[i * 3 + 1] = 0.5 + Math.random() * 28;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 85;
    }
    return arr;
  }, []);
  const phases = useMemo(() => {
    const arr = new Float32Array(200);
    for (let i = 0; i < 200; i++) arr[i] = Math.random() * Math.PI * 2;
    return arr;
  }, []);
  const base = useMemo(() => new Float32Array(positions), [positions]);

  useFrame(({ clock }) => {
    const pts = ref.current;
    if (!pts) return;
    const t = clock.elapsedTime * 0.07;
    const attr = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < 200; i++) {
      attr.array[i * 3] = base[i * 3] + Math.sin(t + phases[i]) * 2.5;
      attr.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 1.7 + phases[i] * 2) * 1.2;
      attr.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.8 + phases[i]) * 2.5;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.3}
        color="#8A93A6"
        transparent
        opacity={0.22}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

/** Rain streaks, only when the fixture's captured weather says "Raining". */
const RAIN_DROPS = 700;

function Rain() {
  const ref = useRef<THREE.LineSegments>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(RAIN_DROPS * 2 * 3);
    const speeds = new Float32Array(RAIN_DROPS);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() - 0.5) * 130;
      const y = Math.random() * 38;
      const z = (Math.random() - 0.5) * 85;
      positions.set([x, y, z, x + 0.15, y - 0.9, z], i * 6);
      speeds[i] = 16 + Math.random() * 8;
    }
    return { positions, speeds };
  }, []);

  useFrame((_, delta) => {
    const seg = ref.current;
    if (!seg) return;
    const dt = Math.min(delta, 0.1);
    const attr = seg.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < RAIN_DROPS; i++) {
      const dy = speeds[i] * dt;
      let y0 = arr[i * 6 + 1] - dy;
      let y1 = arr[i * 6 + 4] - dy;
      if (y1 < 0) {
        const reset = 34 + Math.random() * 8;
        y0 = reset;
        y1 = reset - 0.9;
      }
      arr[i * 6 + 1] = y0;
      arr[i * 6 + 4] = y1;
    }
    attr.needsUpdate = true;
  });

  return (
    <lineSegments ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#9DB8D8" transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  );
}

/** Reads the fixture's weather from the replay event log (replay only). */
export function WeatherFx() {
  const replay = useAppStore((s) => s.match.replay);
  const raining = useMemo(() => {
    const w = replay?.events.find((e) => e.action === "weather");
    const cond = w?.data?.Conditions as string[] | undefined;
    return cond?.includes("Raining") ?? false;
  }, [replay]);
  return raining ? <Rain /> : null;
}

export function Pitch() {
  const { map, emissiveMap } = useMemo(() => {
    const baseTex = new THREE.CanvasTexture(drawPitch(false));
    const glowTex = new THREE.CanvasTexture(drawPitch(true));
    for (const tex of [baseTex, glowTex]) {
      tex.anisotropy = 8;
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    return { map: baseTex, emissiveMap: glowTex };
  }, []);

  return (
    <group>
      {/* apron fading into the fog */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[260, 200]} />
        <meshStandardMaterial color="#030905" />
      </mesh>
      {/* pitch surface with markings */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[PITCH.length, PITCH.width]} />
        <meshStandardMaterial
          map={map}
          emissiveMap={emissiveMap}
          emissive={LINE}
          emissiveIntensity={0.55}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <GoalFrame side={1} />
      <GoalFrame side={-1} />
      <Floodlight position={[-62, 0, -42]} />
      <Floodlight position={[62, 0, -42]} />
      <Floodlight position={[-62, 0, 42]} />
      <Floodlight position={[62, 0, 42]} />
      <Dust />
    </group>
  );
}
