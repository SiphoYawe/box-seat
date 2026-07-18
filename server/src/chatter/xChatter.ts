import type Database from "better-sqlite3";
import { kvGet, kvSet } from "../store/kv.js";
import type { ChatterPost } from "../ws/server.js";
import { buildCliFetcher, resolveTwitterCliPathSync } from "./cliFetcher.js";

/** One shared loop polls every subscribed+live fixture on this cadence. */
const POLL_INTERVAL_MS = 90_000;
/** On a 429 from the X API, stop hitting it entirely for this long. */
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000;
/** Cache entries older than this are stale — still served, but due a refresh. */
export const STALE_MS = 10 * 60_000;
/** Newest N accepted posts kept per fixture. */
const MAX_CACHED_POSTS = 10;
const CACHE_KEY_PREFIX = "chatter:";
const X_SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Lowercase substrings considered profanity/slurs — substring-matched
 * (catches "fucking", "bullshitting", etc.), not word-boundary matched. This
 * deliberately errs toward over-dropping: a false-positive drop on a public
 * demo chatter feed is free; a slur reaching a client is not.
 */
const BLOCKLIST: readonly string[] = [
  // Common profanity
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "dickhead",
  "crap",
  "slut",
  "whore",
  "douchebag",
  "twat",
  "wanker",
  "bollocks",
  "arsehole",
  "goddamn",
  "motherfucker",
  "cocksucker",
  "dipshit",
  "bullshit",
  "prick",
  "cunt",
  "piss off",
  // Slurs — kept short but real; see comment above on substring trade-offs.
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "retarded",
  "spic",
  "chink",
  "kike",
  "wetback",
  "gook",
  "coon",
  "tranny",
  "beaner",
  "raghead",
  "cracker",
  "paki",
  "towelhead",
  "gypsy",
];

/** Raw, already-flattened post shape moderation and formatting operate on. */
export interface RawXPost {
  id: string;
  text: string;
  /** X API's `lang` tweet field — undefined is treated as "not confirmed English". */
  lang?: string;
  createdAtMs: number;
  likes: number;
  hasMedia: boolean;
  authorName: string;
  authorHandle: string;
}

/**
 * Server-side moderation gate. Returns `true` iff the post is safe to ever
 * reach a client: no URLs, no media, not on the blocklist, and confirmed
 * English via the API's `lang` field. Pure and network-free — usable as an
 * `Array.filter` predicate and directly unit-testable.
 */
export function moderatePost(post: RawXPost): boolean {
  const text = post.text ?? "";
  const lower = text.toLowerCase();

  // No link unfurling, ever — "http" catches http(s):// links generally,
  // "t.co" catches X's own shortener even in the rare case a display URL
  // doesn't literally contain "http".
  if (lower.includes("http") || lower.includes("t.co")) return false;

  if (post.hasMedia) return false;

  if (post.lang !== "en") return false;

  for (const word of BLOCKLIST) {
    if (lower.includes(word)) return false;
  }

  return true;
}

/** Converts a moderation-passed raw post into the wire `ChatterPost` shape, hard-capping text at 280 chars verbatim. */
export function toChatterPost(post: RawXPost): ChatterPost {
  return {
    id: post.id,
    author: post.authorName,
    handle: post.authorHandle,
    text: post.text.slice(0, 280),
    ts: post.createdAtMs,
    likes: post.likes,
  };
}

/** Builds the recent-search query for a fixture: quoted team names (implicit AND), retweets and non-English cut at the source. */
export function buildQuery(team1: string, team2: string): string {
  return `"${team1}" "${team2}" -is:retweet lang:en`;
}

// ---------------------------------------------------------------------------
// X API response parsing
// ---------------------------------------------------------------------------

interface ApiTweet {
  id: string;
  text: string;
  lang?: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: { like_count?: number };
  attachments?: { media_keys?: string[] };
}

interface ApiUser {
  id: string;
  name: string;
  username: string;
}

interface ApiSearchResponse {
  data?: ApiTweet[];
  includes?: { users?: ApiUser[] };
  errors?: unknown;
}

function parseApiResponse(json: unknown): RawXPost[] {
  const body = (json ?? {}) as ApiSearchResponse;
  const users = new Map<string, ApiUser>();
  for (const u of body.includes?.users ?? []) users.set(u.id, u);

  const tweets = Array.isArray(body.data) ? body.data : [];
  return tweets.map((t) => {
    const user = t.author_id ? users.get(t.author_id) : undefined;
    const mediaKeys = t.attachments?.media_keys;
    return {
      id: t.id,
      text: t.text ?? "",
      lang: t.lang,
      createdAtMs: t.created_at ? Date.parse(t.created_at) : Date.now(),
      likes: t.public_metrics?.like_count ?? 0,
      hasMedia: Array.isArray(mediaKeys) && mediaKeys.length > 0,
      authorName: user?.name ?? "Unknown",
      authorHandle: user?.username ?? "unknown",
    };
  });
}

// ---------------------------------------------------------------------------
// Cache (kv store)
// ---------------------------------------------------------------------------

export interface ChatterCacheEntry {
  posts: ChatterPost[];
  fetchedAt: number;
}

function cacheKey(fixtureId: number): string {
  return `${CACHE_KEY_PREFIX}${fixtureId}`;
}

/** Reads the cached chatter for a fixture, or null if none exists yet (or the stored value is malformed). */
export function getCachedChatter(
  db: Database.Database,
  fixtureId: number
): ChatterCacheEntry | null {
  const raw = kvGet(db, cacheKey(fixtureId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChatterCacheEntry;
    if (!Array.isArray(parsed.posts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setCachedChatter(
  db: Database.Database,
  fixtureId: number,
  entry: ChatterCacheEntry
): void {
  kvSet(db, cacheKey(fixtureId), JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

/** Minimal shape the poller needs from the WS layer — deliberately not the concrete `Broadcaster` class, so tests never need a real WebSocket server. */
export interface ChatterBroadcaster {
  broadcastChatter(fixtureId: number, posts: ChatterPost[]): void;
}

export interface LiveSubscribedFixture {
  fixtureId: number;
  team1: string;
  team2: string;
}

/**
 * Outcome of one backend-specific fetch attempt for a single fixture — the
 * seam a fetcher backend (X API or the `twitter` CLI) must satisfy so the
 * shared poller stays backend-agnostic. Each backend translates its own
 * failure model (HTTP status codes for the API, exit codes/timeouts for the
 * CLI) into this common shape.
 */
export type FetchOutcome =
  | { kind: "ok"; posts: RawXPost[] }
  /** Permanent for the process — bad/expired token, or an unrecoverable CLI failure. Same discipline as the old 401 path. */
  | { kind: "auth-error"; detail?: string }
  /** Temporary pause (currently only the X API's 429). */
  | { kind: "rate-limited" }
  /** Transient — logged, cache left untouched, no disabling. */
  | { kind: "error"; message: string }
  /** Routine self-pacing (e.g. the CLI's shared 60s-minimum gate) — not a failure, no log. */
  | { kind: "skip" };

/** Injectable backend fetcher — either the X API or the local `twitter` CLI. Tests inject fakes so nothing ever hits a real network or subprocess. */
export type ChatterFetcher = (fixture: LiveSubscribedFixture) => Promise<FetchOutcome>;

export interface PollContext {
  db: Database.Database;
  broadcaster: ChatterBroadcaster;
  fetcher: ChatterFetcher;
  /** Set permanently on an unrecoverable backend failure — must not spam retries for the rest of the process. */
  disabled: boolean;
  /** Poll ticks no-op until this timestamp — set on a rate-limit. */
  pausedUntil: number;
}

/**
 * Polls, moderates, caches, and (on a changed newest-post-id) broadcasts
 * chatter for a single fixture. Never throws — network/parse failures are
 * logged and leave the existing cache untouched (better stale than empty).
 */
export async function pollFixtureOnce(
  ctx: PollContext,
  fixture: LiveSubscribedFixture
): Promise<void> {
  let outcome: FetchOutcome;
  try {
    outcome = await ctx.fetcher(fixture);
  } catch (err) {
    console.warn(
      `[Chatter] Fetch failed for fixture ${fixture.fixtureId} (keeping stale cache):`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (outcome.kind === "skip") return; // routine self-pacing (e.g. CLI's shared 60s gate) — not a failure

  if (outcome.kind === "auth-error") {
    if (!ctx.disabled) {
      console.error(
        `[Chatter] ${outcome.detail ?? "Unrecoverable backend failure"} — disabling match chatter for the rest of this process.`
      );
    }
    ctx.disabled = true;
    return;
  }

  if (outcome.kind === "rate-limited") {
    ctx.pausedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    console.warn("[Chatter] X API rate-limited (429) — pausing chatter polling for 5 minutes.");
    return;
  }

  if (outcome.kind === "error") {
    console.warn(
      `[Chatter] Fetch failed for fixture ${fixture.fixtureId} (keeping stale cache): ${outcome.message}`
    );
    return;
  }

  const accepted = outcome.posts.filter(moderatePost).map(toChatterPost);
  if (accepted.length === 0) return; // keep whatever's cached rather than overwrite with empty

  accepted.sort((a, b) => b.ts - a.ts);
  const newest = accepted.slice(0, MAX_CACHED_POSTS);

  const prior = getCachedChatter(ctx.db, fixture.fixtureId);
  const changed = !prior || prior.posts[0]?.id !== newest[0]?.id;

  setCachedChatter(ctx.db, fixture.fixtureId, { posts: newest, fetchedAt: Date.now() });

  if (changed) {
    ctx.broadcaster.broadcastChatter(fixture.fixtureId, newest);
  }
}

/** One tick of the shared poll loop across every currently subscribed+live fixture. */
export async function pollAllOnce(
  ctx: PollContext,
  getLiveSubscribedFixtures: () => LiveSubscribedFixture[]
): Promise<void> {
  if (ctx.disabled) return;
  if (Date.now() < ctx.pausedUntil) return;

  const fixtures = getLiveSubscribedFixtures();
  for (const fixture of fixtures) {
    if (ctx.disabled || Date.now() < ctx.pausedUntil) break;
    await pollFixtureOnce(ctx, fixture);
  }
}

/** X API-backed `ChatterFetcher` — builds the search query, calls the API, and translates HTTP status codes into a `FetchOutcome`. */
export function buildApiFetcher(bearerToken: string): ChatterFetcher {
  return async (fixture: LiveSubscribedFixture) => {
    const query = buildQuery(fixture.team1, fixture.team2);
    const url = new URL(X_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("tweet.fields", "lang,public_metrics,created_at,entities,attachments");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "name,username");
    url.searchParams.set("max_results", "25");

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } });
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }

    if (res.status === 401 || res.status === 403) {
      return { kind: "auth-error", detail: `X API returned ${res.status} (bad/expired token?)` };
    }
    if (res.status === 429) {
      return { kind: "rate-limited" };
    }
    if (res.status < 200 || res.status >= 300) {
      return { kind: "error", message: `X API returned ${res.status}` };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: "error", message: "failed to parse X API response" };
    }

    return { kind: "ok", posts: parseApiResponse(json) };
  };
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

export interface ChatterBackendEnv {
  CHATTER_FETCHER?: string;
  X_BEARER_TOKEN?: string;
}

export type ChatterBackendSelection =
  | { kind: "api"; bearerToken: string }
  | { kind: "cli"; binPath: string }
  | { kind: "dormant"; reason: string };

/**
 * Pure backend-selection logic for `CHATTER_FETCHER=cli|api|auto` (default
 * `auto`). No fetch, no subprocess, no console output — `resolveCliBinary` is
 * injected so this (and its tests) never touch the real PATH/filesystem
 * directly. `auto` prefers the X API when a token is present, else falls back
 * to the CLI when the binary resolves, else stays dormant exactly as before.
 * An explicit `api`/`cli` mode does NOT fall back to the other backend — it
 * either works or goes dormant with a reason that says why.
 */
export function resolveChatterBackend(
  env: ChatterBackendEnv,
  resolveCliBinary: () => string | null
): ChatterBackendSelection {
  const rawMode = (env.CHATTER_FETCHER ?? "auto").trim().toLowerCase();
  const mode = rawMode === "api" || rawMode === "cli" ? rawMode : "auto";
  const bearerToken = env.X_BEARER_TOKEN;

  const dormantReasonSuffix =
    "checked TWITTER_CLI_PATH, PATH (`which twitter`), ~/.local/bin, ~/.agent-reach/bin";

  if (mode === "api") {
    if (bearerToken) return { kind: "api", bearerToken };
    return { kind: "dormant", reason: "CHATTER_FETCHER=api but X_BEARER_TOKEN is not set" };
  }

  if (mode === "cli") {
    const binPath = resolveCliBinary();
    if (binPath) return { kind: "cli", binPath };
    return {
      kind: "dormant",
      reason: `CHATTER_FETCHER=cli but no \`twitter\` binary found (${dormantReasonSuffix})`,
    };
  }

  // auto: prefer the X API when a token is present, else fall back to the CLI.
  if (bearerToken) return { kind: "api", bearerToken };
  const binPath = resolveCliBinary();
  if (binPath) return { kind: "cli", binPath };
  return {
    kind: "dormant",
    reason: `no X_BEARER_TOKEN and no \`twitter\` binary found (${dormantReasonSuffix})`,
  };
}

export interface StartChatterOptions {
  db: Database.Database;
  broadcaster: ChatterBroadcaster;
  /** Returns every fixture that currently has >=1 subscriber AND is live, with team names for query building. */
  getLiveSubscribedFixtures: () => LiveSubscribedFixture[];
  /** Test/deploy seam — defaults to `process.env`. Only `CHATTER_FETCHER`/`X_BEARER_TOKEN` are read. */
  env?: ChatterBackendEnv;
  /** Test seam — defaults to the real PATH/filesystem lookup (`resolveTwitterCliPathSync`). */
  resolveCliBinary?: () => string | null;
  /** Test seam — defaults to the real `buildCliFetcher`. */
  buildCliFetcher?: (binPath: string) => ChatterFetcher;
}

export interface ChatterHandle {
  stop(): void;
}

/**
 * Starts the shared chatter poll loop. Selects a backend via `CHATTER_FETCHER`
 * (see `resolveChatterBackend`) and stays completely dormant — no polling, no
 * WS messages, nothing but one log line explaining what was checked — when
 * neither backend is available; this must be a totally safe no-op path (e.g.
 * on a Railway deploy where the `twitter` CLI binary doesn't exist).
 */
export function startChatter(opts: StartChatterOptions): ChatterHandle {
  const env = opts.env ?? process.env;
  const resolveCliBinary = opts.resolveCliBinary ?? resolveTwitterCliPathSync;
  const makeCliFetcher = opts.buildCliFetcher ?? buildCliFetcher;

  const selection = resolveChatterBackend(env, resolveCliBinary);

  let fetcher: ChatterFetcher;
  if (selection.kind === "dormant") {
    console.log(`[Chatter] Match chatter disabled — ${selection.reason}.`);
    return { stop() {} };
  } else if (selection.kind === "api") {
    fetcher = buildApiFetcher(selection.bearerToken);
    console.log("[Chatter] Match chatter enabled via the X API backend.");
  } else {
    fetcher = makeCliFetcher(selection.binPath);
    console.log(`[Chatter] Match chatter enabled via the local \`twitter\` CLI backend (${selection.binPath}).`);
  }

  const ctx: PollContext = {
    db: opts.db,
    broadcaster: opts.broadcaster,
    fetcher,
    disabled: false,
    pausedUntil: 0,
  };

  const tick = () => {
    pollAllOnce(ctx, opts.getLiveSubscribedFixtures).catch((err) => {
      console.error("[Chatter] Poll tick failed unexpectedly:", err);
    });
  };

  const interval = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // fill the cache promptly instead of waiting a full interval

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
