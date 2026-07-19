import "dotenv/config";
import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadServiceWallet } from "./solana/wallet.js";
import { setupTxLineSession, type TxLineSession } from "./txline/auth.js";
import { API_BASE_URL } from "./txline/config.js";
import {
  connectScoresStream,
  resolveLineupPlayers,
  type FixtureInfo,
  type PlayerDataHandler,
} from "./txline/ingest.js";
import { backfillFixture } from "./txline/backfill.js";
import { reduce } from "./reducer/reducer.js";
import {
  FINISHED_STATUS_IDS,
  initialMatchState,
  isTerminalEvent,
  type MatchState,
  type RawScoreEvent,
} from "./reducer/types.js";
import { openDb } from "./store/db.js";
import { appendEvent, readEventLog, listFixtureIds } from "./store/eventLog.js";
import { initKv, kvGet, kvSet } from "./store/kv.js";
import { getFixture, listFixtures, upsertFixture } from "./store/fixtures.js";
import { listFixturePlayers, updatePlayerGoals, upsertLineupPlayers } from "./store/players.js";
import { getAttestation, upsertAttestation } from "./store/attestations.js";
import { Broadcaster, type AttestationCluster, type FixtureListEntry } from "./ws/server.js";
import { attestMatch } from "./solana/attestation.js";
import {
  startChatter,
  getCachedChatter,
  type LiveSubscribedFixture,
} from "./chatter/xChatter.js";
import type Database from "better-sqlite3";

const REPLAY_CHUNK_SIZE = 500;
const STREAM_WATCHDOG_MS = 15_000;
const API_TOKEN_KEY = "txline_api_token";
/** TxLINE's World Cup 2026 competition id. */
const WORLD_CUP_COMPETITION_ID = 72;
const MS_PER_DAY = 86_400_000;
/** Delay between sequential startup attestation catch-up calls — RPC-polite. */
const ATTESTATION_CATCHUP_DELAY_MS = 500;

/** `"devnet"` if SOLANA_RPC_URL mentions it, otherwise `"mainnet-beta"`. */
function clusterFromRpcUrl(rpcUrl: string): AttestationCluster {
  return rpcUrl.includes("devnet") ? "devnet" : "mainnet-beta";
}

function isFinalised(events: RawScoreEvent[]): boolean {
  return events.some(isTerminalEvent);
}

function foldState(fixtureId: number, events: RawScoreEvent[]): MatchState {
  return events.reduce(reduce, initialMatchState(fixtureId));
}

/**
 * Fixtures worth polling X chatter for: currently subscribed AND live. Team
 * names come from persisted fixture metadata — a fixture whose names aren't
 * known yet (rare) is skipped rather than queried with a blank name.
 */
function liveSubscribedFixtures(
  db: Database.Database,
  matchStates: Map<number, MatchState>,
  broadcaster: Broadcaster
): LiveSubscribedFixture[] {
  const subscribedIds = broadcaster.subscribedFixtureIds();
  if (subscribedIds.size === 0) return [];
  const out: LiveSubscribedFixture[] = [];
  for (const entry of buildFixtureList(db, matchStates)) {
    if (!subscribedIds.has(entry.fixtureId)) continue;
    if (entry.phase !== "live") continue;
    if (!entry.participant1 || !entry.participant2) continue;
    out.push({
      fixtureId: entry.fixtureId,
      team1: entry.participant1,
      team2: entry.participant2,
    });
  }
  return out;
}

/** Joins persisted fixture metadata with whatever live state we know, for the `fixture_list` WS message. */
function buildFixtureList(
  db: Database.Database,
  matchStates: Map<number, MatchState>
): FixtureListEntry[] {
  const now = Date.now();
  return listFixtures(db).map((f) => {
    const state = matchStates.get(f.fixtureId);
    const statusId = state?.statusId ?? 1;
    const hasData = state !== undefined && state.lastSeq > 0;

    // Single source of truth for the frontend's live/finished classification.
    // A fixture with no event data whose kickoff is >3h past is
    // finished-unknown (predates our capture/backfill window) — it must never
    // leak into "live".
    let phase: FixtureListEntry["phase"];
    if (FINISHED_STATUS_IDS.has(statusId)) {
      phase = "finished";
    } else if (f.startTime !== null && f.startTime > now) {
      phase = "upcoming";
    } else if (hasData) {
      phase = "live";
    } else if (f.startTime !== null && now - f.startTime > 3 * 60 * 60 * 1000) {
      phase = "finished";
    } else {
      phase = "upcoming";
    }

    const attested = getAttestation(db, f.fixtureId);
    return {
      fixtureId: f.fixtureId,
      participant1: f.participant1,
      participant1Id: f.participant1Id,
      participant2: f.participant2,
      participant2Id: f.participant2Id,
      competition: f.competition,
      startTime: f.startTime,
      statusId,
      score: state?.score ?? { participant1: 0, participant2: 0 },
      phase,
      hasData,
      // Join the persisted on-chain attestation so list surfaces can mark
      // proven fixtures without a per-fixture subscribe.
      ...(attested
        ? { attestation: { txSig: attested.txSig, cluster: attested.cluster as AttestationCluster } }
        : {}),
    };
  });
}

/**
 * Seeds the fixtures table from TxLINE's World Cup fixtures snapshot so the
 * match list has real fixtures (and, later, backfill candidates) even before
 * any live FixtureInfo has arrived. `/api/fixtures/snapshot`'s `startEpochDay`
 * returns everything starting at or within 30 days after that day, so one
 * call anchored 14 days back already covers "last 14 days + next 2". Never
 * throws — a failure here just means the match list stays thin until live
 * FixtureInfo messages backfill it.
 */
async function seedFixturesFromSnapshot(
  db: Database.Database,
  session: TxLineSession
): Promise<void> {
  try {
    const todayEpochDay = Math.floor(Date.now() / MS_PER_DAY);
    const startEpochDay = todayEpochDay - 14;
    const response = await axios.get(`${API_BASE_URL}/fixtures/snapshot`, {
      params: { competitionId: WORLD_CUP_COMPETITION_ID, startEpochDay },
      headers: {
        Authorization: `Bearer ${session.jwt}`,
        "X-Api-Token": session.apiToken,
      },
      timeout: 30_000,
    });
    const fixtures: any[] = Array.isArray(response.data) ? response.data : [];
    let seeded = 0;
    for (const f of fixtures) {
      if (f?.FixtureId === undefined || f?.FixtureId === null) continue;
      upsertFixture(db, {
        fixtureId: f.FixtureId,
        participant1: f.Participant1 ?? null,
        participant1Id: f.Participant1Id ?? null,
        participant2: f.Participant2 ?? null,
        participant2Id: f.Participant2Id ?? null,
        competition: f.Competition ?? null,
        competitionId: f.CompetitionId ?? null,
        startTime: typeof f.StartTime === "number" ? f.StartTime : null,
        raw: JSON.stringify(f),
      });
      seeded++;
    }
    console.log(`[Startup] Seeded ${seeded} World Cup fixture(s) from snapshot.`);
  } catch (err) {
    console.warn(
      "[Startup] Failed to seed fixtures from snapshot (non-fatal):",
      axios.isAxiosError(err) ? err.response?.data ?? err.message : err
    );
  }
}

/**
 * Backfills every fixture we might have stale/incomplete local events for:
 * everything currently in the events table, plus every seeded World Cup
 * fixture whose start time has already passed. Runs sequentially and never
 * lets one fixture's failure stop the rest — a 4xx here is expected for
 * fixtures outside the historical endpoint's 2-week-to-6-hour window.
 */
async function backfillPastFixtures(
  db: Database.Database,
  session: TxLineSession
): Promise<void> {
  const candidates = new Set<number>(listFixtureIds(db));
  const now = Date.now();
  for (const f of listFixtures(db)) {
    if (f.startTime !== null && f.startTime < now) {
      candidates.add(f.fixtureId);
    }
  }

  console.log(
    `[Startup] Backfilling ${candidates.size} fixture(s) from TxLINE historical data...`
  );
  for (const fixtureId of candidates) {
    try {
      const result = await backfillFixture(db, session, fixtureId);
      if (result.backfilled) {
        console.log(
          `[Backfill] Fixture ${fixtureId}: replaced local log with ${result.count} authoritative event(s).`
        );
      }
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status !== undefined && status >= 400 && status < 500) {
        console.warn(
          `[Backfill] Fixture ${fixtureId}: historical fetch rejected (${status}) — likely outside the 2wk-6h coverage window. Keeping existing events.`
        );
      } else {
        console.warn(
          `[Backfill] Fixture ${fixtureId}: failed — keeping existing events.`,
          axios.isAxiosError(err) ? err.message : err
        );
      }
    }
  }
}

async function main() {
  const serviceWallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
  const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const tokenMint = new PublicKey(process.env.TXL_TOKEN_MINT!);
  const db = openDb(process.env.DB_PATH!);
  initKv(db);
  const cluster = clusterFromRpcUrl(process.env.SOLANA_RPC_URL!);

  const matchStates = new Map<number, MatchState>();
  const attested = new Set<number>();

  const broadcaster = new Broadcaster(
    // Cloud hosts (Railway) inject PORT; local dev uses WS_PORT from .env.
    Number(process.env.PORT ?? process.env.WS_PORT),
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
      } else if (matchStates.has(fixtureId)) {
        // Live fixture we already have in-memory state for: send an immediate
        // snapshot rather than making the client wait for the next live event.
        broadcaster.sendState(ws, matchStates.get(fixtureId)!);
      }

      // Players/attestation: sent once per subscribe, independent of the
      // live/replay branch above. Graceful absence — nothing sent when the
      // fixture has no players rows / no attestation row yet.
      const players = listFixturePlayers(db, fixtureId);
      if (players.length > 0) {
        broadcaster.sendFixturePlayers(
          ws,
          fixtureId,
          players.map((p) => ({
            id: p.playerId,
            name: p.name,
            number: p.number,
            starter: p.starter === null ? null : p.starter === 1,
            unit: p.unit,
            participant: p.participant,
            goals: p.goals,
          }))
        );
      }
      const attestation = getAttestation(db, fixtureId);
      if (attestation) {
        broadcaster.sendAttestation(
          ws,
          fixtureId,
          attestation.txSig,
          attestation.cluster as AttestationCluster
        );
      }

      // Chatter: graceful absence — nothing sent when there's no cache entry
      // yet (no token, fixture never live/subscribed long enough to poll, or
      // every fetched post got moderated out).
      const chatter = getCachedChatter(db, fixtureId);
      if (chatter && chatter.posts.length > 0) {
        broadcaster.sendChatter(ws, fixtureId, chatter.posts);
      }
    }
  );

  // Cloud bootstrap: a fresh volume has an empty kv store — seed it from env
  // so a cold instance reuses the existing TxLINE session (avoiding the
  // already-subscribed trap) and serves the demo fixture's cached chatter.
  if (!kvGet(db, API_TOKEN_KEY) && process.env.TXLINE_API_TOKEN) {
    kvSet(db, API_TOKEN_KEY, process.env.TXLINE_API_TOKEN);
    console.log("[Startup] Seeded TxLINE API token from env.");
  }
  if (process.env.CHATTER_SEED_FIXTURE && process.env.CHATTER_SEED_JSON) {
    const seedKey = `chatter:${process.env.CHATTER_SEED_FIXTURE}`;
    if (!kvGet(db, seedKey)) {
      kvSet(db, seedKey, process.env.CHATTER_SEED_JSON);
      console.log(`[Startup] Seeded chatter cache for fixture ${process.env.CHATTER_SEED_FIXTURE} from env.`);
    }
  }

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

  // Seed real fixture metadata (names, competition, start times) so the
  // match list isn't empty/numeric-only before any live FixtureInfo arrives.
  await seedFixturesFromSnapshot(db, session);

  // Re-derive event logs for past fixtures from TxLINE's historical endpoint
  // BEFORE folding them into in-memory state — this is what corrects any
  // events recorded by the older, lossier parser (missing Id/Score/Clock).
  await backfillPastFixtures(db, session);

  // Rebuild in-memory state from the (now-corrected) local event log. `attested`
  // is seeded from the fixture_attestation TABLE (has a row = actually attested
  // on-chain), not blanket-marked for every terminal fixture — otherwise a
  // backfilled-finished fixture could sit forever with no attestation and no
  // chip. Fixtures that are terminal but missing a row are queued for the
  // catch-up pass below instead.
  const terminalFixtureIds: number[] = [];
  for (const fixtureId of listFixtureIds(db)) {
    const events = readEventLog(db, fixtureId);
    matchStates.set(fixtureId, foldState(fixtureId, events));
    if (isFinalised(events)) {
      terminalFixtureIds.push(fixtureId);
      if (getAttestation(db, fixtureId)) attested.add(fixtureId);
    }
  }
  console.log(
    `[Startup] Rebuilt state for ${matchStates.size} fixture(s) from event log.`
  );

  broadcaster.broadcastFixtureList(buildFixtureList(db, matchStates));

  // Attestation catch-up: terminal fixtures with no persisted attestation row
  // (e.g. finalised before this change existed, or a prior attempt failed)
  // get attested now. Sequential with a small delay between calls to be
  // RPC-polite — fire-and-forget relative to startup (never awaited by
  // `main`), persists via `.then` on success. `attestMatch` never throws.
  (async () => {
    const pending = terminalFixtureIds.filter((id) => !attested.has(id));
    if (pending.length === 0) return;
    console.log(
      `[Startup] Attestation catch-up: ${pending.length} terminal fixture(s) missing an attestation row.`
    );
    for (const fixtureId of pending) {
      if (attested.has(fixtureId)) continue; // a live terminal event may have raced us
      attested.add(fixtureId);
      const state = matchStates.get(fixtureId);
      if (!state) continue;
      await attestMatch(connection, serviceWallet, state).then((sig) => {
        if (!sig) return;
        try {
          upsertAttestation(db, { fixtureId, txSig: sig, cluster, ts: Date.now() });
          console.log(`[Startup] Attestation catch-up: fixture ${fixtureId} -> ${sig}`);
        } catch (err) {
          console.error(
            `[Startup] Failed to persist catch-up attestation for fixture ${fixtureId}:`,
            err
          );
        }
      });
      await new Promise((resolve) => setTimeout(resolve, ATTESTATION_CATCHUP_DELAY_MS));
    }
  })();

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
        attestMatch(connection, serviceWallet, next).then((sig) => {
          if (!sig) return;
          try {
            upsertAttestation(db, {
              fixtureId: event.fixtureId,
              txSig: sig,
              cluster,
              ts: Date.now(),
            });
          } catch (err) {
            console.error(
              `[Attestation] Failed to persist attestation for fixture ${event.fixtureId}:`,
              err
            );
          }
        });
        // A fixture just went terminal — refresh the match list so clients
        // see its final score/status without waiting for a new fixture.
        broadcaster.broadcastFixtureList(buildFixtureList(db, matchStates));
      }
    } catch (err) {
      console.error("[Ingest] Failed to process event (skipped):", err);
    }
  };

  const onPlayerData: PlayerDataHandler = (fixtureId, { lineups, playerStats }) => {
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
      console.error("[Ingest] Failed to process player data (skipped):", err);
    }
  };

  const onFixtureInfo = (info: FixtureInfo) => {
    try {
      const { isNew } = upsertFixture(db, {
        fixtureId: info.fixtureId,
        participant1: info.participant1 ?? null,
        participant1Id: info.participant1Id ?? null,
        participant2: info.participant2 ?? null,
        participant2Id: info.participant2Id ?? null,
        competition: info.competition ?? null,
        competitionId: info.competitionId ?? null,
        startTime: info.startTime ?? null,
        raw: info.raw,
      });
      if (isNew) {
        broadcaster.broadcastFixtureList(buildFixtureList(db, matchStates));
      }
    } catch (err) {
      console.error("[Ingest] Failed to upsert fixture info (skipped):", err);
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

  let stream = connectScoresStream(session, onEvent, onFixtureInfo, onAuthDeath, onPlayerData);
  // Watchdog: some SSE failure modes close the stream permanently — resurrect it.
  setInterval(() => {
    if (stream.readyState === 2 /* CLOSED */) {
      console.warn("[TxLINE] Scores stream closed — reconnecting...");
      stream = connectScoresStream(session, onEvent, onFixtureInfo, onAuthDeath, onPlayerData);
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
          stream = connectScoresStream(
            newSession,
            onEvent,
            onFixtureInfo,
            onAuthDeath,
            onPlayerData
          );
        } catch (err) {
          console.error(
            "[TxLINE] Failed to recover from persistent auth failure:",
            err
          );
        }
      })();
    }
  }, STREAM_WATCHDOG_MS);

  // Token-gated: dormant (one log line, no polling) unless X_BEARER_TOKEN is set.
  const chatterHandle = startChatter({
    db,
    broadcaster,
    getLiveSubscribedFixtures: () => liveSubscribedFixtures(db, matchStates, broadcaster),
  });

  const shutdown = () => {
    console.log("[Shutdown] Closing...");
    try {
      chatterHandle.stop();
    } catch {}
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
