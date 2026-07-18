export type DangerLevel = "Safe" | "Attack" | "Danger" | "HighDanger";
export type Zone = "defensive" | "middle" | "attacking";
export type Participant = 1 | 2;

export interface RawScoreEvent {
  fixtureId: number;
  action: string;
  statusId: number;
  participant?: Participant;
  data?: Record<string, unknown>;
  ts: number;
  seq: number;
}

export interface KeyMoment {
  type: "goal" | "red_card" | "var_overturned";
  participant: Participant;
  ts: number;
  seq: number;
}

export interface ZonePressure {
  defensive: number;
  middle: number;
  attacking: number;
}

export interface MatchState {
  fixtureId: number;
  statusId: number;
  score: { participant1: number; participant2: number };
  /** -1 (fully participant2 dominant) .. +1 (fully participant1 dominant) */
  momentum: number;
  pressure: { participant1: ZonePressure; participant2: ZonePressure };
  keyMoments: KeyMoment[];
  lastTs: number;
  lastSeq: number;
}

export function initialMatchState(fixtureId: number): MatchState {
  return {
    fixtureId,
    statusId: 1,
    score: { participant1: 0, participant2: 0 },
    momentum: 0,
    pressure: {
      participant1: { defensive: 0, middle: 0, attacking: 0 },
      participant2: { defensive: 0, middle: 0, attacking: 0 },
    },
    keyMoments: [],
    lastTs: 0,
    lastSeq: 0,
  };
}

/**
 * Terminal fixture signals. TxLINE's docs say finished matches emit
 * action="game_finalised" with statusId=100; the underlying Fusion Scores
 * schema instead uses the `status` action with terminal StatusIds
 * 5 (F), 10 (FET), 13 (FPE). The sources disagree, so we accept either.
 */
export const FINISHED_STATUS_IDS = new Set([5, 10, 13, 100]);

export function isTerminalEvent(event: RawScoreEvent): boolean {
  return (
    event.action === "game_finalised" ||
    FINISHED_STATUS_IDS.has(event.statusId)
  );
}
