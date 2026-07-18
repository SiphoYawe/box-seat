# API Enrichment Research (2026-07-18 evening)

Goal: richer visuals via additional data sources. Method: direct live probing
of every candidate endpoint (not doc reading), building on
`docs/research/positional-data-apis.md` (xy survey, unchanged verdicts there).

## Verdict up front

| Need | Source | Status | How we'd use it |
|---|---|---|---|
| Player photos | TheSportsDB | **VERIFIED LIVE, free test key** | build-time download to static assets |
| Match stats (shots, fouls, possession, saves) | ESPN public site API | **VERIFIED LIVE, free** | build-time fetch -> static JSON |
| Goal/card scorer NAMES | ESPN public site API | **VERIFIED LIVE** | same |
| Lineups + formation + starters/subs per match | ESPN public site API | **VERIFIED LIVE** | same |
| Venue + attendance + officials | ESPN public site API | **VERIFIED LIVE** | same |
| Match recap article text | ESPN public site API | **VERIFIED LIVE** | same |
| xy event coordinates / ball tracking | (none) | **still nothing free + reliable** | n/a |

## 1. TheSportsDB - player photos (VERIFIED)

- Endpoint: `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=<name>`
  (test key `3`, no signup). Returns `strThumb` and `strCutout` CDN URLs on
  `r2.thesportsdb.com`.
- Probed: Messi, Yamal, Saka, Mbappe - all return thumbnails; CDN serves
  HTTP 200. Cutouts are transparent PNGs (great for dark UI).
- Integration: a build/dev-time script downloads photos for lineup players
  into `frontend/public/players/<slug>.jpg`. Never hotlinked at runtime
  (satisfies "no external requests"). Rate limits: test key is for dev; for
  production they'd take a $3 patreon key - fine either way.

## 2. ESPN public site API - the enrichment jackpot (VERIFIED)

Base: `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/`
(undocumented but stable for years, used by ESPN's own site; no key).

- `scoreboard?dates=2026` - 100 World Cup events with ESPN ids, dates, names.
  Our fixtures map by team names + kickoff time (e.g. TxLINE 18222446
  Argentina-Switzerland = ESPN 760513 "Switzerland at Argentina").
- `summary?event=<id>` - one document carrying:
  - `boxscore.teams[].statistics`: foulsCommitted, yellowCards, redCards,
    offsides, wonCorners, saves, possessionPct, totalShots, shotsOnTarget,
    passes, crosses, long balls (team match stats).
  - `details[]`: per-event entries with clock display, scoringPlay flag, and
    **participants with athlete names** ("Alexis Mac Allister").
  - `rosters[]`: 26 players per team with `formation`, `formationPlace`,
    `starter`, `jersey`, `subbedIn/Out`, `stats`, `media`.
  - `gameInfo`: venue name + city ("GEHA Field at Arrowhead Stadium"),
    **attendance** (69,045), officials.
  - `keyEvents[]`, `leaders[]`, `article` (recap), `headToHeadGames`.
  - `teams[].roster` on `/teams/<id>/roster`: full squad with positions,
    flags, birthplaces (national-team athlete `headshot` is usually null -
    photos come from TheSportsDB instead).
- CAUTION: the same summary document carries `odds` / `pickcenter` /
  `hasOdds`. Our hard constraint: **the fetch script must strip and never
  persist those fields** - the frontend bundle must contain zero odds data.
  Fetch -> filter to an allowlist -> write static JSON.

## 3. xy coordinates - no change

- Sofascore unofficial API: **403 Forbidden (Cloudflare)** when probed.
- FotMob unofficial `matchDetails`: **404** (path moved/blocked).
- StatsBomb open data: fixed historical archive, no live/2026 coverage.
- Sportmonks `ballCoordinates`: real ball xy (~6/min, ~15s delay) but
  paid (EUR 29+/mo, World Cup excluded from free plan) and betting-positioned.
- Verdict stands (matches the earlier team note): no free, reliable, live xy
  source exists for these fixtures. Our zone-level terrain remains the honest
  representation. Revisit post-hackathon or if TxLINE adds coordinates.

## Recommended integration shape (zero runtime risk)

Two build-time scripts (Node, run manually or pre-deploy), writing static
files the frontend imports - same pattern as `teams.ts` / `demo-match.json`:

1. `scripts/enrich-espn.mjs` - for each fixture in `fixture_list`: find the
   ESPN event by names+date, fetch summary, keep ONLY the allowlisted fields
   (stats, scorer details, rosters, formation, venue/attendance, article),
   write `frontend/src/data/enrichment/<fixtureId>.json`.
2. `scripts/fetch-photos.mjs` - TheSportsDB search per lineup player,
   download thumb/cutout into `frontend/public/players/`.

Frontend features this unlocks (each small, on existing surfaces):
- Stats drawer next to the event log (numbers only, spec-sanctioned).
- Scorer names on GOAL takeovers + event log rows ("GOAL Argentina - Mac Allister").
- Lineup panel upgrade: real formation layout, starters/subs, photos in the
  number roundels (photo with roundel fallback).
- Match header: real venue + attendance; recap article on the replay screen.
