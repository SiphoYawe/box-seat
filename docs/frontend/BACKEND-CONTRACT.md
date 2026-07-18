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
      { "type": "goal", "participant": 1, "ts": 1721300123456, "seq": 42 }
    ],
    "lastTs": 1721300456789,
    "lastSeq": 118
  }
}
```

**Field semantics:**

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

Team names arrive via TxLINE fixture data (`participant1`/`participant2` on
`MatchState` correspond to the fixture's two competing teams), not via this WebSocket
contract. Badges and brand colors are **not** provided by TxLINE at all — the frontend
owns a static lookup table for badges/colors (see the design doc's open item for the
expected shape of that table).
