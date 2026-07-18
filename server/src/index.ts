import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadServiceWallet } from "./solana/wallet.js";
import { setupTxLineSession, type TxLineSession } from "./txline/auth.js";
import { connectScoresStream } from "./txline/ingest.js";
import { reduce } from "./reducer/reducer.js";
import {
  initialMatchState,
  isTerminalEvent,
  type MatchState,
  type RawScoreEvent,
} from "./reducer/types.js";
import { openDb } from "./store/db.js";
import { appendEvent, readEventLog, listFixtureIds } from "./store/eventLog.js";
import { initKv, kvGet, kvSet } from "./store/kv.js";
import { Broadcaster } from "./ws/server.js";
import { attestMatch } from "./solana/attestation.js";

const REPLAY_CHUNK_SIZE = 500;
const STREAM_WATCHDOG_MS = 15_000;
const API_TOKEN_KEY = "txline_api_token";

function isFinalised(events: RawScoreEvent[]): boolean {
  return events.some(isTerminalEvent);
}

function foldState(fixtureId: number, events: RawScoreEvent[]): MatchState {
  return events.reduce(reduce, initialMatchState(fixtureId));
}

async function main() {
  const serviceWallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
  const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const tokenMint = new PublicKey(process.env.TXL_TOKEN_MINT!);
  const db = openDb(process.env.DB_PATH!);
  initKv(db);

  const matchStates = new Map<number, MatchState>();
  const attested = new Set<number>();

  // Rebuild in-memory state from the local event log (restart resilience).
  for (const fixtureId of listFixtureIds(db)) {
    const events = readEventLog(db, fixtureId);
    matchStates.set(fixtureId, foldState(fixtureId, events));
    if (isFinalised(events)) attested.add(fixtureId); // don't re-attest after restart
  }
  console.log(
    `[Startup] Rebuilt state for ${matchStates.size} fixture(s) from event log.`
  );

  const broadcaster = new Broadcaster(
    Number(process.env.WS_PORT),
    (ws, fixtureId) => {
      // Contract: finished fixtures get full history as replay chunks, then current state.
      const events = readEventLog(db, fixtureId);
      if (events.length > 0 && isFinalised(events)) {
        for (let i = 0; i < events.length; i += REPLAY_CHUNK_SIZE) {
          const chunk = events.slice(i, i + REPLAY_CHUNK_SIZE);
          broadcaster.sendReplayChunk(
            ws,
            fixtureId,
            chunk,
            i + REPLAY_CHUNK_SIZE >= events.length
          );
        }
        const state = matchStates.get(fixtureId) ?? foldState(fixtureId, events);
        broadcaster.sendState(ws, state);
        return;
      }
      // Live fixture we already have in-memory state for: send an immediate
      // snapshot rather than making the client wait for the next live event.
      if (matchStates.has(fixtureId)) {
        broadcaster.sendState(ws, matchStates.get(fixtureId)!);
      }
    }
  );

  console.log("[Startup] Authenticating with TxLINE...");
  const persistedToken = kvGet(db, API_TOKEN_KEY);
  if (persistedToken) {
    console.log("[Startup] Reusing persisted TxLINE API token.");
  }
  let session: TxLineSession = await setupTxLineSession(
    serviceWallet,
    connection,
    tokenMint,
    persistedToken || undefined
  );
  kvSet(db, API_TOKEN_KEY, session.apiToken);
  console.log("[Startup] TxLINE session acquired.");

  const onEvent = (event: RawScoreEvent) => {
    try {
      appendEvent(db, event);
      const current =
        matchStates.get(event.fixtureId) ?? initialMatchState(event.fixtureId);
      const next = reduce(current, event);
      matchStates.set(event.fixtureId, next);
      broadcaster.broadcastState(next);
      if (isTerminalEvent(event) && !attested.has(event.fixtureId)) {
        attested.add(event.fixtureId);
        // Fire-and-forget — attestMatch never throws (see solana/attestation.ts).
        attestMatch(connection, serviceWallet, next);
      }
    } catch (err) {
      console.error("[Ingest] Failed to process event (skipped):", err);
    }
  };

  // Counts consecutive stream auth deaths (post-renewal 401/403). A wedged
  // persisted token renews its JWT fine but never regains API access, so the
  // stream keeps dying the same way forever — this counter detects that
  // pattern so the watchdog can discard the token and re-subscribe from
  // scratch instead of retrying the same broken token indefinitely.
  let authDeaths = 0;
  const onAuthDeath = () => {
    authDeaths++;
  };

  let stream = connectScoresStream(session, onEvent, onAuthDeath);
  // Watchdog: some SSE failure modes close the stream permanently — resurrect it.
  setInterval(() => {
    if (stream.readyState === 2 /* CLOSED */) {
      console.warn("[TxLINE] Scores stream closed — reconnecting...");
      stream = connectScoresStream(session, onEvent, onAuthDeath);
    }
    if (authDeaths >= 5) {
      console.warn(
        "[TxLINE] Persistent auth failure — discarding persisted token and re-subscribing..."
      );
      authDeaths = 0;
      (async () => {
        try {
          kvSet(db, API_TOKEN_KEY, "");
          const newSession = await setupTxLineSession(
            serviceWallet,
            connection,
            tokenMint
          );
          kvSet(db, API_TOKEN_KEY, newSession.apiToken);
          session = newSession;
          stream.close();
          stream = connectScoresStream(newSession, onEvent, onAuthDeath);
        } catch (err) {
          console.error(
            "[TxLINE] Failed to recover from persistent auth failure:",
            err
          );
        }
      })();
    }
  }, STREAM_WATCHDOG_MS);

  const shutdown = () => {
    console.log("[Shutdown] Closing...");
    try {
      stream.close();
    } catch {}
    try {
      db.close();
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[Startup] Box Seat backend running.");
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
