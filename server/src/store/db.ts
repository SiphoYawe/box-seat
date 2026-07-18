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
  `);
  return db;
}
