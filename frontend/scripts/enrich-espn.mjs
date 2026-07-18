// Fetches match enrichment from ESPN's public site API for every fixture the
// backend's fixture_list reports, keeping ONLY allowlisted fields (never any
// odds/betting surfaces - those fields are stripped here, upstream of the
// bundle). Output: src/data/enrichment/<fixtureId>.json + index.json.
//
// Usage: node scripts/enrich-espn.mjs [--ws ws://localhost:8787]
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/data/enrichment");
const wsArgIndex = process.argv.indexOf("--ws");
const WS_URL = wsArgIndex >= 0 ? process.argv[wsArgIndex + 1] : "ws://localhost:8787";
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const UA = { "User-Agent": "Mozilla/5.0 (Box Seat enrichment fetch)" };

function normalize(name) {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

async function getFixtureList() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => reject(new Error("fixture_list timeout")), 12000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === "fixture_list") {
        clearTimeout(timer);
        ws.close();
        resolve(msg.fixtures);
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const NAME_ALIASES = {
  usa: ["united states", "united states of america", "usmnt"],
  "cote d'ivoire": ["ivory coast"],
  curacao: ["curaçao"],
  "south korea": ["korea republic", "korea"],
};

function teamsMatch(espnName, txName) {
  const a = normalize(espnName);
  const b = normalize(txName);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aliases = NAME_ALIASES[b] ?? [];
  return aliases.some((al) => a === al || a.includes(al) || al.includes(a));
}

function parseClockMinutes(displayValue) {
  // "67'" -> 67, "45+2'" -> 47, "10'" -> 10
  if (!displayValue) return null;
  const m = String(displayValue).match(/(\d+)(?:\+(\d+))?/);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const fixtures = await getFixtureList();
  console.log(`fixture_list: ${fixtures.length} fixtures`);

  // the 2026 catch-all board stops at the quarters; later rounds need
  // explicit date queries
  const board = await fetchJson(`${ESPN_BASE}/scoreboard?dates=2026`);
  const events = [...(board.events ?? [])];
  for (const date of ["20260714", "20260715", "20260718", "20260719"]) {
    const d = await fetchJson(`${ESPN_BASE}/scoreboard?dates=${date}`);
    events.push(...(d.events ?? []));
    await delay(120);
  }
  console.log(`ESPN events: ${events.length}`);

  mkdirSync(OUT_DIR, { recursive: true });
  const index = [];

  for (const fx of fixtures) {
    const match = events.find((e) => {
      const comp = e.competitions?.[0];
      const competitors = comp?.competitors ?? [];
      const names = competitors.map((c) => c.team?.displayName ?? c.team?.name ?? "");
      const hasP1 = names.some((n) => teamsMatch(n, fx.participant1));
      const hasP2 = names.some((n) => teamsMatch(n, fx.participant2));
      if (!hasP1 || !hasP2) return false;
      if (fx.startTime == null) return true;
      return Math.abs(new Date(e.date).getTime() - fx.startTime) < 2 * 3600_000;
    });
    if (!match) {
      console.log(`  ${fx.participant1} vs ${fx.participant2} (${fx.fixtureId}): no ESPN event`);
      continue;
    }

    let summary;
    try {
      summary = await fetchJson(`${ESPN_BASE}/summary?event=${match.id}`);
    } catch (err) {
      console.log(`  ${fx.participant1} vs ${fx.participant2} (${fx.fixtureId}): summary failed (${err.message})`);
      continue;
    }
    await delay(120);

    const comp = summary.header?.competitions?.[0];
    const competitors = comp?.competitors ?? [];
    // map TxLINE participantN -> ESPN competitor
    const compOf = (txName) =>
      competitors.find((c) => teamsMatch(c.team?.displayName ?? c.team?.name ?? "", txName));

    // boxscore stats, keyed by participant
    const stats = { participant1: {}, participant2: {} };
    const bsTeams = summary.boxscore?.teams ?? [];
    for (const [txName, key] of [
      [fx.participant1, "participant1"],
      [fx.participant2, "participant2"],
    ]) {
      const espn = bsTeams.find((t) => teamsMatch(t.team?.displayName ?? t.team?.name ?? "", txName));
      for (const s of espn?.statistics ?? []) {
        if (s.name && s.displayValue != null) stats[key][s.name] = s.displayValue;
      }
    }

    // scoring details with athlete names (strip everything else)
    const scorers = (comp?.details ?? [])
      .filter((d) => d.scoringPlay)
      .map((d) => {
        const team = d.team?.displayName ?? d.team?.name ?? "";
        const participant = teamsMatch(team, fx.participant1) ? 1 : teamsMatch(team, fx.participant2) ? 2 : null;
        const athlete = d.participants?.[0]?.athlete;
        return {
          minute: parseClockMinutes(d.clock?.displayValue),
          participant,
          name: athlete?.displayName ?? null,
        };
      })
      .filter((s) => s.name && s.participant);

    // rosters with formation
    const rosters = { participant1: [], participant2: [], formation1: null, formation2: null };
    for (const r of summary.rosters ?? []) {
      const teamName = r.team?.displayName ?? r.team?.name ?? "";
      const key = teamsMatch(teamName, fx.participant1)
        ? "participant1"
        : teamsMatch(teamName, fx.participant2)
          ? "participant2"
          : null;
      if (!key) continue;
      if (key === "participant1") rosters.formation1 = r.formation ?? null;
      else rosters.formation2 = r.formation ?? null;
      rosters[key] = (r.roster ?? []).map((p) => ({
        jersey: p.jersey ?? null,
        name: p.athlete?.displayName ?? null,
        starter: Boolean(p.starter),
        formationPlace: p.formationPlace ?? null,
        position: p.athlete?.position?.abbreviation ?? p.athlete?.position?.name ?? null,
        subbedIn: Boolean(p.subbedIn),
        subbedOut: Boolean(p.subbedOut),
      })).filter((p) => p.name);
    }

    // commentator material: head-to-head + recent form (allowlisted fields only)
    const factEvent = (e) => ({
      date: e.gameDate ?? null,
      score: e.score ?? null,
      result: e.gameResult ?? null, // W/D/L from this team's perspective
      opponent: e.opponent?.displayName ?? null,
      round: e.roundName ?? null,
      competition: e.competitionName ?? null,
      note: e.matchNote ?? null,
    });
    const h2h = (summary.headToHeadGames ?? [])
      .flatMap((t) => t.events ?? [])
      .map(factEvent)
      .filter((e) => e.date && e.score)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
    const form = { participant1: [], participant2: [] };
    for (const t of summary.lastFiveGames ?? []) {
      const teamName = t.team?.displayName ?? t.team?.name ?? "";
      const key = teamsMatch(teamName, fx.participant1)
        ? "participant1"
        : teamsMatch(teamName, fx.participant2)
          ? "participant2"
          : null;
      if (!key) continue;
      form[key] = (t.events ?? [])
        .map(factEvent)
        .filter((e) => e.date && e.result)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);
    }

    const venue = summary.gameInfo?.venue;
    const article = summary.article;
    const out = {
      fixtureId: fx.fixtureId,
      espnEventId: Number(match.id),
      stats,
      scorers,
      rosters,
      venue: venue?.fullName ? { name: venue.fullName, city: venue.address?.city ?? null, attendance: summary.gameInfo?.attendance ?? null } : null,
      article: article?.headline
        ? { headline: article.headline, description: article.description ?? null, story: (article.story ?? "").slice(0, 2400) }
        : null,
      h2h,
      form,
    };

    writeFileSync(join(OUT_DIR, `${fx.fixtureId}.json`), JSON.stringify(out, null, 1) + "\n");
    index.push(fx.fixtureId);
    console.log(
      `  ${fx.participant1} vs ${fx.participant2} (${fx.fixtureId}): espn ${match.id}, ` +
        `${rosters.participant1.length}+${rosters.participant2.length} players, ${scorers.length} scorers, venue=${venue?.shortName ?? "?"}`
    );
    await delay(120);
  }

  writeFileSync(join(OUT_DIR, "index.json"), JSON.stringify(index) + "\n");
  console.log(`wrote ${index.length} enrichment files`);
}

main().catch((e) => {
  console.error("enrich failed:", e.message);
  process.exit(1);
});
