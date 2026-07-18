import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Pitch, WeatherFx } from "./Pitch.js";
import { Terrain } from "./Terrain.js";
import { Ribbon } from "./Ribbon.js";
import { CameraRig } from "./CameraRig.js";
import { useAppStore } from "../state/store.js";
import { metaFromList } from "../lib/meta.js";
import { getTeam, getTeamGlow } from "../lib/teams.js";

/**
 * The one scene, one canvas, one bloom pass. Stadium at night: near-black
 * world, the pitch/terrain/ribbon are the light sources. Everything important
 * is emissive; the HUD lives in DOM outside the canvas.
 */
export function MatchScene() {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const fixtures = useAppStore((s) => s.fixtures);
  const demo = useAppStore((s) => s.demo);
  const meta = fixtureId != null ? metaFromList(fixtures, fixtureId, { demo }) : null;
  const glow1 = meta ? getTeamGlow(getTeam(meta.participant1)) : "#8A93A6";
  const glow2 = meta ? getTeamGlow(getTeam(meta.participant2)) : "#8A93A6";

  return (
    <Canvas
      key={fixtureId ?? "none"}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      camera={{ fov: 45, near: 0.1, far: 1200, position: [0, 55, 85] }}
      shadows={false}
      style={{ position: "absolute", inset: 0 }}
    >
      <color attach="background" args={["#05070C"]} />
      <fog attach="fog" args={["#05070C", 80, 400]} />
      <ambientLight intensity={0.25} color="#B9C8E8" />
      <directionalLight position={[30, 80, 20]} intensity={0.5} color="#DCE6F5" />

      <Pitch />
      <WeatherFx />
      <Terrain glow1={glow1} glow2={glow2} />
      <Ribbon />
      <CameraRig />

      <EffectComposer>
        <Bloom
          mipmapBlur
          luminanceThreshold={0.5}
          luminanceSmoothing={0.15}
          intensity={0.95}
          radius={0.72}
        />
      </EffectComposer>
    </Canvas>
  );
}
