import { execFile, execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChatterFetcher, LiveSubscribedFixture, RawXPost } from "./xChatter.js";

const execFileAsync = promisify(execFile);

/** `execFile` timeout for a single `twitter search` invocation. */
const CLI_TIMEOUT_MS = 15_000;
/** Minimum spacing between CLI invocations, shared across every fixture (the CLI is unofficial and can be throttled). */
const CLI_MIN_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Binary resolution — defensive, PATH-based, no hardcoded absolute paths.
// ---------------------------------------------------------------------------

/** Candidate install locations checked when `which` doesn't find the binary on PATH. */
function knownInstallLocations(): string[] {
  const home = homedir();
  return [join(home, ".local", "bin", "twitter"), join(home, ".agent-reach", "bin", "twitter")];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the local `twitter` CLI binary path, synchronously, so `startChatter`
 * can stay a synchronous call. Resolution order: `TWITTER_CLI_PATH` env override
 * (validated executable), then `which twitter` on PATH, then a short list of
 * known install locations (`~/.local/bin`, `~/.agent-reach/bin`). Returns `null`
 * if nothing resolves — the caller falls back to "dormant".
 */
export function resolveTwitterCliPathSync(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.TWITTER_CLI_PATH;
  if (override && isExecutable(override)) return override;

  try {
    const out = execFileSync("which", ["twitter"], { timeout: 2000, encoding: "utf8" }).trim();
    if (out) return out;
  } catch {
    // `which` exits non-zero when nothing is found — fall through to known locations.
  }

  for (const candidate of knownInstallLocations()) {
    if (isExecutable(candidate)) return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// CLI invocation
// ---------------------------------------------------------------------------

/**
 * Builds the exact verified argv for `twitter search` — passed to `execFile`
 * as an array (never a shell string), so team names can never be interpreted
 * as shell syntax.
 */
export function buildCliArgs(team1: string, team2: string): string[] {
  return ["search", `${team1} ${team2}`, "-n", "15", "--lang", "en", "-t", "latest", "--json", "--exclude", "retweets"];
}

// ---------------------------------------------------------------------------
// CLI JSON -> RawXPost mapping
// ---------------------------------------------------------------------------

interface CliAuthor {
  name?: string;
  screenName?: string;
}

interface CliMetrics {
  likes?: number;
}

/** One post from `twitter search --json`'s `data` array. */
interface CliPost {
  id: string;
  text?: string;
  author?: CliAuthor;
  metrics?: CliMetrics;
  createdAtISO?: string;
  media?: unknown[];
  urls?: unknown[];
  lang?: string;
  isRetweet?: boolean;
}

interface CliSearchResponse {
  ok?: boolean;
  schema_version?: string;
  data?: CliPost[];
}

/**
 * Maps one CLI post into the same `RawXPost` shape the X API path produces, so
 * it flows through the existing moderation pipeline unchanged. `urls`/`media`
 * non-empty and `isRetweet`/non-`en` `lang` are already filtered by the query
 * itself (`--exclude retweets --lang en`) — mapping `hasMedia`/`lang` through
 * here is the belt-and-braces check the existing moderator already performs;
 * `urls` needs no separate field since moderation's URL rule is text-based.
 */
export function mapCliPost(post: CliPost): RawXPost {
  return {
    id: post.id,
    text: post.text ?? "",
    lang: post.lang,
    createdAtMs: post.createdAtISO ? Date.parse(post.createdAtISO) : Date.now(),
    likes: post.metrics?.likes ?? 0,
    hasMedia: Array.isArray(post.media) && post.media.length > 0,
    authorName: post.author?.name ?? "Unknown",
    authorHandle: post.author?.screenName ?? "unknown",
  };
}

/** Parses `twitter search --json`'s root document (`{ ok, schema_version, data }`) into `RawXPost[]`. */
export function parseCliResponse(json: unknown): RawXPost[] {
  const body = (json ?? {}) as CliSearchResponse;
  const posts = Array.isArray(body.data) ? body.data : [];
  return posts.map(mapCliPost);
}

// ---------------------------------------------------------------------------
// Fetcher factory
// ---------------------------------------------------------------------------

export interface CliFetcherOptions {
  /** Overridable for tests; defaults to the real 60s shared minimum. */
  minIntervalMs?: number;
  /** Overridable clock for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Builds a `ChatterFetcher` backed by the local `twitter` CLI. One instance is
 * shared across every fixture (the poller reuses the same `PollContext.fetcher`
 * for the whole process), so the closed-over `lastInvocationAt` naturally
 * enforces the "one CLI invocation per 60s, globally" rule across fixtures.
 *
 * Any failure — non-zero exit, ENOENT (binary vanished), timeout, or
 * unparseable JSON — resolves to `{ kind: "auth-error" }`, which the shared
 * poller treats exactly like the X API's 401 path: log once, disable for the
 * rest of the process. Never throws, never retry-spams.
 */
export function buildCliFetcher(binPath: string, opts: CliFetcherOptions = {}): ChatterFetcher {
  const minIntervalMs = opts.minIntervalMs ?? CLI_MIN_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  let lastInvocationAt = 0;

  return async (fixture: LiveSubscribedFixture) => {
    const ts = now();
    if (ts - lastInvocationAt < minIntervalMs) {
      // Routine self-pacing, not a failure — silently sit this cycle out.
      return { kind: "skip" };
    }
    lastInvocationAt = ts;

    let stdout: string;
    try {
      const result = await execFileAsync(binPath, buildCliArgs(fixture.team1, fixture.team2), {
        timeout: CLI_TIMEOUT_MS,
      });
      stdout = result.stdout;
    } catch (err) {
      return {
        kind: "auth-error",
        detail: `twitter CLI invocation failed (${err instanceof Error ? err.message : String(err)})`,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {
      return { kind: "auth-error", detail: "twitter CLI returned unparseable JSON" };
    }

    return { kind: "ok", posts: parseCliResponse(json) };
  };
}
