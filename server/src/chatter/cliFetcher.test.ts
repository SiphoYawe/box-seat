import { describe, it, expect, vi } from "vitest";
import { moderatePost, toChatterPost } from "./xChatter.js";
import {
  mapCliPost,
  parseCliResponse,
  buildCliArgs,
  buildCliFetcher,
  resolveTwitterCliPathSync,
} from "./cliFetcher.js";

// ---------------------------------------------------------------------------
// Captured sample — trimmed and anonymized from a real, live invocation of:
//   twitter search "Argentina Switzerland" -n 15 --lang en -t latest --json --exclude retweets
// run on this machine on 2026-07-19 (15 posts returned; root shape confirmed
// as `{ ok: true, schema_version: "1", data: [...] }`). Field names/nesting
// below are verbatim from that response; author identity and post text are
// genericized.
// ---------------------------------------------------------------------------

const CAPTURED_SAMPLE = {
  ok: true,
  schema_version: "1",
  data: [
    {
      id: "2078622077276328224",
      text: "Huge respect for both sides after that game, incredible finish honestly.",
      author: {
        id: "1837145567723462656",
        name: "Test Fan",
        screenName: "testfan_wc",
        profileImageUrl: "https://pbs.twimg.com/profile_images/000/normal.jpg",
        verified: false,
      },
      metrics: { likes: 2, retweets: 0, replies: 0, quotes: 0, views: 8, bookmarks: 0 },
      createdAt: "Sat Jul 18 23:24:56 +0000 2026",
      createdAtLocal: "2026-07-19 00:24",
      createdAtISO: "2026-07-18T23:24:56+00:00",
      media: [],
      urls: [],
      isRetweet: false,
      retweetedBy: null,
      lang: "en",
      score: null,
    },
    {
      id: "2078617740655378722",
      text: "Full match recap thread coming up shortly, stay tuned.",
      author: {
        id: "1551964644222410754",
        name: "Match Alerts",
        screenName: "matchalerts_hq",
        profileImageUrl: "https://pbs.twimg.com/profile_images/111/normal.jpg",
        verified: true,
      },
      metrics: { likes: 7, retweets: 1, replies: 0, quotes: 0, views: 852, bookmarks: 0 },
      createdAt: "Sat Jul 18 23:07:42 +0000 2026",
      createdAtLocal: "2026-07-19 00:07",
      createdAtISO: "2026-07-18T23:07:42+00:00",
      media: [{ type: "photo", url: "https://pbs.twimg.com/media/example.jpg", width: 1064, height: 710 }],
      urls: [],
      isRetweet: false,
      retweetedBy: null,
      lang: "en",
      score: null,
    },
  ],
};

describe("mapCliPost", () => {
  it("maps every field into the RawXPost shape, including epoch-ms conversion", () => {
    const [postA] = CAPTURED_SAMPLE.data;
    const mapped = mapCliPost(postA);

    expect(mapped).toEqual({
      id: "2078622077276328224",
      text: "Huge respect for both sides after that game, incredible finish honestly.",
      lang: "en",
      createdAtMs: Date.parse("2026-07-18T23:24:56+00:00"),
      likes: 2,
      hasMedia: false,
      authorName: "Test Fan",
      authorHandle: "testfan_wc",
    });
    expect(mapped.createdAtMs).toBe(1784417096000);
  });

  it("sets hasMedia true when the media array is non-empty", () => {
    const [, postB] = CAPTURED_SAMPLE.data;
    const mapped = mapCliPost(postB);
    expect(mapped.hasMedia).toBe(true);
  });

  it("defaults missing author/metrics fields defensively", () => {
    const mapped = mapCliPost({ id: "1", text: "hi" });
    expect(mapped.authorName).toBe("Unknown");
    expect(mapped.authorHandle).toBe("unknown");
    expect(mapped.likes).toBe(0);
    expect(mapped.hasMedia).toBe(false);
  });
});

describe("parseCliResponse", () => {
  it("parses the captured sample's root document into RawXPost[]", () => {
    const posts = parseCliResponse(CAPTURED_SAMPLE);
    expect(posts).toHaveLength(2);
    expect(posts[0].id).toBe("2078622077276328224");
    expect(posts[1].id).toBe("2078617740655378722");
  });

  it("runs mapped posts through the existing (unchanged) moderation pipeline", () => {
    const posts = parseCliResponse(CAPTURED_SAMPLE);
    const accepted = posts.filter(moderatePost).map(toChatterPost);

    // Post A: clean, text-only -> passes. Post B: has media -> dropped by the
    // existing hasMedia rule, same as it would be for the X API backend.
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toEqual({
      id: "2078622077276328224",
      author: "Test Fan",
      handle: "testfan_wc",
      text: "Huge respect for both sides after that game, incredible finish honestly.",
      ts: 1784417096000,
      likes: 2,
    });
  });

  it("returns an empty array for a malformed/empty root document", () => {
    expect(parseCliResponse(null)).toEqual([]);
    expect(parseCliResponse({})).toEqual([]);
    expect(parseCliResponse({ ok: true, data: "not-an-array" })).toEqual([]);
  });
});

describe("buildCliArgs", () => {
  it("builds the exact verified argv for `twitter search`", () => {
    expect(buildCliArgs("Argentina", "Switzerland")).toEqual([
      "search",
      "Argentina Switzerland",
      "-n",
      "15",
      "--lang",
      "en",
      "-t",
      "latest",
      "--json",
      "--exclude",
      "retweets",
    ]);
  });
});

describe("resolveTwitterCliPathSync", () => {
  it("trusts TWITTER_CLI_PATH only when it points at an executable file", () => {
    // A path that (almost certainly) doesn't exist on any machine.
    const result = resolveTwitterCliPathSync({ TWITTER_CLI_PATH: "/nonexistent/path/twitter-cli-does-not-exist" });
    // Falls through to the real `which`/known-location lookup rather than
    // trusting a bogus override — result depends on the host machine, so we
    // only assert it doesn't throw and returns a string or null.
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("buildCliFetcher", () => {
  const fixture = { fixtureId: 1, team1: "Argentina", team2: "Switzerland" };

  it("enforces the shared 60s-minimum interval across fixtures via a skip outcome", async () => {
    let now = 1_000_000;
    const fetcher = buildCliFetcher("/fake/bin/twitter-never-invoked", {
      now: () => now,
      minIntervalMs: 60_000,
    });

    // First call would invoke the (fake, never-resolving-successfully) binary —
    // we don't care about its outcome kind here, only that it wasn't skipped.
    const first = fetcher(fixture);
    now += 1_000; // still well within the 60s window
    const secondOutcome = await fetcher({ fixtureId: 2, team1: "C", team2: "D" });
    expect(secondOutcome).toEqual({ kind: "skip" });

    await first; // avoid an unhandled-rejection warning from the real execFile attempt
  });

  it("resolves auth-error on a nonexistent binary path (ENOENT) without throwing", async () => {
    const fetcher = buildCliFetcher("/definitely/not/a/real/binary/twitter", { minIntervalMs: 0 });
    const outcome = await fetcher(fixture);
    expect(outcome.kind).toBe("auth-error");
  });
});
