# Supplementary Positional Data APIs — Research Notes

Researched 2026-07-17 while scoping the visualization approach. TxLINE's soccer feed
does **not** carry x/y coordinates (only zone-level signal: possession danger state
`Safe`/`Attack`/`Danger`/`HighDanger`, shot outcome, corner side — see
[`docs/txline/scores/soccer-feed.md`](../txline/scores/soccer-feed.md)). This was a
survey of whether a second data source could add real x/y positional data for richer
visualization. **Current decision: not integrating any of these** — kept here in case
we want to revisit post-hackathon or if TxLINE's own coverage changes.

## Findings

### StatsBomb Open Data — free, official, but not live
- https://github.com/statsbomb/open-data
- Genuinely free, well-documented, JSON event data including x/y locations and
  "360 data" (freeze-frame positional context around each event).
- **Blocker**: it's a fixed archive of specific past competitions StatsBomb chose to
  open-source for research/analytics use — not a live feed, and does not cover an
  active/ongoing commercial tournament like World Cup 2026.
- **Possible future use**: a great reference/calibration dataset during development to
  validate what realistic zone-pressure patterns look like, or to build/test the
  visualization renderer against real historical matches before wiring up TxLINE live
  data. Not usable as a runtime dependency.

### Sportmonks `ballCoordinates` — closest real option, but paid + betting-positioned
- Docs: https://docs.sportmonks.com/v3/tutorials-and-guides/tutorials/includes/ballcoordinates
- Real ball x/y tracking (not player positions — ball only, no `player_id`), normalized
  `x: 0.01-1.01` (goal line to goal line), `y: -0.02-1.02` (sideline to sideline).
- ~568 data points per match on average (6.3/min), up to 12/min in high-action periods.
- ~15 second delay — "near-real-time," faster than broadcast TV delay.
- Docs list availability for "International tournaments: World Cup, European
  Championship" in principle, but caveat that **not all fixtures have coordinate data**
  — depends on the specific stadium's tracking tech and Sportmonks' data partnerships
  for that venue.
- **Blockers**:
  - Free plan only covers 2 leagues (confirmed via https://www.sportmonks.com/football-api/free-plan/) — does not include World Cup. Paid plans start at €29/mo (Starter, 5 leagues) up to €249/mo (Pro); advanced tracking includes are typically gated further on top of that.
  - Their own docs pitch this feature explicitly around "betting insights" and "live
    betting applications" as primary use cases — same category concern as most
    commercial football data vendors (see API-Football below).
  - Would require signup/payment plus mapping Sportmonks fixture IDs to TxLINE
    `FixtureId`s — nontrivial integration work for a second live data pipeline.
- **Verdict**: the most technically real option if we ever wanted true ball positional
  data, but not free for World Cup 2026 and adds real cost + integration risk.

### FotMob unofficial API — free but undocumented/unsupported
- Widely used by hobbyist football-analytics builders (`fotmob-api` PyPI package, a Ruby
  wrapper, several scraping tutorials) to pull shot maps with x/y coordinates and xG.
- Free, and does cover major live tournaments including World Cup fixtures.
- **Blocker**: it's a reverse-engineered internal API, not a published/supported
  product — no ToS backing it, no stability guarantee, real risk of being rate-limited,
  changed, or blocked without notice. Not something to depend on for a live public demo.

### API-Football / API-Sports and most other "free" football data APIs
- Free tiers exist and cover World Cup 2026 fixtures/livescores/standings/events, but
  none surfaced in this search expose shot- or ball-level x/y coordinates.
- Odds/bookmaker data is a first-class part of their core product line (e.g. bookmaker
  odds listed alongside livescores as a headline feature) — same values-alignment
  concern as Sportmonks given the "no betting-related anything" constraint, even though
  we would only use the non-odds endpoints.

## Decision

Not integrating a second live data source. TxLINE's zone/danger signal stays the sole
live input — it's already required for track eligibility, reliable, and sufficient to
drive an honest (non-literal) zone-based 3D pressure visualization rather than pretending
we have precision we don't have. Revisit if: (a) TxLINE ever adds coordinate data itself,
or (b) a genuinely free, live, non-betting-positioned x/y source appears.
