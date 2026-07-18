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
  /**
   * Action id (Update.Id). Messages for the same real-world action — e.g. an
   * unconfirmed goal followed by its confirmation — share this id. Use it to
   * dedupe repeated messages instead of re-applying the reducer per message.
   */
  id?: number;
  /** Action confirmation status (Update.Confirmed). */
  confirmed?: boolean;
  /**
   * Authoritative running scoreline (Update.Score.ParticipantN.Total.Goals),
   * present only on actions that can modify the score-line (goal,
   * score_adjustment, etc). This is a running total, not a delta — when
   * present it replaces the reducer's derived score outright.
   */
  score?: { participant1: number; participant2: number };
  /** Game clock (Update.Clock). Seconds counts down from the period's full allocation. */
  clock?: { running: boolean; seconds: number };
}

export interface KeyMoment {
  type: "goal" | "red_card" | "var_overturned";
  participant: Participant;
  ts: number;
  seq: number;
  /** Action id this moment was derived from, when the source event carried one. */
  id?: number;
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
  /**
   * Game clock as of the last event that carried one. `seconds` counts down
   * from the period's full allocation (e.g. 2700 for a 45-minute half) and
   * can go negative into stoppage time. Null until the first clock-bearing
   * event arrives. The frontend derives the display minute — this is the raw
   * feed value.
   */
  clock: { running: boolean; seconds: number; statusId: number } | null;
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
    clock: null,
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
