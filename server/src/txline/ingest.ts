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

/** One player entry within a lineup team block, as captured from `Lineups[].lineups[]`. */
export interface RawLineupPlayer {
  fixturePlayerId?: number;
  /** The player's normativeId — stable across fixtures, used as fixture_players.player_id. */
  playerId: number;
  name?: string;
  number?: string;
  starter?: boolean;
  unit?: number;
}

/** One team block within a `Lineups` array — `normativeId` is the team's TxLINE id. */
export interface RawLineupTeam {
  normativeId?: number;
  players: RawLineupPlayer[];
}

/**
 * Parsed `Lineups` field from a `lineups` action. Verified against
 * `/api/scores/historical/18222446`: `Lineups[]` -> one block per team with
 * `normativeId` + `lineups[]` -> `{ fixturePlayerId, rosterNumber, starter,
 * positionId, unitId, player: { normativeId, preferredName, ... } }`.
 * `participant1Id`/`participant2Id` are the record's own fixture-participant
 * ids (present at the top level of every record, live and historical alike),
 * used to resolve each team block's `normativeId` to participant 1|2.
 */
export interface ParsedLineups {
  participant1Id?: number;
  participant2Id?: number;
  teams: RawLineupTeam[];
}

/** Flattened lineup player, resolved to a participant, ready for `store/players.ts#upsertLineupPlayers`. */
export interface ResolvedLineupPlayer {
  playerId: number;
  name?: string;
  number?: string;
  starter?: boolean;
  unit?: number;
  participant: 1 | 2;
}

/**
 * Parsed `PlayerStats` field — running per-player goal totals keyed by player
 * normativeId (string), one block per participant. Verified shape:
 * `{ Participant1: { "<playerNormativeId>": { "goals": 1, ... } }, ... }`.
 * Arrives on later, unrelated actions too (not necessarily the goal action
 * itself) — every appearance is the current running total, not a delta.
 */
export interface ParsedPlayerStats {
  participant1?: Record<string, number>;
  participant2?: Record<string, number>;
}

export type PlayerDataHandler = (
  fixtureId: number,
  data: { lineups?: ParsedLineups; playerStats?: ParsedPlayerStats }
) => void;

export interface ParsedScoresMessage {
  event: RawScoreEvent | null;
  fixtureInfo?: FixtureInfo;
  /** Resolved fixture id, even when `event` itself failed to parse (e.g. missing ts/seq) — so lineups/playerStats can still be captured. */
  fixtureId?: number;
  lineups?: ParsedLineups;
  playerStats?: ParsedPlayerStats;
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
 * Extracts the `Lineups` field from a `lineups` action record. Tolerant of
 * missing/malformed entries — skips an individual bad player or team rather
 * than dropping the whole message or throwing. A player with no resolvable
 * `player.normativeId` is skipped outright (no stable id to key the row on).
 */
function extractLineups(update: any): ParsedLineups | undefined {
  const teamsRaw = update?.Lineups ?? update?.lineups;
  if (!Array.isArray(teamsRaw) || teamsRaw.length === 0) return undefined;

  const teams: RawLineupTeam[] = [];
  for (const team of teamsRaw) {
    if (!team || typeof team !== "object") continue;
    const normativeId = firstDefined<number>(team.normativeId, team.NormativeId);
    const playersRaw = team.lineups ?? team.Lineups;
    if (!Array.isArray(playersRaw)) continue;

    const players: RawLineupPlayer[] = [];
    for (const p of playersRaw) {
      if (!p || typeof p !== "object") continue;
      const player = p.player ?? p.Player;
      const playerId = firstDefined<number>(player?.normativeId, player?.NormativeId);
      if (playerId === undefined) continue;
      players.push({
        fixturePlayerId: firstDefined<number>(p.fixturePlayerId, p.FixturePlayerId),
        playerId,
        name: firstDefined<string>(player?.preferredName, player?.PreferredName),
        number: firstDefined<string>(p.rosterNumber, p.RosterNumber),
        starter: firstDefined<boolean>(p.starter, p.Starter),
        unit: firstDefined<number>(p.unitId, p.UnitId),
      });
    }
    if (players.length > 0) teams.push({ normativeId, players });
  }
  if (teams.length === 0) return undefined;

  return {
    participant1Id: firstDefined<number>(update?.Participant1Id, update?.participant1Id),
    participant2Id: firstDefined<number>(update?.Participant2Id, update?.participant2Id),
    teams,
  };
}

/**
 * Resolves each team block's `normativeId` to participant 1|2 by matching
 * against the fixture's known participant ids, and flattens to one array
 * ready for `store/players.ts#upsertLineupPlayers`. Prefers the ids carried
 * on the lineups record itself; falls back to caller-supplied ids (typically
 * from the fixtures table) when the record didn't carry them. A team that
 * can't be resolved to either participant is skipped — never guessed.
 */
export function resolveLineupPlayers(
  lineups: ParsedLineups,
  fallback: { participant1Id?: number | null; participant2Id?: number | null }
): ResolvedLineupPlayer[] {
  const participant1Id = lineups.participant1Id ?? fallback.participant1Id ?? undefined;
  const participant2Id = lineups.participant2Id ?? fallback.participant2Id ?? undefined;

  const resolved: ResolvedLineupPlayer[] = [];
  for (const team of lineups.teams) {
    let participant: 1 | 2 | undefined;
    if (
      team.normativeId !== undefined &&
      participant1Id !== undefined &&
      team.normativeId === participant1Id
    ) {
      participant = 1;
    } else if (
      team.normativeId !== undefined &&
      participant2Id !== undefined &&
      team.normativeId === participant2Id
    ) {
      participant = 2;
    }
    if (participant === undefined) continue;
    for (const p of team.players) {
      resolved.push({
        playerId: p.playerId,
        name: p.name,
        number: p.number,
        starter: p.starter,
        unit: p.unit,
        participant,
      });
    }
  }
  return resolved;
}

/**
 * Extracts the `PlayerStats` field. Only the `goals` key is captured (other
 * stat keys present in the feed, e.g. yellowCards/redCards, are out of scope
 * for this table). A player entry with no numeric `goals` field is omitted
 * entirely rather than defaulted to 0, so it never clobbers a previously
 * recorded total for that player.
 */
function extractPlayerStats(update: any): ParsedPlayerStats | undefined {
  const statsRaw = update?.PlayerStats ?? update?.playerStats;
  if (!statsRaw || typeof statsRaw !== "object") return undefined;

  const extractBlock = (block: unknown): Record<string, number> | undefined => {
    if (!block || typeof block !== "object") return undefined;
    const goalsByPlayer: Record<string, number> = {};
    for (const [playerId, stat] of Object.entries(block as Record<string, unknown>)) {
      const s = stat as any;
      const goals = firstDefined<number>(s?.goals, s?.Goals);
      if (typeof goals === "number") goalsByPlayer[playerId] = goals;
    }
    return Object.keys(goalsByPlayer).length > 0 ? goalsByPlayer : undefined;
  };

  const result: ParsedPlayerStats = {};
  const p1 = extractBlock((statsRaw as any).Participant1 ?? (statsRaw as any).participant1);
  const p2 = extractBlock((statsRaw as any).Participant2 ?? (statsRaw as any).participant2);
  if (p1) result.participant1 = p1;
  if (p2) result.participant2 = p2;
  if (!result.participant1 && !result.participant2) return undefined;
  return result;
}

/**
 * Parses one already-`JSON.parse`d scores record into our RawScoreEvent
 * shape (plus any FixtureInfo/Lineups/PlayerStats it carries). Records
 * arrive in two shapes:
 *
 * - SSE-wrapped: `{ FixtureInfo?: {...}, Update: {...} }` — documented for the live stream.
 * - Bare: the Update-record fields directly at the top level, with no
 *   `FixtureInfo`/`Update` wrapper — this is how both the live
 *   `/api/scores/stream` and `/api/scores/historical/{fixtureId}` endpoints
 *   were measured actually sending records (verified against fixture
 *   18222446's historical feed and the live 18257865 stream).
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

  const fixtureInfo = extractFixtureInfo(parsed?.FixtureInfo);

  let lineups: ParsedLineups | undefined;
  try {
    lineups = extractLineups(update);
  } catch (err) {
    console.warn("[TxLINE] Failed to parse Lineups (skipped):", err);
  }

  let playerStats: ParsedPlayerStats | undefined;
  try {
    playerStats = extractPlayerStats(update);
  } catch (err) {
    console.warn("[TxLINE] Failed to parse PlayerStats (skipped):", err);
  }

  // Ts/Seq back NOT NULL DB columns (see store/eventLog.ts) — reject payloads
  // missing either rather than letting the insert throw downstream. Lineups/
  // PlayerStats are still returned even when this happens, since they don't
  // depend on the event log.
  const ts = firstDefined<number>(update.Ts, update.ts);
  const seq = firstDefined<number>(update.Seq, update.seq);
  if (ts === undefined || seq === undefined) {
    console.warn("[TxLINE] Unparseable scores payload:", rawForLog.slice(0, 200));
    return { event: null, fixtureInfo, fixtureId, lineups, playerStats };
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

  return { event, fixtureInfo, fixtureId, lineups, playerStats };
}

/**
 * Parses a raw TxLINE scores SSE payload into our RawScoreEvent shape, plus
 * any FixtureInfo/Lineups/PlayerStats it carries. See
 * docs/txline/scores/soccer-feed.md and the Scores Product API PDF for the
 * full raw message shape.
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
 * for every parsed message (`onFixtureInfo` whenever a message carries fixture
 * metadata, `onPlayerData` whenever one carries Lineups and/or PlayerStats).
 * Handles JWT renewal on 401/403 automatically, matching the pattern in
 * docs/txline/reference-code/mainnet/scripts/subscription_free_tier.ts.
 */
export function connectScoresStream(
  session: TxLineSession,
  onEvent: ScoreEventHandler,
  onFixtureInfo?: FixtureInfoHandler,
  onAuthDeath?: () => void,
  onPlayerData?: PlayerDataHandler
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
    const { event, fixtureInfo, fixtureId, lineups, playerStats } = parseScoresPayload(
      evt.data
    );
    if (fixtureInfo) onFixtureInfo?.(fixtureInfo);
    if ((lineups || playerStats) && fixtureId !== undefined) {
      onPlayerData?.(fixtureId, { lineups, playerStats });
    }
    if (event) onEvent(event);
  };

  eventSource.onerror = (err: unknown) => {
    console.error("[TxLINE] Scores stream error:", err);
  };

  return eventSource;
}
