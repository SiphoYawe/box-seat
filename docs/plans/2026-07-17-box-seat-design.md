# Box Seat — Design Doc

**Date**: 2026-07-17
**Event**: TxODDS x Solana World Cup Hackathon (Superteam UK / Encode Club, London) — see [`HACKATHON.md`](../../HACKATHON.md)
**Track**: Consumer and Fan Experiences ($16,000 — $10k/$4k/$2k)
**Team**: solo
**Hard constraint**: no betting/odds/wagering anything, anywhere in the product — a personal boundary, not just a design choice. Only TxLINE's `/scores` and `/fixtures` endpoints are used; `/odds` is never called.

"Box Seat" is a placeholder name.

## 1. Concept

A single-match visualization that works identically whether the match is live or already
finished. Its spine is a **momentum read** — not odds, not predictions, just a continuous,
honest picture of who's dominating the run of play right now, built entirely from TxLINE's
scores feed: possession danger-level (`Safe`/`Attack`/`Danger`/`HighDanger`), shots (with
outcome), corners, cards, free-kick zones, VAR incidents, goals. It's what a good
commentator narrates ("City are really building pressure now") made visible and precise.

The experience is **mostly 3D**. A real football pitch — line markings, goal frames, center
circle, penalty boxes, corner arcs, so it reads as an actual pitch rather than an abstract
grid — has a "pressure terrain" layered above it: two translucent team-colored surfaces
whose height/glow at each pitch zone (thirds × channels, whatever resolution the zone data
supports) encodes that team's accumulated pressure there. A momentum ribbon runs through
the same scene as the match timeline, curving toward whichever team dominates a stretch of
play — it doubles as the replay scrub control. 2D is reserved strictly for numbers/text: a
broadcast-style HUD (score, team badges/colors, clock, event log) overlaid on the 3D scene.
Goals, red cards, and VAR overturns trigger a brief full-screen takeover animation — the one
place the ambient visual language deliberately breaks to be unambiguous.

**Two temporal modes, one engine**: live (terrain grows / ribbon extends as events stream
in) and replay (same visuals, fully scrubbable, auto-play available) — solving both "help
me read this match while I'm watching it" and "catch me up fast on a match I missed."

Solana isn't cosmetic: TxLINE itself requires wallet-based data access even on the free
tier, and after a match finishes, its final state gets a small on-chain attestation —
making "verified match story" literal, not just a marketing line.

## 2. Data Foundation & What We Deliberately Don't Have

TxLINE's soccer scores feed (see [`docs/txline/scores/soccer-feed.md`](../txline/scores/soccer-feed.md)
and the full [Scores Product API PDF](../txline/scores/txodds-soccer-feed-v1.1.pdf)) gives
event data, not player tracking: goals, cards, corners, shots (`OnTarget`/`OffTarget`/
`Woodwork`/`Blocked`), free kicks (zone: `Safe`/`Attack`/`Danger`/`HighDanger`/`Offside`),
substitutions, VAR, possession states (with the same danger-zone vocabulary), lineups. No
x/y coordinates for players or the ball.

We researched whether a second API could supply real positional data — see
[`docs/research/positional-data-apis.md`](../research/positional-data-apis.md). Conclusion:
nothing free covers live World Cup 2026 with genuine x/y (StatsBomb Open Data is free but
historical-only; Sportmonks `ballCoordinates` is real but paid and betting-positioned;
FotMob's API has coordinates but is unofficial/unsupported). **Decision: TxLINE's zone/
danger signal is the only live input.** The pressure terrain is built honestly from that —
zone-resolution, not literal-dot precision — which is also architecturally simpler and
removes an entire class of live-demo fragility from an unofficial third party.

## 3. Architecture

```
TxLINE SSE (/scores, /fixtures — never /odds)
   → Ingestion service (holds JWT/API token, one shared TxLINE mainnet subscription,
       service level 12 / real-time)
   → Match State Engine — pure reducer: (state, event) → newState
   → Persisted event log (own DB — see §5)
   → Re-broadcast (WebSocket/SSE of derived state, not raw TxLINE payloads)
   → Frontend (3D scene + 2D HUD)
```

**One reducer, two temporal modes.** The Match State Engine is a deterministic pure
function turning raw scores events into: a momentum value per team, zone-pressure
accumulation per team, and a timeline of key moments. Live mode feeds it events as they
arrive; replay mode feeds it a finished match's full stored event history, either scrubbed
instantly to any point or auto-played. Same function, same visuals, no duplicated logic —
this is the core structural idea that keeps a solo build tractable.

A thin backend is required (not pure client-side) because TxLINE credentials can't live in
the browser, and one shared TxLINE connection should serve every visitor rather than each
browser tab holding its own subscription.

## 4. The 3D Scene

- **Ground truth**: an accurate pitch — goal lines, boxes, center circle, corner arcs.
- **Pressure terrain**: two translucent team-colored surfaces over a pitch zone grid
  (defensive/middle/attacking third × channel), height/glow driven by accumulated
  possession-danger + shots + corners + free-kicks in that zone.
- **Momentum ribbon**: flows through the scene as the timeline; curves toward the
  dominant team; in live mode a glowing marker sits at "now" with history trailing behind;
  in replay mode it *is* the scrub control (drag along it, or auto-play a fly-through).
- **Key moments**: goals/red cards/VAR trigger a full-screen takeover animation (team
  badge, moment type) before returning to the ambient scene.
- **HUD (2D, always-on)**: broadcast-style scorebug — team badges, colors, live clock,
  score, event log. This is the only place numbers/text live; everything else is 3D.
- **Look**: dark, stadium-at-night aesthetic — glowing team-color terrain against
  near-black. Orbit/zoom camera always available; auto-fly-along-ribbon as an optional
  cinematic replay mode.
- **Stack**: React Three Fiber + Three.js/drei, shader-driven terrain height for smooth
  interpolation as pressure updates stream in (not discrete jumps).

## 5. Frontend Structure

1. **Match list** — live now / upcoming / finished across all 104 fixtures, team badges/
   colors/scores. Functional entry point, not a visual centerpiece. No wallet connect
   required here or anywhere — see §6.
2. **Match view** — the 3D scene described above; same screen serves both live and replay,
   switching automatically once a fixture reaches `game_finalised`.
3. **Key moment takeover** — full-screen animation on goal/red card/VAR-overturned.

Minimal interaction model deliberately: orbit/zoom always, scrub bar only in replay mode.
No other controls — solo-build scope favors depth of polish on few screens over breadth.

## 6. Solana Integration

**No end-user wallet required.** TxLINE's entitlement model is wallet-based, but that
wallet doesn't need to belong to each viewer — our backend holds one **service wallet**
that subscribes to TxLINE once (mainnet, free World Cup tier, service level 12) and
re-serves the processed visualization to anyone who visits. This removes all wallet-connect
friction for casual fans while still being genuine, checkable Solana usage: the on-chain
`subscribe` transaction, the wallet-signed TxLINE activation, and the post-match
attestation are all real transactions on Solana, just performed by the app rather than by
each visitor — analogous to how a website's backend calling a paid API is invisible to
visitors but still real.

**Flow**: service wallet → `subscribe()` on-chain tx (service level 12) → guest JWT
(`/auth/guest/start`) → signed activation → API token → SSE streams. Post-match: once a
fixture hits `game_finalised`, write a compact on-chain record (SPL Memo program — no
custom program needed) containing a fingerprint of that match's final state. Attestation
writes are **non-blocking** — a failure never breaks the viewing/replay experience.

## 7. Error Handling & Resilience

- **SSE reconnection**: track `Last-Event-Id`, reconnect using it (TxLINE caches ~2hrs
  including suspensions). Beyond that, full context refetch (`Ts=0`). 401s trigger silent
  JWT renewal + retry with the same activated API token.
- **Uneven coverage**: not all 104 fixtures are guaranteed to have Scores coverage
  (`ScoresCaptureTracking`/`CoverageStatus`/`CoverageType` on `/fixtures`). Uncovered
  fixtures show basic metadata only — never a 3D scene with nothing to render.
- **Own persistence, not reliance on TxLINE's retention**: free World Cup access ends
  exactly when submissions close, right as several matches finish, and TxLINE's historical
  endpoint only covers a 2-week-to-6-hour window regardless. The ingestion service persists
  every processed event to our own storage as it arrives; replay reads from there, so it
  keeps working after TxLINE access lapses.
- **Mainnet, not devnet**: devnet's free tier appears to serve fixed demo fixtures for
  testing the validation flow, not live tournament data. Devnet is for developing/testing
  the on-chain flow before pointing it at mainnet.

## 8. Testing Strategy

Effort concentrates on the one piece of pure logic that matters: the reducer. Everything
visual is verified by running the app, not by test suites.

- **Reducer unit tests**: known event sequences (a goal, a string of attacking-third
  possession, a red card) → assert resulting momentum/pressure state.
- **Golden/snapshot test** against one real captured match's full event sequence (captured
  during build, or a synthetic fixture if none have finished yet).
- **Synthetic replay fixture**: a hand-authored/captured event sequence so the whole
  pipeline (reducer → 3D scene → replay scrubbing) can be developed and demoed without
  depending on a live match being in progress at that exact moment.
- **Manual visual QA** against both the synthetic fixture and a real match before calling
  any part "done" — this is where polish gets verified.

## 9. Tech Stack

- **Frontend**: Next.js, React Three Fiber / Three.js / drei, Tailwind (HUD).
- **Backend**: persistent Node service (Vercel Fluid Compute supports long-lived SSE/
  WebSocket, so this can share the deployment) — holds the TxLINE session, runs the
  reducer, persists events, re-broadcasts derived state.
- **Storage**: Postgres (Vercel Marketplace) for the persisted event log.
- **Solana**: `@solana/web3.js` + `@coral-xyz/anchor`, server-side only, matching TxLINE's
  published IDL/program addresses ([`docs/txline/programs/`](../txline/programs/)).

## 10. Rough Build Phasing

Sat build start → Sun noon local deadline, reserving real time at the end for polish and
demo-video recording rather than feature-cramming to the wire:

1. TxLINE ingestion + service-wallet auth working end-to-end (de-risk the one external
   dependency first).
2. Reducer + zone/momentum logic, tested against a captured or synthetic match.
3. 3D scene: pitch geometry, terrain, ribbon, base look.
4. Wire live/replay to the reducer output; replay scrubbing.
5. Broadcast HUD, full-screen moment animations, match list screen.
6. Solana attestation.
7. Polish pass + demo video.

## Open items for implementation planning

- Exact zone-grid resolution the free-kick/possession danger data actually supports in
  practice (thirds only, or thirds × channels) — confirm against real live data once
  matches start streaming Saturday.
- Team badge/color source (TxLINE fixture messages carry team names/IDs but not
  logos/brand colors — need a small static lookup table for the 32 World Cup teams).
- Whether any confirmed-coverage fixture is live during early build hours for real-data
  testing, or whether Sunday's matches are the first opportunity — shapes how much the
  synthetic fixture needs to carry the early build.
