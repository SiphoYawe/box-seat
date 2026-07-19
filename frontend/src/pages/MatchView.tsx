import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAppStore } from "../state/store.js";
import { metaFromList } from "../lib/meta.js";
import { startDemoLive, startDemoReplay, stopDemoLive } from "../lib/demo.js";
import { MatchScene } from "../scene/MatchScene.js";
import { HudOverlay } from "../hud/HudOverlay.js";
import { TakeoverLayer } from "../hud/Takeover.js";
import { LegendOverlay } from "../hud/LegendOverlay.js";
import { FormationOverlay } from "../hud/FormationOverlay.js";
import { LeanBack } from "../hud/LeanBack.js";

/**
 * The match view: one 3D scene serving both live and replay, plus the 2D HUD
 * and the key-moment takeover layer. ?demo=1 bypasses the WebSocket and feeds
 * the synthetic match through the exact same pipeline (&live=1 simulates live).
 */
export function MatchView() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const fixtureId = Number(params.fixtureId);
  const demo = searchParams.get("demo") === "1";
  const demoLive = searchParams.get("live") === "1";

  useEffect(() => {
    if (!Number.isFinite(fixtureId)) return;
    const store = useAppStore.getState();
    store.enterMatch(fixtureId, { demo, demoLive });
    if (demo) {
      if (demoLive) startDemoLive(fixtureId);
      else {
        startDemoReplay(fixtureId);
        // debug/demo helper: ?minute=61 lands the playhead mid-match
        const minute = Number(searchParams.get("minute"));
        if (Number.isFinite(minute) && minute > 0) {
          const { replay } = useAppStore.getState().match;
          if (replay) {
            const ts = replay.kickoffTs + (minute <= 45 ? minute : minute + 15) * 60000;
            useAppStore.getState().setPlayhead(ts, { manual: true });
          }
        }
      }
    }
    return () => {
      stopDemoLive();
      useAppStore.getState().leaveMatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, demo, demoLive]);

  // replay auto-play driver: advances the shared playhead
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      useAppStore.getState().advancePlayhead(now - last);
      last = now;
    }, 50);
    return () => clearInterval(id);
  }, []);

  if (!Number.isFinite(fixtureId)) {
    return (
      <div className="h-[100dvh] flex items-center justify-center text-muted">
        Unknown fixture
      </div>
    );
  }

  const fixtures = useAppStore((s) => s.fixtures);
  const meta = metaFromList(fixtures, fixtureId, { demo });

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-ink">
      <MatchScene />
      <HudOverlay meta={meta} />
      <LegendOverlay />
      <FormationOverlay meta={meta} />
      <TakeoverLayer />
      <LeanBack meta={meta} />
    </div>
  );
}
