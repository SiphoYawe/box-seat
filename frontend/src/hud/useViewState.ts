import { useEffect, useState } from "react";
import { currentViewFrame, type ViewFrame } from "../scene/sceneUtils.js";

/**
 * HUD-safe polling of the scene-driving state. The playhead moves at frame
 * rate during auto-play, so HUD widgets poll at a few Hz instead of
 * subscribing to the store (which would re-render per frame).
 */
export function useViewState(intervalMs = 200): ViewFrame | null {
  const [view, setView] = useState<ViewFrame | null>(null);
  useEffect(() => {
    const update = () => setView(currentViewFrame());
    update();
    const id = setInterval(update, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return view;
}

/** Ticking wall-clock for the live match clock. */
export function useNow(stepMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
