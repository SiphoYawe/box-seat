import { describe, expect, it } from "vitest";
import { initialMatchState, type RawScoreEvent } from "./types.js";
import { reduce } from "./reducer.js";

function ev(partial: Partial<RawScoreEvent>): RawScoreEvent {
  return {
    fixtureId: 1,
    action: "possession",
    statusId: 4,
    ts: 1000,
    seq: 1,
    ...partial,
  };
}

describe("ported reducer", () => {
  it("a goal updates the score and appends a key moment", () => {
    const s0 = initialMatchState(1);
    const s1 = reduce(s0, ev({ action: "goal", participant: 1 }));
    expect(s1.score.participant1).toBe(1);
    expect(s1.score.participant2).toBe(0);
    expect(s1.keyMoments).toHaveLength(1);
    expect(s1.keyMoments[0].type).toBe("goal");
    expect(s1.keyMoments[0].participant).toBe(1);
    expect(s1.momentum).toBeGreaterThan(0);
  });

  it("a red card does not change the score and pushes momentum to the other team", () => {
    const s0 = initialMatchState(1);
    const s1 = reduce(s0, ev({ action: "red_card", participant: 2 }));
    expect(s1.score.participant1).toBe(0);
    expect(s1.score.participant2).toBe(0);
    expect(s1.keyMoments[0].type).toBe("red_card");
    // participant 2 sent off -> momentum toward participant 1 (positive)
    expect(s1.momentum).toBeGreaterThan(0);
  });

  it("momentum clamps to [-1, 1]", () => {
    let s = initialMatchState(1);
    for (let i = 0; i < 200; i++) {
      s = reduce(s, ev({ action: "high_danger_possession", participant: 1, seq: i + 1 }));
    }
    expect(s.momentum).toBeLessThanOrEqual(1);
    expect(s.momentum).toBe(1);
    for (let i = 0; i < 400; i++) {
      s = reduce(s, ev({ action: "high_danger_possession", participant: 2, seq: 1000 + i }));
    }
    expect(s.momentum).toBe(-1);
  });

  it("possession actions accumulate pressure in the mapped zone", () => {
    let s = initialMatchState(1);
    s = reduce(s, ev({ action: "danger_possession", participant: 2 }));
    expect(s.pressure.participant2.attacking).toBeCloseTo(0.8);
    expect(s.pressure.participant2.middle).toBe(0);
    s = reduce(s, ev({ action: "corner", participant: 1, seq: 2 }));
    expect(s.pressure.participant1.attacking).toBeCloseTo(1);
  });

  it("an offside free kick is a no-op besides ts/seq", () => {
    const s0 = reduce(initialMatchState(1), ev({ action: "goal", participant: 1 }));
    const s1 = reduce(
      s0,
      ev({ action: "free_kick", participant: 2, data: { freeKickType: "Offside" }, ts: 2000, seq: 2 })
    );
    expect(s1.momentum).toBe(s0.momentum);
    expect(s1.pressure).toEqual(s0.pressure);
    expect(s1.lastTs).toBe(2000);
    expect(s1.lastSeq).toBe(2);
  });

  it("var_end appends a key moment only when overturned", () => {
    let s = initialMatchState(1);
    s = reduce(s, ev({ action: "var_end", participant: 1, data: { outcome: "Confirmed" } }));
    expect(s.keyMoments).toHaveLength(0);
    s = reduce(s, ev({ action: "var_end", participant: 1, data: { outcome: "Overturned" }, seq: 2 }));
    expect(s.keyMoments).toHaveLength(1);
    expect(s.keyMoments[0].type).toBe("var_overturned");
    expect(s.score.participant1).toBe(0);
  });

  it("off-target shots weigh less than on-target shots", () => {
    const onTarget = reduce(
      initialMatchState(1),
      ev({ action: "shot", participant: 1, data: { outcome: "OnTarget" } })
    );
    const offTarget = reduce(
      initialMatchState(1),
      ev({ action: "shot", participant: 1, data: { outcome: "OffTarget" } })
    );
    expect(onTarget.pressure.participant1.attacking).toBeCloseTo(1);
    expect(offTarget.pressure.participant1.attacking).toBeCloseTo(0.5);
  });

  it("status updates flow through kickoff/halftime/game_finalised", () => {
    let s = initialMatchState(1);
    s = reduce(s, ev({ action: "kickoff", statusId: 2 }));
    expect(s.statusId).toBe(2);
    s = reduce(s, ev({ action: "halftime_finalised", statusId: 3 }));
    expect(s.statusId).toBe(3);
    s = reduce(s, ev({ action: "game_finalised", statusId: 100 }));
    expect(s.statusId).toBe(100);
  });

  it("the Score field is authoritative and replaces the derived score", () => {
    let s = initialMatchState(1);
    s = reduce(s, ev({ action: "goal", participant: 1 }));
    expect(s.score.participant1).toBe(1);
    // a later action carrying the running total overrides outright
    s = reduce(
      s,
      ev({ action: "goal", participant: 2, score: { participant1: 3, participant2: 2 }, seq: 2 })
    );
    expect(s.score).toEqual({ participant1: 3, participant2: 2 });
  });

  it("the same real goal (shared action id) is recorded only once", () => {
    let s = initialMatchState(1);
    const base = {
      action: "goal",
      participant: 2 as const,
      id: 555,
      score: { participant1: 0, participant2: 1 },
    };
    s = reduce(s, ev({ ...base, seq: 10 }));
    const momentumAfterFirst = s.momentum;
    // unconfirmed -> confirmed redelivery of the same goal
    s = reduce(s, ev({ ...base, seq: 11, confirmed: true }));
    s = reduce(s, ev({ ...base, seq: 12 }));
    expect(s.keyMoments.filter((m) => m.type === "goal")).toHaveLength(1);
    expect(s.momentum).toBe(momentumAfterFirst);
    expect(s.score.participant2).toBe(1);
  });

  it("clock readings flow into state with the status at reading time", () => {
    let s = initialMatchState(1);
    expect(s.clock).toBeNull();
    s = reduce(s, ev({ action: "kickoff", statusId: 2, clock: { running: true, seconds: 2700 } }));
    expect(s.clock).toEqual({ running: true, seconds: 2700, statusId: 2 });
    s = reduce(s, ev({ action: "possession", participant: 1, clock: { running: true, seconds: 2500 } }));
    expect(s.clock?.seconds).toBe(2500);
  });

  it("action_discarded retracts a previously recorded goal (no phantom moment)", () => {
    let s = initialMatchState(1);
    // goal arrives, unconfirmed, with the authoritative scoreline
    s = reduce(
      s,
      ev({ action: "goal", participant: 1, id: 900, score: { participant1: 1, participant2: 0 }, seq: 10 })
    );
    expect(s.keyMoments).toHaveLength(1);
    expect(s.score.participant1).toBe(1);
    const momentumAfterGoal = s.momentum;
    // the feed retracts it on review, with the corrected scoreline
    s = reduce(
      s,
      ev({ action: "action_discarded", id: 900, score: { participant1: 0, participant2: 0 }, seq: 11 })
    );
    expect(s.keyMoments).toHaveLength(0);
    expect(s.score.participant1).toBe(0);
    // momentum is not rewound - it decays naturally
    expect(s.momentum).toBe(momentumAfterGoal);
  });

  it("action_discarded for an unknown id is a no-op", () => {
    const s0 = reduce(initialMatchState(1), ev({ action: "goal", participant: 2, id: 5, seq: 3 }));
    const s1 = reduce(s0, ev({ action: "action_discarded", id: 999, seq: 4 }));
    expect(s1.keyMoments).toHaveLength(1);
    expect(s1.lastSeq).toBe(4);
  });
});
