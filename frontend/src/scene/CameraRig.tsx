import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useAppStore } from "../state/store.js";

/**
 * Broadcast-gantry camera. Three curated presets (cycled from the HUD) are
 * the default UX; free orbit/zoom stays available, double-click returns to
 * the Broadcast preset. 20s idle in live mode starts a slow auto-orbit,
 * key-moment takeovers get a 300ms FOV punch.
 */

export const CAMERA_PRESETS = [
  { name: "Broadcast", pos: new THREE.Vector3(0, 55, 85), target: new THREE.Vector3(0, 2, 0) },
  { name: "Tactical", pos: new THREE.Vector3(0, 135, 0.01), target: new THREE.Vector3(0, 0, 0) },
  { name: "Corner", pos: new THREE.Vector3(60, 7, 42), target: new THREE.Vector3(45, 2, 20) },
] as const;

const BASE_FOV = 45;
const DRIFT_DELAY_MS = 20_000;
const DRIFT_SPEED = 0.19; // ~0.02 rad/s with OrbitControls' autoRotate scale

interface CameraTween {
  t0: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
}

/** Low behind-the-goal-line spot for goal-cam replays. */
function goalCamPose(end: 1 | -1): { pos: THREE.Vector3; target: THREE.Vector3 } {
  return {
    pos: new THREE.Vector3(end * 64, 4.5, 16),
    target: new THREE.Vector3(end * 52.5, 2.5, 0),
  };
}

export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const presetIndex = useAppStore((s) => s.cameraPreset);

  const lastInputAt = useRef(performance.now());
  const tween = useRef<CameraTween | null>(null);
  const mountedAt = useRef(performance.now());
  const goalCamHeld = useRef(false);
  const goalCamCancelled = useRef(false);

  const startTween = (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
    const controls = controlsRef.current;
    if (!controls) return;
    tween.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos,
      toTarget,
    };
  };

  // goal-cam: swing behind the goal line while an instant replay rolls,
  // swing back when it ends. Any user orbit during it cancels the hold.
  useFrame(() => {
    const { match } = useAppStore.getState();
    const ir = match.instantReplay;
    if (ir && !goalCamHeld.current && !goalCamCancelled.current) {
      const pose = goalCamPose(ir.goalEnd);
      startTween(pose.pos, pose.target);
      goalCamHeld.current = true;
    } else if (!ir && goalCamHeld.current) {
      goalCamHeld.current = false;
      goalCamCancelled.current = false;
      const preset = CAMERA_PRESETS[presetIndex % CAMERA_PRESETS.length];
      startTween(preset.pos.clone(), preset.target.clone());
    }
  });

  // preset changes tween the camera (skip the initial mount - already there)
  useEffect(() => {
    if (performance.now() - mountedAt.current < 500) return;
    const controls = controlsRef.current;
    if (!controls) return;
    const preset = CAMERA_PRESETS[presetIndex % CAMERA_PRESETS.length];
    tween.current = {
      t0: performance.now(),
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: preset.pos.clone(),
      toTarget: preset.target.clone(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetIndex]);

  useEffect(() => {
    const dom = gl.domElement;
    const onInput = () => {
      lastInputAt.current = performance.now();
      tween.current = null;
      if (goalCamHeld.current) goalCamCancelled.current = true;
    };
    const onReset = () => {
      useAppStore.getState().setCameraPreset(0);
    };
    dom.addEventListener("pointerdown", onInput);
    dom.addEventListener("wheel", onInput, { passive: true });
    dom.addEventListener("dblclick", onReset);
    return () => {
      dom.removeEventListener("pointerdown", onInput);
      dom.removeEventListener("wheel", onInput);
      dom.removeEventListener("dblclick", onReset);
    };
  }, [gl]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const now = performance.now();
    const { match } = useAppStore.getState();

    // preset/reset tween (~0.8s ease-out)
    if (tween.current) {
      const t = Math.min(1, (now - tween.current.t0) / 800);
      const e = 1 - Math.pow(1 - t, 3);
      camera.position.lerpVectors(tween.current.fromPos, tween.current.toPos, e);
      controls.target.lerpVectors(tween.current.fromTarget, tween.current.toTarget, e);
      if (t >= 1) tween.current = null;
    }

    // keep the pan target inside the stadium so the pitch can't be lost
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -70, 70);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -50, 50);
    controls.target.y = THREE.MathUtils.clamp(controls.target.y, 0, 18);

    // takeover punch: 300ms FOV kick, eased back out (full takeovers only)
    let punch = 0;
    const takeover = match.activeTakeover;
    if (takeover?.fxStartedAt != null && takeover.variant === "full") {
      const age = now - takeover.fxStartedAt;
      const span = takeover.compressed ? 900 : 1600;
      if (age < span) {
        const rise = takeover.compressed ? 120 : 300;
        punch =
          age < rise
            ? age / rise
            : age > span * 0.55
              ? Math.max(0, 1 - (age - span * 0.55) / (span * 0.45))
              : 1;
      }
    }
    camera.fov = BASE_FOV - punch * 9;
    camera.updateProjectionMatrix();

    // idle drift in live mode only (never during goal-cam); the final whistle
    // earns a slow celebratory orbit while its card plays
    const ftCelebration = takeover?.moment.type === "full_time";
    const idle = now - lastInputAt.current > DRIFT_DELAY_MS;
    controls.autoRotate =
      (ftCelebration && !goalCamHeld.current) ||
      (match.mode === "live" && idle && !tween.current && punch === 0 && !goalCamHeld.current);
    controls.autoRotateSpeed = ftCelebration ? 0.5 : DRIFT_SPEED;
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={25}
      maxDistance={160}
      maxPolarAngle={THREE.MathUtils.degToRad(85)}
      enablePan
      panSpeed={0.8}
      screenSpacePanning={false}
      target={CAMERA_PRESETS[0].target.toArray()}
    />
  );
}
