import type Database from "better-sqlite3";

export interface FixtureAttestation {
  fixtureId: number;
  txSig: string;
  cluster: string;
  ts: number;
}

/** Persists a confirmed on-chain attestation for a fixture (idempotent — safe to call again on the same fixture). */
export function upsertAttestation(
  db: Database.Database,
  attestation: FixtureAttestation
): void {
  db.prepare(
    `INSERT INTO fixture_attestation (fixture_id, tx_sig, cluster, ts)
     VALUES (@fixtureId, @txSig, @cluster, @ts)
     ON CONFLICT(fixture_id) DO UPDATE SET
       tx_sig = excluded.tx_sig,
       cluster = excluded.cluster,
       ts = excluded.ts`
  ).run(attestation);
}

export function getAttestation(
  db: Database.Database,
  fixtureId: number
): FixtureAttestation | undefined {
  return db
    .prepare(
      `SELECT fixture_id AS fixtureId, tx_sig AS txSig, cluster, ts
       FROM fixture_attestation WHERE fixture_id = ?`
    )
    .get(fixtureId) as FixtureAttestation | undefined;
}
