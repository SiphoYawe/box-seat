// Addendum acceptance: legend dismiss, camera presets, keyboard transport,
// step-to-moment, glyph markers.
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300));
});
const store = (fn, arg) => page.evaluate(fn, arg);

await page.goto("http://localhost:5173/match/18222446", { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__boxseat?.getState().match.mode === "replay", null, { timeout: 20000 });
await page.waitForTimeout(1500);

// legend shows on first visit -> dismiss
const legendVisible = await page.locator("text=How to read it").count();
await page.click("text=Got it");
await page.waitForTimeout(400);
console.log("legend shown + dismissed:", legendVisible > 0);

// camera presets: cycle to Tactical, then Corner
await page.click("button[aria-label='Cycle camera angle']");
await page.waitForTimeout(1100);
await page.screenshot({ path: "/tmp/add-cam-tactical.png" });
await page.click("button[aria-label='Cycle camera angle']");
await page.waitForTimeout(1100);
await page.screenshot({ path: "/tmp/add-cam-corner.png" });
await page.click("button[aria-label='Cycle camera angle']"); // back to Broadcast
await page.waitForTimeout(1100);

// keyboard: ArrowRight -> next key moment (should land on one + takeover)
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(600);
const stepped = await store(() => {
  const s = window.__boxseat.getState();
  return {
    takeover: s.match.activeTakeover?.moment.type ?? null,
    playing: s.match.playing,
    minute: s.match.playheadTs,
  };
});
console.log("ArrowRight step -> takeover:", stepped.takeover, "| playing after step:", stepped.playing);
await page.screenshot({ path: "/tmp/add-step.png" });
await page.waitForTimeout(1600);

// keyboard: Space -> resumes playback; speed cycles 1/2/4
await page.keyboard.press("Space");
await page.waitForTimeout(300);
const playingNow = await store(() => window.__boxseat.getState().match.playing);
await page.click("button[aria-label='Cycle playback speed']");
await page.click("button[aria-label='Cycle playback speed']");
const speedNow = await store(() => window.__boxseat.getState().match.speed);
console.log("Space -> playing:", playingNow, "| speed after 2 cycles:", speedNow);
await page.keyboard.press("Space"); // pause again

// close-up of glyph markers: jump near a goal moment
await store(() => {
  const s = window.__boxseat.getState();
  const km = s.match.replay.frames.at(-1).state.keyMoments[0];
  s.setPlayhead(km.ts, { manual: true });
});
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/add-glyphs.png" });

await browser.close();
console.log("done");
