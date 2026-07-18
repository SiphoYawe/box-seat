# Box Seat Backend → Frontend Contract

This document is the ground truth for the interface between the Box Seat backend
and frontend. If anything in `KIMI-BUILD-SPEC.md` (or any other doc) disagrees with
this file, **this file wins**.

The backend exposes exactly **one WebSocket endpoint**. That is the entire interface.
There is no REST API, no direct TxLINE access, and no Solana calls from the frontend —
all TxLINE ingestion and all Solana activity live in the backend behind a service
wallet.

**Endpoint:** `ws://<host>:<WS_PORT>` — default port `8787` (see `server/.env.example`,
`WS_PORT`). In production this should be fronted as `wss://...`.

---

## Client → Server

```json
{ "type": "subscribe", "fixtureId": 14790158 }
{ "type": "unsubscribe", "fixtureId": 14790158 }
```

A client may hold multiple simultaneous subscriptions (e.g. a match list subscribed to
several fixtures at once).

---

## Server → Client

### `state`

Sent on every reducer update for a subscribed fixture. Each message carries the **full
authoritative `MatchState`** — not a delta. The frontend should replace its local
state wholesale, never merge.

```json
{
  "type": "state",
  "state": {
    "fixtureId": 14790158,
    "statusId": 4,
    "score": { "participant1": 1, "participant2": 0 },
    "momentum": 0.42,
    "pressure": {
      "participant1": { "defensive": 3, "middle": 8, "attacking": 14 },
      "participant2": { "defensive": 5, "middle": 4, "attacking": 2 }
    },
    "keyMoments": [
      { "type": "goal", "participant": 1, "ts": 1721300123456, "seq": 42, "id": 241 }
    ],
    "lastTs": 1721300456789,
    "lastSeq": 118,
    "clock": { "running": true, "seconds": 1523, "statusId": 4 }
  }
}
```

**Field semantics:**

- `score` — **authoritative**, taken directly from TxLINE's `Score` field on the
  triggering action (a running total, not derived by counting `goal` events). TxLINE
  sends several messages per real goal (unconfirmed, then one or more
  confirm/amend updates, all sharing the same action `id`) — the backend applies the
  `Score` field outright rather than incrementing per message, so the frontend never
  needs to dedupe goals itself. Only if a `goal` event arrives with no `Score` field at
  all (a malformed/legacy frame) does the backend fall back to a one-time increment.
- `momentum` — a number in `[-1, +1]`. Negative favors participant2, positive favors
  participant1. 0 is neutral.
- `pressure.participantN.{defensive,middle,attacking}` — unbounded, accumulating
  totals per pitch third. These are running sums, not bounded percentages — the
  frontend must normalize them itself (e.g. relative to the max value seen so far in
  the match) before rendering.
- `keyMoments` — the full ordered list of key moments to date (not just the newest
  one). Detect newly arrived moments by watching for a change in array length (or
  tracking the highest `seq` already handled) and trigger the full-screen takeover for
  `goal`, `red_card`, and `var_overturned` types.
  - `keyMoments[].id` — the TxLINE action id the moment was derived from, when the
    source event carried one. The backend already dedupes repeated messages for the
    same action id (a moment is appended, and its momentum boost applied, at most
    once per id) — this field is exposed mainly for correlating a moment back to the
    raw event log, not something the frontend needs to dedupe again.
- `clock` — the game clock as of the last event that carried one, or `null` if none has
  arrived yet for this fixture.
  - `running` — whether the clock is currently ticking.
  - `seconds` — **counts UP as CUMULATIVE MATCH TIME, from 0 at kickoff** — not
    per-period. (CORRECTED TWICE against the live World Cup feed, final answer:
    at ~4 min of H1 it read `247`; at the 73rd minute — deep into H2 — it read
    `4402` (= 73.4 × 60). A per-period clock would have read ~1700 there. The
    Fusion PDF's countdown description and our first per-period correction were
    both wrong; this is measured across two periods of a live match.)
  - `statusId` — the game-phase `StatusId` in effect when this clock reading was taken
    (see the Game Phase Encoding table in `docs/txline/scores/soccer-feed.md`; `2` =
    H1, `4` = H2, etc).
  - The backend does not compute a display minute — derive it on the frontend:
    - `minute = ceil(seconds / 60)` — that's it, it's cumulative.
    - Stoppage display: H1 (`statusId` 2) with `minute > 45` → render `45+X'`
      (`X = minute - 45`); H2 (`statusId` 4) with `minute > 90` → `90+X'`;
      ET1 (`7`) past 105 → `105+X'`; ET2 (`9`) past 120 → `120+X'`.
    - Between periods (`running: false` at HT etc.), show the period label (`HT`)
      rather than a minute.

### `fixture_list`

Sent to every client immediately on connect, and rebroadcast to all connected clients
whenever the list changes: a new fixture is discovered (via live `FixtureInfo` or the
startup snapshot seed), or a fixture's state transitions to a terminal status. This is
the backend's only source of fixture metadata — team names, competition, and start
time — and of the match list for a "browse fixtures" screen.

```json
{
  "type": "fixture_list",
  "fixtures": [
    {
      "fixtureId": 18241006,
      "participant1": "England",
      "participant1Id": 4433,
      "participant2": "Argentina",
      "participant2Id": 38298,
      "competition": "World Cup",
      "startTime": 1752606000000,
      "statusId": 5,
      "score": { "participant1": 2, "participant2": 1 }
    }
  ]
}
```

`statusId`/`score` are joined in from the backend's in-memory match state when known;
for a fixture with no live/replayed state yet, they default to `statusId: 1` (not
started) and `score: { "participant1": 0, "participant2": 0 }`. `startTime` is epoch
milliseconds, or `null` if TxLINE hasn't reported one yet.

### `replay_chunk`

Only sent when a finished match's history is requested — i.e. subscribing to a
fixture whose match has already reached `game_finalised`.

```json
{ "type": "replay_chunk", "fixtureId": 14790158, "events": [ /* raw events */ ], "done": false }
```

The frontend accumulates chunks as they arrive and treats the sequence as complete
once a chunk arrives with `done: true`. After that, it reconstructs the full state
timeline from the accumulated raw events and can scrub freely through it.

> **Reducer version note (2026-07-18, late):** `server/src/reducer/reducer.ts` gained an
> `action_discarded` case — a disallowed goal (observed live: England had a goal
> chalked off in France–England) now retracts its key moment by action id instead of
> leaving a phantom beacon. **If the frontend ports the reducer for replay
> reconstruction, re-copy `reducer.ts` now** — an old copy will show a goal takeover
> in replays that the live view (correctly) never showed.
>
> **Second reducer update (2026-07-19, post-FT):** `penalty_outcome` with
> `Data.Outcome === "Scored"` now records a **goal** key moment (England's fifth in
> France-England was a penalty and previously produced no beacon). Re-copy
> `reducer.ts` once more — final version for the demo.

---

## Live vs. Replay

There is no separate replay endpoint. Subscribing to any `fixtureId` yields whatever
is available for that fixture:

- **In-progress matches** — live `state` updates as the reducer processes each new
  event.
- **Finalised matches (`game_finalised`)** — the backend first sends the fixture's
  full event history as one or more `replay_chunk` messages, then continues sending
  `state` messages as normal (which, for a finished match, will simply be the final,
  unchanging state).

If the backend already has state for a live fixture, a `state` snapshot is sent
immediately on subscribe; otherwise the first `state` arrives with the next live
event.

---

## Team Metadata

Team names, competition, and start time arrive via the `fixture_list` message (see
above) — `MatchState` itself carries no team names, only `participant1`/`participant2`
as the numeric side identifiers (`1`/`2`) used throughout `score`, `pressure`, and
`keyMoments`. Join `fixture_list`'s `fixtureId` against a subscribed match's `state`
to resolve names. Badges and brand colors are **not** provided by TxLINE at all — the
frontend owns a static lookup table for badges/colors (see the design doc's open item
for the expected shape of that table).

## fixture_list: phase and hasData (added 2026-07-18)

Each `fixture_list` entry now carries two additional fields the frontend MUST obey:

- `phase`: `"upcoming" | "live" | "finished"` — the server-computed classification.
  **Never derive live/finished on the frontend from `startTime` or `statusId`** — the
  server accounts for cases the frontend cannot (e.g. matches that ended before our
  data capture window began).
- `hasData`: boolean — `false` means the backend holds no event data for this fixture:
  its `score` is meaningless (do not display it — show the card as "FT" without a
  score, or greyed/non-clickable), and subscribing will yield no replay.

## New WS messages: `fixture_players` and `attestation` (added 2026-07-18)

Two new server-to-client message types. Both are sent **once per `subscribe`**, after
whatever `replay_chunk`/`state` messages that subscribe already triggers (order
relative to those doesn't matter) — and **only when the backend actually has the
data**. Neither changes the shape or semantics of `state`, `replay_chunk`, or
`fixture_list`.

### `fixture_players`

Lineups (starting XI + bench) and running per-player goal totals, captured from
TxLINE's `lineups` action and `PlayerStats` field. Sent once on subscribe **only when
the fixture has at least one captured player row** — a fixture with no lineup data yet
(not started, or TxLINE hasn't sent it) yields no message at all; do not wait for one.

```json
{
  "type": "fixture_players",
  "fixtureId": 18222446,
  "players": [
    {
      "id": 10096940,
      "name": "Almada, Thiago",
      "number": "16",
      "starter": false,
      "unit": 0,
      "participant": 1,
      "goals": 0
    },
    {
      "id": 1184377,
      "name": "Mac Allister, Alexis",
      "number": "20",
      "starter": true,
      "unit": 0,
      "participant": 1,
      "goals": 1
    }
  ]
}
```

Field semantics:

- `id` — the player's TxLINE `normativeId`, stable across fixtures.
- `name` — TxLINE's `preferredName` (`"Last, First"` formatting, as sent — not
  reformatted). Null if never captured.
- `number` — shirt number as a string (TxLINE sends it as a string, e.g. `"10"`), null
  if unknown.
- `starter` — boolean, or null if unknown (never guess `false` for "unknown").
- `unit` — the raw formation unit id from the feed (0-indexed group, not a pitch
  position) — keep it opaque and map it frontend-side if needed. Null if unknown.
- `participant` — `1` or `2`, matching `state.score`'s participant numbering. Null in
  the rare case a player's team couldn't be resolved to either fixture participant
  (backend skips attributing those rather than guessing — so this should be rare/never
  in practice).
- `goals` — running total for this player in this fixture, **authoritative** (replaces
  outright on each update, same pattern as `state.score` — never increment client-side).
  Defaults to `0` for a player who has a lineup row but hasn't scored.

A player who scores before their lineup row exists still gets a row (via the goals
update alone) with `name`/`number`/`starter`/`unit` all null until a later lineups
message (or backfill) fills them in — treat those fields as always-optional.

### `attestation`

The Solana on-chain attestation for a fixture's final state, once the backend has
successfully landed and confirmed it. Sent once on subscribe **only when an
attestation has been persisted for that fixture** — most fixtures (anything not yet
finished) will never get this message; do not show a pending/loading chip while
waiting for it, just render nothing until (if ever) it arrives.

```json
{
  "type": "attestation",
  "fixtureId": 18222446,
  "txSig": "5s3s...base58...txsig",
  "cluster": "mainnet-beta",
  "status": "confirmed"
}
```

- `txSig` — base58 transaction signature. Link to
  `https://solscan.io/tx/<txSig>?cluster=<cluster>` (omit the `?cluster=` query param
  entirely for `mainnet-beta`, per Solscan's convention).
- `cluster` — `"mainnet-beta"` or `"devnet"`, derived server-side from `SOLANA_RPC_URL`.
- `status` — always `"confirmed"` today, since the backend only persists (and
  therefore only ever sends) an attestation row after on-chain confirmation. The field
  is kept for forward-compat with a possible future `"pending"` state sent before
  confirmation — treat any other value as "don't show the chip yet".

Backend behavior notes (not part of the wire contract, but useful context): attestation
happens once per fixture the moment its state first reaches a terminal status
(`game_finalised` / finished `statusId`), and again as a startup catch-up pass for any
already-terminal fixture that's missing a persisted attestation row (e.g. finalised
before this feature existed). A confirmed attestation, once persisted, never changes —
there's no "re-attest" or update path.

## New WS message: `chatter` (added 2026-07-18)

A collapsible "Match chatter" panel shows recent X (Twitter) posts about a fixture. The
frontend must **never** call X directly — this message is a moderated, cached,
server-side proxy. Sent once per `subscribe` (after whatever `fixture_players`/
`attestation` that subscribe already triggers — order doesn't matter), and again to
that fixture's subscribers whenever the cached list changes (compared by newest post
id).

```json
{
  "type": "chatter",
  "fixtureId": 18222446,
  "posts": [
    {
      "id": "1234567890",
      "author": "Display Name",
      "handle": "user",
      "text": "verbatim post text",
      "ts": 1784400000000,
      "likes": 42
    }
  ]
}
```

- `id` — the X post's id (string).
- `author` — the poster's display name.
- `handle` — the poster's `@handle`, without the `@`.
- `text` — the post's text, verbatim except for a hard 280-char cap (see moderation
  guarantees below). No link unfurling, no formatting changes.
- `ts` — epoch milliseconds the post was created.
- `likes` — like count at fetch time (a snapshot, not live-updating per post).

At most ~10 posts, newest first.

### Fetch backend is configurable server-side — the wire contract does not change

The backend fetches posts from either the official X API (bearer token) or the local
`twitter` CLI (`CHATTER_FETCHER=cli|api|auto`, server-side env var only). This is purely
an internal fetch-seam detail: every post — from either backend — still passes through
the same moderation pipeline before being cached or broadcast, and the `chatter` message
shape above is identical regardless of which backend produced it. The frontend has no way
to tell which backend is active and does not need to.

### Graceful absence — this message may simply never arrive

Treat absence as "hide the chatter panel entirely," not as a loading/error state. All of
the following are normal, expected reasons no `chatter` message ever shows up for a
fixture:

- Neither fetch backend is available (no `X_BEARER_TOKEN` and no local `twitter` CLI
  binary — the normal case on a server deploy, e.g. Railway) — the entire chatter
  subsystem is dormant for the whole process; no fixture ever gets a `chatter` message.
- The fixture hasn't reached `phase: "live"` yet (see `fixture_list`) — only live
  fixtures are polled. A finished fixture still serves whatever was cached while it was
  live (no fresh polling), and an upcoming fixture has never been polled at all.
- No X post about the fixture has passed moderation yet (see below) — an empty/absent
  cache is not an error.

Once a `chatter` message does arrive for a fixture, expect further ones as the cached
list changes (new posts pass moderation), but there's no guaranteed cadence — the
backend polls a shared loop on the order of ~90s per live, subscribed fixture, and backs
off further (or stops permanently for the process) under rate limits or backend
failures (auth errors for the X API; non-zero exit/timeout/unparseable output for the
CLI). Delivery is best-effort and absent-when-unavailable in every case — the frontend
should not infer anything from a gap between `chatter` messages.

### Moderation guarantees

Every post in a `chatter` message has already passed server-side moderation before the
frontend ever sees it:

- **No URLs** — posts containing a link (any `http` substring or a `t.co` shortener) are
  dropped entirely, not stripped. No link unfurling, ever.
- **No media** — posts with an image/video/GIF/poll attachment are dropped entirely.
  `chatter` posts are text-only; there is no image or avatar field anywhere in the
  payload, and there never will be (read-only, text-only, forever).
- **English only** — posts are kept only when the X API's `lang` field is exactly `en`;
  anything else (including missing `lang`) is dropped.
- **Blocklist-filtered** — posts matching an inline profanity/slur blocklist
  (substring-matched, erring toward over-dropping) are dropped entirely.
- **Text is capped at 280 characters**, verbatim (no truncation ellipsis, no
  reformatting) — a hard slice, not a moderation drop.

This is a read-only proxy: the backend never posts, likes, retweets, or performs any
write action against X, now or in any planned future change.
