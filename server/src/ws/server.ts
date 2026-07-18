import { WebSocketServer, type WebSocket } from "ws";
import type { MatchState } from "../reducer/types.js";

export type ClientMessage =
  | { type: "subscribe"; fixtureId: number }
  | { type: "unsubscribe"; fixtureId: number };

/** One row of the match list, joining fixture metadata with known live state. */
export interface FixtureListEntry {
  fixtureId: number;
  participant1: string | null;
  participant1Id: number | null;
  participant2: string | null;
  participant2Id: number | null;
  competition: string | null;
  startTime: number | null;
  statusId: number;
  score: { participant1: number; participant2: number };
  /**
   * Server-computed classification — the frontend must use this verbatim and
   * never derive live/finished from startTime or statusId itself.
   */
  phase: "upcoming" | "live" | "finished";
  /** False when we hold no event data for the fixture (score unknown — hide it). */
  hasData: boolean;
}

/** One player row of the `fixture_players` message — see docs/frontend/BACKEND-CONTRACT.md. */
export interface FixturePlayerEntry {
  id: number;
  name: string | null;
  number: string | null;
  starter: boolean | null;
  unit: number | null;
  participant: 1 | 2 | null;
  goals: number;
}

export type AttestationCluster = "mainnet-beta" | "devnet";

/** One accepted, moderated X post in a `chatter` message — see docs/frontend/BACKEND-CONTRACT.md. */
export interface ChatterPost {
  id: string;
  author: string;
  handle: string;
  text: string;
  ts: number;
  likes: number;
}

export type ServerMessage =
  | { type: "state"; state: MatchState }
  | { type: "keyMoment"; fixtureId: number; moment: MatchState["keyMoments"][number] }
  | { type: "replay_chunk"; fixtureId: number; events: unknown[]; done: boolean }
  | { type: "fixture_list"; fixtures: FixtureListEntry[] }
  | { type: "fixture_players"; fixtureId: number; players: FixturePlayerEntry[] }
  | {
      type: "attestation";
      fixtureId: number;
      txSig: string;
      cluster: AttestationCluster;
      status: "confirmed" | "pending";
    }
  | { type: "chatter"; fixtureId: number; posts: ChatterPost[] };

export type SubscribeHandler = (ws: WebSocket, fixtureId: number) => void;

export class Broadcaster {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<number>>();
  private onSubscribe?: SubscribeHandler;
  private fixtureList: FixtureListEntry[] = [];

  constructor(port: number, onSubscribe?: SubscribeHandler) {
    this.onSubscribe = onSubscribe;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws) => {
      this.subscriptions.set(ws, new Set());
      this.sendFixtureList(ws);
      ws.on("message", (raw) => this.handleMessage(ws, raw.toString()));
      ws.on("close", () => this.subscriptions.delete(ws));
      ws.on("error", (err) => {
        console.warn("[WS] Client socket error:", err.message);
        this.subscriptions.delete(ws);
      });
    });
    console.log(`[WS] Broadcasting on port ${port}`);
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // Guard against valid-JSON-but-wrong-shape payloads (e.g. literal `null`,
    // numbers, or a non-integer fixtureId) — these must never crash the process
    // or poison the Set<number> with a mismatched type.
    if (typeof msg !== "object" || msg === null) return;
    const { type, fixtureId } = msg as Partial<ClientMessage>;
    if (!Number.isInteger(fixtureId)) return;
    const subs = this.subscriptions.get(ws);
    if (!subs) return;
    if (type === "subscribe") {
      subs.add(fixtureId as number);
      this.onSubscribe?.(ws, fixtureId as number);
    }
    if (type === "unsubscribe") subs.delete(fixtureId as number);
  }

  /** Broadcast derived state to every client subscribed to this fixture. */
  broadcastState(state: MatchState): void {
    const payload: ServerMessage = { type: "state", state };
    const json = JSON.stringify(payload);
    for (const [ws, subs] of this.subscriptions) {
      if (subs.has(state.fixtureId) && ws.readyState === ws.OPEN) {
        ws.send(json);
      }
    }
  }

  sendReplayChunk(
    ws: WebSocket,
    fixtureId: number,
    events: unknown[],
    done: boolean
  ): void {
    if (ws.readyState !== ws.OPEN) return;
    const payload: ServerMessage = { type: "replay_chunk", fixtureId, events, done };
    ws.send(JSON.stringify(payload));
  }

  /** Send current state to one specific client (used for replay-completion snapshots). */
  sendState(ws: WebSocket, state: MatchState): void {
    if (ws.readyState === ws.OPEN) {
      const payload: ServerMessage = { type: "state", state };
      ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Sends the current `fixture_players` snapshot to one client, once, on
   * subscribe. Callers are expected to skip calling this entirely when the
   * fixture has no players rows yet (graceful absence — no message sent).
   */
  sendFixturePlayers(
    ws: WebSocket,
    fixtureId: number,
    players: FixturePlayerEntry[]
  ): void {
    if (ws.readyState !== ws.OPEN) return;
    const payload: ServerMessage = { type: "fixture_players", fixtureId, players };
    ws.send(JSON.stringify(payload));
  }

  /**
   * Sends the persisted attestation for one fixture to one client, on
   * subscribe. We only persist an attestation row after on-chain
   * confirmation, so `status` is always "confirmed" here — the field is kept
   * for forward-compat (a future "pending" state before confirmation).
   */
  sendAttestation(
    ws: WebSocket,
    fixtureId: number,
    txSig: string,
    cluster: AttestationCluster
  ): void {
    if (ws.readyState !== ws.OPEN) return;
    const payload: ServerMessage = {
      type: "attestation",
      fixtureId,
      txSig,
      cluster,
      status: "confirmed",
    };
    ws.send(JSON.stringify(payload));
  }

  /**
   * Sends the current cached chatter for one fixture to one client, on
   * subscribe. Callers are expected to skip calling this entirely when there
   * is no cached entry (or it has zero posts) — graceful absence, no message
   * sent (see docs/frontend/BACKEND-CONTRACT.md).
   */
  sendChatter(ws: WebSocket, fixtureId: number, posts: ChatterPost[]): void {
    if (ws.readyState !== ws.OPEN) return;
    const payload: ServerMessage = { type: "chatter", fixtureId, posts };
    ws.send(JSON.stringify(payload));
  }

  /** Broadcast an updated chatter list to every client subscribed to this fixture only. */
  broadcastChatter(fixtureId: number, posts: ChatterPost[]): void {
    const payload: ServerMessage = { type: "chatter", fixtureId, posts };
    const json = JSON.stringify(payload);
    for (const [ws, subs] of this.subscriptions) {
      if (subs.has(fixtureId) && ws.readyState === ws.OPEN) {
        ws.send(json);
      }
    }
  }

  /**
   * All fixtureIds with at least one active subscriber across every
   * connected client — used by the chatter poller to know what's worth
   * polling (only fixtures with a subscriber, further filtered to "live" by
   * the caller).
   */
  subscribedFixtureIds(): Set<number> {
    const ids = new Set<number>();
    for (const subs of this.subscriptions.values()) {
      for (const id of subs) ids.add(id);
    }
    return ids;
  }

  private sendFixtureList(ws: WebSocket): void {
    if (ws.readyState !== ws.OPEN) return;
    const payload: ServerMessage = { type: "fixture_list", fixtures: this.fixtureList };
    ws.send(JSON.stringify(payload));
  }

  /**
   * Updates the cached fixture list and pushes it to every connected client
   * (not just subscribed ones — this is the match list, sent on connect and
   * whenever it changes: a new fixture appears, or a fixture's state
   * transitions to a terminal status).
   */
  broadcastFixtureList(fixtures: FixtureListEntry[]): void {
    this.fixtureList = fixtures;
    const payload: ServerMessage = { type: "fixture_list", fixtures };
    const json = JSON.stringify(payload);
    for (const [ws] of this.subscriptions) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }
}
