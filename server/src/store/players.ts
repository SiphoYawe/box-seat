import type Database from "better-sqlite3";

export interface FixturePlayerRow {
  fixtureId: number;
  playerId: number;
  name: string | null;
  number: string | null;
  starter: 0 | 1 | null;
  unit: number | null;
  participant: 1 | 2 | null;
  goals: number;
}

/** One lineup player, already resolved to a participant, ready to upsert. */
export interface LineupPlayerInput {
  playerId: number;
  name?: string | null;
  number?: string | null;
  starter?: boolean | null;
  unit?: number | null;
  participant: 1 | 2;
}

function toStarterColumn(starter: boolean | null | undefined): 0 | 1 | null {
  if (starter === undefined || starter === null) return null;
  return starter ? 1 : 0;
}

/**
 * Upserts one fixture's `lineups` action into `fixture_players` — inserts new
 * rows, or updates name/number/starter/unit/participant on existing ones,
 * while always preserving whatever `goals` total has already accumulated
 * (goals only ever move via `updatePlayerGoals`, never here).
 */
export function upsertLineupPlayers(
  db: Database.Database,
  fixtureId: number,
  players: LineupPlayerInput[]
): void {
  if (players.length === 0) return;
  const stmt = db.prepare(`
    INSERT INTO fixture_players (fixture_id, player_id, name, number, starter, unit, participant, goals)
    VALUES (@fixtureId, @playerId, @name, @number, @starter, @unit, @participant, 0)
    ON CONFLICT(fixture_id, player_id) DO UPDATE SET
      name = excluded.name,
      number = excluded.number,
      starter = excluded.starter,
      unit = excluded.unit,
      participant = excluded.participant
  `);
  const insertMany = db.transaction((rows: LineupPlayerInput[]) => {
    for (const p of rows) {
      stmt.run({
        fixtureId,
        playerId: p.playerId,
        name: p.name ?? null,
        number: p.number ?? null,
        starter: toStarterColumn(p.starter),
        unit: p.unit ?? null,
        participant: p.participant,
      });
    }
  });
  insertMany(players);
}

/**
 * Replaces the running goal totals for every player named in `goalsByPlayerId`
 * — TxLINE's `PlayerStats.ParticipantN` block, player normativeId (string) ->
 * absolute goal count (a running total, not a delta — see docs/frontend/BACKEND-CONTRACT.md).
 * Creates a row for a player not yet seen via `upsertLineupPlayers`, leaving the
 * descriptive fields null until a `lineups` action fills them in.
 */
export function updatePlayerGoals(
  db: Database.Database,
  fixtureId: number,
  participant: 1 | 2,
  goalsByPlayerId: Record<string, number>
): void {
  const entries = Object.entries(goalsByPlayerId).filter(
    ([playerId, goals]) => Number.isFinite(Number(playerId)) && Number.isFinite(goals)
  );
  if (entries.length === 0) return;

  const stmt = db.prepare(`
    INSERT INTO fixture_players (fixture_id, player_id, name, number, starter, unit, participant, goals)
    VALUES (@fixtureId, @playerId, NULL, NULL, NULL, NULL, @participant, @goals)
    ON CONFLICT(fixture_id, player_id) DO UPDATE SET
      goals = excluded.goals,
      participant = excluded.participant
  `);
  const updateMany = db.transaction((rows: [string, number][]) => {
    for (const [playerIdStr, goals] of rows) {
      stmt.run({ fixtureId, playerId: Number(playerIdStr), participant, goals });
    }
  });
  updateMany(entries);
}

export function listFixturePlayers(
  db: Database.Database,
  fixtureId: number
): FixturePlayerRow[] {
  return db
    .prepare(
      `SELECT
         fixture_id AS fixtureId,
         player_id AS playerId,
         name,
         number,
         starter,
         unit,
         participant,
         goals
       FROM fixture_players
       WHERE fixture_id = ?`
    )
    .all(fixtureId) as FixturePlayerRow[];
}
