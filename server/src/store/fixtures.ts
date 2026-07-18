import type Database from "better-sqlite3";

export interface FixtureMeta {
  fixtureId: number;
  participant1: string | null;
  participant1Id: number | null;
  participant2: string | null;
  participant2Id: number | null;
  competition: string | null;
  competitionId: number | null;
  /** Epoch milliseconds, or null if unknown. */
  startTime: number | null;
  raw: string;
}

export interface UpsertFixtureInput {
  fixtureId: number;
  participant1?: string | null;
  participant1Id?: number | null;
  participant2?: string | null;
  participant2Id?: number | null;
  competition?: string | null;
  competitionId?: number | null;
  startTime?: number | null;
  raw: string;
}

/**
 * Inserts or updates a fixture's metadata row. Returns `isNew` so callers
 * can rebroadcast the fixture list only when this actually adds a fixture
 * the client hasn't seen before, rather than on every repeat FixtureInfo.
 */
export function upsertFixture(
  db: Database.Database,
  info: UpsertFixtureInput
): { isNew: boolean } {
  const params = {
    fixtureId: info.fixtureId,
    participant1: info.participant1 ?? null,
    participant1Id: info.participant1Id ?? null,
    participant2: info.participant2 ?? null,
    participant2Id: info.participant2Id ?? null,
    competition: info.competition ?? null,
    competitionId: info.competitionId ?? null,
    startTime: info.startTime ?? null,
    raw: info.raw,
  };

  const insertResult = db
    .prepare(
      `INSERT OR IGNORE INTO fixtures
         (fixture_id, participant1, participant1_id, participant2, participant2_id, competition, competition_id, start_time, raw)
       VALUES
         (@fixtureId, @participant1, @participant1Id, @participant2, @participant2Id, @competition, @competitionId, @startTime, @raw)`
    )
    .run(params);

  const isNew = insertResult.changes > 0;
  if (!isNew) {
    db.prepare(
      `UPDATE fixtures SET
         participant1 = @participant1,
         participant1_id = @participant1Id,
         participant2 = @participant2,
         participant2_id = @participant2Id,
         competition = @competition,
         competition_id = @competitionId,
         start_time = @startTime,
         raw = @raw
       WHERE fixture_id = @fixtureId`
    ).run(params);
  }

  return { isNew };
}

/** Looks up one fixture's metadata (participant ids, etc). Undefined if unknown. */
export function getFixture(
  db: Database.Database,
  fixtureId: number
): FixtureMeta | undefined {
  return db
    .prepare(
      `SELECT
         fixture_id AS fixtureId,
         participant1,
         participant1_id AS participant1Id,
         participant2,
         participant2_id AS participant2Id,
         competition,
         competition_id AS competitionId,
         start_time AS startTime,
         raw
       FROM fixtures WHERE fixture_id = ?`
    )
    .get(fixtureId) as FixtureMeta | undefined;
}

export function listFixtures(db: Database.Database): FixtureMeta[] {
  return db
    .prepare(
      `SELECT
         fixture_id AS fixtureId,
         participant1,
         participant1_id AS participant1Id,
         participant2,
         participant2_id AS participant2Id,
         competition,
         competition_id AS competitionId,
         start_time AS startTime,
         raw
       FROM fixtures`
    )
    .all() as FixtureMeta[];
}
