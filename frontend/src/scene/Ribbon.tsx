import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, Text } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useAppStore } from "../state/store.js";
import type { KeyMoment } from "../reducer/types.js";
import { decimate, type MomentumSample } from "../lib/reconstruct.js";
import {
  PITCH,
  ribbonDomain,
  tsToX,
  xToTs,
  replayMinuteLabel,
  type RibbonDomain,
} from "./sceneUtils.js";
import { getTeam, getTeamGlow } from "../lib/teams.js";
import { metaFromList } from "../lib/meta.js";
import { BARLOW_CONDENSED_600 } from "./fonts.js";

/**
 * The momentum ribbon: a vertical glowing band high above the terrain. x =
 * match time across the pitch length, vertical deflection = momentum (up =
 * participant1 dominant). It is the match's heartbeat drawn in the air - and
 * the replay scrub control.
 */

const RIBBON_Y = PITCH.ribbonBaseY;
const RIBBON_H = 1.4;
const DIM = 0.25;

interface RibbonGeometryData {
  geometry: THREE.BufferGeometry;
  baseColors: Float32Array;
  vertexTs: Float32Array;
  head: THREE.Vector3 | null;
  samples: MomentumSample[];
}

function teamGlows(
  fixtureId: number | null,
  fixtures: import("../state/store.js").FixtureListEntry[],
  demo: boolean
): [string, string] {
  const meta = fixtureId != null ? metaFromList(fixtures, fixtureId, { demo }) : null;
  const g1 = meta ? getTeamGlow(getTeam(meta.participant1)) : "#8A93A6";
  const g2 = meta ? getTeamGlow(getTeam(meta.participant2)) : "#8A93A6";
  return [g1, g2];
}

function buildRibbon(
  samples: MomentumSample[],
  domain: RibbonDomain,
  glow1: string,
  glow2: string
): RibbonGeometryData | null {
  const pts = samples
    .filter((s) => s.t >= domain.kickoffTs)
    .map(
      (s) =>
        new THREE.Vector3(
          tsToX(s.t, domain),
          RIBBON_Y + THREE.MathUtils.clamp(s.m, -1, 1) * PITCH.ribbonHeight,
          0
        )
    );
  if (pts.length < 2) return null;

  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  const divisions = Math.min(240, Math.max(32, pts.length));
  const sampled = curve.getPoints(divisions);
  // Catmull-Rom overshoots between wide-spaced points; keep the band inside
  // its sanctioned y band (always clear of the terrain peaks)
  for (const p of sampled) {
    p.y = THREE.MathUtils.clamp(p.y, RIBBON_Y - PITCH.ribbonHeight + 0.1, RIBBON_Y + PITCH.ribbonHeight - 0.1);
  }
  const n = sampled.length;

  const positions = new Float32Array(n * 2 * 3);
  const baseColors = new Float32Array(n * 2 * 3);
  const vertexTs = new Float32Array(n * 2);
  const indices: number[] = [];

  const c1 = new THREE.Color(glow1);
  const c2 = new THREE.Color(glow2);
  const white = new THREE.Color("#F4F7FF");
  const edge = new THREE.Color();

  for (let i = 0; i < n; i++) {
    const p = sampled[i];
    const m = THREE.MathUtils.clamp((p.y - RIBBON_Y) / PITCH.ribbonHeight, -1, 1);

    // fill from the centerline out to the wave: dominance reads as AREA.
    // vertex 0 sits on the guide line (dim), vertex 1 on the wave (glowing).
    positions.set([p.x, RIBBON_Y, 0], i * 6);
    positions.set([p.x, p.y, 0], i * 6 + 3);

    // near-saturated team color as soon as one side leads, white only when
    // the contest is genuinely even
    const dominance = Math.min(1, Math.abs(m) * 2.2 + 0.12);
    if (m >= 0) edge.copy(white).lerp(c1, dominance);
    else edge.copy(white).lerp(c2, dominance);

    baseColors.set([edge.r * 0.12, edge.g * 0.12, edge.b * 0.12], i * 6);
    baseColors.set([edge.r * 1.5, edge.g * 1.5, edge.b * 1.5], i * 6 + 3);

    const ts = xToTs(p.x, domain);
    vertexTs[i * 2] = ts;
    vertexTs[i * 2 + 1] = ts;

    if (i < n - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(baseColors.slice(), 3));
  geometry.setIndex(indices);

  return { geometry, baseColors, vertexTs, head: pts[pts.length - 1], samples };
}

/** Minute ticks along the guide line: 15' HT 60' 90'. */
const TICKS: Array<{ minute: number; label: string }> = [
  { minute: 15, label: "15'" },
  { minute: 45, label: "HT" },
  { minute: 60, label: "60'" },
  { minute: 90, label: "90'" },
];

function GuideAndTicks({
  domain,
  code1,
  code2,
  glow1,
  glow2,
}: {
  domain: RibbonDomain;
  code1: string;
  code2: string;
  glow1: string;
  glow2: string;
}) {
  return (
    <group>
      <Line
        points={[
          [-PITCH.halfX, RIBBON_Y, 0],
          [PITCH.halfX, RIBBON_Y, 0],
        ]}
        color="#3A455E"
        dashed
        dashSize={1.2}
        gapSize={0.8}
        transparent
        opacity={0.5}
        lineWidth={1}
      />
      {/* team codes pin the direction legend to both ends: up = team1 */}
      {[-PITCH.halfX - 1.6, PITCH.halfX + 1.6].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Text
            position={[0, RIBBON_Y + 1.7, 0]}
            fontSize={1.5}
            color={glow1}
            font={BARLOW_CONDENSED_600}
            anchorX="center"
            anchorY="middle"
          >
            {code1}
          </Text>
          <Text
            position={[0, RIBBON_Y - 1.7, 0]}
            fontSize={1.5}
            color={glow2}
            font={BARLOW_CONDENSED_600}
            anchorX="center"
            anchorY="middle"
          >
            {code2}
          </Text>
        </group>
      ))}
      {TICKS.map(({ minute, label }) => {
        const ts = domain.kickoffTs + (minute <= 45 ? minute : minute + 15) * 60000;
        if (ts > domain.endTs + 60000) return null;
        const x = tsToX(ts, domain);
        return (
          <group key={label} position={[x, 0, 0]}>
            <Line
              points={[
                [0, RIBBON_Y - 0.5, 0],
                [0, RIBBON_Y + 0.5, 0],
              ]}
              color="#3A455E"
              transparent
              opacity={0.6}
              lineWidth={1}
            />
            <Text
              position={[0, RIBBON_Y - 1.7, 0]}
              fontSize={1.5}
              color="#8A93A6"
              font={BARLOW_CONDENSED_600}
              anchorX="center"
              anchorY="middle"
            >
              {label}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

/** Canvas-drawn glyph textures so markers read at a glance: ball, cards, VAR. */
function glyphTexture(kind: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  if (kind === "goal") {
    ctx.font = "92px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚽", 64, 70);
  } else if (kind === "red_card" || kind === "yellow_card") {
    ctx.fillStyle = kind === "red_card" ? "#E30613" : "#F7D117";
    ctx.beginPath();
    ctx.roundRect(38, 22, 52, 84, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 4;
    ctx.stroke();
  } else if (kind === "pen_scored" || kind === "pen_missed") {
    ctx.fillStyle = kind === "pen_scored" ? "#2ECC71" : "#E30613";
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (kind === "pen_scored") {
      ctx.moveTo(40, 66);
      ctx.lineTo(58, 86);
      ctx.lineTo(92, 44);
    } else {
      ctx.moveTo(44, 44);
      ctx.lineTo(84, 84);
      ctx.moveTo(84, 44);
      ctx.lineTo(44, 84);
    }
    ctx.stroke();
  } else {
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFB300";
    ctx.fillText("VAR", 64, 66);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glyphTextures: Record<string, THREE.Texture> = {};
function getGlyphTexture(kind: string): THREE.Texture {
  return (glyphTextures[kind] ??= glyphTexture(kind));
}

/** Corner/shot notches on a track just under the ribbon wave (replay only). */
function TimelineTicks({
  events,
  domain,
  glow1,
  glow2,
}: {
  events: import("../reducer/types.js").RawScoreEvent[];
  domain: RibbonDomain;
  glow1: string;
  glow2: string;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const tmp = new THREE.Color();
    let i = 0;
    for (const e of events) {
      if (e.ts < domain.kickoffTs || e.ts > domain.endTs) continue;
      const isCorner = e.action === "corner";
      const isShot = e.action === "shot";
      if (!isCorner && !isShot) continue;
      const outcome = (e.data?.Outcome ?? e.data?.outcome) as string | undefined;
      const woodwork = isShot && outcome === "Woodwork";
      const glow = e.participant === 1 ? glow1 : e.participant === 2 ? glow2 : "#8A93A6";
      tmp.set(woodwork ? "#FFB300" : isShot ? "#E6EAF2" : glow);
      const size = woodwork ? 0.5 : isShot ? 0.32 : 0.26;
      const x = tsToX(e.ts, domain);
      const y = RIBBON_Y - 1.15;
      positions.push(x - size, y - size, 0, x + size, y - size, 0, x + size, y + size, 0, x - size, y + size, 0);
      const boost = woodwork ? 1.6 : 1.1;
      for (let v = 0; v < 4; v++) colors.push(tmp.r * boost, tmp.g * boost, tmp.b * boost);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      i += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    g.setIndex(indices);
    return g;
  }, [events, domain, glow1, glow2]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

function MomentMarker({
  moment,
  x,
  y,
  glow,
  clickable,
  onJump,
}: {
  moment: KeyMoment;
  x: number;
  y: number;
  glow: string;
  clickable: boolean;
  onJump: (ts: number) => void;
}) {
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!clickable) return;
    e.stopPropagation();
    onJump(moment.ts);
  };
  return (
    <group position={[x, y, 0]} onClick={handleClick}>
      {/* 3D beacon shape + a glanceable glyph sprite above it */}
      <sprite position={[0, 1.7, 0]} scale={[1.7, 1.7, 1]}>
        <spriteMaterial
          map={getGlyphTexture(moment.type)}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      {moment.type === "goal" && (
        <mesh>
          <torusGeometry args={[0.6, 0.09, 12, 32]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
      )}
      {moment.type === "red_card" && (
        <mesh rotation={[0, 0, 0.28]}>
          <boxGeometry args={[0.42, 0.62, 0.06]} />
          <meshBasicMaterial color="#E30613" toneMapped={false} />
        </mesh>
      )}
      {moment.type === "var_overturned" && (
        <mesh>
          <octahedronGeometry args={[0.45]} />
          <meshBasicMaterial color="#FFB300" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

export function Ribbon() {
  const mode = useAppStore((s) => s.match.mode);
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const fixtures = useAppStore((s) => s.fixtures);
  const demo = useAppStore((s) => s.demo);
  const replay = useAppStore((s) => s.match.replay);
  const momentumHistory = useAppStore((s) => s.match.momentumHistory);

  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  const [hover, setHover] = useState<{ x: number; ts: number } | null>(null);
  const dragging = useRef(false);
  const dimmedFor = useRef<number>(Number.NaN);
  const meshRef = useRef<THREE.Mesh>(null);
  const playheadBeam = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);

  const domain = ribbonDomain();
  const [glow1, glow2] = teamGlows(fixtureId, fixtures, demo);
  const meta = fixtureId != null ? metaFromList(fixtures, fixtureId, { demo }) : null;
  const code1 = meta ? getTeam(meta.participant1).code : "TM1";
  const code2 = meta ? getTeam(meta.participant2).code : "TM2";

  const data = useMemo(() => {
    if (!domain) return null;
    const samples = decimate(
      mode === "replay" && replay ? replay.samples : momentumHistory,
      400
    );
    return buildRibbon(samples, domain, glow1, glow2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, replay, momentumHistory, domain?.kickoffTs, domain?.domainMs, glow1, glow2]);

  const keyMoments = useMemo(() => {
    if (mode === "replay" && replay) {
      return replay.frames[replay.frames.length - 1]?.state.keyMoments ?? [];
    }
    return useAppStore.getState().match.latest?.keyMoments ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, replay, momentumHistory]);

  // per-frame: dim future vertices, move the playhead beam, pulse the live head
  useFrame(({ clock }) => {
    const { match } = useAppStore.getState();
    const playhead = match.playheadTs;

    if (data && meshRef.current) {
      const dimTarget = match.mode === "replay" && playhead !== null ? playhead : Number.POSITIVE_INFINITY;
      if (dimTarget !== dimmedFor.current) {
        dimmedFor.current = dimTarget;
        const attr = data.geometry.getAttribute("color") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const inf = dimTarget === Number.POSITIVE_INFINITY;
        for (let i = 0; i < data.vertexTs.length; i++) {
          const f = inf || data.vertexTs[i] <= dimTarget ? 1 : DIM;
          arr[i * 3] = data.baseColors[i * 3] * f;
          arr[i * 3 + 1] = data.baseColors[i * 3 + 1] * f;
          arr[i * 3 + 2] = data.baseColors[i * 3 + 2] * f;
        }
        attr.needsUpdate = true;
      }
    }

    if (playheadBeam.current && domain) {
      playheadBeam.current.visible = match.mode === "replay" && playhead !== null;
      if (playhead !== null) playheadBeam.current.position.x = tsToX(playhead, domain);
    }

    if (headRef.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 3.2) * 0.18;
      headRef.current.scale.setScalar(s);
    }
  });

  const commit = (x: number) => {
    if (!domain) return;
    useAppStore.getState().setPlayhead(xToTs(x, domain), { manual: true });
  };

  if (!domain) return <group />;

  const momentY = (ts: number): number => {
    if (!data || data.samples.length === 0) return RIBBON_Y;
    let best = data.samples[0];
    for (const s of data.samples) {
      if (Math.abs(s.t - ts) < Math.abs(best.t - ts)) best = s;
    }
    return RIBBON_Y + THREE.MathUtils.clamp(best.m, -1, 1) * PITCH.ribbonHeight;
  };

  return (
    <group>
      <GuideAndTicks domain={domain} code1={code1} code2={code2} glow1={glow1} glow2={glow2} />

      {data && (
        <mesh ref={meshRef} geometry={data.geometry}>
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={0.88}
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* live head: the brightest object in the scene */}
      {mode === "live" && data?.head && (
        <mesh ref={headRef} position={data.head}>
          <sphereGeometry args={[0.55, 16, 16]} />
          <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
        </mesh>
      )}

      {/* corner/shot notches under the wave (replay only) */}
      {mode === "replay" && replay && (
        <TimelineTicks events={replay.events} domain={domain} glow1={glow1} glow2={glow2} />
      )}

      {/* shootout penalty beacons: scored = green check, missed = red cross */}
      {mode === "replay" &&
        replay &&
        replay.events
          .filter(
            (e, idx, arr) =>
              e.action === "penalty_outcome" &&
              e.ts >= domain.kickoffTs &&
              e.ts <= domain.endTs &&
              arr.findIndex((o) => o.action === "penalty_outcome" && (o.id ?? o.seq) === (e.id ?? e.seq)) === idx
          )
          .map((e) => {
            const scored = (e.data?.Outcome as string | undefined) === "Scored";
            return (
              <group key={`po${e.seq}`} position={[tsToX(e.ts, domain), momentY(e.ts), 0]}>
                <sprite position={[0, 1.6, 0]} scale={[1.4, 1.4, 1]}>
                  <spriteMaterial
                    map={getGlyphTexture(scored ? "pen_scored" : "pen_missed")}
                    transparent
                    depthWrite={false}
                    toneMapped={false}
                  />
                </sprite>
                <mesh>
                  <torusGeometry args={[0.4, 0.06, 10, 24]} />
                  <meshBasicMaterial color={scored ? "#2ECC71" : "#E30613"} toneMapped={false} />
                </mesh>
              </group>
            );
          })}

      {/* yellow-card incident markers (replay only) */}
      {mode === "replay" &&
        replay &&
        replay.events
          .filter((e) => e.action === "yellow_card" && e.ts >= domain.kickoffTs && e.ts <= domain.endTs)
          .map((e) => {
            const p = e.participant ?? (e.data?.Participant as number | undefined);
            return (
              <group key={`y${e.seq}`} position={[tsToX(e.ts, domain), momentY(e.ts), 0]}>
                <sprite position={[0, 1.5, 0]} scale={[1.25, 1.25, 1]}>
                  <spriteMaterial
                    map={getGlyphTexture("yellow_card")}
                    transparent
                    depthWrite={false}
                    toneMapped={false}
                  />
                </sprite>
                <mesh rotation={[0, 0, 0.28]}>
                  <boxGeometry args={[0.34, 0.5, 0.05]} />
                  <meshBasicMaterial color="#F7D117" toneMapped={false} />
                </mesh>
              </group>
            );
          })}

      {/* key-moment markers on the ribbon */}
      {data &&
        keyMoments.map((km) => {
          const x = tsToX(km.ts, domain);
          return (
            <MomentMarker
              key={`${km.type}:${km.seq}`}
              moment={km}
              x={x}
              y={momentY(km.ts)}
              glow={km.participant === 1 ? glow1 : glow2}
              clickable={mode === "replay"}
              onJump={(ts) => useAppStore.getState().setPlayhead(ts, { manual: true })}
            />
          );
        })}

      {/* committed playhead beam (replay) */}
      <group ref={playheadBeam} visible={false}>
        <mesh position={[0, RIBBON_Y / 2, 0]}>
          <boxGeometry args={[0.18, RIBBON_Y, 0.18]} />
          <meshBasicMaterial
            color="#DCE6FF"
            transparent
            opacity={0.5}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, RIBBON_Y, 0]}>
          <sphereGeometry args={[0.42, 16, 16]} />
          <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
        </mesh>
      </group>

      {/* hover ghost beam + minute label (replay scrub) */}
      {mode === "replay" && hover && (
        <group position={[hover.x, 0, 0]}>
          <mesh position={[0, RIBBON_Y / 2, 0]}>
            <boxGeometry args={[0.12, RIBBON_Y, 0.12]} />
            <meshBasicMaterial
              color="#BFD4FF"
              transparent
              opacity={0.28}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <Text
            position={[0, RIBBON_Y + 2.2, 0]}
            fontSize={1.4}
            color="#DCE6FF"
            font={BARLOW_CONDENSED_600}
            anchorX="center"
            anchorY="middle"
          >
            {replayMinuteLabel(hover.ts)}
          </Text>
        </group>
      )}

      {/* invisible scrub proxy: easy to hit, drag to scrub */}
      {mode === "replay" && (
        <mesh
          position={[0, RIBBON_Y, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            dragging.current = true;
            if (controls) controls.enabled = false;
            (e.target as Element).setPointerCapture?.(e.pointerId);
            commit(e.point.x);
          }}
          onPointerMove={(e) => {
            const x = THREE.MathUtils.clamp(e.point.x, -PITCH.halfX, PITCH.halfX);
            setHover({ x, ts: xToTs(x, domain) });
            if (dragging.current) commit(x);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            if (controls) controls.enabled = true;
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <planeGeometry args={[PITCH.length, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
