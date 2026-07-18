// Acceptance driver for the Argentina 3-1 Switzerland replay (18222446):
// FT view, scrub-to-goal takeover, scrub-to-red-card takeover, terrain shift.
import { chromium } from "playwright-core";

const BASE = "http://localhost:5173";
const GOAL_TS = 1783818619532; // Argentina goal (seq 116)
const RED_TS = 1783823568543; // Switzerland red card (seq 686)

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text());
});

const shot = (path) => page.screenshot({ path });
const store = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}/match/18222446`, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => window.__boxseat?.getState().match.mode === "replay",
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(2500); // let terrain settle at FT

const hud = await store(() => {
  const s = window.__boxseat.getState();
  return {
    score: s.match.replay.frames.at(-1).state.score,
    moments: s.match.replay.frames.at(-1).state.keyMoments,
    clock: s.match.replay.frames.at(-1).state.clock,
  };
});
console.log("final score:", JSON.stringify(hud.score), "| clock:", JSON.stringify(hud.clock));
console.log("moments:", hud.moments.map((m) => `${m.type}@p${m.participant}`).join(", "));

await shot("/tmp/acc-ft.png");

// terrain at an early minute for the shift comparison
await store((ts) => window.__boxseat.getState().setPlayhead(ts, { manual: true }), GOAL_TS - 900000);
await page.waitForTimeout(1200);
await shot("/tmp/acc-terrain-early.png");

// scrub onto the goal -> goal takeover must fire
await store((ts) => window.__boxseat.getState().setPlayhead(ts, { manual: true }), GOAL_TS + 1000);
await page.waitForTimeout(900);
const goalTakeover = await store(() => window.__boxseat.getState().match.activeTakeover?.moment.type ?? null);
console.log("goal-scrub takeover:", goalTakeover);
await shot("/tmp/acc-goal-takeover.png");
await page.waitForTimeout(1500);

// scrub onto the red card -> red card takeover must fire
await store((ts) => window.__boxseat.getState().setPlayhead(ts, { manual: true }), RED_TS + 1000);
await page.waitForTimeout(900);
const redTakeover = await store(() => window.__boxseat.getState().match.activeTakeover?.moment.type ?? null);
console.log("red-scrub takeover:", redTakeover);
await shot("/tmp/acc-red-takeover.png");
await page.waitForTimeout(1800);

// terrain late for the shift comparison
await store(() => {
  const s = window.__boxseat.getState();
  s.setPlayhead(s.match.replay.endTs - 600000, { manual: true });
});
await page.waitForTimeout(1200);
await shot("/tmp/acc-terrain-late.png");

await browser.close();
console.log("done");
