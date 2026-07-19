# Backend Task Prompt: CLI-backed X fetcher for chatter (paste to the backend Claude)

You are working on the Box Seat backend (`server/`). The chatter subsystem is
shipped and tested (`server/src/chatter/xChatter.ts`: shared poller, moderation
pipeline, kv cache, fixture-scoped broadcast, 53/53 tests green). It currently
fetches via the official X API when `X_BEARER_TOKEN` is set, and stays dormant
otherwise.

**Task: add a second fetcher backend that uses the locally installed
`twitter` CLI instead of the X API - zero credentials, zero cost.** The CLI is
already authenticated on this machine (agent-reach uses it). Do not touch the
moderation pipeline, the kv cache, the WS message shape, or the contract -
this is a swap/option at the fetch seam only.

## The CLI (verified live 2026-07-19)

```bash
twitter search "Argentina Switzerland" -n 15 --lang en -t latest --json --exclude retweets
```

- `--json` prints a JSON document (also `--yaml`; default is YAML). Root shape:
  `{ ok: true, schema_version: "1", data: [...] }`.
- Per post in `data`:
  - `id` (string) -> `id`
  - `text` (string) -> `text` (the existing 280-cap moderation still applies)
  - `author.name` (string) -> `author`
  - `author.screenName` (string) -> `handle`
  - `createdAtISO` (string) -> `ts` (use `Date.parse`)
  - `metrics.likes` (number) -> `likes`
  - `urls` (array) - if non-empty, drop (redundant with the existing URL rule;
    keep the rule anyway)
  - `media` (array) - if non-empty, drop (redundant with the media rule)
  - `lang` (string) - the query already pre-filters `--lang en`; keep the
    existing language rule as the belt-and-braces check
  - `isRetweet` (bool) - the query already excludes retweets
- Query template per fixture: `"<team1 name> <team2 name>"` (both quoted as
  one string), `-n 15`, `-t latest`. Do NOT use `--from`/`--to`/`--has`.

## Implementation requirements

- Spawn with `child_process.execFile("twitter", args, { timeout: 15000 })` -
  never `exec`/shell strings. Fixture names go in as argv entries, no
  interpolation into a shell line.
- Fetcher selection via env: `CHATTER_FETCHER=cli|api|auto` (default `auto`):
  use `api` when `X_BEARER_TOKEN` is set, else `cli` when the `twitter` binary
  resolves on PATH, else stay dormant exactly as today (one startup log line,
  no WS messages, nothing else changes).
- Failure handling: CLI non-zero exit, ENOENT, auth expiry, or malformed JSON
  -> log once per process and keep the subsystem dormant for that cycle; never
  crash the poller. Rate-limit-friendly: keep the existing ~90s/fixture
  cadence, and add a per-process minimum of one CLI invocation per 60s shared
  across fixtures (the CLI is unofficial and can be throttled).
- Read-only forever: the CLI is used for search only - no posting, liking,
  retweeting, or any write action.
- Contract: the `chatter` WS message shape is unchanged; update
  `docs/frontend/BACKEND-CONTRACT.md` only to note that the fetch backend is
  configurable (`CHATTER_FETCHER`) - the graceful-absence rules stay true as
  written.

## Tests

- Keep all 53 existing tests green.
- Add a fetcher-mapping unit test: feed a captured `--json` sample (two posts)
  through the mapper and assert the `{ id, author, handle, text, ts, likes }`
  output, including epoch-ms conversion and the urls/media drop rules.
- Add a selection test: `CHATTER_FETCHER=auto` picks `cli` when no bearer
  token is set and the binary resolves (stub PATH lookup).
