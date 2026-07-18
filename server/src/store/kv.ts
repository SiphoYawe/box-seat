import type Database from "better-sqlite3";

export function initKv(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

export function kvGet(db: Database.Database, key: string): string | null {
  const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function kvSet(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
