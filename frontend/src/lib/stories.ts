import type { MatchState, RawScoreEvent, ZonePressure } from "../reducer/types.js";

/**
 * Live story chips: insights derived from the pressure/momentum stream.
 * Everything here describes the run of play so far - no predictions, no
 * probability framing, no invented stats (spec boundary).
 */

export interface StoryChip {
  id: string;
  kind: "dominance" | "drought" | "flip";
  text: string;
  participant: 1 | 2 | null;
}

interface PressurePoint {
  ts: number;
  p1: ZonePressure;
  p2: ZonePressure;
}

function sumZones(z: ZonePressure): number {
  return z.defensive + z.middle + z.attacking;
}

/** "France camping in England's third (last 6 min)" - attacking-delta share. */
export function dominanceChip(
  window: PressurePoint[],
  nowTs: number,
  names: [string, string]
): StoryChip | null {
  if (window.length < 6) return null;
  const first = window[0];
  const last = window[window.length - 1];
  const spanMs = last.ts - first.ts;
  if (spanMs < 4 * 60_000) return null;

  const d1 = sumZones(last.p1) - sumZones(first.p1);
  const d2 = sumZones(last.p2) - sumZones(first.p2);
  const total = d1 + d2;
  if (total < 3) return null;
  const minutes = Math.round(spanMs / 60000);
  if (d1 / total >= 0.65) {
    return {
      id: `dom-1-${Math.floor(nowTs / 60000)}`,
      kind: "dominance",
      text: `${names[0]} camping in ${names[1]}'s third (last ${minutes} min)`,
      participant: 1,
    };
  }
  if (d2 / total >= 0.65) {
    return {
      id: `dom-2-${Math.floor(nowTs / 60000)}`,
      kind: "dominance",
      text: `${names[1]} camping in ${names[0]}'s third (last ${minutes} min)`,
      participant: 2,
    };
  }
  return null;
}

/** "No big chance for England in 12 minutes" - shot/corner-scale drought. */
export function droughtChip(
  lastBigDeltaAt: Record<1 | 2, number>,
  nowTs: number,
  names: [string, string]
): StoryChip | null {
  const candidates: StoryChip[] = [];
  for (const p of [1, 2] as const) {
    const last = lastBigDeltaAt[p];
    if (!last) continue;
    const gapMin = Math.floor((nowTs - last) / 60000);
    if (gapMin >= 10) {
      candidates.push({
        id: `dry-${p}-${gapMin}`,
        kind: "drought",
        text: `No big chance for ${names[p - 1]} in ${gapMin} minutes`,
        participant: p,
      });
    }
  }
  return candidates[0] ?? null;
}

/** "Momentum flipped" (optionally tied to a recent key moment). */
export function flipChip(
  history: { t: number; m: number }[],
  nowTs: number,
  recentMomentLabel: string | null
): StoryChip | null {
  if (history.length < 8) return null;
  const windowMs = 8 * 60_000;
  const recent = history.filter((h) => nowTs - h.t <= windowMs);
  const older = history.filter((h) => nowTs - h.t > windowMs && nowTs - h.t <= windowMs * 2.5);
  if (recent.length < 3 || older.length < 3) return null;
  const avg = (arr: { m: number }[]) => arr.reduce((a, h) => a + h.m, 0) / arr.length;
  const aOld = avg(older);
  const aNew = avg(recent);
  const flipped =
    (aOld < -0.12 && aNew > 0.12) || (aOld > 0.12 && aNew < -0.12);
  if (!flipped) return null;
  return {
    id: `flip-${Math.floor(nowTs / 60000)}`,
    kind: "flip",
    text: recentMomentLabel ? `Momentum flipped since the ${recentMomentLabel}` : "Momentum flipped",
    participant: null,
  };
}

/** Big-delta tracker: which events count as shot/corner-scale chances. */
export function isBigChanceEvent(e: RawScoreEvent): boolean {
  if (e.action === "shot" || e.action === "corner" || e.action === "penalty") return true;
  return e.action === "high_danger_possession";
}

/** Replay-side helpers: pressure points + last big chance from frames/events. */
export function replayPressureWindow(
  frames: { ts: number; state: MatchState }[],
  playheadTs: number,
  spanMs: number
): PressurePoint[] {
  const out: PressurePoint[] = [];
  for (const f of frames) {
    if (f.ts > playheadTs) break;
    if (playheadTs - f.ts <= spanMs) {
      out.push({ ts: f.ts, p1: f.state.pressure.participant1, p2: f.state.pressure.participant2 });
    }
  }
  return out;
}

export function lastBigChanceFromEvents(
  events: RawScoreEvent[],
  playheadTs: number
): Record<1 | 2, number> {
  const out: Record<1 | 2, number> = { 1: 0, 2: 0 };
  for (const e of events) {
    if (e.ts > playheadTs) break;
    if (!isBigChanceEvent(e)) continue;
    const p = e.participant ?? (e.data?.Participant as 1 | 2 | undefined);
    if (p === 1 || p === 2) out[p] = e.ts;
  }
  return out;
}
