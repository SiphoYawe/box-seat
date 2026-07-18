import type Database from "better-sqlite3";
import type { RawScoreEvent } from "../reducer/types.js";

export function appendEvent(db: Database.Database, event: RawScoreEvent): void {
  db.prepare(
    `INSERT OR IGNORE INTO events (fixture_id, seq, ts, action, raw)
     VALUES (@fixtureId, @seq, @ts, @action, @raw)`
  ).run({
    fixtureId: event.fixtureId,
    seq: event.seq,
    ts: event.ts,
    action: event.action,
    raw: JSON.stringify(event),
  });
}

export function readEventLog(
  db: Database.Database,
  fixtureId: number
): RawScoreEvent[] {
  const rows = db
    .prepare(
      `SELECT raw FROM events WHERE fixture_id = ? ORDER BY seq ASC`
    )
    .all(fixtureId) as { raw: string }[];
  return rows.map((row) => JSON.parse(row.raw) as RawScoreEvent);
}

export function listFixtureIds(db: Database.Database): number[] {
  const rows = db
    .prepare(`SELECT DISTINCT fixture_id AS fixtureId FROM events`)
    .all() as { fixtureId: number }[];
  return rows.map((r) => r.fixtureId);
}
