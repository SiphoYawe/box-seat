# Superteam Earn Submission — Draft Content

Paste-ready drafts for the Consumer & Fan Experiences listing form. Fill the
bracketed gaps once the frontend/deployment/video exist.

---

## Project name

**Box Seat**

## One-liner

A live 3D World Cup match visualizer — watch the match's momentum and territorial
pressure unfold on a glowing pitch, live or as a scrubbable replay. No betting, no
odds, no wallet needed to watch.

## Links

- **Demo video (≤5 min):** [RECORD & PASTE — see checklist]
- **Public repo:** https://github.com/SiphoYawe/box-seat
- **Live app:** https://siphoyawe.github.io/box-seat/

## Brief technical documentation

**Core idea.** TxLINE streams every World Cup score event (possession danger levels,
shots with outcomes, corners, cards, VAR, goals). Box Seat folds that stream through a
pure, deterministic match-state reducer into two signals a fan can *see*: momentum
(-1..+1, who's on top right now) and zone pressure (which third of the pitch each team
is threatening from). A React Three Fiber frontend renders these as a 3D pressure
terrain over a real pitch, with a momentum ribbon as the match timeline. Goals, red
cards, and VAR overturns trigger full-screen broadcast-style takeovers.

**Live and replay are the same engine.** Every event is persisted to a local event
log; a finished match replays by folding the identical stored events through the
identical reducer — so the replay is provably the same story as the live view, and
replays keep working even after TxLINE's hackathon data window closes. Subscribing to
a finished fixture streams the full history as chunks over WebSocket, then the final
state; the frontend scrubs freely through the reconstruction.

**Solana usage.** (1) TxLINE entitlements are on-chain: our service wallet performs
the Anchor `subscribe` transaction (with priority fee + blockhash-retry to land
reliably on mainnet) and the wallet-signed activation; the session token persists so
restarts never re-pay. (2) On full time, the backend writes an SPL Memo attestation —
`boxseat:<fixtureId>:<sha256 of final state>` — a permanent public record of the match
story shown. Viewers never touch a wallet.

**Resilience engineering** (it has to survive a live demo): SSE auto-reconnect with
JWT renewal and a watchdog; automatic full re-subscription after persistent auth
failure; restart state-rebuild from the event log; malformed feed events and malformed
WS clients are isolated, never fatal; attestation is non-blocking by design. The
reducer has 22 unit tests; finish detection accepts both documented TxLINE finish
signals (`game_finalised` and terminal StatusIds) after we found the two TxODDS schema
sources disagree.

**TxLINE endpoints used:** `POST /auth/guest/start`, on-chain `subscribe` (program
`9ExbZ…cKaA`, service level 12 — real-time free World Cup tier), `POST
/api/token/activate`, `GET /api/scores/stream` (SSE). Deliberately never `/odds` —
Box Seat is betting-free by principle, enforced structurally.

## Feedback on the TxLINE API (form question)

What we liked:
- The on-chain entitlement model genuinely delivers "no sales call" access — wallet →
  subscribe → activate → streaming in minutes, and the free World Cup tier is real.
- The `tx-on-chain` reference repo with runnable mainnet examples was the single most
  useful resource — we lifted the auth and SSE patterns directly from it.
- SSE with `Last-Event-ID` resume and ~2h server-side cache made reconnect handling
  almost free.

Friction we hit:
1. **Finish-signal ambiguity:** the TxLINE docs ("Final Outcome and Fixtures") say
   finished matches emit `action=game_finalised` with `statusId=100`, but the Scores
   Product PDF (soccer v1.1) has no `game_finalised` for soccer and instead documents
   terminal StatusIds 5/10/13 via the `status` action. We had to implement dual-signal
   detection to be safe. One authoritative answer would help.
2. **Field-casing traps:** payload fields are PascalCase (`Update.FixtureId`,
   `Data.Outcome`) but it's easy to write lowercase against the prose docs; a JSON
   Schema or TypeScript types package for the scores messages would remove a whole
   bug class.
3. **Blockhash expiry on the public RPC:** the reference subscribe flow (no priority
   fee, single attempt) expired unconfirmed on mainnet on our first real run; we added
   a compute-unit price + fresh-blockhash retry loop. Consider adding that to the
   reference scripts — anyone on the default public RPC will likely hit this.
4. Small one: `subscribe` rejecting with `ActiveSubscription` (6016) on restart is
   easy to hit in dev; the docs could call out persisting the activated API token as
   the intended pattern.

## Team

Othniel — solo builder. Backend/orchestration built with Claude; frontend built with
Kimi K3 (per the hackathon's AI-tooling-friendly rules).
