import { initialMatchState, type MatchState, type RawScoreEvent } from "../reducer/types.js";
import { reduce } from "../reducer/reducer.js";

export interface Frame {
  ts: number;
  seq: number;
  state: MatchState;
  /** running max of the six pressure zone values as of this frame (floor 1) */
  maxSeen: number;
}

export interface MomentumSample {
  t: number;
  m: number;
}

export interface ReplayData {
  frames: Frame[];
  /** raw events in seq order, for timeline enrichment (replay only) */
  events: RawScoreEvent[];
  samples: MomentumSample[];
  kickoffTs: number;
  halftimeTs: number | null;
  endTs: number;
}

function sixZoneMax(state: MatchState): number {
  const { participant1: a, participant2: b } = state.pressure;
  return Math.max(a.defensive, a.middle, a.attacking, b.defensive, b.middle, b.attacking);
}

/**
 * Fold the full raw event array in seq order, keeping every intermediate
 * MatchState. A full match is a few thousand events at most - instant.
 */
export function reconstruct(fixtureId: number, events: RawScoreEvent[]): ReplayData {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let state = initialMatchState(fixtureId);
  let maxSeen = 1;
  const frames: Frame[] = [];
  let kickoffTs: number | null = null;
  let halftimeTs: number | null = null;

  for (const event of sorted) {
    state = reduce(state, event);
    maxSeen = Math.max(maxSeen, sixZoneMax(state));
    frames.push({ ts: event.ts, seq: event.seq, state, maxSeen });
    if (kickoffTs === null && event.action === "kickoff") kickoffTs = event.ts;
    if (halftimeTs === null && event.action === "halftime_finalised") halftimeTs = event.ts;
  }

  const first = frames[0];
  const last = frames[frames.length - 1];
  const samples = decimate(
    frames.map((f) => ({ t: f.ts, m: f.state.momentum })),
    400
  );

  return {
    frames,
    events: sorted,
    samples,
    kickoffTs: kickoffTs ?? first?.ts ?? 0,
    halftimeTs,
    endTs: last?.ts ?? 0,
  };
}

/** Binary search: the last frame at or before `ts` (first frame if earlier). */
export function frameAt(frames: Frame[], ts: number): Frame | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  if (ts <= frames[0].ts) return frames[0];
  if (ts >= frames[hi].ts) return frames[hi];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].ts <= ts) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

/** Thin a sample list to at most `max` points, keeping first and last. */
export function decimate(samples: MomentumSample[], max: number): MomentumSample[] {
  if (samples.length <= max) return samples;
  const out: MomentumSample[] = [];
  const step = (samples.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(samples[Math.round(i * step)]);
  }
  return out;
}
