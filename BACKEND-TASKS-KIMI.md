# Backend Tasks by Kimi (for the backend Claude to verify)

Backend-side changes made by Kimi (frontend agent) during the autonomous
polish sprint (2026-07-19), after the user lifted the frontend-only
constraint and asked for a tracker. Server code edits are small and additive;
everything else lives in standalone scripts.

## 1. `fixture_list` entries now carry the attestation (server code)

- `server/src/index.ts` — `buildFixtureList()` joins `getAttestation(db,
  fixtureId)` and adds `attestation: { txSig, cluster }` to entries that have
  a persisted attestation row (omitted otherwise).
- `server/src/ws/server.ts` — `FixtureListEntry` gains the optional
  `attestation?: { txSig: string; cluster: AttestationCluster }` field
  (backward-compatible; older clients ignore it).
- Purpose: the match list shows an "on-chain" attested marker per fixture
  without a per-fixture subscribe.
- Verified: `npx tsc --noEmit` clean, `npx vitest run` 81/81, and
  `fixture_list` for 18257865 carries the real txSig on the wire.
- TODO for you: one line in `docs/frontend/BACKEND-CONTRACT.md` under
  `fixture_list` documenting the optional field (I left the contract file
  untouched as it's your ground truth).

## 2. `server/scripts/reattest.mts` (new standalone script)

- Re-attests fixture(s) with the CURRENT reducer state: folds the event log
  through `server/src/reducer/reducer.ts`, calls the existing
  `attestMatch()` (same memo format `boxseat:<id>:<sha256>`), and upserts
  `fixture_attestation`. Run: `cd server && npx tsx scripts/reattest.mts <id>`.
- Reads `server/.env` manually (no dotenv import - repo root has no modules).
- Ran once for fixture 18257865: new on-chain tx
  `55kj3fkDswjmruEeeHjAvHcYoxZvzKfUJz1zgFj4UbUct9iLimmBR2hRqB4D7iF58e1iZEfmL9DtsuUannYvSMuK`
  (mainnet-beta, confirmed). Reason: the original attestation predated the
  penalty-goal + action_discarded reducer changes, so its fingerprint no
  longer matched the folded log (frontend correctly reported "stale").
- Note: re-attesting spends service-wallet SOL via the existing attestMatch
  path (priority fee + fresh blockhash per attempt).

## 3. Frontend replay-integrity verification (context for you)

- The frontend recomputes the attestation fingerprint in the browser
  (`crypto.subtle`, exact replica of `fingerprint()` in
  `server/src/solana/attestation.ts`), reads the SPL Memo via a public RPC,
  and shows VERIFIED / STALE / RPC-unreachable in the "On-chain proof" panel.
- `https://api.mainnet-beta.solana.com` returns **403 to browser requests**;
  the verifier uses `https://solana-rpc.publicnode.com`
  (devnet: `https://solana-devnet-rpc.publicnode.com`). If you'd rather not
  depend on a third-party RPC in the browser, the alternative is a backend
  passthrough of `getTransaction` over the existing WS (new message type).
- If the event log for an attested fixture grows later (late backfill), the
  panel will correctly flip to "Attestation predates log" - re-run
  `scripts/reattest.mts` to refresh.

## 4. `scripts/cache-chatter.mjs` (repo root, pre-existing from earlier task)

- Manual one-off: fills `kv` key `chatter:<fixtureId>` with real,
  CLI-fetched, server-rule-moderated posts (exact `moderatePost` rules copied
  from `server/src/chatter/xChatter.ts`). Used to seed demo chatter for
  fixture 18257865 before the CLI fetcher existed. No server code touched;
  the serve path reads kv per subscribe.

## Not changed by me

- No changes to `state` / `replay_chunk` / `fixture_players` / `chatter`
  message shapes, the reducer, the ingestion path, or the moderation
  pipeline. 81/81 backend tests remain green after items 1-2.
