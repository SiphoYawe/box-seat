// Screenshot harness: drives system Chrome over CDP in REAL time (so rAF and
// animations run naturally), waits for a selector or timeout, then shoots.
// Usage: node scripts/shoot.mjs <url> <out.png> [waitSelector] [waitMs]
import { chromium } from "playwright-core";

const [url, out, waitSelector, waitMsArg] = process.argv.slice(2);
const waitMs = Number(waitMsArg ?? 6000);

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text());
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(url, { waitUntil: "networkidle" });
const clickSelector = process.argv[6];
if (clickSelector) {
  for (const sel of clickSelector.split(",")) {
    try {
      await page.click(sel.trim(), { timeout: 8000 });
      await page.waitForTimeout(250);
    } catch {
      console.log("clickSelector not found:", sel);
    }
  }
}
if (waitSelector) {
  try {
    await page.waitForSelector(waitSelector, { timeout: Number(waitMs) });
    await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 900)); // let entrance animations settle
  } catch {
    console.log("waitSelector timed out:", waitSelector);
  }
} else {
  await page.waitForTimeout(waitMs);
}
await page.screenshot({ path: out });
console.log("wrote", out);
await browser.close();
