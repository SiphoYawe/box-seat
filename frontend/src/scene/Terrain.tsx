import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useAppStore } from "../state/store.js";
import { currentViewFrame, normPressure, PITCH } from "./sceneUtils.js";

/**
 * Pressure terrain: one translucent heightfield per team floating above the
 * pitch. The whole field derives from 6 scalars (3 zones x 2 teams) + noise,
 * so displacement runs in the vertex shader with the zone values as uniforms,
 * tweened CPU-side. Both teams' attacking mounds rise near the goal they are
 * attacking - pressure visibly piles up on the goal under siege.
 */

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uZones;   // normalized defensive / middle / attacking (team-oriented)
uniform float uMirror; // +1 participant1 (attacks +x), -1 participant2
uniform float uBaseY;

varying float vH;
varying vec3 vWorld;

// Ashima / Ian McEwan simplex noise (webgl-noise, MIT)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Each zone value becomes a mound centered on its third (gaussian bumps,
// sigma ~22m) - smooth blending, no plateaus, ends taper toward the goals.
float zoneProfile(float xt) {
  float d0 = (xt + 35.0) / 22.0;
  float d1 = xt / 22.0;
  float d2 = (xt - 35.0) / 22.0;
  return uZones.x * exp(-d0 * d0) + uZones.y * exp(-d1 * d1) + uZones.z * exp(-d2 * d2);
}

void main() {
  float xt = uMirror * position.x;
  float prof = zoneProfile(xt);
  // cosine dome across z: 1.0 at center, ~0.4 at the touchlines (slightly
  // peaked so accumulated plateaus still read as mounds, not slabs)
  float dome = pow(cos(clamp(abs(position.z) / 34.0, 0.0, 1.0) * 1.5707963), 1.3);
  float env = mix(0.4, 1.0, dome);
  float h = pow(max(prof, 0.0), 1.15) * env;
  // breath: boils only where real pressure exists (amplitude scales with h)
  float breath = snoise(vec3(position.x * 0.1, position.z * 0.1, uTime * 0.12)) * 0.08 * h;
  float y = uBaseY + (h + breath) * ${PITCH.terrainMax.toFixed(1)};
  vH = h;
  vWorld = vec3(position.x, y, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, y, position.z, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlphaScale;
uniform vec4 uRipples[6]; // xy: center, z: start time, w: strength

varying float vH;
varying vec3 vWorld;

// woven dot-grid texture (0.8m cells in world space) - the surface reads as a
// luminous mesh, not a flat sheet
float dotGrid(vec2 xz) {
  vec2 g = fract(xz * 1.25) - 0.5;
  return smoothstep(0.22, 0.06, length(g));
}

void main() {
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(normal, viewDir)), 2.0);

  // flats near-invisible, peaks glow hard enough to bloom
  vec3 col = uColor * (0.05 + vH * 1.2) + uColor * fres * 0.4;

  // dot weave brightens with height: fabric of light on the mounds
  float dots = dotGrid(vWorld.xz);
  col += uColor * dots * (0.10 + vH * 0.9);

  // white-hot core at the very peaks: heat reads instantly, weave shows through
  col = mix(col, vec3(1.2, 1.28, 1.45), smoothstep(0.78, 1.0, vH) * 0.6);

  float ring = 0.0;
  for (int i = 0; i < 6; i++) {
    float age = uTime - uRipples[i].z;
    if (uRipples[i].w > 0.001 && age >= 0.0 && age <= 1.5) {
      float radius = age * 10.0;
      float d = distance(vWorld.xz, uRipples[i].xy);
      ring += smoothstep(1.4, 0.0, abs(d - radius)) * (1.0 - age / 1.5) * uRipples[i].w;
    }
  }
  col += uColor * ring * 1.8;
  float alpha = clamp(0.06 + vH * 0.28 + dots * vH * 0.10 + fres * 0.10 + ring * 0.35, 0.0, 0.72) * uAlphaScale;
  gl_FragColor = vec4(col, alpha);
}
`;

interface TeamTerrainProps {
  participant: 1 | 2;
  glow: string;
  baseY: number;
  mirror: 1 | -1;
}

function makeMaterial(mirror: number, baseY: number, glow: string) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uZones: { value: new THREE.Vector3(0, 0, 0) },
      uMirror: { value: mirror },
      uBaseY: { value: baseY },
      uColor: { value: new THREE.Color(glow) },
      uAlphaScale: { value: 1.0 },
      uRipples: {
        value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -10, 0)),
      },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function TeamTerrain({ participant, glow, baseY, mirror }: TeamTerrainProps) {
  const material = useMemo(
    () => makeMaterial(mirror, baseY, glow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(PITCH.length, PITCH.width, 128, 64);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const current = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const { match } = useAppStore.getState();
    const nowS = performance.now() / 1000;

    // target zones from the state currently driving the scene
    const view = currentViewFrame();
    const key = participant === 1 ? "participant1" : "participant2";
    const zones = view?.state.pressure[key];
    const maxSeen = view?.maxSeen ?? 1;
    const target = rippleScratchTarget;
    target.set(
      normPressure(zones?.defensive ?? 0, maxSeen),
      normPressure(zones?.middle ?? 0, maxSeen),
      normPressure(zones?.attacking ?? 0, maxSeen)
    );

    // tween: ~1.2s ease on live updates, ~0.3s while scrubbing
    const tau = match.mode === "replay" ? 0.075 : 0.3;
    const a = 1 - Math.exp(-Math.min(delta, 0.1) / tau);
    current.current.lerp(target, a);

    material.uniforms.uTime.value = nowS;
    (material.uniforms.uZones.value as THREE.Vector3).copy(current.current);

    // ambient ripples for this team + takeover shockwave
    const slots = material.uniforms.uRipples.value as THREE.Vector4[];
    for (let i = 0; i < 6; i++) slots[i].set(0, 0, -10, 0);
    let slot = 0;
    for (const ripple of match.ripples) {
      if (ripple.participant !== participant || slot >= 6) continue;
      const age = nowS - ripple.startedAt / 1000;
      if (age < 0 || age > 1.5) continue;
      slots[slot].set(ripple.x, ripple.z, ripple.startedAt / 1000, 1);
      slot += 1;
    }
    const takeover = match.activeTakeover;
    if (takeover?.fxStartedAt != null && takeover.variant === "full" && slot < 6) {
      const ageMs = performance.now() - takeover.fxStartedAt;
      if (ageMs < 1500) {
        const x = takeover.moment.participant === 1 ? 40 : -40;
        slots[slot].set(x, 0, takeover.fxStartedAt / 1000, 1.6);
      }
    }
  });

  return <mesh geometry={geometry} material={material} renderOrder={participant} />;
}

const rippleScratchTarget = new THREE.Vector3();

/**
 * Territorial wash: a woven overlay lying on the pitch, tinted per zone by
 * which team leads the pressure there - the pitch itself shows who owns the
 * territory. Same six scalars as the mounds, same tweens.
 */
const WASH_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = vec3(position.x, 0.0, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WASH_FRAG = /* glsl */ `
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uZones1;
uniform vec3 uZones2;

varying vec3 vWorld;

float prof(vec3 z, float xt) {
  float d0 = (xt + 35.0) / 22.0;
  float d1 = xt / 22.0;
  float d2 = (xt - 35.0) / 22.0;
  return z.x * exp(-d0 * d0) + z.y * exp(-d1 * d1) + z.z * exp(-d2 * d2);
}

float dotGrid(vec2 xz) {
  vec2 g = fract(xz * 1.25) - 0.5;
  return smoothstep(0.22, 0.06, length(g));
}

void main() {
  float p1 = prof(uZones1, vWorld.x);
  float p2 = prof(uZones2, -vWorld.x);
  float lead = p1 - p2;
  vec3 col = lead >= 0.0 ? uColor1 : uColor2;
  float strength = clamp(abs(lead), 0.0, 1.2);
  float dots = dotGrid(vWorld.xz);
  vec3 outCol = col * (0.22 + strength * 0.85) + col * dots * strength * 0.55;
  float alpha = clamp(strength * 0.20 + dots * strength * 0.09, 0.0, 0.30);
  gl_FragColor = vec4(outCol, alpha);
}
`;

function TerritoryWash({ glow1, glow2 }: { glow1: string; glow2: string }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: WASH_VERT,
        fragmentShader: WASH_FRAG,
        uniforms: {
          uColor1: { value: new THREE.Color(glow1) },
          uColor2: { value: new THREE.Color(glow2) },
          uZones1: { value: new THREE.Vector3(0, 0, 0) },
          uZones2: { value: new THREE.Vector3(0, 0, 0) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(PITCH.length, PITCH.width, 128, 64);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const current1 = useRef(new THREE.Vector3(0, 0, 0));
  const current2 = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((_, delta) => {
    const { match } = useAppStore.getState();
    const view = currentViewFrame();
    const maxSeen = view?.maxSeen ?? 1;
    const tau = match.mode === "replay" ? 0.075 : 0.3;
    const a = 1 - Math.exp(-Math.min(delta, 0.1) / tau);

    const z1 = view?.state.pressure.participant1;
    const z2 = view?.state.pressure.participant2;
    rippleScratchTarget.set(
      normPressure(z1?.defensive ?? 0, maxSeen),
      normPressure(z1?.middle ?? 0, maxSeen),
      normPressure(z1?.attacking ?? 0, maxSeen)
    );
    current1.current.lerp(rippleScratchTarget, a);
    rippleScratchTarget.set(
      normPressure(z2?.defensive ?? 0, maxSeen),
      normPressure(z2?.middle ?? 0, maxSeen),
      normPressure(z2?.attacking ?? 0, maxSeen)
    );
    current2.current.lerp(rippleScratchTarget, a);

    (material.uniforms.uZones1.value as THREE.Vector3).copy(current1.current);
    (material.uniforms.uZones2.value as THREE.Vector3).copy(current2.current);
  });

  return <mesh geometry={geometry} material={material} position={[0, 0.06, 0]} renderOrder={0} />;
}

export function Terrain({ glow1, glow2 }: { glow1: string; glow2: string }) {
  return (
    <group>
      <TerritoryWash glow1={glow1} glow2={glow2} />
      <TeamTerrain participant={1} glow={glow1} baseY={0.3} mirror={1} />
      <TeamTerrain participant={2} glow={glow2} baseY={0.6} mirror={-1} />
    </group>
  );
}
