# Backend Task Prompt (hand to the backend engineer/agent)

You are working on the Box Seat backend (`server/` in this repo). The frontend
is built and live; we now need three additions server-side. Read
`docs/frontend/BACKEND-CONTRACT.md` first (it is the ground truth — update it
when done), then `server/src/txline/ingest.ts`, `server/src/index.ts`,
`server/src/solana/attestation.ts`, and `server/src/store/eventLog.ts`.

## 1. Persist lineups and player stats

TxLINE score records carry two sibling fields our `RawScoreEvent` currently
drops (verified present on `/api/scores/historical/{fixtureId}` rows and on
live `Update` records):

- `Lineups` — on the `lineups` action. Shape:
  `Lineups[].lineups[]` → `{ fixturePlayerId, rosterNumber, starter,
  positionId, unitId, player: { normativeId, preferredName, country,
  dateOfBirth } }`, plus the team block's `normativeId` (maps to the fixture's
  `Participant1Id`/`Participant2Id` to assign `participant` 1|2).
- `PlayerStats` — on various in-play actions. Shape:
  `{ Participant1: { "<playerNormativeId>": { "goals": 1 } }, ... }` —
  running per-player totals (replace, don't increment).

Tasks:

- Extend `parseScoresRecord` (or a side-channel in `connectScoresStream` and
  `backfillFixture`) to capture these into a new table, e.g.
  `fixture_players(fixture_id, player_id, name, number, starter, unit,
  participant, goals, PRIMARY KEY (fixture_id, player_id))`. Upsert on
  `lineups` actions; update `goals` whenever `PlayerStats` appears (merge the
  running totals per participant). Keep it tolerant: fields may be absent.
- Re-run the startup backfill after deploying so finished fixtures get their
  lineups (the backfill deletes per-fixture first, so it's safe).

## 2. Expose players to the frontend (new WS message)

On subscribe to a fixture (after any replay chunks), send one:

```json
{
  "type": "fixture_players",
  "fixtureId": 18222446,
  "players": [
    { "id": 10096940, "name": "Preferred Name", "number": "16",
      "starter": true, "unit": 0, "participant": 1, "goals": 0 }
  ]
}
```

`unit` is the formation unit id from the feed (keep raw; frontend maps it).
Send it once per subscribe, before/after replay chunks — order doesn't matter.
Frontend treats unknown/absent gracefully, so partial data is fine.

## 3. Attestation status + Solscan linkage

`attestMatch` already fires on terminal events. Persist its outcome per
fixture (a `fixture_attestation(fixture_id, tx_sig, cluster, ts)` table or kv
entries), including transactions that landed before this change if discoverable.

Include in the same `fixture_players` message (or a separate
`{ "type": "attestation", fixtureId, txSig, cluster, status }` message on
subscribe): `txSig` (base58), `cluster` (`"mainnet-beta"` or `"devnet"` —
derive from `SOLANA_RPC_URL`), and `status` (`"confirmed" | "pending"`).

The frontend renders an "Attested on Solana" chip linking to
`https://solscan.io/tx/<txSig>?cluster=<cluster>` when present, and hides it
otherwise — pending attestations get a subtle pending state.

## Notes

- Do NOT change the shapes of `state`, `replay_chunk`, or `fixture_list` —
  the frontend depends on them exactly as documented.
- Unknown/extra WS message types are ignored by older clients, so this is
  backward-compatible.
- `docs/frontend/BACKEND-CONTRACT.md` must gain the new message(s) when done —
  the frontend codes against the contract.

## 4. Live X feed per match (planned, not yet built)

The frontend will get a collapsible "Match chatter" panel showing recent X
posts about the fixture. It must NOT be called browser-direct (CORS, auth
secrets in the client, and unmoderated content on a public demo). Design:

- **Proxy in the backend**: poll an X search API (e.g. recent search for
  `"<team1> <team2>" OR "#<code1><code2>"` every 60-120s, per live fixture),
  **moderate server-side** (drop posts with links-only content, slur lists,
  or non-English if we can't moderate them), keep the newest ~10 per fixture.
- Expose as a new WS message `{ "type": "chatter", fixtureId, posts: [{ id,
  author, handle, text, ts, likes? }] }` sent on subscribe + on update.
- The frontend renders posts verbatim (text-only, no link unfurling, no
  images), with an "X" source label and attribution, behind a collapsed
  panel. Rate-limit friendly: one shared search for all live fixtures, cache
  results in kv with a TTL.
- No X write actions of any kind, ever. Read-only.
