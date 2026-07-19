// Re-attests a fixture with the CURRENT reducer state: folds the stored
// event log through the reducer (same code the backend runs), writes a fresh
// SPL Memo attestation on-chain, and upserts the fixture_attestation row so
// the frontend's replay-integrity check verifies against current data.
// Idempotent-safe (a new memo each run; the row points at the newest sig).
//
// Usage (from repo root): npx tsx scripts/reattest.mts <fixtureId> [more ids]
import { Connection } from "@solana/web3.js";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

// dotenv resolves packages from the script's own tree (repo root has none) -
// read server/.env directly instead
const envPath = join(ROOT, "server/.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const require2 = createRequire(join(ROOT, "server/package.json"));

const { loadServiceWallet } = await import(join(ROOT, "server/src/solana/wallet.ts"));
const { attestMatch } = await import(join(ROOT, "server/src/solana/attestation.ts"));
const { openDb } = await import(join(ROOT, "server/src/store/db.ts"));
const { readEventLog } = await import(join(ROOT, "server/src/store/eventLog.ts"));
const { reduce } = await import(join(ROOT, "server/src/reducer/reducer.ts"));
const { initialMatchState, isTerminalEvent } = await import(join(ROOT, "server/src/reducer/types.ts"));
const { upsertAttestation } = await import(join(ROOT, "server/src/store/attestations.ts"));

const fixtureIds = process.argv.slice(2).map(Number);
if (fixtureIds.length === 0) {
  console.error("usage: npx tsx scripts/reattest.mts <fixtureId> [more ids]");
  process.exit(1);
}

const dbPath = process.env.DB_PATH ?? join(ROOT, "server/box-seat.db");
const db = openDb(dbPath);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const wallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);

for (const fixtureId of fixtureIds) {
  const events = readEventLog(db, fixtureId);
  if (events.length === 0) {
    console.log(`fixture ${fixtureId}: no events - skipped`);
    continue;
  }
  if (!events.some(isTerminalEvent)) {
    console.log(`fixture ${fixtureId}: not finalised - skipped`);
    continue;
  }
  const state = events.reduce(reduce, initialMatchState(fixtureId));
  console.log(
    `fixture ${fixtureId}: folding ${events.length} events -> ${state.score.participant1}-${state.score.participant2}, ${state.keyMoments.length} moments, lastSeq ${state.lastSeq}`
  );
  const sig = await attestMatch(connection, wallet, state);
  if (sig) {
    const cluster = process.env.SOLANA_RPC_URL!.includes("devnet") ? "devnet" : "mainnet-beta";
    upsertAttestation(db, { fixtureId, txSig: sig, cluster, ts: Date.now() });
    console.log(`fixture ${fixtureId}: re-attested ${sig}`);
  } else {
    console.log(`fixture ${fixtureId}: attestation failed (see logs)`);
  }
}
db.close();
