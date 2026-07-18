import type { MatchState, RawScoreEvent } from "../reducer/types.js";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "demo";

export type ServerMessage =
  | { type: "state"; state: MatchState }
  | { type: "replay_chunk"; fixtureId: number; events: RawScoreEvent[]; done: boolean }
  | { type: string; [key: string]: unknown };

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (status: ConnStatus) => void;

const BACKOFF_START_MS = 500;
const BACKOFF_CAP_MS = 10_000;

/**
 * Thin wrapper over the native WebSocket: exponential-backoff reconnect
 * (capped ~10s), re-send of all active subscriptions after every reconnect,
 * JSON parse with try/catch, silent ignore of unknown message shapes.
 */
export class BoxSeatSocket {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private subs = new Set<number>();
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private backoff = BACKOFF_START_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private everOpened = false;
  private shouldRun = false;
  private status: ConnStatus = "connecting";

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.shouldRun = true;
    this.open();
  }

  dispose(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private setStatus(status: ConnStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const h of this.statusHandlers) h(status);
  }

  private open(): void {
    this.setStatus(this.everOpened ? "reconnecting" : "connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.everOpened = true;
      this.backoff = BACKOFF_START_MS;
      this.setStatus("open");
      for (const id of this.subs) this.send({ type: "subscribe", fixtureId: id });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
        for (const h of this.messageHandlers) h(msg);
      } catch {
        // malformed payload - tolerate and move on
      }
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.shouldRun) this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, BACKOFF_CAP_MS);
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  subscribe(fixtureId: number): void {
    this.subs.add(fixtureId);
    this.send({ type: "subscribe", fixtureId });
  }

  unsubscribe(fixtureId: number): void {
    this.subs.delete(fixtureId);
    this.send({ type: "unsubscribe", fixtureId });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }
}

export const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";

export const socket = new BoxSeatSocket(WS_URL);
