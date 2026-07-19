/**
 * Static match enrichment baked at build time by scripts/enrich-espn.mjs
 * (ESPN public site API, allowlisted fields only - stats, scorer names,
 * rosters/formation, venue, article recap; no odds data exists here).
 */

export interface EnrichScorer {
  minute: number | null;
  participant: 1 | 2;
  name: string;
}

export interface EnrichPlayer {
  jersey: string | null;
  name: string;
  starter: boolean;
  formationPlace: number | null;
  position: string | null;
  subbedIn: boolean;
  subbedOut: boolean;
}

export interface EnrichFactEvent {
  date: string;
  score: string | null;
  result: "W" | "D" | "L" | null;
  opponent: string | null;
  round: string | null;
  competition: string | null;
  note: string | null;
}

export interface Enrichment {
  fixtureId: number;
  espnEventId: number;
  stats: { participant1: Record<string, string>; participant2: Record<string, string> };
  scorers: EnrichScorer[];
  rosters: {
    participant1: EnrichPlayer[];
    participant2: EnrichPlayer[];
    formation1: string | null;
    formation2: string | null;
  };
  venue: { name: string; city: string | null; attendance: number | null } | null;
  article: { headline: string; description: string | null; story: string | null } | null;
  h2h: EnrichFactEvent[];
  form: { participant1: EnrichFactEvent[]; participant2: EnrichFactEvent[] };
}

const modules = import.meta.glob("../data/enrichment/*.json", {
  eager: true,
  import: "default",
});

const BY_ID = new Map<number, Enrichment>();
for (const data of Object.values(modules)) {
  const e = data as Enrichment;
  if (e && typeof e.fixtureId === "number") BY_ID.set(e.fixtureId, e);
}

export function getEnrichment(fixtureId: number | null): Enrichment | undefined {
  return fixtureId == null ? undefined : BY_ID.get(fixtureId);
}

/**
 * Resolve the scorer for a goal moment: same team, closest official minute
 * within `tol` (the feed's cumulative clock can drift several minutes from
 * the official one, so the tolerance is generous and the best match wins).
 */
export function scorerFor(
  enrich: Enrichment | undefined,
  participant: 1 | 2,
  minuteFloat: number | null,
  tol = 9
): string | null {
  if (!enrich || minuteFloat == null) return null;
  let best: { name: string; dist: number } | null = null;
  for (const s of enrich.scorers) {
    if (s.participant !== participant || s.minute == null) continue;
    const dist = Math.abs(s.minute - minuteFloat);
    if (dist <= tol && (!best || dist < best.dist)) best = { name: s.name, dist };
  }
  return best?.name ?? null;
}

/** Stat rows to display, in order: [espnKey, label]. */
export const STAT_ROWS: Array<[string, string]> = [
  ["possessionPct", "Possession %"],
  ["totalShots", "Shots"],
  ["shotsOnTarget", "Shots on target"],
  ["wonCorners", "Corners"],
  ["foulsCommitted", "Fouls"],
  ["offsides", "Offsides"],
  ["yellowCards", "Yellow cards"],
  ["redCards", "Red cards"],
  ["saves", "Saves"],
  ["passPct", "Pass accuracy %"],
];
