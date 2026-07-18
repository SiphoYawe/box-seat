import type Database from "better-sqlite3";
import axios from "axios";
import { API_BASE_URL } from "./config.js";
import type { TxLineSession } from "./auth.js";
import {
  parseScoresRecord,
  resolveLineupPlayers,
  type ParsedLineups,
  type ParsedPlayerStats,
} from "./ingest.js";
import { appendEvent } from "../store/eventLog.js";
import { getFixture } from "../store/fixtures.js";
import { upsertLineupPlayers, updatePlayerGoals } from "../store/players.js";
import type { RawScoreEvent } from "../reducer/types.js";

export interface BackfillResult {
  backfilled: boolean;
  count: number;
}

/**
 * `/api/scores/historical/{fixtureId}` is documented (openapi.yaml) as
 * returning a JSON array, but in practice it responds
 * `content-type: text/event-stream` — the same `data: {...}` framing as the
 * live stream, just batched into one response instead of pushed
 * incrementally. Axios can't auto-parse that as JSON (it isn't one JSON
 * document), so `response.data` arrives as the raw multi-line string; this
 * pulls one record out of each `data:` line. Falls back to treating the
 * body as an already-parsed JSON array, in case that ever changes.
 */
function parseHistoricalResponseBody(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data !== "string") return [];

  const records: unknown[] = [];
  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload) continue;
    try {
      records.push(JSON.parse(payload));
    } catch {
      // Skip an individual unparseable line rather than failing the batch.
    }
  }
  return records;
}

/**
 * Persists whatever lineups/player-stats one parsed record carried. Tolerant
 * of missing fixture metadata (falls back to the fixtures table for
 * participant resolution) and never throws — a bad record here must not
 * abort the rest of the backfill.
 */
function capturePlayerData(
  db: Database.Database,
  fixtureId: number,
  lineups: ParsedLineups | undefined,
  playerStats: ParsedPlayerStats | undefined
): void {
  try {
    if (lineups) {
      const fixture = getFixture(db, fixtureId);
      const resolved = resolveLineupPlayers(lineups, {
        participant1Id: fixture?.participant1Id ?? undefined,
        participant2Id: fixture?.participant2Id ?? undefined,
      });
      if (resolved.length > 0) upsertLineupPlayers(db, fixtureId, resolved);
    }
    if (playerStats?.participant1) {
      updatePlayerGoals(db, fixtureId, 1, playerStats.participant1);
    }
    if (playerStats?.participant2) {
      updatePlayerGoals(db, fixtureId, 2, playerStats.participant2);
    }
  } catch (err) {
    console.warn(
      `[Backfill] Fixture ${fixtureId}: failed to persist player data (skipped):`,
      err
    );
  }
}

/**
 * Re-derives one fixture's local event log from TxLINE's historical endpoint
 * — the authoritative source of truth for a completed/in-progress fixture's
 * message history. This is what corrects any locally-recorded events that
 * were parsed by an older, lossier version of the parser (e.g. before we
 * captured Id/Score/Clock). Along the way, also captures any lineups/
 * player-goal data the records carry (idempotent upserts — safe to re-run).
 *
 * Safety: existing event rows are only replaced once we have a successful,
 * non-empty, *parseable* fetch in hand. `/scores/historical/{fixtureId}`
 * only serves fixtures started between two weeks and six hours ago — a 4xx
 * for anything outside that window (or any other failure) must leave
 * whatever we already recorded live untouched, not wipe it.
 */
export async function backfillFixture(
  db: Database.Database,
  session: TxLineSession,
  fixtureId: number
): Promise<BackfillResult> {
  const response = await axios.get(
    `${API_BASE_URL}/scores/historical/${fixtureId}`,
    {
      headers: {
        Authorization: `Bearer ${session.jwt}`,
        "X-Api-Token": session.apiToken,
      },
      timeout: 30_000,
    }
  );

  const records = parseHistoricalResponseBody(response.data);
  if (records.length === 0) {
    return { backfilled: false, count: 0 };
  }

  // Records here may be SSE-wrapped or bare Update-record shape — same
  // parser as the live stream so the two paths can't drift apart.
  const events: RawScoreEvent[] = [];
  for (const record of records) {
    const {
      event,
      fixtureId: recordFixtureId,
      lineups,
      playerStats,
    } = parseScoresRecord(record, JSON.stringify(record));
    if (event) events.push(event);
    if (lineups || playerStats) {
      capturePlayerData(db, recordFixtureId ?? event?.fixtureId ?? fixtureId, lineups, playerStats);
    }
  }

  if (events.length === 0) {
    // The endpoint responded with data but none of it parsed — most likely
    // an unrecognized record shape. Don't wipe a working log for zero
    // replacement rows; surface it loudly instead.
    console.warn(
      `[Backfill] Fixture ${fixtureId}: historical endpoint returned ${records.length} record(s), none parseable — keeping existing events.`
    );
    return { backfilled: false, count: 0 };
  }

  const deleteExisting = db.prepare(`DELETE FROM events WHERE fixture_id = ?`);
  const replace = db.transaction((evts: RawScoreEvent[]) => {
    deleteExisting.run(fixtureId);
    for (const evt of evts) appendEvent(db, evt);
  });
  replace(events);

  return { backfilled: true, count: events.length };
}
