import { WebSocketServer, type WebSocket } from "ws";
import type { MatchState } from "../reducer/types.js";

export type ClientMessage =
  | { type: "subscribe"; fixtureId: number }
  | { type: "unsubscribe"; fixtureId: number };

export type ServerMessage =
  | { type: "state"; state: MatchState }
  | { type: "keyMoment"; fixtureId: number; moment: MatchState["keyMoments"][number] }
  | { type: "replay_chunk"; fixtureId: number; events: unknown[]; done: boolean };

export type SubscribeHandler = (ws: WebSocket, fixtureId: number) => void;

export class Broadcaster {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<number>>();
  private onSubscribe?: SubscribeHandler;

  constructor(port: number, onSubscribe?: SubscribeHandler) {
    this.onSubscribe = onSubscribe;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws) => {
      this.subscriptions.set(ws, new Set());
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
}
