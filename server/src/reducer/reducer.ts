import type {
  DangerLevel,
  KeyMoment,
  MatchState,
  Participant,
  RawScoreEvent,
  Zone,
} from "./types.js";

const DANGER_WEIGHT: Record<DangerLevel, number> = {
  Safe: 0.1,
  Attack: 0.4,
  Danger: 0.8,
  HighDanger: 1.2,
};

const ACTION_TO_DANGER: Record<string, DangerLevel> = {
  possession: "Safe",
  safe_possession: "Safe",
  attack_possession: "Attack",
  danger_possession: "Danger",
  high_danger_possession: "HighDanger",
};

/**
 * Runtime lookup for free-kick danger levels. The feed's FreeKickType also
 * carries values that are NOT danger levels — notably "Offside" (several per
 * match), which is a defensive stoppage that kills the attack. Anything not in
 * this map (Offside, future values) must not add momentum or pressure.
 */
const FREE_KICK_DANGER: Record<string, DangerLevel | undefined> = {
  Safe: "Safe",
  Attack: "Attack",
  Danger: "Danger",
  HighDanger: "HighDanger",
};

/**
 * TxLINE's scores feed doesn't carry pitch coordinates — only a possession danger
 * level. This maps danger to a pitch third as an honest, documented approximation
 * (not literal positional data): safe play happens in deeper areas, high-danger
 * play happens near goal. See docs/research/positional-data-apis.md.
 */
function dangerToZone(danger: DangerLevel): Zone {
  if (danger === "Safe") return "defensive";
  if (danger === "Attack") return "middle";
  return "attacking";
}

const MOMENTUM_DECAY = 0.97;
const MOMENTUM_STEP = 0.15;
const PRESSURE_STEP = 1;

function otherParticipant(p: Participant): Participant {
  return p === 1 ? 2 : 1;
}

function applyMomentum(
  state: MatchState,
  participant: Participant,
  weight: number
): number {
  const decayed = state.momentum * MOMENTUM_DECAY;
  const direction = participant === 1 ? 1 : -1;
  const shifted = decayed + direction * weight * MOMENTUM_STEP;
  return Math.max(-1, Math.min(1, shifted));
}

function applyPressure(
  state: MatchState,
  participant: Participant,
  zone: Zone,
  amount: number
): MatchState["pressure"] {
  const key = participant === 1 ? "participant1" : "participant2";
  return {
    ...state.pressure,
    [key]: {
      ...state.pressure[key],
      [zone]: state.pressure[key][zone] + amount,
    },
  };
}

export function reduce(state: MatchState, event: RawScoreEvent): MatchState {
  let next: MatchState = {
    ...state,
    statusId: event.statusId ?? state.statusId,
    lastTs: event.ts,
    lastSeq: event.seq,
  };

  const participant = event.participant;
  const danger = ACTION_TO_DANGER[event.action];

  if (danger && participant) {
    const weight = DANGER_WEIGHT[danger];
    const zone = dangerToZone(danger);
    next = {
      ...next,
      momentum: applyMomentum(next, participant, weight),
      pressure: applyPressure(next, participant, zone, weight * PRESSURE_STEP),
    };
    return next;
  }

  switch (event.action) {
    case "corner": {
      if (!participant) return next;
      next = {
        ...next,
        momentum: applyMomentum(next, participant, DANGER_WEIGHT.Attack),
        pressure: applyPressure(next, participant, "attacking", PRESSURE_STEP),
      };
      return next;
    }

    case "shot": {
      if (!participant) return next;
      const outcome = (event.data?.Outcome ?? event.data?.outcome) as
        | string
        | undefined;
      const weight = outcome === "OffTarget" ? 0.5 : 1;
      next = {
        ...next,
        momentum: applyMomentum(next, participant, weight),
        pressure: applyPressure(
          next,
          participant,
          "attacking",
          PRESSURE_STEP * weight
        ),
      };
      return next;
    }

    case "free_kick": {
      if (!participant) return next;
      const freeKickType = (event.data?.FreeKickType ??
        event.data?.freeKickType) as string | undefined;
      const danger = freeKickType ? FREE_KICK_DANGER[freeKickType] : undefined;
      if (!danger) {
        // Offside free kicks (and any unrecognized FreeKickType) are no-ops:
        // an offside kills the attack, so it must not add momentum or
        // pressure anywhere. Only lastTs/lastSeq advance.
        return next;
      }
      const weight = DANGER_WEIGHT[danger];
      const zone = dangerToZone(danger);
      next = {
        ...next,
        momentum: applyMomentum(next, participant, weight),
        pressure: applyPressure(next, participant, zone, weight * PRESSURE_STEP),
      };
      return next;
    }

    case "goal": {
      if (!participant) return next;
      const key = participant === 1 ? "participant1" : "participant2";
      const moment: KeyMoment = {
        type: "goal",
        participant,
        ts: event.ts,
        seq: event.seq,
      };
      next = {
        ...next,
        score: { ...next.score, [key]: next.score[key] + 1 },
        momentum: applyMomentum(next, participant, 1.5),
        keyMoments: [...next.keyMoments, moment],
      };
      return next;
    }

    case "red_card": {
      if (!participant) return next;
      const moment: KeyMoment = {
        type: "red_card",
        participant,
        ts: event.ts,
        seq: event.seq,
      };
      next = {
        ...next,
        momentum: applyMomentum(next, otherParticipant(participant), 0.5),
        keyMoments: [...next.keyMoments, moment],
      };
      return next;
    }

    case "var_end": {
      const outcome = (event.data?.Outcome ?? event.data?.outcome) as
        | string
        | undefined;
      if (outcome === "Overturned" && participant) {
        const moment: KeyMoment = {
          type: "var_overturned",
          participant,
          ts: event.ts,
          seq: event.seq,
        };
        next = { ...next, keyMoments: [...next.keyMoments, moment] };
      }
      return next;
    }

    default:
      // Unrecognized/unmodeled action types are intentionally no-ops — see
      // docs/txline/scores/txodds-soccer-feed-v1.1.pdf for the full action list.
      return next;
  }
}
