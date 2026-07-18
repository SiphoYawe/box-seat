# TxLINE Documentation — Local Mirror

Full local copy of the TxLINE docs (fetched 2026-07-17 via the `.md` suffix trick on
`https://txline-docs.txodds.com/documentation/*.md`, which returns clean Mintlify-source
markdown with no scraping/JS-rendering artifacts). Canonical live site:
https://txline-docs.txodds.com (aliased at https://txline.txodds.com — identical content,
docs cross-link using whichever host was requested).

Re-sync any single page with:
```bash
curl -sL "https://txline-docs.txodds.com/documentation/<path>.md" -o docs/txline/<path>.md
```

## Contents

### Getting Started
- [`quickstart.md`](./quickstart.md) — full paid + free onboarding flow, auth, on-chain subscribe, token activation
- [`worldcup.md`](./worldcup.md) — free World Cup + Int'l Friendlies tier walkthrough (the one we're using)
- [`subscription-tiers.md`](./subscription-tiers.md) — service levels, pricing, delay tiers

### Odds
- [`odds/overview.md`](./odds/overview.md) — StablePrice odds overview
- [`odds/odds-coverage.md`](./odds/odds-coverage.md) — covered competitions, soccer league list

### Scores
- [`scores/overview.md`](./scores/overview.md) — scores feed overview
- [`scores/schedule.md`](./scores/schedule.md) — confirmed fixtures currently covered
- [`scores/soccer-feed.md`](./scores/soccer-feed.md) — soccer score encodings: game-phase IDs, stat-key encoding for on-chain validation (most relevant for World Cup)
- [`scores/football-feed.md`](./scores/football-feed.md) — American football score encodings
- [`scores/basketball-feed.md`](./scores/basketball-feed.md) — basketball score encodings
- [`scores/txodds-soccer-feed-v1.1.pdf`](./scores/txodds-soccer-feed-v1.1.pdf) — full 40-page Scores action-message reference linked from `soccer-feed.md`. Defines every soccer action type (goal, corner, card, VAR, substitution, possession states, shot, throw-in, penalty shootout, etc.) with full JSON field schemas, plus `StatusId` game-phase table and `Confirmed`/amend/discard message-lifecycle semantics. Not condensed here — read directly (pages 1-9 cover common types like `Clock`/`Score`/`PlayerStats`; pages 9-38 are one action type per page/section) when implementing actual score-consumption logic.

### Solana Programs
- [`programs/addresses.md`](./programs/addresses.md) — mainnet/devnet program addresses, PDA derivation
- [`programs/mainnet.md`](./programs/mainnet.md) — mainnet integration values, validation accounts
- [`programs/devnet.md`](./programs/devnet.md) — devnet integration values, validation accounts

### Examples
- [`examples/fetching-snapshots.md`](./examples/fetching-snapshots.md) — fixtures/odds/scores snapshot examples
- [`examples/streaming-data.md`](./examples/streaming-data.md) — SSE streaming examples (odds + scores)
- [`examples/onchain-validation.md`](./examples/onchain-validation.md) — fetching proofs + on-chain validation
- [`examples/devnet-examples.md`](./examples/devnet-examples.md) — runnable devnet scripts index
- [`examples/troubleshooting.md`](./examples/troubleshooting.md) — activation/streaming/auth error diagnosis

### API Reference
- [`api-reference/openapi.yaml`](./api-reference/openapi.yaml) — full OpenAPI 3.1 spec, source of truth for every endpoint/schema (3685 lines)
