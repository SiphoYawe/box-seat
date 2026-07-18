# Box Seat

**A live 3D match visualizer for the 2026 World Cup — see the match the way the data sees it.**

Built for the [TxODDS x Solana World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup)
(Consumer & Fan Experiences track). Design research began July 17; implementation
July 18 — within the hackathon's June 24 – July 19 submission window.

## What it is

Box Seat turns TxLINE's live World Cup scores feed into a **3D match story**: a real
football pitch with a glowing *pressure terrain* rising over the zones where each team
is generating danger, and a *momentum ribbon* threading through the scene as the match
timeline. Goals, red cards, and VAR overturns trigger full-screen broadcast-style
takeovers. When a match finishes, the same engine becomes a **scrubbable replay** — drag
through the whole match in seconds.

One deterministic state engine drives both modes: live events fold through a pure
reducer; replay folds the same stored events through the same reducer. What you see
live is exactly what you can scrub back through later.

**Hard product boundary: no betting, no odds, no predictions — anywhere.** The backend
consumes only TxLINE's `/scores` and `/fixtures` data and never touches `/odds`. This is
a values decision, enforced structurally in code.

## How Solana is used (no wallet needed to watch)

- TxLINE's data entitlements are on-chain: the backend's **service wallet** performs the
  Anchor `subscribe` transaction and wallet-signed API activation against TxLINE's
  mainnet program. Viewers never connect a wallet — the app is a pure viewer.
- When a match reaches full time, the backend writes a compact **SPL Memo attestation**
  (`boxseat:<fixtureId>:<sha256 fingerprint of final state>`) to Solana mainnet — a
  permanent, checkable record of the match story the visualization tells.

## Architecture

```
TxLINE SSE (/scores — never /odds)
   → service-wallet auth (on-chain subscribe → activation, persisted session)
   → pure match-state reducer (momentum, zone pressure, key moments)
   → SQLite event log (replay survives feed-access expiry)
   → WebSocket broadcast  ←  3D frontend (React Three Fiber, built with Kimi K3)
   → SPL Memo attestation on match finish
```

Key properties:
- **Live/replay determinism** — same reducer, same events, same result.
- **Restart resilience** — state rebuilt from the event log; TxLINE session persisted
  and reused; already-subscribed (`ActiveSubscription`) handled; stale tokens trigger
  automatic re-subscription.
- **Demo-grade hardening** — malformed WS clients can't crash the server; malformed
  feed events are logged and skipped; the SSE stream self-heals via watchdog;
  attestation is non-blocking by design.

## Repo layout

- `server/` — the backend (Node 20+, TypeScript, strict ESM). `npm install && npm run dev`
  (needs a funded Solana keypair at `server/_keys/service-wallet.json` and a `.env` from
  `.env.example`).
- `docs/frontend/BACKEND-CONTRACT.md` — the WebSocket contract the frontend consumes.
- `docs/frontend/KIMI-BUILD-SPEC.md` — the full frontend build specification.
- `docs/plans/` — design doc and implementation plans.
- `docs/txline/` — local mirror of TxLINE documentation + OpenAPI spec used to build this.
- `OTHNIEL-TODO.md` / `HACKATHON.md` — working notes and the hackathon brief.

## Tests

```bash
cd server && npm test   # 22 tests on the match-state reducer — the semantic core
```

## Built with

TxLINE (TxODDS) · Solana (`@coral-xyz/anchor`, SPL Memo) · Node/TypeScript · SQLite ·
WebSockets · React Three Fiber (frontend) — developed with Claude (backend/orchestration)
and Kimi K3 (frontend), per the hackathon's AI-tooling-friendly rules.
