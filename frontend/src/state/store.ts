import { create } from "zustand";
import { FINISHED_STATUS_IDS, type KeyMoment, type MatchState, type RawScoreEvent } from "../reducer/types.js";
import { reconstruct, frameAt, type MomentumSample, type ReplayData } from "../lib/reconstruct.js";
import { socket, type ConnStatus, type ServerMessage } from "../lib/ws.js";

/** One entry of the backend's `fixture_list` message (contract). */
export interface FixtureListEntry {
  fixtureId: number;
  participant1: string;
  participant1Id?: number;
  participant2: string;
  participant2Id?: number;
  competition?: string;
  startTime: number | null;
  statusId: number;
  score: { participant1: number; participant2: number };
  /** Server-computed classification; never derive this on the frontend. */
  phase: "upcoming" | "live" | "finished";
  /** false = backend holds no event data; score is meaningless, no replay. */
  hasData: boolean;
  /** Confirmed on-chain attestation, when persisted (added by backend; optional). */
  attestation?: { txSig: string; cluster: string };
}

export type MatchMode = "idle" | "live" | "replay-loading" | "replay";
/** Replay playback multiplier - continuous, slider-driven (1x .. 128x). */
export type PlaySpeed = number;

export const SPEED_MIN = 1;
export const SPEED_MAX = 128;

export interface TerrainRipple {
  id: number;
  participant: 1 | 2;
  x: number; // world x of the zone center that fired
  z: number;
  startedAt: number; // performance.now()
}

/** Interrupt tiers: full-screen beat, compact center card, bottom toast. */
export type TakeoverVariant = "full" | "mini" | "toast";

/** Moment shape - KeyMoment plus the replay-only event types we celebrate. */
export interface TakeoverMoment {
  type: string; // goal | red_card | var_overturned | penalty | yellow_card | woodwork | corner | substitution | pen_scored | pen_missed
  participant: 1 | 2;
  ts: number;
  seq: number;
  id?: number;
}

export interface TakeoverRequest {
  moment: TakeoverMoment;
  variant: TakeoverVariant;
  compressed: boolean; // replay auto-play uses the short version
  scoreAfter: { participant1: number; participant2: number };
  fxStartedAt: number | null; // performance.now() once activated
}

interface MatchViewSlice {
  fixtureId: number | null;
  mode: MatchMode;
  latest: MatchState | null;
  latestReceivedAt: number | null; // Date.now() when `latest` arrived
  momentumHistory: MomentumSample[];
  maxSeenLive: number;
  replay: ReplayData | null;
  playheadTs: number | null;
  playing: boolean;
  speed: PlaySpeed;
  ripples: TerrainRipple[];
  takeoverQueue: TakeoverRequest[];
  activeTakeover: TakeoverRequest | null;
  seenMomentKeys: string[];
  everReceived: boolean;
  coverageNotice: boolean;
  /** goal-cam instant replay state (replay autoplay only) */
  instantReplay: { untilTs: number; resumeTs: number; resumeSpeed: PlaySpeed; goalEnd: 1 | -1 } | null;
  /** rolling pressure snapshots (live), for story-chip derivation */
  pressureWindow: {
    ts: number;
    p1: MatchState["pressure"]["participant1"];
    p2: MatchState["pressure"]["participant2"];
  }[];
  /** last ts each side had a shot/corner-scale pressure jump (live) */
  bigDeltaAt: Record<1 | 2, number>;
}

/** Player metadata from the backend's `fixture_players` message (optional). */
export interface PlayerInfo {
  id: number;
  name: string;
  number?: string;
  starter?: boolean;
  unit?: number;
  participant: 1 | 2;
  goals?: number;
}

/** Solana attestation info for a fixture (optional backend message). */
export interface AttestationInfo {
  txSig: string;
  cluster: string;
  status?: string;
}

/** One moderated X post from the backend's `chatter` message (optional). */
export interface ChatterPost {
  id: string;
  author: string;
  handle: string;
  text: string;
  ts: number;
  likes?: number;
}

interface AppState {
  connection: ConnStatus;
  demo: boolean;
  demoLive: boolean;
  listStates: Record<number, MatchState>;
  fixtures: FixtureListEntry[];
  players: Record<number, PlayerInfo[]>;
  attestations: Record<number, AttestationInfo>;
  chatter: Record<number, ChatterPost[]>;
  match: MatchViewSlice;

  enterMatch: (fixtureId: number, opts?: { demo?: boolean; demoLive?: boolean }) => void;
  leaveMatch: () => void;
  handleServerMessage: (msg: ServerMessage) => void;
  setConnection: (status: ConnStatus) => void;

  setPlayhead: (ts: number, opts?: { manual?: boolean }) => void;
  advancePlayhead: (dtMs: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  stepMoment: (dir: 1 | -1) => void;
  dismissTakeover: () => void;
  startDemoReplay: () => void;
  cameraPreset: number;
  cycleCameraPreset: () => void;
  setCameraPreset: (index: number) => void;
  leanBack: boolean;
  toggleLeanBack: () => void;
  legendOpen: boolean;
  setLegendOpen: (open: boolean) => void;
}

const initialMatchSlice: MatchViewSlice = {
  fixtureId: null,
  mode: "idle",
  latest: null,
  latestReceivedAt: null,
  momentumHistory: [],
  maxSeenLive: 1,
  replay: null,
  playheadTs: null,
  playing: false,
  speed: 2,
  ripples: [],
  takeoverQueue: [],
  activeTakeover: null,
  seenMomentKeys: [],
  everReceived: false,
  coverageNotice: false,
  instantReplay: null,
  pressureWindow: [],
  bigDeltaAt: { 1: 0, 2: 0 },
};

// --- module-level internals (non-reactive) ---
let replayBuffer: RawScoreEvent[] = [];
let rippleId = 0;
let coverageTimer: ReturnType<typeof setTimeout> | null = null;
let resubTimer: ReturnType<typeof setTimeout> | null = null;
let rewindTimer: ReturnType<typeof setTimeout> | null = null;
let activeFixture: number | null = null;

function clearTimers() {
  if (coverageTimer) clearTimeout(coverageTimer);
  if (resubTimer) clearTimeout(resubTimer);
  if (rewindTimer) clearTimeout(rewindTimer);
  coverageTimer = null;
  resubTimer = null;
  rewindTimer = null;
}

const ZONE_X_P1 = { defensive: -35, middle: 0, attacking: 35 } as const;

function momentKey(m: TakeoverMoment): string {
  // the action id is the stable identity of a real-world moment (the feed
  // re-sends it across confirm/amend updates); seq is the fallback
  return `${m.type}:${m.id ?? m.seq}`;
}

function variantOf(type: string): TakeoverVariant {
  if (
    type === "goal" ||
    type === "red_card" ||
    type === "var_overturned" ||
    type === "penalty" ||
    type === "full_time"
  ) {
    return "full";
  }
  if (
    type === "yellow_card" ||
    type === "woodwork" ||
    type === "pen_scored" ||
    type === "pen_missed" ||
    type === "halftime"
  ) {
    return "mini";
  }
  return "toast";
}

/** Manual-scrub takeovers refire a moment at most this often (wall clock). */
const SCRUB_TAKEOVER_COOLDOWN_MS = 20_000;
/** Landing within this window of match time after a moment counts as "on it". */
const SCRUB_TAKEOVER_WINDOW_MS = 8_000;
const scrubFiredAt = new Map<string, number>();

/** Replay event -> celebratable moment type, when the event is one we surface. */
function eventMomentType(e: RawScoreEvent): string | null {
  if (e.action === "yellow_card") return "yellow_card";
  if (e.action === "shot" && (e.data?.Outcome ?? e.data?.outcome) === "Woodwork") return "woodwork";
  if (e.action === "penalty") return "penalty";
  if (e.action === "penalty_outcome") {
    // a scored penalty is a GOAL key moment (reducer) — the full takeover
    // owns it; only misses fire the mini card here
    return (e.data?.Outcome as string | undefined) === "Scored" ? null : "pen_missed";
  }
  if (e.action === "corner") return "corner";
  if (e.action === "substitution") return "substitution";
  if (e.action === "kickoff") return e.statusId === 4 ? "kickoff2" : "kickoff";
  return null;
}

export const useAppStore = create<AppState>((set, get) => {
  function queueTakeover(req: TakeoverRequest) {
    const { match } = get();
    if (match.activeTakeover) {
      // hygiene under speed: full moments always queue (cap 4); minis drop
      // when the line is long; toasts are the first to go when busy
      const queue = match.takeoverQueue;
      if (req.variant === "toast" && queue.length >= 2) return;
      if (req.variant === "mini" && queue.length >= 3) return;
      if (req.variant === "full" && queue.length >= 4) return;
      if (req.variant === "mini" && queue.length >= 2) {
        const toastIdx = queue.findIndex((q) => q.variant === "toast");
        if (toastIdx >= 0) {
          const next = [...queue];
          next.splice(toastIdx, 1, req);
          set({ match: { ...match, takeoverQueue: next } });
          return;
        }
      }
      set({ match: { ...match, takeoverQueue: [...queue, req] } });
    } else {
      set({ match: { ...match, activeTakeover: { ...req, fxStartedAt: performance.now() } } });
    }
  }

  function addRipples(prev: MatchState | null, next: MatchState) {
    if (!prev) return;
    const fired: TerrainRipple[] = [];
    for (const p of [1, 2] as const) {
      const key = p === 1 ? "participant1" : "participant2";
      for (const zone of ["defensive", "middle", "attacking"] as const) {
        const delta = next.pressure[key][zone] - prev.pressure[key][zone];
        if (delta >= 0.9) {
          const x1 = ZONE_X_P1[zone];
          fired.push({
            id: ++rippleId,
            participant: p,
            x: p === 1 ? x1 : -x1,
            z: 0,
            startedAt: performance.now(),
          });
        }
      }
    }
    if (fired.length > 0) {
      const { match } = get();
      set({ match: { ...match, ripples: [...match.ripples, ...fired].slice(-12) } });
    }
  }

  function detectNewMoments(state: MatchState, isSnapshot: boolean) {
    const { match } = get();
    const seen = new Set(match.seenMomentKeys);
    const fresh = state.keyMoments.filter((m) => !seen.has(momentKey(m)));
    if (fresh.length === 0) return;
    const seenKeys = [...match.seenMomentKeys, ...fresh.map(momentKey)];
    set({ match: { ...get().match, seenMomentKeys: seenKeys } });
    // A subscribe snapshot replays history - seed the seen set, don't celebrate it.
    if (isSnapshot) return;
    for (const moment of fresh) {
      queueTakeover({
        moment,
        variant: "full",
        compressed: false,
        scoreAfter: { ...state.score },
        fxStartedAt: null,
      });
    }
  }

  function ingestState(state: MatchState) {
    const { match } = get();
    if (match.fixtureId !== state.fixtureId) return;
    const prev = match.latest;

    // story-chip tracking: shot/corner-scale single-zone jumps per side
    const bigDeltaAt = { ...match.bigDeltaAt };
    if (prev) {
      for (const p of [1, 2] as const) {
        const key = p === 1 ? "participant1" : "participant2";
        for (const zone of ["defensive", "middle", "attacking"] as const) {
          if (state.pressure[key][zone] - prev.pressure[key][zone] >= 0.9) {
            bigDeltaAt[p] = state.lastTs;
          }
        }
      }
    }

    set({
      match: {
        ...match,
        latest: state,
        latestReceivedAt: Date.now(),
        everReceived: true,
        coverageNotice: false,
        momentumHistory: [...match.momentumHistory, { t: state.lastTs, m: state.momentum }],
        pressureWindow: [
          ...match.pressureWindow,
          {
            ts: state.lastTs,
            p1: { ...state.pressure.participant1 },
            p2: { ...state.pressure.participant2 },
          },
        ].slice(-90),
        bigDeltaAt,
        maxSeenLive: Math.max(
          match.maxSeenLive,
          state.pressure.participant1.defensive,
          state.pressure.participant1.middle,
          state.pressure.participant1.attacking,
          state.pressure.participant2.defensive,
          state.pressure.participant2.middle,
          state.pressure.participant2.attacking,
          1
        ),
        mode:
          match.mode === "replay" || match.mode === "replay-loading"
            ? match.mode
            : state.statusId === 100 && match.mode === "idle"
              ? "replay-loading"
              : match.mode === "idle"
                ? "live"
                : match.mode,
      },
    });

    addRipples(prev, state);
    if (get().match.mode === "live") detectNewMoments(state, prev === null);

    // broadcast bookends: halftime whistle + the final whistle
    if (prev && prev.statusId !== state.statusId && get().match.mode === "live") {
      const seen = new Set(get().match.seenMomentKeys);
      if (state.statusId === 3 && !seen.has("halftime:ht")) {
        seen.add("halftime:ht");
        set({ match: { ...get().match, seenMomentKeys: [...seen] } });
        queueTakeover({
          moment: { type: "halftime", participant: 1, ts: state.lastTs, seq: state.lastSeq },
          variant: "mini",
          compressed: false,
          scoreAfter: { ...state.score },
          fxStartedAt: null,
        });
      }
      if (
        FINISHED_STATUS_IDS.has(state.statusId) &&
        !FINISHED_STATUS_IDS.has(prev.statusId) &&
        !seen.has("full_time:ft")
      ) {
        seen.add("full_time:ft");
        set({ match: { ...get().match, seenMomentKeys: [...seen] } });
        const winner =
          state.score.participant1 > state.score.participant2
            ? 1
            : state.score.participant2 > state.score.participant1
              ? 2
              : 1;
        queueTakeover({
          moment: { type: "full_time", participant: winner as 1 | 2, ts: state.lastTs, seq: state.lastSeq },
          variant: "full",
          compressed: false,
          scoreAfter: { ...state.score },
          fxStartedAt: null,
        });
      }
    }

    // A live match just finalised: pull the full history to switch to replay.
    if (state.statusId === 100 && get().match.mode === "live") {
      replayBuffer = [];
      socket.unsubscribe(state.fixtureId);
      socket.subscribe(state.fixtureId);
      if (resubTimer) clearTimeout(resubTimer);
      // If no replay stream follows, stay on the frozen final state.
      resubTimer = setTimeout(() => {
        const m = get().match;
        if (m.mode === "live" && m.latest?.statusId === 100) {
          set({ match: { ...m, playing: false } });
        }
      }, 6000);
    }
  }

  function ingestReplayChunk(fixtureId: number, events: RawScoreEvent[], done: boolean) {
    const { match } = get();
    if (match.fixtureId !== fixtureId) return;
    replayBuffer.push(...events);
    if (match.mode === "idle" || match.mode === "live") {
      set({ match: { ...get().match, mode: "replay-loading", everReceived: true } });
    } else {
      set({ match: { ...get().match, everReceived: true } });
    }
    if (!done) return;

    const replay = reconstruct(fixtureId, replayBuffer);
    replayBuffer = [];
    if (replay.frames.length === 0) return; // nothing to scrub - stay put

    const current = get().match;
    set({
      match: {
        ...current,
        mode: "replay",
        replay,
        playheadTs: replay.endTs,
        playing: false,
        momentumHistory: replay.samples,
        everReceived: true,
      },
    });
  }

  return {
    connection: "connecting",
    demo: false,
    demoLive: false,
    listStates: {},
    fixtures: [],
    players: {},
    attestations: {},
    chatter: {},
    match: initialMatchSlice,

    setConnection: (connection) => set({ connection }),

    enterMatch: (fixtureId, opts) => {
      clearTimers();
      replayBuffer = [];
      activeFixture = fixtureId;
      const demo = opts?.demo ?? false;
      set({
        demo,
        demoLive: demo && (opts?.demoLive ?? false),
        match: { ...initialMatchSlice, fixtureId },
      });

      if (demo) {
        set({ connection: "demo" });
        return; // demo pump is driven by the MatchView effect
      }

      set({ connection: "connecting" });
      socket.connect();
      socket.subscribe(fixtureId);

      // Coverage notice: subscribed fixture with past kickoff that stays silent.
      const meta = get().fixtures.find((f) => f.fixtureId === fixtureId);
      const kickoffPast = meta?.startTime != null ? meta.startTime <= Date.now() : true;
      if (kickoffPast) {
        coverageTimer = setTimeout(() => {
          const m = get().match;
          if (m.fixtureId === fixtureId && !m.everReceived) {
            set({ match: { ...m, coverageNotice: true } });
          }
        }, 10_000);
      }
    },

    leaveMatch: () => {
      clearTimers();
      if (activeFixture !== null && !get().demo) socket.unsubscribe(activeFixture);
      activeFixture = null;
      replayBuffer = [];
      set({ match: { ...initialMatchSlice }, demoLive: false });
    },

    handleServerMessage: (msg) => {
      if (msg.type === "state") {
        const state = (msg as { state: MatchState }).state;
        if (!state || typeof state.fixtureId !== "number") return;
        set({ listStates: { ...get().listStates, [state.fixtureId]: state } });
        ingestState(state);
      } else if (msg.type === "fixture_list") {
        const list = (msg as unknown as { fixtures: FixtureListEntry[] }).fixtures;
        if (Array.isArray(list)) set({ fixtures: list });
      } else if (msg.type === "fixture_players") {
        const m = msg as unknown as {
          fixtureId: number;
          players: PlayerInfo[];
          attestation?: AttestationInfo;
        };
        if (typeof m.fixtureId !== "number") return;
        if (Array.isArray(m.players)) {
          set({ players: { ...get().players, [m.fixtureId]: m.players } });
        }
        if (m.attestation?.txSig) {
          set({ attestations: { ...get().attestations, [m.fixtureId]: m.attestation } });
        }
      } else if (msg.type === "attestation") {
        const m = msg as unknown as { fixtureId: number } & AttestationInfo;
        if (typeof m.fixtureId === "number" && m.txSig) {
          set({
            attestations: {
              ...get().attestations,
              [m.fixtureId]: { txSig: m.txSig, cluster: m.cluster, status: m.status },
            },
          });
        }
      } else if (msg.type === "chatter") {
        const m = msg as unknown as { fixtureId: number; posts: ChatterPost[] };
        if (typeof m.fixtureId === "number" && Array.isArray(m.posts)) {
          set({ chatter: { ...get().chatter, [m.fixtureId]: m.posts.slice(0, 10) } });
        }
      } else if (msg.type === "replay_chunk") {
        const chunk = msg as { fixtureId: number; events: RawScoreEvent[]; done: boolean };
        if (!Array.isArray(chunk.events)) return;
        ingestReplayChunk(chunk.fixtureId, chunk.events, Boolean(chunk.done));
      }
      // unknown message types: ignore silently
    },

    setPlayhead: (ts, opts) => {
      const { match } = get();
      if (match.mode !== "replay" || !match.replay) return;
      const clamped = Math.min(Math.max(ts, match.replay.kickoffTs), match.replay.endTs);
      if (opts?.manual && rewindTimer) {
        clearTimeout(rewindTimer);
        rewindTimer = null;
      }
      set({
        match: {
          ...match,
          playheadTs: clamped,
          playing: opts?.manual ? false : match.playing,
          instantReplay: opts?.manual ? null : match.instantReplay,
        },
      });

      // Landing on a key moment by hand (marker click, or scrubbing right
      // onto it) replays its broadcast beat - compressed, cooldown-gated so
      // dragging back and forth can't spam it.
      if (opts?.manual && match.replay) {
        const frames = match.replay.frames;
        const finalMoments = frames[frames.length - 1]?.state.keyMoments ?? [];
        const now = performance.now();
        let toastsUsed = 0;
        for (const moment of finalMoments) {
          if (clamped < moment.ts || clamped > moment.ts + SCRUB_TAKEOVER_WINDOW_MS) continue;
          const key = momentKey(moment);
          const last = scrubFiredAt.get(key);
          if (last !== undefined && now - last < SCRUB_TAKEOVER_COOLDOWN_MS) continue;
          scrubFiredAt.set(key, now);
          const frame = frames.find((f) => f.ts >= moment.ts);
          queueTakeover({
            moment,
            variant: variantOf(moment.type),
            compressed: true,
            scoreAfter: frame ? { ...frame.state.score } : { participant1: 0, participant2: 0 },
            fxStartedAt: null,
          });
        }
        // same landing treatment for replay event moments (yellow, woodwork,
        // penalty, shootout kicks, corner, sub)
        for (const e of match.replay.events) {
          if (e.ts < clamped || e.ts > clamped + SCRUB_TAKEOVER_WINDOW_MS) continue;
          const type = eventMomentType(e);
          if (!type) continue;
          const p = e.participant ?? (e.data?.Participant as 1 | 2 | undefined);
          // kickoff moments carry no participant - everything else needs one
          if (p !== 1 && p !== 2 && type !== "kickoff" && type !== "kickoff2") continue;
          const variant = variantOf(type);
          if (variant === "toast" && toastsUsed >= 1) continue;
          const key = `${type}:${e.id ?? e.seq}`;
          const last = scrubFiredAt.get(key);
          if (last !== undefined && now - last < SCRUB_TAKEOVER_COOLDOWN_MS) continue;
          scrubFiredAt.set(key, now);
          if (variant === "toast") toastsUsed += 1;
          const frame = frameAt(frames, e.ts);
          queueTakeover({
            moment: { type, participant: p ?? 1, ts: e.ts, seq: e.seq, id: e.id },
            variant,
            compressed: true,
            scoreAfter: frame ? { ...frame.state.score } : { participant1: 0, participant2: 0 },
            fxStartedAt: null,
          });
        }

        // landing on the halftime break: mini halftime card
        const htTs = match.replay.halftimeTs;
        if (htTs && clamped >= htTs && clamped <= htTs + SCRUB_TAKEOVER_WINDOW_MS) {
          const key = "halftime:ht";
          const last = scrubFiredAt.get(key);
          if (last === undefined || now - last >= SCRUB_TAKEOVER_COOLDOWN_MS) {
            scrubFiredAt.set(key, now);
            const frame = frameAt(frames, htTs);
            queueTakeover({
              moment: { type: "halftime", participant: 1, ts: htTs, seq: frame?.seq ?? 0 },
              variant: "mini",
              compressed: true,
              scoreAfter: frame ? { ...frame.state.score } : { participant1: 0, participant2: 0 },
              fxStartedAt: null,
            });
          }
        }

        // landing on full time: the final whistle card (one goal-cam-era exception
        // to "no takeovers while scrubbing" - FT is the end card)
        if (clamped >= match.replay.endTs - 1) {
          const finalFrame = frames[frames.length - 1];
          const key = "full_time:ft";
          const last = scrubFiredAt.get(key);
          if (
            finalFrame &&
            FINISHED_STATUS_IDS.has(finalFrame.state.statusId) &&
            (last === undefined || now - last >= SCRUB_TAKEOVER_COOLDOWN_MS)
          ) {
            scrubFiredAt.set(key, now);
            const score = finalFrame.state.score;
            const winner =
              score.participant1 > score.participant2 ? 1 : score.participant2 > score.participant1 ? 2 : 1;
            queueTakeover({
              moment: { type: "full_time", participant: winner as 1 | 2, ts: match.replay.endTs, seq: finalFrame.seq },
              variant: "full",
              compressed: true,
              scoreAfter: { ...score },
              fxStartedAt: null,
            });
          }
        }
      }
    },

    advancePlayhead: (dtMs) => {
      const { match } = get();
      if (match.mode !== "replay" || !match.replay || !match.playing) return;
      const prev = match.playheadTs ?? match.replay.kickoffTs;
      // instant replay runs at 1x regardless of the transport speed
      const effectiveSpeed = match.instantReplay ? 1 : match.speed;
      const next = Math.min(prev + dtMs * effectiveSpeed, match.replay.endTs);

      // instant replay finished its window: jump back to where we interrupted
      if (match.instantReplay && next >= match.instantReplay.untilTs) {
        const ir = match.instantReplay;
        set({
          match: {
            ...match,
            instantReplay: null,
            playheadTs: Math.max(ir.resumeTs, next),
            speed: ir.resumeSpeed,
          },
        });
        return;
      }

      // Fire compressed takeovers for key moments crossed during auto-play.
      if (next > prev) {
        const seen = new Set(match.seenMomentKeys);
        const crossedGoals: { ts: number; end: 1 | -1 }[] = [];
        for (const frame of match.replay.frames) {
          if (frame.ts <= prev || frame.ts > next) continue;
          for (const moment of frame.state.keyMoments) {
            if (moment.ts !== frame.ts || seen.has(momentKey(moment))) continue;
            seen.add(momentKey(moment));
            queueTakeover({
              moment,
              variant: "full",
              compressed: true,
              scoreAfter: { ...frame.state.score },
              fxStartedAt: null,
            });
            if (moment.type === "goal") {
              crossedGoals.push({ ts: moment.ts, end: moment.participant === 1 ? 1 : -1 });
            }
          }
        }

        // replay-only event moments: yellow cards, woodwork, penalties,
        // shootout kicks, corners, substitutions (toasts capped per crossing)
        let toastsUsed = 0;
        for (const e of match.replay.events) {
          if (e.ts <= prev || e.ts > next) continue;
          const type = eventMomentType(e);
          if (!type) continue;
          const p = e.participant ?? (e.data?.Participant as 1 | 2 | undefined);
          // kickoff moments carry no participant - everything else needs one
          if (p !== 1 && p !== 2 && type !== "kickoff" && type !== "kickoff2") continue;
          const key = `${type}:${e.id ?? e.seq}`;
          if (seen.has(key)) continue;
          const variant = variantOf(type);
          if (variant === "toast" && toastsUsed >= 1) continue;
          seen.add(key);
          if (variant === "toast") toastsUsed += 1;
          const frame = frameAt(match.replay.frames, e.ts);
          queueTakeover({
            moment: { type, participant: p ?? 1, ts: e.ts, seq: e.seq, id: e.id },
            variant,
            compressed: true,
            scoreAfter: frame ? { ...frame.state.score } : { participant1: 0, participant2: 0 },
            fxStartedAt: null,
          });
        }

        // halftime whistle (replay: crossing the break during auto-play)
        const htTs = match.replay.halftimeTs;
        if (htTs && prev < htTs && next >= htTs && !seen.has("halftime:ht")) {
          seen.add("halftime:ht");
          const frame = frameAt(match.replay.frames, htTs);
          queueTakeover({
            moment: { type: "halftime", participant: 1, ts: htTs, seq: frame?.seq ?? 0 },
            variant: "mini",
            compressed: true,
            scoreAfter: frame ? { ...frame.state.score } : { participant1: 0, participant2: 0 },
            fxStartedAt: null,
          });
        }

        if (seen.size !== match.seenMomentKeys.length) {
          set({ match: { ...get().match, seenMomentKeys: [...seen] } });
        }

        // Goal-cam: after the goal's compressed takeover, rewind into the
        // buildup and roll at 1x through just past the goal. Skipped when the
        // window is entirely behind us (big overshoots at high speeds).
        const goal = crossedGoals[0];
        if (goal && !match.instantReplay && !rewindTimer) {
          const replay = match.replay;
          const resumeSpeed = match.speed;
          rewindTimer = setTimeout(() => {
            rewindTimer = null;
            const m = useAppStore.getState().match;
            if (m.mode !== "replay" || !m.replay || !m.playing) return;
            const untilTs = goal.ts + 4_000;
            const resumeTs = m.playheadTs ?? replay.endTs;
            const from = Math.max(goal.ts - 12_000, replay.kickoffTs);
            set({
              match: {
                ...useAppStore.getState().match,
                playheadTs: from,
                instantReplay: { untilTs, resumeTs, resumeSpeed, goalEnd: goal.end },
              },
            });
          }, 1700);
        }
      }

      const done = next >= match.replay.endTs;
      if (done) {
        // the final whistle in replay: a real broadcast beat, once per session
        const finalFrame = match.replay.frames[match.replay.frames.length - 1];
        const seen = new Set(get().match.seenMomentKeys);
        if (
          finalFrame &&
          FINISHED_STATUS_IDS.has(finalFrame.state.statusId) &&
          !seen.has("full_time:ft")
        ) {
          seen.add("full_time:ft");
          set({ match: { ...get().match, seenMomentKeys: [...seen] } });
          const score = finalFrame.state.score;
          const winner =
            score.participant1 > score.participant2 ? 1 : score.participant2 > score.participant1 ? 2 : 1;
          queueTakeover({
            moment: { type: "full_time", participant: winner as 1 | 2, ts: match.replay.endTs, seq: finalFrame.seq },
            variant: "full",
            compressed: match.speed > 4,
            scoreAfter: { ...score },
            fxStartedAt: null,
          });
        }
      }
      set({
        match: {
          ...get().match,
          playheadTs: next,
          playing: done ? false : match.playing,
          // never strand goal-cam state at full time (a late goal's window
          // can outlive the match - playback must not crawl at 1x forever)
          instantReplay: done ? null : get().match.instantReplay,
        },
      });
    },

    setPlaying: (playing) => {
      const { match } = get();
      if (match.mode !== "replay" || !match.replay) return;
      let playheadTs = match.playheadTs;
      // pressing play at FT restarts the match (and drops any goal-cam state)
      if (playing && playheadTs !== null && playheadTs >= match.replay.endTs - 1) {
        playheadTs = match.replay.kickoffTs;
        set({ match: { ...match, playing, playheadTs, instantReplay: null } });
        return;
      }
      set({ match: { ...match, playing, playheadTs } });
    },

    setSpeed: (speed) => {
      const { match } = get();
      const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
      set({ match: { ...match, speed: clamped } });
    },

    stepMoment: (dir) => {
      const { match } = get();
      if (match.mode !== "replay" || !match.replay) return;
      const frames = match.replay.frames;
      const moments = (frames[frames.length - 1]?.state.keyMoments ?? [])
        .map((m) => m.ts)
        .sort((a, b) => a - b);
      if (moments.length === 0) return;
      const playhead = match.playheadTs ?? match.replay.endTs;
      const gap = 2000;
      const target =
        dir === 1
          ? moments.find((t) => t > playhead + gap)
          : [...moments].reverse().find((t) => t < playhead - gap);
      if (target !== undefined) get().setPlayhead(target, { manual: true });
    },

    dismissTakeover: () => {
      const { match } = get();
      const [next, ...rest] = match.takeoverQueue;
      set({
        match: {
          ...match,
          takeoverQueue: rest,
          activeTakeover: next ? { ...next, fxStartedAt: performance.now() } : null,
        },
      });
    },

    startDemoReplay: () => {
      const { match } = get();
      if (!match.fixtureId) return;
      // The demo pump calls this with replayBuffer pre-loaded via demo.ts
      const replay = reconstruct(match.fixtureId, replayBuffer);
      replayBuffer = [];
      if (replay.frames.length === 0) return;
      set({
        match: {
          ...match,
          mode: "replay",
          replay,
          latest: replay.frames[replay.frames.length - 1].state,
          playheadTs: replay.endTs,
          playing: false,
          momentumHistory: replay.samples,
          everReceived: true,
        },
      });
    },

    cameraPreset: 0,
    cycleCameraPreset: () => set({ cameraPreset: (get().cameraPreset + 1) % 3 }),
    setCameraPreset: (index) => set({ cameraPreset: index }),

    leanBack: false,
    toggleLeanBack: () => set({ leanBack: !get().leanBack }),
    legendOpen: false,
    setLegendOpen: (open) => set({ legendOpen: open }),
  };
});

/** Demo helper: feed the synthetic event log through the replay path. */
export function demoLoadReplay(events: RawScoreEvent[]) {
  replayBuffer = [...events];
  useAppStore.getState().startDemoReplay();
}

/** Demo helper: fold one event live (same path as a real `state` message). */
export function demoIngestState(state: MatchState) {
  useAppStore.getState().handleServerMessage({ type: "state", state });
}
