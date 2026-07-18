import Database from "better-sqlite3";

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      fixture_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      raw TEXT NOT NULL,
      PRIMARY KEY (fixture_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_events_fixture ON events(fixture_id, seq);

    CREATE TABLE IF NOT EXISTS fixtures (
      fixture_id INTEGER PRIMARY KEY,
      participant1 TEXT,
      participant1_id INTEGER,
      participant2 TEXT,
      participant2_id INTEGER,
      competition TEXT,
      competition_id INTEGER,
      start_time INTEGER,
      raw TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fixture_players (
      fixture_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      name TEXT,
      number TEXT,
      starter INTEGER,
      unit INTEGER,
      participant INTEGER,
      goals INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (fixture_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS fixture_attestation (
      fixture_id INTEGER PRIMARY KEY,
      tx_sig TEXT NOT NULL,
      cluster TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
  `);
  return db;
}
