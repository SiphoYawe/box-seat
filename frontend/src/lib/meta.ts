import { useAppStore, type FixtureListEntry } from "../state/store.js";
import stagesJson from "../data/stages.json";

const STAGES: Record<string, string> = stagesJson as Record<string, string>;

/** Round/stage label for a fixture, when known (static map, keyed by id). */
export function stageOf(fixtureId: number): string | undefined {
  return STAGES[String(fixtureId)];
}

/**
 * Fixture metadata for display: team names, competition, start time. The
 * backend's `fixture_list` message is the only source of real fixture
 * metadata - there is no static roster in the frontend. Unknown fixture IDs
 * (e.g. the synthetic demo fixture) resolve to honest fallbacks.
 */
export interface FixtureMeta {
  fixtureId: number;
  participant1: string;
  participant2: string;
  competition: string;
  /** epoch ms, null when the feed hasn't reported a start time */
  startTime: number | null;
}

export function metaFromEntry(entry: FixtureListEntry): FixtureMeta {
  return {
    fixtureId: entry.fixtureId,
    participant1: entry.participant1,
    participant2: entry.participant2,
    competition: entry.competition ?? "World Cup",
    startTime: entry.startTime,
  };
}

const DEMO_META: FixtureMeta = {
  fixtureId: 14790158,
  participant1: "France",
  participant2: "Brazil",
  competition: "Demo match",
  startTime: null,
};

const UNKNOWN_META = (id: number): FixtureMeta => ({
  fixtureId: id,
  participant1: "Team One",
  participant2: "Team Two",
  competition: "World Cup",
  startTime: null,
});

/** Pure resolution of display metadata from a fixture_list array. */
export function metaFromList(
  fixtures: FixtureListEntry[],
  fixtureId: number,
  opts?: { demo?: boolean }
): FixtureMeta {
  const entry = fixtures.find((f) => f.fixtureId === fixtureId);
  if (entry) return metaFromEntry(entry);
  if (opts?.demo) return DEMO_META;
  return UNKNOWN_META(fixtureId);
}

/** Resolve display metadata for a fixture from the store's fixture_list. */
export function resolveFixtureMeta(fixtureId: number, opts?: { demo?: boolean }): FixtureMeta {
  const { fixtures } = useAppStore.getState();
  return metaFromList(fixtures, fixtureId, opts);
}
