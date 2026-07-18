import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDb } from "../store/db.js";
import { initKv } from "../store/kv.js";
import {
  moderatePost,
  toChatterPost,
  buildQuery,
  getCachedChatter,
  pollFixtureOnce,
  pollAllOnce,
  startChatter,
  buildApiFetcher,
  resolveChatterBackend,
  type RawXPost,
  type PollContext,
  type ChatterBroadcaster,
  type ChatterFetcher,
  type FetchOutcome,
} from "./xChatter.js";
import type Database from "better-sqlite3";

function rawPost(overrides: Partial<RawXPost> = {}): RawXPost {
  return {
    id: "1",
    text: "What a match, incredible finish!",
    lang: "en",
    createdAtMs: 1_000,
    likes: 5,
    hasMedia: false,
    authorName: "Jane Fan",
    authorHandle: "janefan",
    ...overrides,
  };
}

describe("moderatePost", () => {
  it("passes a clean English text-only post", () => {
    expect(moderatePost(rawPost())).toBe(true);
  });

  it("drops posts containing a URL (http substring)", () => {
    expect(moderatePost(rawPost({ text: "Check this out https://example.com/x" }))).toBe(false);
  });

  it("drops posts containing a t.co link even without a literal http prefix in text", () => {
    expect(moderatePost(rawPost({ text: "link: t.co/abc123" }))).toBe(false);
  });

  it("drops posts with media attachments", () => {
    expect(moderatePost(rawPost({ hasMedia: true }))).toBe(false);
  });

  it("drops posts matching the profanity/slur blocklist", () => {
    expect(moderatePost(rawPost({ text: "This ref is full of shit honestly" }))).toBe(false);
  });

  it("drops non-English posts (lang !== en)", () => {
    expect(moderatePost(rawPost({ lang: "es", text: "Que golazo!" }))).toBe(false);
  });

  it("drops posts with no lang field at all (unconfirmed English)", () => {
    const { lang, ...rest } = rawPost();
    expect(moderatePost(rest as RawXPost)).toBe(false);
  });
});

describe("toChatterPost", () => {
  it("hard-caps text at 280 chars verbatim", () => {
    const longText = "a".repeat(400);
    const post = toChatterPost(rawPost({ text: longText }));
    expect(post.text).toHaveLength(280);
    expect(post.text).toBe("a".repeat(280));
  });

  it("leaves short text untouched", () => {
    const post = toChatterPost(rawPost({ text: "short one" }));
    expect(post.text).toBe("short one");
  });

  it("maps fields to the wire shape verbatim", () => {
    const post = toChatterPost(
      rawPost({ id: "999", authorName: "Display Name", authorHandle: "user", createdAtMs: 1784400000000, likes: 42 })
    );
    expect(post).toEqual({
      id: "999",
      author: "Display Name",
      handle: "user",
      text: "What a match, incredible finish!",
      ts: 1784400000000,
      likes: 42,
    });
  });
});

describe("buildQuery", () => {
  it("quotes each team name and appends the noise-cutting suffix", () => {
    expect(buildQuery("Argentina", "Switzerland")).toBe(
      '"Argentina" "Switzerland" -is:retweet lang:en'
    );
  });
});

// ---------------------------------------------------------------------------
// Poll pipeline (mocked fetcher — no network in tests)
// ---------------------------------------------------------------------------

interface ApiTweetFixture {
  id: string;
  text: string;
  lang?: string;
  author_id?: string;
  created_at?: string;
  likes?: number;
  mediaKeys?: string[];
}

function apiResponse(tweets: ApiTweetFixture[], users: { id: string; name: string; username: string }[] = []) {
  return {
    data: tweets.map((t) => ({
      id: t.id,
      text: t.text,
      lang: t.lang ?? "en",
      author_id: t.author_id,
      created_at: t.created_at ?? "2026-07-18T12:00:00.000Z",
      public_metrics: { like_count: t.likes ?? 0 },
      attachments: t.mediaKeys ? { media_keys: t.mediaKeys } : undefined,
    })),
    includes: { users },
  };
}

/** Queues `FetchOutcome`s for a fake `ChatterFetcher` — no network, no subprocess. */
function outcomeQueue(...outcomes: FetchOutcome[]): ChatterFetcher {
  const fn = vi.fn();
  for (const o of outcomes) {
    fn.mockResolvedValueOnce(o);
  }
  return fn as unknown as ChatterFetcher;
}

function makeCtx(db: Database.Database, fetcher: ChatterFetcher, broadcaster: ChatterBroadcaster): PollContext {
  return { db, broadcaster, fetcher, disabled: false, pausedUntil: 0 };
}

describe("pollFixtureOnce", () => {
  let db: Database.Database;
  let broadcastChatter: ReturnType<typeof vi.fn>;
  let broadcaster: ChatterBroadcaster;

  beforeEach(() => {
    db = openDb(":memory:");
    initKv(db);
    broadcastChatter = vi.fn();
    broadcaster = { broadcastChatter };
  });

  const fixture = { fixtureId: 42, team1: "Argentina", team2: "Switzerland" };

  it("caches accepted posts and broadcasts on first fetch", async () => {
    const fetcher = outcomeQueue({
      kind: "ok",
      posts: [rawPost({ id: "100", text: "Huge win for Argentina!", authorName: "Fan One", authorHandle: "fanone" })],
    });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    const cached = getCachedChatter(db, 42);
    expect(cached).not.toBeNull();
    expect(cached!.posts).toHaveLength(1);
    expect(cached!.posts[0]).toMatchObject({ id: "100", author: "Fan One", handle: "fanone" });
    expect(broadcastChatter).toHaveBeenCalledTimes(1);
    expect(broadcastChatter).toHaveBeenCalledWith(42, cached!.posts);
  });

  it("drops moderated-out posts entirely, leaving no cache and no broadcast", async () => {
    const fetcher = outcomeQueue({
      kind: "ok",
      posts: [rawPost({ id: "101", text: "Check it out https://spam.example" })],
    });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    expect(getCachedChatter(db, 42)).toBeNull();
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("does not rebroadcast when the newest post id is unchanged", async () => {
    const outcome: FetchOutcome = {
      kind: "ok",
      posts: [rawPost({ id: "200", text: "Same post both polls", authorName: "Fan", authorHandle: "fan" })],
    };
    const fetcher = outcomeQueue(outcome, outcome);
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);
    await pollFixtureOnce(ctx, fixture);

    expect(broadcastChatter).toHaveBeenCalledTimes(1);
  });

  it("rebroadcasts when the newest post id changes", async () => {
    const fetcher = outcomeQueue(
      { kind: "ok", posts: [rawPost({ id: "300", text: "First post", createdAtMs: 1_000 })] },
      { kind: "ok", posts: [rawPost({ id: "301", text: "Newer post", createdAtMs: 2_000 })] }
    );
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);
    await pollFixtureOnce(ctx, fixture);

    expect(broadcastChatter).toHaveBeenCalledTimes(2);
    const cached = getCachedChatter(db, 42);
    expect(cached!.posts[0].id).toBe("301");
  });

  it("keeps the stale cache and does not throw when the fetch itself fails", async () => {
    const fetcher: ChatterFetcher = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const ctx = makeCtx(db, fetcher, broadcaster);

    await expect(pollFixtureOnce(ctx, fixture)).resolves.toBeUndefined();
    expect(getCachedChatter(db, 42)).toBeNull();
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("disables the poller for the process lifetime on an auth-error outcome", async () => {
    const fetcher = outcomeQueue({ kind: "auth-error", detail: "X API returned 401" });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    expect(ctx.disabled).toBe(true);
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("backs off for 5 minutes on a rate-limited outcome", async () => {
    const fetcher = outcomeQueue({ kind: "rate-limited" });
    const ctx = makeCtx(db, fetcher, broadcaster);
    const before = Date.now();

    await pollFixtureOnce(ctx, fixture);

    expect(ctx.pausedUntil).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000);
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("does nothing on a skip outcome (routine self-pacing, not a failure)", async () => {
    const fetcher = outcomeQueue({ kind: "skip" });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    expect(ctx.disabled).toBe(false);
    expect(ctx.pausedUntil).toBe(0);
    expect(broadcastChatter).not.toHaveBeenCalled();
  });
});

describe("pollAllOnce", () => {
  let db: Database.Database;
  let broadcaster: ChatterBroadcaster;

  beforeEach(() => {
    db = openDb(":memory:");
    initKv(db);
    broadcaster = { broadcastChatter: vi.fn() };
  });

  it("short-circuits every fixture once disabled mid-loop (a bad token must not spam requests)", async () => {
    const fetcher = outcomeQueue(
      { kind: "auth-error", detail: "X API returned 401" },
      { kind: "ok", posts: [rawPost({ id: "1", text: "hi" })] }
    );
    const ctx = makeCtx(db, fetcher, broadcaster);
    const fixtures = [
      { fixtureId: 1, team1: "A", team2: "B" },
      { fixtureId: 2, team1: "C", team2: "D" },
    ];

    await pollAllOnce(ctx, () => fixtures);

    expect(fetcher).toHaveBeenCalledTimes(1); // second fixture never polled
    expect(ctx.disabled).toBe(true);
  });

  it("skips polling entirely while paused after a rate-limited outcome", async () => {
    const fetcher = outcomeQueue({ kind: "rate-limited" });
    const ctx = makeCtx(db, fetcher, broadcaster);
    const fixtures = [{ fixtureId: 1, team1: "A", team2: "B" }];

    await pollAllOnce(ctx, () => fixtures); // triggers the rate-limit, sets pausedUntil
    await pollAllOnce(ctx, () => fixtures); // should no-op — still paused

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("polls nothing when there are no live subscribed fixtures", async () => {
    const fetcher = vi.fn();
    const ctx = makeCtx(db, fetcher as unknown as ChatterFetcher, broadcaster);

    await pollAllOnce(ctx, () => []);

    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildApiFetcher — HTTP status -> FetchOutcome translation
// ---------------------------------------------------------------------------

describe("buildApiFetcher", () => {
  const fixture = { fixtureId: 42, team1: "Argentina", team2: "Switzerland" };
  let fetchSpy: { mockRestore: () => void } | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it("maps a 200 response through parseApiResponse into an ok outcome", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      json: async () =>
        apiResponse([{ id: "1", text: "hi", author_id: "u1" }], [{ id: "u1", name: "Fan", username: "fan" }]),
    } as Response);

    const outcome = await buildApiFetcher("token")(fixture);

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.posts[0]).toMatchObject({ id: "1", authorName: "Fan", authorHandle: "fan" });
    }
  });

  it("maps a 401 to an auth-error outcome", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ status: 401, json: async () => ({}) } as Response);
    const outcome = await buildApiFetcher("token")(fixture);
    expect(outcome.kind).toBe("auth-error");
  });

  it("maps a 429 to a rate-limited outcome", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ status: 429, json: async () => ({}) } as Response);
    const outcome = await buildApiFetcher("token")(fixture);
    expect(outcome.kind).toBe("rate-limited");
  });

  it("maps a 500 to a transient error outcome", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ status: 500, json: async () => ({}) } as Response);
    const outcome = await buildApiFetcher("token")(fixture);
    expect(outcome.kind).toBe("error");
  });

  it("maps a network-level throw to a transient error outcome", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const outcome = await buildApiFetcher("token")(fixture);
    expect(outcome).toEqual({ kind: "error", message: "network down" });
  });
});

// ---------------------------------------------------------------------------
// resolveChatterBackend — pure CHATTER_FETCHER=cli|api|auto selection logic
// ---------------------------------------------------------------------------

describe("resolveChatterBackend", () => {
  it("auto: picks api when a bearer token is present", () => {
    const result = resolveChatterBackend({ X_BEARER_TOKEN: "tok" }, () => "/should/not/be/used");
    expect(result).toEqual({ kind: "api", bearerToken: "tok" });
  });

  it("auto: picks cli when no bearer token is set and the binary resolves", () => {
    const result = resolveChatterBackend({}, () => "/fake/bin/twitter");
    expect(result).toEqual({ kind: "cli", binPath: "/fake/bin/twitter" });
  });

  it("auto: dormant when neither a token nor a binary is available", () => {
    const result = resolveChatterBackend({}, () => null);
    expect(result.kind).toBe("dormant");
  });

  it("explicit api mode ignores an available CLI binary and goes dormant without a token", () => {
    const result = resolveChatterBackend({ CHATTER_FETCHER: "api" }, () => "/fake/bin/twitter");
    expect(result.kind).toBe("dormant");
  });

  it("explicit cli mode ignores an available token and goes dormant without a binary", () => {
    const result = resolveChatterBackend({ CHATTER_FETCHER: "cli", X_BEARER_TOKEN: "tok" }, () => null);
    expect(result.kind).toBe("dormant");
  });

  it("an unrecognized CHATTER_FETCHER value falls back to auto behavior", () => {
    const result = resolveChatterBackend({ CHATTER_FETCHER: "bogus", X_BEARER_TOKEN: "tok" }, () => null);
    expect(result).toEqual({ kind: "api", bearerToken: "tok" });
  });
});

// ---------------------------------------------------------------------------
// startChatter — backend selection wiring + startup logs
// ---------------------------------------------------------------------------

describe("startChatter backend selection", () => {
  const originalToken = process.env.X_BEARER_TOKEN;
  const originalMode = process.env.CHATTER_FETCHER;

  beforeEach(() => {
    delete process.env.X_BEARER_TOKEN;
    delete process.env.CHATTER_FETCHER;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalToken;
    if (originalMode === undefined) delete process.env.CHATTER_FETCHER;
    else process.env.CHATTER_FETCHER = originalMode;
  });

  function newDb(): Database.Database {
    const db = openDb(":memory:");
    initKv(db);
    return db;
  }

  it("stays dormant and logs which backends were checked when neither a token nor a CLI binary is available", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const handle = startChatter({
      db: newDb(),
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [{ fixtureId: 1, team1: "A", team2: "B" }],
      resolveCliBinary: () => null,
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[Chatter] Match chatter disabled — no X_BEARER_TOKEN and no `twitter` binary found " +
        "(checked TWITTER_CLI_PATH, PATH (`which twitter`), ~/.local/bin, ~/.agent-reach/bin)."
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() => handle.stop()).not.toThrow();

    logSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("selects the X API backend when X_BEARER_TOKEN is set, even if a CLI binary also resolves", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.X_BEARER_TOKEN = "test-token";

    const handle = startChatter({
      db: newDb(),
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [], // selection-only — never actually poll (no real network here)
      resolveCliBinary: () => "/fake/bin/twitter",
    });

    expect(logSpy).toHaveBeenCalledWith("[Chatter] Match chatter enabled via the X API backend.");
    handle.stop();
    logSpy.mockRestore();
  });

  it("auto mode selects the CLI backend when no token is set and the binary resolves (injected fake resolver — no real PATH lookup or subprocess)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cliFetcherStub: ChatterFetcher = vi.fn(async (): Promise<FetchOutcome> => ({ kind: "ok", posts: [] }));
    const buildCliFetcherSpy = vi.fn((binPath: string) => {
      expect(binPath).toBe("/fake/bin/twitter");
      return cliFetcherStub;
    });

    const handle = startChatter({
      db: newDb(),
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [], // selection-only — never actually poll
      resolveCliBinary: () => "/fake/bin/twitter",
      buildCliFetcher: buildCliFetcherSpy,
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[Chatter] Match chatter enabled via the local `twitter` CLI backend (/fake/bin/twitter)."
    );
    expect(buildCliFetcherSpy).toHaveBeenCalledWith("/fake/bin/twitter");
    handle.stop();
    logSpy.mockRestore();
  });

  it("explicit CHATTER_FETCHER=api does not fall back to the CLI when no token is set", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.CHATTER_FETCHER = "api";

    const handle = startChatter({
      db: newDb(),
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [],
      resolveCliBinary: () => "/fake/bin/twitter", // present, but must be ignored in explicit api mode
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[Chatter] Match chatter disabled — CHATTER_FETCHER=api but X_BEARER_TOKEN is not set."
    );
    handle.stop();
    logSpy.mockRestore();
  });

  it("explicit CHATTER_FETCHER=cli does not fall back to the API when the binary is missing, even with a token set", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.CHATTER_FETCHER = "cli";
    process.env.X_BEARER_TOKEN = "test-token";

    const handle = startChatter({
      db: newDb(),
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [],
      resolveCliBinary: () => null,
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[Chatter] Match chatter disabled — CHATTER_FETCHER=cli but no `twitter` binary found " +
        "(checked TWITTER_CLI_PATH, PATH (`which twitter`), ~/.local/bin, ~/.agent-reach/bin)."
    );
    handle.stop();
    logSpy.mockRestore();
  });
});
