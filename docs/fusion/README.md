# Tx FUSION ODDS — Technical Reference Notes

Condensed from `TXODDS-Fusion-User-Guide-v1.24.pdf` (80 pages, Nov 2025), which is kept
in this folder as the full source. Fusion is TxODDS' **enterprise** low-latency odds feed
(8-10ms, 250+ bookmakers, 30+ sports) — the product **TxLINE wraps and exposes on-chain
for the hackathon**. There is no public Fusion docs site; `fusion.txodds.com` returns 403
without enterprise credentials, so this PDF is the only source. Not something we'll
integrate directly this weekend (TxLINE is the free/hackathon-accessible path), but it's
the schema/vocabulary TxLINE inherits — useful for understanding what data shapes and
market types are ultimately available.

## What it is
- SSE (Server-Sent Events) streaming API over plain HTTPS — no special protocol, auto-reconnect via `Last-Event-ID`.
- Delivers fixtures, odds, scores, competitions, teams, players, matchdata as continuous streams.
- Two environments: UAT (`fusion-uat.txodds.com`) and Production (`fusion.txodds.com`), separate credentials for each.
- Auth: username + password + allow-listed IP addresses (enterprise-style, not the wallet-based auth TxLINE uses).

## Core concept: SuperOddsType
TxODDS normalizes every bookmaker's different naming for the same market (e.g. "Match Betting", "1x2", "Full Time Result", "Money Line" all mean the same soccer result market) into one canonical `SuperOddsType` string, e.g. `1X2_PARTICIPANT_RESULT`. A market is fully described by:
- **SuperOddsType** — market type + subject + object (e.g. result, handicap, moneyline × team/player × goals/corners/cards)
- **MarketPeriod** — when it applies (`half=1`, `et`, `after_minutes=15`, `set=2,game=5`, empty = full time)
- **MarketParameters** — market-specific config (`line=2.5`, `correctscore=1:0`, `participants=part1`)

There are **300+ SuperOddsTypes** covering soccer, tennis, basketball, baseball, US football, ice hockey, cricket, esports, darts, and more — spanning result/handicap/moneyline/over-under/correct-score/odd-even/race-to/yes-no families across objects like goals, corners, cards, bookings, points, sets, aces, touchdowns, passing yards, kills, maps, rounds. Full extracted list saved in this repo's brainstorming notes — call the live `/oddstypes` endpoint for the current canonical list since it grows continuously.

Worked soccer examples pulled from the guide:
- Full-time result: `1X2_PARTICIPANT_RESULT`, MarketPeriod `""`, prices `[part1, draw, part2]`
- Half-time result: same SuperOddsType, MarketPeriod `half=1`
- Total goals band: `EXACTTOTAL_PARTICIPANT_GOALS`, MarketParameters `range=0-1` / `range2-3` / `range4-6` / `range7+`
- Over/under goals: `OVERUNDER_PARTICIPANT_GOALS`, MarketParameters `line=0.5`/`1.5`/`2.5`/`3.5`, prices `[over, under]`
- European handicap: `EUROHANDICAP_PARTICIPANT_GOALS`, MarketParameters `line=-0.5`
- Asian handicap: `ASIANHANDICAP_PARTICIPANT_GOALS`, one message per line (e.g. `+0.5` through `-2.5`)
- Player prop (American football): `OVERUNDER_PLAYER_TOUCHDOWNS`, MarketParameters `line=15.5,player=Niemann;Nick,playerId=10037329`

## Subscription Query DSL
Every streaming endpoint (`/odds`, `/synthetic_odds`, `/fixtures`, `/fixturegroups`, `/competitions`, `/players`, `/teams`, `/matchdata`, `/scores`) takes required + optional query params, e.g.:
```
/odds?Bookmaker=bwin,1xbet,ladbrokes&Sport=Tennis,Soccer&SuperOddsType=MONEYLINE_PARTICIPANT_RESULT&InRunning=false&CompetitionId=66,1550366
```
- Wildcards: `xxx_*` (starts with), `*_yyy` (ends with), `*_zzz_*` (includes)
- Multiple values as comma-separated lists
- `Days=n` / `Hours=n` — sliding window filters on fixture start time (only return fixtures/odds within the next N days/hours)
- `Ts=0` — request full context (current state of all offers); `Ts=<timestamp>` — only messages newer than that
- `ExtraFields` — opt in to extra response fields (Country, Competition, OfferIdHash, SynthDetails, etc.) since the default payload is trimmed for latency

**Advanced query DSL** (DNF — disjunctive normal form) filters `MarketPeriod`/`MarketParameters` with `,`=AND, `|`=OR, `[]`=partial/include match, `<>`=exact match. E.g. `MarketPeriod=<null|half=1>` returns full-time OR first-half markets only.

## Static (non-streaming) reference endpoints
`/sports`, `/bookmakers`, `/countries`, `/oddstypes` — call these to get the current canonical ID/name lists rather than hardcoding.

## Context shipping & reliability
- `Ts=0` on a stream request ships full current-state context first (`event: context`), then live updates (`event: live`).
- `Last-Event-Id` (SSE-native) lets a reconnecting client resume from exactly where it left off — Fusion caches ~2 hours of history including suspensions/OTBs (off-the-boards).
- OTB (market pulled/suspended) is signaled by `"Prices":[]` in a message referencing the original `MessageId`.
- Heartbeats stream continuously so clients can detect a dead connection even with zero odds activity.
- `MessageId` strictly increases within a line/market and is safe to use for ordering; `Ts` is not (multiple messages can share a timestamp).

## Synthetic bookmakers (consensus pricing)
Fusion lets you define a virtual "synthetic" bookmaker (`Synth=8888:17+3*42+5*84` — weighted combination of bookmaker IDs 17, 42, 84 with weights 1, 3, 5) computed in two modes:
- **Weighted average** — blended consensus price across chosen bookmakers/weights
- **Evensline** — picks the single line with the smallest home/away price gap (best/most-equitable line) from one bookmaker
Supports **delay conditions** (exclude offers older than X) and **probability conditions** (exclude offers with overround above a threshold) to keep the consensus clean, plus demargining (odds-ratio method) and "dampen" (suppress near-noise price updates). This — a bookmaker-agnostic, de-margined consensus price — is conceptually what **TXStablePrice** is downstream: TxODDS' own consensus/demarginated price product, a specific named synthetic bookmaker (`TXStablePrice` / `TXStablePriceDemargined`) available for soccer, tennis, basketball, baseball, US football, ice hockey, handball, volleyball.

## Message shape essentials (odds endpoint)
Key fields on every odds message: `FixtureId`, `Participant1`/`Participant2` (+ Ids), `Participant1IsHome` (handles reversed home/away fixtures without changing FixtureId), `BookmakerId`/`Bookmaker`, `InRunning` (pre-game=false/in-play=true), `SuperOddsType`, `MarketPeriod`, `MarketParameters`, `LineId`, `PriceNames` + `Prices` (parallel arrays), `Ts`, `MessageId`, `OfferId`/`OfferIdHash` (stable identifier for a specific line = hash of FixtureId+BookmakerId+SOT+MarketPeriod+MarketParameter).

Fixtures/scores messages carry `GameState` (scheduled/live/finished/postponed/suspended/cancelled/walkover/retired), `EntityStatus` (active/deleted), and a `Delta` field showing just what changed.

## Why this matters for the hackathon
TxLINE (what we're actually building against) is the on-chain-anchored, wallet-authenticated subset of this same underlying TxODDS data pipeline, scoped to World Cup + International Friendlies for the free tier. The TxLINE SuperOddsType vocabulary, JSON message shapes, and StablePrice concept all trace back to Fusion — so if TxLINE's docs feel sparse, this guide is the deeper reference for what a given field/market type means.
