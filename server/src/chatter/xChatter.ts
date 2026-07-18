import type Database from "better-sqlite3";
import { kvGet, kvSet } from "../store/kv.js";
import type { ChatterPost } from "../ws/server.js";

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

/** Injectable HTTP fetcher — a trimmed-down `fetch` so tests never monkeypatch globals. */
export type XFetcher = (query: string) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface PollContext {
  db: Database.Database;
  broadcaster: ChatterBroadcaster;
  fetcher: XFetcher;
  /** Set permanently on a 401/403 — a bad token must not spam retries for the rest of the process. */
  disabled: boolean;
  /** Poll ticks no-op until this timestamp — set on a 429. */
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
  const query = buildQuery(fixture.team1, fixture.team2);

  let res: { status: number; json(): Promise<unknown> };
  try {
    res = await ctx.fetcher(query);
  } catch (err) {
    console.warn(
      `[Chatter] Fetch failed for fixture ${fixture.fixtureId} (keeping stale cache):`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (res.status === 401 || res.status === 403) {
    if (!ctx.disabled) {
      console.error(
        `[Chatter] X API returned ${res.status} — disabling match chatter for the rest of this process (bad/expired token?).`
      );
    }
    ctx.disabled = true;
    return;
  }

  if (res.status === 429) {
    ctx.pausedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    console.warn("[Chatter] X API rate-limited (429) — pausing chatter polling for 5 minutes.");
    return;
  }

  if (res.status < 200 || res.status >= 300) {
    console.warn(
      `[Chatter] X API returned ${res.status} for fixture ${fixture.fixtureId} — keeping stale cache.`
    );
    return;
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    console.warn(`[Chatter] Failed to parse X API response for fixture ${fixture.fixtureId}:`, err);
    return;
  }

  const accepted = parseApiResponse(json).filter(moderatePost).map(toChatterPost);
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

function buildDefaultFetcher(bearerToken: string): XFetcher {
  return async (query: string) => {
    const url = new URL(X_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("tweet.fields", "lang,public_metrics,created_at,entities,attachments");
    url.searchParams.set("expansions", "author_id");
    url.searchParams.set("user.fields", "name,username");
    url.searchParams.set("max_results", "25");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    return { status: res.status, json: () => res.json() };
  };
}

export interface StartChatterOptions {
  db: Database.Database;
  broadcaster: ChatterBroadcaster;
  /** Returns every fixture that currently has >=1 subscriber AND is live, with team names for query building. */
  getLiveSubscribedFixtures: () => LiveSubscribedFixture[];
}

export interface ChatterHandle {
  stop(): void;
}

/**
 * Starts the shared chatter poll loop. Completely dormant — no polling, no
 * WS messages, nothing but one log line — when `X_BEARER_TOKEN` is unset or
 * empty; this must be a totally safe no-op path.
 */
export function startChatter(opts: StartChatterOptions): ChatterHandle {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    console.log("[Chatter] X_BEARER_TOKEN not set — match chatter disabled.");
    return { stop() {} };
  }

  const ctx: PollContext = {
    db: opts.db,
    broadcaster: opts.broadcaster,
    fetcher: buildDefaultFetcher(bearerToken),
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
