import { useAppStore } from "../state/store.js";
import { frameAt } from "../lib/reconstruct.js";
import type { MatchState } from "../reducer/types.js";
import { minuteLabel, playMinutesAt, type ClockAnchor } from "../lib/time.js";

export const PITCH = {
  length: 105,
  width: 68,
  halfX: 52.5,
  halfZ: 34,
  ribbonBaseY: 12,
  ribbonHeight: 6,
  terrainMax: 6,
} as const;

export interface ViewFrame {
  state: MatchState;
  maxSeen: number;
}

/**
 * The state currently driving the scene - live latest, or the replay frame at
 * the playhead. Read transiently inside useFrame (never via a hook per frame).
 */
export function currentViewFrame(): ViewFrame | null {
  const { match } = useAppStore.getState();
  if (match.mode === "replay" && match.replay) {
    const ts = match.playheadTs ?? match.replay.endTs;
    const frame = frameAt(match.replay.frames, ts);
    return frame ? { state: frame.state, maxSeen: frame.maxSeen } : null;
  }
  return match.latest ? { state: match.latest, maxSeen: match.maxSeenLive } : null;
}

export interface RibbonDomain {
  kickoffTs: number;
  endTs: number;
  domainMs: number;
}

/** Live kickoff anchor: the fixture_list start time, falling back to the
 * first observed event ts when that's missing or later than the data (demo). */
function liveKickoffAnchor(match: {
  fixtureId: number | null;
  momentumHistory: { t: number }[];
  latest: { lastTs: number } | null;
}): number {
  const { fixtures } = useAppStore.getState();
  const scheduled =
    match.fixtureId != null
      ? fixtures.find((f) => f.fixtureId === match.fixtureId)?.startTime
      : null;
  const firstObserved = match.momentumHistory[0]?.t ?? match.latest?.lastTs ?? 0;
  if (scheduled != null && (!firstObserved || scheduled <= firstObserved)) {
    return scheduled;
  }
  return firstObserved;
}

/** Time domain for the ribbon: kickoff -> max(90min, elapsed). */
export function ribbonDomain(): RibbonDomain | null {
  const { match } = useAppStore.getState();
  if (match.mode === "replay" && match.replay) {
    const { kickoffTs, endTs } = match.replay;
    return { kickoffTs, endTs, domainMs: Math.max(90 * 60000, endTs - kickoffTs) };
  }
  const kickoffTs = liveKickoffAnchor(match);
  if (!kickoffTs) return null;
  const history = match.momentumHistory;
  const lastT = match.latest?.lastTs ?? history[history.length - 1]?.t ?? kickoffTs;
  return { kickoffTs, endTs: lastT, domainMs: Math.max(90 * 60000, lastT - kickoffTs) };
}

export function tsToX(ts: number, domain: RibbonDomain): number {
  const f = Math.min(1, Math.max(0, (ts - domain.kickoffTs) / domain.domainMs));
  return -PITCH.halfX + f * PITCH.length;
}

export function xToTs(x: number, domain: RibbonDomain): number {
  const f = Math.min(1, Math.max(0, (x + PITCH.halfX) / PITCH.length));
  return domain.kickoffTs + f * domain.domainMs;
}

/** Clock anchor for the HUD: replay knows HT, live approximates it. */
export function clockAnchor(): ClockAnchor | null {
  const { match } = useAppStore.getState();
  if (match.mode === "replay" && match.replay) {
    return { kickoffTs: match.replay.kickoffTs, halftimeTs: match.replay.halftimeTs };
  }
  const kickoffTs = liveKickoffAnchor(match);
  if (!kickoffTs) return null;
  return { kickoffTs, halftimeTs: null };
}

/** Normalize a raw accumulating pressure value for display. */
export function normPressure(v: number, maxSeen: number): number {
  return Math.pow(v / Math.max(1, maxSeen), 0.75);
}

/**
 * Minute label at a replay timestamp, from the real game clock carried in the
 * frames; ts-based fallback when no clock reading exists yet (early frames,
 * synthetic demo data).
 */
export function replayMinuteLabel(ts: number): string {
  const { match } = useAppStore.getState();
  if (match.replay) {
    const label = minuteLabel(frameAt(match.replay.frames, ts)?.state.clock ?? null);
    if (label) return label;
    const anchor: ClockAnchor = {
      kickoffTs: match.replay.kickoffTs,
      halftimeTs: match.replay.halftimeTs,
    };
    const m = playMinutesAt(ts, anchor);
    return `${Math.max(1, Math.round(m))}'`;
  }
  return "";
}
