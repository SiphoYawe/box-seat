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
  type RawXPost,
  type PollContext,
  type ChatterBroadcaster,
  type XFetcher,
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

function fetcherQueue(...responses: Array<{ status: number; json: unknown }>): XFetcher {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({ status: r.status, json: async () => r.json });
  }
  return fn as unknown as XFetcher;
}

function makeCtx(db: Database.Database, fetcher: XFetcher, broadcaster: ChatterBroadcaster): PollContext {
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
    const fetcher = fetcherQueue({
      status: 200,
      json: apiResponse(
        [{ id: "100", text: "Huge win for Argentina!", author_id: "u1" }],
        [{ id: "u1", name: "Fan One", username: "fanone" }]
      ),
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
    const fetcher = fetcherQueue({
      status: 200,
      json: apiResponse([{ id: "101", text: "Check it out https://spam.example", author_id: "u1" }]),
    });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    expect(getCachedChatter(db, 42)).toBeNull();
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("does not rebroadcast when the newest post id is unchanged", async () => {
    const response = {
      status: 200,
      json: apiResponse(
        [{ id: "200", text: "Same post both polls", author_id: "u1" }],
        [{ id: "u1", name: "Fan", username: "fan" }]
      ),
    };
    const fetcher = fetcherQueue(response, response);
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);
    await pollFixtureOnce(ctx, fixture);

    expect(broadcastChatter).toHaveBeenCalledTimes(1);
  });

  it("rebroadcasts when the newest post id changes", async () => {
    const fetcher = fetcherQueue(
      {
        status: 200,
        json: apiResponse([{ id: "300", text: "First post", author_id: "u1", created_at: "2026-07-18T12:00:00.000Z" }]),
      },
      {
        status: 200,
        json: apiResponse([{ id: "301", text: "Newer post", author_id: "u1", created_at: "2026-07-18T12:05:00.000Z" }]),
      }
    );
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);
    await pollFixtureOnce(ctx, fixture);

    expect(broadcastChatter).toHaveBeenCalledTimes(2);
    const cached = getCachedChatter(db, 42);
    expect(cached!.posts[0].id).toBe("301");
  });

  it("keeps the stale cache and does not throw when the fetch itself fails", async () => {
    const fetcher: XFetcher = vi.fn().mockRejectedValueOnce(new Error("network down"));
    const ctx = makeCtx(db, fetcher, broadcaster);

    await expect(pollFixtureOnce(ctx, fixture)).resolves.toBeUndefined();
    expect(getCachedChatter(db, 42)).toBeNull();
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("disables the poller for the process lifetime on a 401", async () => {
    const fetcher = fetcherQueue({ status: 401, json: {} });
    const ctx = makeCtx(db, fetcher, broadcaster);

    await pollFixtureOnce(ctx, fixture);

    expect(ctx.disabled).toBe(true);
    expect(broadcastChatter).not.toHaveBeenCalled();
  });

  it("backs off for 5 minutes on a 429", async () => {
    const fetcher = fetcherQueue({ status: 429, json: {} });
    const ctx = makeCtx(db, fetcher, broadcaster);
    const before = Date.now();

    await pollFixtureOnce(ctx, fixture);

    expect(ctx.pausedUntil).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000);
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
    const fetcher = fetcherQueue(
      { status: 401, json: {} },
      { status: 200, json: apiResponse([{ id: "1", text: "hi", author_id: "u1" }]) }
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

  it("skips polling entirely while paused after a 429", async () => {
    const fetcher = fetcherQueue({ status: 429, json: {} });
    const ctx = makeCtx(db, fetcher, broadcaster);
    const fixtures = [{ fixtureId: 1, team1: "A", team2: "B" }];

    await pollAllOnce(ctx, () => fixtures); // triggers the 429, sets pausedUntil
    await pollAllOnce(ctx, () => fixtures); // should no-op — still paused

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("polls nothing when there are no live subscribed fixtures", async () => {
    const fetcher = vi.fn();
    const ctx = makeCtx(db, fetcher as unknown as XFetcher, broadcaster);

    await pollAllOnce(ctx, () => []);

    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("startChatter (dormant path)", () => {
  const originalToken = process.env.X_BEARER_TOKEN;

  beforeEach(() => {
    delete process.env.X_BEARER_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = originalToken;
  });

  it("logs one line and never touches fetch when X_BEARER_TOKEN is unset", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const db = openDb(":memory:");
    initKv(db);
    const handle = startChatter({
      db,
      broadcaster: { broadcastChatter: vi.fn() },
      getLiveSubscribedFixtures: () => [{ fixtureId: 1, team1: "A", team2: "B" }],
    });

    expect(logSpy).toHaveBeenCalledWith(
      "[Chatter] X_BEARER_TOKEN not set — match chatter disabled."
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() => handle.stop()).not.toThrow();

    logSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
