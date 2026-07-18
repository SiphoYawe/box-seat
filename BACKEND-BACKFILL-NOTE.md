# TxLINE Backfill Note (for the backend side)

> **Status update (2026-07-18, later):** IMPLEMENTED server-side. The backend
> now backfills past fixtures at startup (`server/src/txline/backfill.ts`,
> delete-then-insert per fixture, full `id`/`confirmed`/`score`/`clock`
> fields via the shared `parseScoresRecord`), seeds a fixtures table from the
> snapshot API, and emits `fixture_list` on connect. A first pass via a
> standalone script (15,430 events, 14 matches) was superseded by the
> backend's own full-field backfill; the script was removed to keep one
> backfill path. The rest of this note stays as the design record.

**Problem:** replays for past matches don't work because the local event log
(`events` table) only fills from the live SSE stream. Nothing streams for
already-finished fixtures, so `replay_chunk`s never fire.

**Solution (verified working 2026-07-18):** TxLINE's historical scores API,
covered by the existing World Cup free tier ("Historical Replay" is listed in
`docs/txline/worldcup.md`).

## Endpoint

```
GET https://txline.txodds.com/api/scores/historical/{fixtureId}
Authorization: Bearer <guest JWT>
X-Api-Token: <activated API token>
```

- Auth is the same JWT + API token pair the scores stream already uses
  (`setupTxLineSession` / `renewJwt` in `server/src/txline/auth.ts`). The
  persisted token in `kv.txline_api_token` works as-is.
- **Window:** fixture start time must be between **two weeks and six hours**
  in the past (per `docs/txline/api-reference/openapi.yaml`). All six
  knockout-round matches played so far are inside the window; tonight's
  third-place match and tomorrow's final become backfillable ~6h after they
  end.
- **Response is `text/event-stream`, not `application/json`** (the OpenAPI
  spec says JSON array — the wire is SSE). Parse line-wise: each line is
  `data: {...}`, JSON.parse the slice after `data:`.

## Row shape = the SSE `Update` shape (free adapter)

Each parsed row carries exactly the fields `parseScoresPayload`
(`server/src/txline/ingest.ts`) already reads:

```json
{
  "FixtureId": 18237038, "Action": "game_finalised", "StatusId": ...,
  "Participant": 1, "Data": {...}, "Ts": 1784063054751, "Seq": 905, ...
}
```

So each row can go straight through `parseScoresPayload(JSON.stringify(row))`
(or a direct field copy) into `RawScoreEvent` — no new mapping logic.

Verified response for `18237038` (France-Spain semi): HTTP 200, 1,127,098
bytes, **1027 events**, `Seq` 0..905, starts with `coverage_update`, ends with
`game_finalised` — a complete replayable match. CompetitionId for the World
Cup is `72`.

## Fixtures snapshot (real fixture metadata)

```
GET /api/fixtures/snapshot?competitionId=72&startEpochDay=<epochDay>
```

Plain JSON array (no SSE framing here): `FixtureId, Participant1,
Participant2, Participant1IsHome, StartTime, GameState, FixtureGroupId`.
The frontend's `frontend/src/data/fixtures.json` is already updated with the
real knockout fixtures from this API (quarter-finals through the final).

## Suggested integration (server/src/index.ts)

1. **On subscribe** (in the `Broadcaster` onSubscribe handler): if
   `readEventLog(db, fixtureId)` is empty AND the fixture's start time is >6h
   in the past, fetch `scores/historical/{fixtureId}`, `appendEvent` each row
   in `seq` order (PK `(fixture_id, seq)` + `INSERT OR IGNORE` semantics makes
   this idempotent), fold into `matchStates`, then fall through to the
   existing replay-chunk path. Guard with a per-fixture in-flight set so two
   subscribers don't double-fetch.
2. **Startup sweep (optional):** same backfill for every fixture in
   `fixtures.json` whose kickoff is >6h past, so finished matches are
   replayable without waiting for a subscriber.
3. Failed/empty responses (outside window, no coverage): cache negatively for
   a few minutes to avoid hammering the API on every subscribe.

## After backfill

The existing contract works unchanged: subscribing to a finalised fixture
streams `replay_chunk`s then `state`, and the frontend reconstructs and
scrubs the full match. No frontend changes needed.
