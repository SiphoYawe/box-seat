// Generates src/data/demo-match.json - a synthetic RawScoreEvent[] for a
// fictional France vs Brazil final (fixtureId 14790158). Seeded so the file is
// stable across regenerations. Run: node scripts/gen-demo.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURE_ID = 14790158;
const KICKOFF_TS = Date.UTC(2026, 6, 19, 19, 0, 0); // 2026-07-19T19:00:00Z
const HT_BREAK_MIN = 15;

// --- deterministic PRNG (mulberry32) ---
let seed = 0xC0FFEE;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// play minute -> elapsed ms since kickoff (second half starts after HT break)
function tsAt(playMinute) {
  const elapsed = playMinute <= 45 ? playMinute : playMinute + HT_BREAK_MIN;
  return KICKOFF_TS + Math.round(elapsed * 60000);
}

// Phase bias: probability an ambient event belongs to France (participant 1)
const PHASES = [
  [0, 10, 0.5],
  [10, 25, 0.76], // France build-up to the opener
  [25, 35, 0.38], // Brazil respond after conceding
  [35, 45, 0.32],
  [45, 54, 0.3], // Brazil equalise early second half
  [54, 61, 0.5],
  [61, 79, 0.82], // Brazil down to ten, France siege
  [79, 94, 0.58], // France manage the lead
];

const AMBIENT = [
  ["possession", 42],
  ["attack_possession", 30],
  ["danger_possession", 16],
  ["high_danger_possession", 7],
  ["corner", 3],
  ["shot", 2],
];

function ambientAction() {
  const total = AMBIENT.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [action, w] of AMBIENT) {
    r -= w;
    if (r <= 0) return action;
  }
  return "possession";
}

const events = [];
let seq = 0;
function push(playMinute, action, participant, extra = {}) {
  seq += 1;
  events.push({
    fixtureId: FIXTURE_ID,
    action,
    statusId: extra.statusId ?? 4,
    ...(participant ? { participant } : {}),
    ...(extra.data ? { data: extra.data } : {}),
    ts: tsAt(playMinute),
    seq,
  });
}

// --- kickoff ---
push(0, "kickoff", undefined, { statusId: 2 });

// --- scripted key beats ---
const BEATS = [
  { at: 11.4, action: "corner", participant: 1 },
  { at: 17.6, action: "shot", participant: 1, data: { outcome: "OnTarget" } },
  { at: 21.2, action: "shot", participant: 1, data: { outcome: "OffTarget" } },
  { at: 25.0, action: "goal", participant: 1 },
  { at: 32.7, action: "corner", participant: 2 },
  { at: 38.3, action: "shot", participant: 2, data: { outcome: "OnTarget" } },
  { at: 42.1, action: "free_kick", participant: 2, data: { freeKickType: "Danger" } },
  { at: 45.0, action: "halftime_finalised", statusId: 3 },
  { at: 46.0, action: "kickoff", statusId: 4 }, // second half (ts includes HT break)
  { at: 51.8, action: "corner", participant: 2 },
  { at: 54.5, action: "goal", participant: 2 },
  { at: 61.2, action: "red_card", participant: 2 },
  { at: 66.4, action: "shot", participant: 1, data: { outcome: "OnTarget" } },
  { at: 70.7, action: "var_end", participant: 2, data: { outcome: "Overturned" } },
  { at: 74.9, action: "corner", participant: 1 },
  { at: 79.3, action: "goal", participant: 1 },
  { at: 85.2, action: "free_kick", participant: 2, data: { freeKickType: "Offside" } },
  { at: 89.6, action: "shot", participant: 2, data: { outcome: "OffTarget" } },
  { at: 94.0, action: "game_finalised", statusId: 100 },
];

const beatAt = (m) => BEATS.find((b) => Math.abs(b.at - m) < 0.001);

// --- ambient fill, one event every ~25-45s of play ---
let minute = 0.6;
const beatQueue = [...BEATS];
while (minute <= 94) {
  const beat = beatQueue[0];
  if (beat && beat.at <= minute) {
    push(beat.at, beat.action, beat.participant, {
      statusId: beat.statusId,
      data: beat.data,
    });
    beatQueue.shift();
    continue;
  }
  const phase = PHASES.find(([a, b]) => minute >= a && minute < b) ?? PHASES[0];
  const france = rand() < phase[2];
  const action = ambientAction();
  const participant = france ? 1 : 2;
  const extra = {};
  if (action === "shot") extra.data = { outcome: rand() < 0.55 ? "OnTarget" : "OffTarget" };
  push(minute, action, participant, extra);
  minute += 0.28 + rand() * 0.5;
}
// flush any beats past the final ambient cursor
for (const beat of beatQueue) {
  push(beat.at, beat.action, beat.participant, { statusId: beat.statusId, data: beat.data });
}

// sort by ts, renumber seq to guarantee monotonicity
events.sort((a, b) => a.ts - b.ts);
events.forEach((e, i) => (e.seq = i + 1));

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/data/demo-match.json");
writeFileSync(out, JSON.stringify(events, null, 2) + "\n");
console.log(`wrote ${events.length} events -> ${out}`);
