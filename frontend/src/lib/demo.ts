import type { RawScoreEvent } from "../reducer/types.js";
import { initialMatchState } from "../reducer/types.js";
import { reduce } from "../reducer/reducer.js";
import { demoIngestState, demoLoadReplay, useAppStore } from "../state/store.js";
import demoEvents from "../data/demo-match.json";

const DEMO_SPEED = 60; // simulated-live playback rate
const DEMO_FIXTURE_ID = 14790158;

let liveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Demo events are authored against a fictional kickoff date. Shift them so
 * kickoff lands at "now" on load - the live clock and live ribbon domain
 * (both wall-clock anchored) then tick naturally in simulated-live mode.
 */
export function getDemoEvents(): RawScoreEvent[] {
  const events = demoEvents as RawScoreEvent[];
  const kickoff = events.find((e) => e.action === "kickoff")?.ts ?? events[0]?.ts ?? 0;
  const shift = Date.now() - kickoff;
  return events.map((e) => ({ ...e, ts: e.ts + shift }));
}

/** Instant finished match: reconstruction -> replay mode (the default demo). */
export function startDemoReplay(fixtureId: number): void {
  stopDemoLive();
  const events = getDemoEvents().map((e) => ({ ...e, fixtureId }));
  demoLoadReplay(events);
}

/**
 * Simulated live: the synthetic events stream through the exact live pipeline
 * (reduce -> ingestState) at 60x, so live mode is demoable without a backend.
 */
export function startDemoLive(fixtureId: number): void {
  stopDemoLive();
  const events = getDemoEvents().map((e) => ({ ...e, fixtureId }));
  if (events.length === 0) return;
  let state = initialMatchState(fixtureId);
  let i = 0;
  const t0 = Date.now();

  const step = () => {
    const event = events[i];
    if (!event) return;
    state = reduce(state, event);
    demoIngestState(state);
    i += 1;
    const next = events[i];
    if (!next) return;
    const delay = Math.max(16, (next.ts - event.ts) / DEMO_SPEED);
    liveTimer = setTimeout(step, delay);
  };

  // Prime mode to "live" immediately, then stream.
  useAppStore.setState((s) => ({ match: { ...s.match, mode: "live" } }));
  void t0;
  step();
}

export function stopDemoLive(): void {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
}

export { DEMO_FIXTURE_ID };
