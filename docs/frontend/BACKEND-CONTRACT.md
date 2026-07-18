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
  - `seconds` — **counts UP within the current period, from 0**. (CORRECTED 2026-07-18
    against the live World Cup feed: at ~4 minutes into a live match, `seconds` read
    `247`. The Fusion Scores PDF describes a countdown clock — the live TxLINE feed
    does the opposite. Trust this, it was measured, not read.)
  - `statusId` — the game-phase `StatusId` in effect when this clock reading was taken
    (see the Game Phase Encoding table in `docs/txline/scores/soccer-feed.md`; `2` =
    H1, `4` = H2, etc).
  - The backend does not compute a display minute — derive it on the frontend:
    - H1 (`statusId` 2): `minute = min(45, ceil(seconds / 60))`; if
      `seconds > 2700`, render stoppage time (`45+X'` where `X = ceil((seconds - 2700) / 60)`).
    - H2 (`statusId` 4): `minute = min(90, 45 + ceil(seconds / 60))`; if
      `seconds > 2700`, render `90+X'` similarly.
    - Extra time periods (`statusId` 7/9): same pattern over a 15-minute (900s) period,
      based at 90' and 105'.
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
