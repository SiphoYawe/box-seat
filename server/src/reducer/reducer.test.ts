import { describe, it, expect } from "vitest";
import { reduce } from "./reducer.js";
import {
  initialMatchState,
  isTerminalEvent,
  type RawScoreEvent,
} from "./types.js";

function event(overrides: Partial<RawScoreEvent>): RawScoreEvent {
  return {
    fixtureId: 1,
    action: "possession",
    statusId: 2,
    ts: 1000,
    seq: 1,
    ...overrides,
  };
}

describe("reduce", () => {
  it("starts at zero momentum with no events", () => {
    const state = initialMatchState(1);
    expect(state.momentum).toBe(0);
  });

  it("shifts momentum toward participant 1 on high-danger possession", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "high_danger_possession", participant: 1 })
    );
    expect(next.momentum).toBeGreaterThan(0);
  });

  it("shifts momentum toward participant 2 on high-danger possession", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "high_danger_possession", participant: 2 })
    );
    expect(next.momentum).toBeLessThan(0);
  });

  it("weighs high-danger possession more than safe possession", () => {
    const safe = reduce(
      initialMatchState(1),
      event({ action: "possession", participant: 1 })
    );
    const highDanger = reduce(
      initialMatchState(1),
      event({ action: "high_danger_possession", participant: 1 })
    );
    expect(highDanger.momentum).toBeGreaterThan(safe.momentum);
  });

  it("accumulates attacking-zone pressure on corners", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ action: "corner", participant: 1 }));
    expect(next.pressure.participant1.attacking).toBeGreaterThan(0);
    expect(next.pressure.participant2.attacking).toBe(0);
  });

  it("records a goal as a key moment and takes the score from the Score field, not from counting", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({
        action: "goal",
        participant: 1,
        seq: 5,
        ts: 5000,
        id: 100,
        score: { participant1: 2, participant2: 0 },
      })
    );
    // The Score field is a running total, not a delta — score comes from it
    // outright (2-0), regardless of the prior state having 0 goals.
    expect(next.score).toEqual({ participant1: 2, participant2: 0 });
    expect(next.keyMoments).toHaveLength(1);
    expect(next.keyMoments[0]).toMatchObject({
      type: "goal",
      participant: 1,
      seq: 5,
      ts: 5000,
      id: 100,
    });
  });

  it("falls back to incrementing the score when a goal event carries neither Score nor Id (malformed frame)", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "goal", participant: 2, seq: 7, ts: 7000 })
    );
    expect(next.score).toEqual({ participant1: 0, participant2: 1 });
    expect(next.keyMoments).toHaveLength(1);
  });

  it("dedupes repeated goal messages that share the same action Id — one keyMoment, authoritative score, momentum boosted once", () => {
    const goalEvent = (seq: number, ts: number) =>
      event({
        action: "goal",
        participant: 1,
        id: 500,
        seq,
        ts,
        score: { participant1: 1, participant2: 0 },
      });

    // Single-message baseline to compare momentum against.
    const single = reduce(initialMatchState(1), goalEvent(10, 10_000));

    // TxLINE style: unconfirmed -> confirmed -> amend, same action Id.
    let deduped = initialMatchState(1);
    deduped = reduce(deduped, goalEvent(10, 10_000));
    deduped = reduce(deduped, goalEvent(11, 10_100));
    deduped = reduce(deduped, goalEvent(12, 10_200));

    expect(deduped.keyMoments).toHaveLength(1);
    expect(deduped.score).toEqual({ participant1: 1, participant2: 0 });
    expect(deduped.momentum).toBe(single.momentum);
  });

  it("records a red card as a key moment without changing score", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "red_card", participant: 2, seq: 9, ts: 9000 })
    );
    expect(next.keyMoments).toHaveLength(1);
    expect(next.keyMoments[0].type).toBe("red_card");
    expect(next.score.participant2).toBe(0);
  });

  it("shifts momentum toward participant 1 when participant 2 gets a red card", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ action: "red_card", participant: 2 }));
    expect(next.momentum).toBeGreaterThan(0);
  });

  it("shifts momentum toward participant 2 when participant 1 gets a red card", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ action: "red_card", participant: 1 }));
    expect(next.momentum).toBeLessThan(0);
  });

  it("treats an offside free kick as a no-op for momentum and pressure", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({
        action: "free_kick",
        participant: 1,
        data: { FreeKickType: "Offside" },
      })
    );
    expect(next.momentum).toBe(0);
    expect(next.pressure.participant1).toEqual({
      defensive: 0,
      middle: 0,
      attacking: 0,
    });
    expect(next.pressure.participant2).toEqual({
      defensive: 0,
      middle: 0,
      attacking: 0,
    });
  });

  it("falls back to lowercase outcome for a shot when PascalCase is absent", () => {
    const state = initialMatchState(1);
    const offTarget = reduce(
      state,
      event({ action: "shot", participant: 1, data: { outcome: "OffTarget" } })
    );
    const onTarget = reduce(
      state,
      event({ action: "shot", participant: 1, data: { outcome: "OnTarget" } })
    );
    expect(offTarget.momentum).toBeGreaterThan(0);
    expect(offTarget.momentum).toBeLessThan(onTarget.momentum);
  });

  it("falls back to lowercase freeKickType for an offside free kick when PascalCase is absent", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({
        action: "free_kick",
        participant: 1,
        data: { freeKickType: "Offside" },
      })
    );
    expect(next.momentum).toBe(0);
    expect(next.pressure.participant1).toEqual({
      defensive: 0,
      middle: 0,
      attacking: 0,
    });
    expect(next.pressure.participant2).toEqual({
      defensive: 0,
      middle: 0,
      attacking: 0,
    });
  });

  it("decays momentum toward zero on neutral events", () => {
    const withMomentum = reduce(
      initialMatchState(1),
      event({ action: "high_danger_possession", participant: 1, seq: 1 })
    );
    const decayed = reduce(
      withMomentum,
      event({ action: "possession", participant: 2, seq: 2 })
    );
    expect(Math.abs(decayed.momentum)).toBeLessThan(withMomentum.momentum);
  });

  it("clamps momentum to [-1, 1]", () => {
    let state = initialMatchState(1);
    for (let i = 0; i < 50; i++) {
      state = reduce(
        state,
        event({ action: "high_danger_possession", participant: 1, seq: i })
      );
    }
    expect(state.momentum).toBeLessThanOrEqual(1);
  });

  it("updates lastTs and lastSeq on every event", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ ts: 4242, seq: 7 }));
    expect(next.lastTs).toBe(4242);
    expect(next.lastSeq).toBe(7);
  });

  it("ignores unrecognized action types without throwing", () => {
    const state = initialMatchState(1);
    expect(() =>
      reduce(state, event({ action: "some_future_action_we_dont_model" }))
    ).not.toThrow();
  });

  it("is pure — does not mutate the input state", () => {
    const state = initialMatchState(1);
    const snapshot = JSON.parse(JSON.stringify(state));
    reduce(state, event({ action: "goal", participant: 1 }));
    expect(state).toEqual(snapshot);
  });

  it("advances statusId to 5 on a status action event", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ action: "status", statusId: 5 }));
    expect(next.statusId).toBe(5);
  });

  it("adds defensive-zone pressure and shifts momentum slightly negative on safe_possession for participant 2", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "safe_possession", participant: 2 })
    );
    expect(next.pressure.participant2.defensive).toBeGreaterThan(0);
    expect(next.momentum).toBeLessThan(0);
  });

  it("dedupes repeated red_card messages sharing the same action Id", () => {
    const redCardEvent = (seq: number) =>
      event({ action: "red_card", participant: 2, id: 900, seq, ts: seq * 100 });
    let state = initialMatchState(1);
    state = reduce(state, redCardEvent(1));
    const afterFirst = state.momentum;
    state = reduce(state, redCardEvent(2));
    state = reduce(state, redCardEvent(3));
    expect(state.keyMoments).toHaveLength(1);
    expect(state.momentum).toBe(afterFirst);
  });

  it("does not dedupe key moments when the event carries no Id (keeps current per-message behavior)", () => {
    const state = initialMatchState(1);
    const withTwoGoals = [1, 2].reduce(
      (acc, seq) =>
        reduce(
          acc,
          event({ action: "goal", participant: 1, seq, ts: seq * 100 })
        ),
      state
    );
    expect(withTwoGoals.keyMoments).toHaveLength(2);
    expect(withTwoGoals.score.participant1).toBe(2);
  });
});

describe("clock", () => {
  it("is null before any clock-bearing event", () => {
    expect(initialMatchState(1).clock).toBeNull();
  });

  it("updates from event.clock, carrying the event's statusId", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({
        action: "status",
        statusId: 4,
        clock: { running: true, seconds: 1800 },
      })
    );
    expect(next.clock).toEqual({ running: true, seconds: 1800, statusId: 4 });
  });

  it("leaves clock unchanged when a later event carries no clock", () => {
    const withClock = reduce(
      initialMatchState(1),
      event({ clock: { running: true, seconds: 900 } })
    );
    const next = reduce(withClock, event({ action: "possession", participant: 1 }));
    expect(next.clock).toEqual(withClock.clock);
  });
});

describe("isTerminalEvent", () => {
  it("is true for action game_finalised with statusId 100", () => {
    expect(
      isTerminalEvent(event({ action: "game_finalised", statusId: 100 }))
    ).toBe(true);
  });

  it("is true for a plain event with statusId 5, 10, or 13", () => {
    expect(isTerminalEvent(event({ action: "status", statusId: 5 }))).toBe(
      true
    );
    expect(isTerminalEvent(event({ action: "status", statusId: 10 }))).toBe(
      true
    );
    expect(isTerminalEvent(event({ action: "status", statusId: 13 }))).toBe(
      true
    );
  });

  it("is false for statusId 4", () => {
    expect(isTerminalEvent(event({ action: "status", statusId: 4 }))).toBe(
      false
    );
  });
});
