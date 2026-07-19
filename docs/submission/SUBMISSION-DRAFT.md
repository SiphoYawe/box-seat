# Superteam Earn Submission: Draft Content

Paste-ready drafts for the Consumer & Fan Experiences listing form. Fill the
bracketed gaps once the frontend/deployment/video exist.

---

## Project name

**Box Seat**

## One-liner

A live 3D World Cup match visualizer: watch the match's momentum and territorial
pressure unfold on a glowing pitch, live or as a scrubbable replay. No betting, no
odds, no wallet needed to watch.

## Form field mapping (exact fields from the live form)

| Field | Value |
|---|---|
| Link to Your Submission | https://siphoyawe.github.io/box-seat/ |
| Tweet Link | [POST THE LAUNCH TWEET FIRST, see below] |
| Project Title | Box Seat |
| Briefly explain your Project | Box Seat turns TxLINE's live World Cup feed into a 3D match you can read: territorial pressure rises as glowing terrain over a real pitch, and a momentum ribbon bends toward whichever team is on top. Watch live, or scrub any finished match as a replay driven by the same engine. Full time writes each match's fingerprint to Solana, and the app verifies its own replays against the chain. No betting, no odds, no wallet needed to watch. |
| Live & working MVP | https://siphoyawe.github.io/box-seat/ |
| Live Demo Video | [RECORD & PASTE] |
| Public Repository | https://github.com/SiphoYawe/box-seat |
| Technical Documentation | https://github.com/SiphoYawe/box-seat/blob/main/docs/frontend/BACKEND-CONTRACT.md (plus README) |
| X Profile / tweet | https://x.com/SiphoYawe + the launch tweet |
| TxLINE experience | (paste the Feedback section below verbatim) |
| Anything Else? | Hero replay: https://siphoyawe.github.io/box-seat/match/18257865 (France 4-6 England), captured live event by event, attested on Solana mainnet (tx visible via the app's On-chain chip / proof panel). Backend: Railway (wss://box-seat-production.up.railway.app). Built July 17-19 within the June 24 - July 19 window. |

## Brief technical documentation

**Core idea.** TxLINE streams every World Cup score event: possession danger levels,
shots with outcomes, corners, cards, VAR, goals. Box Seat folds that stream through a
pure, deterministic reducer into two signals a fan can see. Momentum (-1..+1) says who
is on top right now. Zone pressure says which third of the pitch each team threatens.
A React Three Fiber frontend renders both as a 3D pressure terrain over a real pitch,
with a momentum ribbon as the match timeline. Goals, red cards, and VAR overturns
trigger full-screen broadcast-style takeovers.

**Live and replay share one engine.** The backend persists every event to a local
log. A finished match replays by folding those same stored events through the same
reducer, so the replay provably tells the story the live view told, and replays keep
working after TxLINE's hackathon window closes. Subscribing to a finished fixture
streams the full history in chunks over WebSocket, then the final state; the frontend
scrubs freely through the reconstruction.

**Solana.** TxLINE's entitlements live on-chain: our service wallet performs the
Anchor `subscribe` transaction (priority fee plus blockhash retry, so it lands on the
public RPC) and the wallet-signed activation, and the session token persists across
restarts. At full time, the backend writes an SPL Memo attestation,
`boxseat:<fixtureId>:<sha256 of final state>`: a permanent public record of the match
story shown. The app checks its replays against these attestations and shows REPLAY
VERIFIED. Viewers never touch a wallet.

**Resilience.** The system survived a live tournament weekend: SSE auto-reconnect
with JWT renewal and a watchdog, automatic re-subscription after persistent auth
failure, restart state-rebuild from the event log, malformed feed events and
malformed WS clients isolated rather than fatal, non-blocking attestation. 81 unit
tests cover the reducer and the chatter moderation pipeline. Finish detection accepts
both of TxLINE's documented finish signals (`game_finalised` and terminal StatusIds)
because the two TxODDS schema sources disagree; we measured the live feed to settle
it.

**TxLINE endpoints used:** `POST /auth/guest/start`; on-chain `subscribe` (program
`9ExbZ…cKaA`, service level 12, the real-time free World Cup tier); `POST
/api/token/activate`; `GET /api/scores/stream` (SSE); `GET
/api/scores/historical/{fixtureId}` for backfill. We never call `/odds`. Box Seat is
betting-free on principle, and the code enforces it.

## Feedback on the TxLINE API (form question)

What we liked:
- The on-chain entitlement model delivers what it promises: wallet, subscribe,
  activate, streaming, all inside a few minutes, and the free World Cup tier is real.
- The `tx-on-chain` reference repo with runnable mainnet examples was the single most
  useful resource. We lifted the auth and SSE patterns straight from it.
- SSE with `Last-Event-ID` resume and the ~2h server-side cache made reconnect
  handling cheap.

Friction we hit:
1. **Finish-signal ambiguity.** The TxLINE docs ("Final Outcome and Fixtures") say a
   finished match emits `action=game_finalised` with `statusId=100`. The Scores
   Product PDF (soccer v1.1) contains no `game_finalised` for soccer and instead
   documents terminal StatusIds 5/10/13 via the `status` action. We implemented
   dual-signal detection to stay safe. One authoritative answer would help.
2. **Field-casing traps.** Payload fields are PascalCase (`Update.FixtureId`,
   `Data.Outcome`), and it is easy to write lowercase against the prose docs. A JSON
   Schema or TypeScript types package for the scores messages would remove that whole
   bug class.
3. **Blockhash expiry on the public RPC.** The reference subscribe flow (no priority
   fee, single attempt) expired unconfirmed on our first real mainnet run. We added a
   compute-unit price and a fresh-blockhash retry loop. Consider adding both to the
   reference scripts: anyone on the default public RPC will hit this.
4. **Clock direction.** The docs describe a countdown clock; the live feed counts up
   as cumulative match time. We measured it mid-match to settle the discrepancy.
5. Small one: `subscribe` rejects with `ActiveSubscription` (6016) on restart, which
   every dev will hit. The docs could call out persisting the activated API token as
   the intended pattern.
