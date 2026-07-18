import { EventSource } from "eventsource";
import { API_BASE_URL } from "./config.js";
import { renewJwt, type TxLineSession } from "./auth.js";
import type { RawScoreEvent } from "../reducer/types.js";

export type ScoreEventHandler = (event: RawScoreEvent) => void;

/**
 * Normalized fixture metadata captured from a stream message's `FixtureInfo`
 * block (see docs/txline/scores/soccer-feed.md and the Scores Product API
 * PDF). `startTime` is normalized to epoch milliseconds regardless of
 * whether the source sent an ISO-8601 string or a numeric timestamp.
 */
export interface FixtureInfo {
  fixtureId: number;
  participant1?: string;
  participant1Id?: number;
  participant2?: string;
  participant2Id?: number;
  competition?: string;
  competitionId?: number;
  startTime?: number;
  gameState?: string;
  /** Original FixtureInfo payload, JSON-stringified, for the fixtures.raw column. */
  raw: string;
}

export type FixtureInfoHandler = (info: FixtureInfo) => void;

export interface ParsedScoresMessage {
  event: RawScoreEvent | null;
  fixtureInfo?: FixtureInfo;
}

function firstDefined<T>(...values: (T | null | undefined)[]): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function normalizeStartTime(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function extractFixtureInfo(raw: any): FixtureInfo | undefined {
  if (!raw) return undefined;
  const fixtureId = raw.FixtureId;
  if (fixtureId === undefined || fixtureId === null) return undefined;
  return {
    fixtureId,
    participant1: raw.Participant1,
    participant1Id: raw.Participant1Id,
    participant2: raw.Participant2,
    participant2Id: raw.Participant2Id,
    competition: raw.Competition,
    competitionId: raw.CompetitionId,
    startTime: normalizeStartTime(raw.StartTime),
    gameState: raw.GameState,
    raw: JSON.stringify(raw),
  };
}

/**
 * Extracts the authoritative goals scoreline from an Update's `Score` field.
 * `Score.ParticipantN.Total.Goals` is the sum of regulation + extra-time
 * periods (penalties excluded) — see the Scores Product API PDF's `Score`
 * object. Tolerates a lowercase-fielded variant defensively, since not every
 * TxLINE surface is documented with the same casing.
 */
function extractScore(update: any): RawScoreEvent["score"] {
  const scoreObj = update?.Score ?? update?.score ?? update?.scoreSoccer;
  if (!scoreObj) return undefined;
  const p1Total = scoreObj.Participant1?.Total ?? scoreObj.participant1?.total;
  const p2Total = scoreObj.Participant2?.Total ?? scoreObj.participant2?.total;
  // Total is a running per-participant stat block that (per observed live data)
  // omits still-zero keys entirely rather than sending `Goals: 0` — e.g.
  // `Total: { Corners: 3 }` with no Goals key at all means 0 goals so far, not
  // "no score data here". Require the Total block itself, but default a
  // missing Goals key to 0 rather than discarding the whole score.
  if (!p1Total || !p2Total) return undefined;
  const p1 = typeof p1Total.Goals === "number" ? p1Total.Goals : p1Total.goals;
  const p2 = typeof p2Total.Goals === "number" ? p2Total.Goals : p2Total.goals;
  return {
    participant1: typeof p1 === "number" ? p1 : 0,
    participant2: typeof p2 === "number" ? p2 : 0,
  };
}

/** Extracts `Update.Clock` — `Seconds` counts down from the period's full allocation. */
function extractClock(update: any): RawScoreEvent["clock"] {
  const clockObj = update?.Clock ?? update?.clock;
  if (!clockObj) return undefined;
  const running = clockObj.Running ?? clockObj.running;
  const seconds = clockObj.Seconds ?? clockObj.seconds;
  if (typeof running === "boolean" && typeof seconds === "number") {
    return { running, seconds };
  }
  return undefined;
}

/**
 * Parses one already-`JSON.parse`d scores record into our RawScoreEvent
 * shape (plus any FixtureInfo it carries). Records arrive in two shapes:
 *
 * - SSE-wrapped: `{ FixtureInfo?: {...}, Update: {...} }` — the live stream shape.
 * - Bare: the Update-record fields directly at the top level, with no
 *   `FixtureInfo`/`Update` wrapper — this is how the
 *   `/api/scores/historical/{fixtureId}` endpoint returns records.
 *
 * Both are handled here so `connectScoresStream` and `backfillFixture` share
 * one parser instead of drifting apart.
 */
export function parseScoresRecord(
  parsed: any,
  rawForLog: string
): ParsedScoresMessage {
  const update = parsed?.Update ?? parsed;
  if (!update) {
    console.warn("[TxLINE] Unparseable scores payload:", rawForLog.slice(0, 200));
    return { event: null };
  }

  const fixtureId = firstDefined<number>(
    update.FixtureId,
    update.fixtureId,
    parsed?.FixtureInfo?.FixtureId
  );
  if (fixtureId === undefined) {
    console.warn("[TxLINE] Unparseable scores payload:", rawForLog.slice(0, 200));
    return { event: null };
  }

  // Ts/Seq back NOT NULL DB columns (see store/eventLog.ts) — reject payloads
  // missing either rather than letting the insert throw downstream.
  const ts = firstDefined<number>(update.Ts, update.ts);
  const seq = firstDefined<number>(update.Seq, update.seq);
  if (ts === undefined || seq === undefined) {
    console.warn("[TxLINE] Unparseable scores payload:", rawForLog.slice(0, 200));
    return { event: null };
  }

  const event: RawScoreEvent = {
    fixtureId,
    action: update.Action ?? update.action,
    statusId: firstDefined<number>(update.StatusId, update.statusId) as number,
    participant: update.Participant ?? update.participant,
    data: update.Data ?? update.data,
    ts,
    seq,
    id: firstDefined<number>(update.Id, update.id),
    confirmed: firstDefined<boolean>(update.Confirmed, update.confirmed),
    score: extractScore(update),
    clock: extractClock(update),
  };

  return { event, fixtureInfo: extractFixtureInfo(parsed?.FixtureInfo) };
}

/**
 * Parses a raw TxLINE scores SSE payload into our RawScoreEvent shape, plus
 * any FixtureInfo it carries. See docs/txline/scores/soccer-feed.md and the
 * Scores Product API PDF for the full raw message shape.
 */
export function parseScoresPayload(raw: string): ParsedScoresMessage {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[TxLINE] Unparseable scores payload:", raw.slice(0, 200));
    return { event: null };
  }
  return parseScoresRecord(parsed, raw);
}

/**
 * Opens a persistent connection to TxLINE's /scores/stream and invokes `onEvent`
 * for every parsed message (and `onFixtureInfo` whenever a message carries
 * fixture metadata). Handles JWT renewal on 401/403 automatically, matching
 * the pattern in docs/txline/reference-code/mainnet/scripts/subscription_free_tier.ts.
 */
export function connectScoresStream(
  session: TxLineSession,
  onEvent: ScoreEventHandler,
  onFixtureInfo?: FixtureInfoHandler,
  onAuthDeath?: () => void
): EventSource {
  const streamUrl = `${API_BASE_URL}/scores/stream`;
  let currentJwt = session.jwt;

  const eventSource = new EventSource(streamUrl, {
    fetch: async (input: any, init: any) => {
      const attempt = (jwt: string) =>
        fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            "Accept-Encoding": "gzip",
            Authorization: `Bearer ${jwt}`,
            "X-Api-Token": session.apiToken,
          },
        });

      let response = await attempt(currentJwt);
      if (response.status === 401 || response.status === 403) {
        console.log("[TxLINE] Scores stream JWT rejected, renewing...");
        currentJwt = await renewJwt();
        response = await attempt(currentJwt);
        if (response.status === 401 || response.status === 403) {
          // eventsource v4 treats a non-200 Response as fatal (failConnection,
          // readyState CLOSED, never retries). Throwing instead routes this
          // through eventsource's auto-retry path so the stream can recover
          // once the auth problem clears.
          onAuthDeath?.();
          throw new Error(
            `[TxLINE] Scores stream auth rejected twice (status ${response.status}) — will retry`
          );
        }
      }
      return response;
    },
  });

  eventSource.onmessage = (evt: MessageEvent) => {
    const { event, fixtureInfo } = parseScoresPayload(evt.data);
    if (fixtureInfo) onFixtureInfo?.(fixtureInfo);
    if (event) onEvent(event);
  };

  eventSource.onerror = (err: unknown) => {
    console.error("[TxLINE] Scores stream error:", err);
  };

  return eventSource;
}
