// Downloads player photos from TheSportsDB (free test key) for every player
// in the baked ESPN enrichment rosters, into public/players/. Writes
// src/data/player-photos.json mapping player name -> local path.
// Usage: node scripts/fetch-photos.mjs [--only-starters]
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENRICH_DIR = join(ROOT, "src/data/enrichment");
const PHOTO_DIR = join(ROOT, "public/players");
const MAP_PATH = join(ROOT, "src/data/player-photos.json");
const ONLY_STARTERS = process.argv.includes("--only-starters");
const API = "https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = 450; // TheSportsDB test key throttles hard (~30/window)
const slug = (name) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

async function main() {
  const files = readdirSync(ENRICH_DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
  const names = new Set();
  for (const f of files) {
    const e = JSON.parse(readFileSync(join(ENRICH_DIR, f), "utf8"));
    for (const key of ["participant1", "participant2"]) {
      for (const p of e.rosters?.[key] ?? []) {
        if (!p.name) continue;
        if (ONLY_STARTERS && !p.starter && !(p.goals > 0)) continue;
        names.add(p.name);
      }
    }
  }
  console.log(`players to resolve: ${names.size}`);
  mkdirSync(PHOTO_DIR, { recursive: true });

  const map = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf8")) : {};
  let fetched = 0;
  let kept = 0;
  let missed = 0;

  for (const name of names) {
    const file = `${slug(name)}.png`;
    const rel = `players/${file}`;
    if (map[name] || existsSync(join(PHOTO_DIR, file))) {
      map[name] = rel;
      kept += 1;
      continue;
    }
    try {
      const res = await fetch(`${API}${encodeURIComponent(name)}`);
      const data = await res.json();
      const players = data.player ?? [];
      const hit = players[0];
      let url = hit?.strCutout ?? hit?.strThumb ?? null;
      if (!url) {
        // fallback: Wikipedia search -> top hit's page image
        const wiki = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name + " footballer")}&format=json&srlimit=1`
        );
        const wd = await wiki.json();
        const title = wd.query?.search?.[0]?.title;
        if (title) {
          const img = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=200`
          );
          const id = await img.json();
          const page = Object.values(id.query?.pages ?? {})[0];
          url = page?.thumbnail?.source ?? null;
        }
        if (!url) {
          missed += 1;
          await delay(PACE_MS);
          continue;
        }
      }
      const img = await fetch(url);
      if (!img.ok) {
        missed += 1;
        await delay(PACE_MS);
        continue;
      }
      const buf = Buffer.from(await img.arrayBuffer());
      writeFileSync(join(PHOTO_DIR, file), buf);
      map[name] = rel;
      fetched += 1;
    } catch {
      missed += 1;
    }
    await delay(PACE_MS);
  }

  writeFileSync(MAP_PATH, JSON.stringify(map, null, 1) + "\n");
  console.log(`photos: ${fetched} fetched, ${kept} already present, ${missed} unresolved`);
}

main().catch((e) => {
  console.error("photo fetch failed:", e.message);
  process.exit(1);
});
