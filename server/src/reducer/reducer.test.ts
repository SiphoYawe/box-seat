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

  it("records a goal as a key moment and updates the score", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "goal", participant: 1, seq: 5, ts: 5000 })
    );
    expect(next.score.participant1).toBe(1);
    expect(next.keyMoments).toHaveLength(1);
    expect(next.keyMoments[0]).toMatchObject({
      type: "goal",
      participant: 1,
      seq: 5,
      ts: 5000,
    });
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
