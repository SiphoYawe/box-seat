# Box Seat

**A live 3D match visualizer for the 2026 World Cup. See the match the way the data sees it.**

**App:** https://siphoyawe.github.io/box-seat/

Built solo for the [TxODDS x Solana World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup), Consumer & Fan Experiences track.

## What it is

TxLINE streams every World Cup score event: possession danger levels, shots with outcomes, corners, cards, VAR, goals. Box Seat folds that stream through a pure, deterministic reducer into two signals a fan can see. Momentum (-1..+1) says who is on top right now. Zone pressure says which third of the pitch each team threatens. A React Three Fiber frontend renders both as a 3D pressure terrain over a real pitch, with a momentum ribbon as the match timeline. Goals, red cards, and VAR overturns trigger full-screen broadcast-style takeovers.

No betting, no odds, no predictions. The backend reads only TxLINE's `/scores` and `/fixtures` data. That is a values decision, and the code enforces it.

## Live and replay share one engine

The backend persists every event to a local log. A finished match replays by folding those same stored events through the same reducer, so the replay provably tells the story the live view told, and replays keep working after feed access expires. Subscribing to a finished fixture streams the full history in chunks over WebSocket, then the final state; the frontend scrubs freely through the reconstruction.

## Solana (no wallet needed to watch)

TxLINE's entitlements live on-chain: the backend's service wallet performs the Anchor `subscribe` transaction (priority fee plus blockhash retry, so it lands on the public RPC) and the wallet-signed activation, and the session token persists across restarts. At full time, the backend writes an SPL Memo attestation, `boxseat:<fixtureId>:<sha256 of final state>`, to mainnet: a permanent public record of the match story shown. The app checks each replay against its attestation and shows REPLAY VERIFIED. Viewers never connect a wallet.

## Architecture

```
TxLINE SSE (/scores)
   → service-wallet auth (on-chain subscribe → activation, persisted session)
   → pure match-state reducer (momentum, zone pressure, key moments)
   → SQLite event log (replays survive feed-access expiry)
   → WebSocket broadcast  ←  3D frontend (React Three Fiber)
   → SPL Memo attestation at full time
```

**Resilience.** The system survived a live tournament weekend: SSE auto-reconnect with JWT renewal and a watchdog, automatic re-subscription after persistent auth failure, restart state-rebuild from the event log, malformed feed events and malformed WebSocket clients isolated rather than fatal, non-blocking attestation. Finish detection accepts both of TxLINE's documented finish signals (`game_finalised` and terminal StatusIds) because the two TxODDS schema sources disagree; I measured the live feed to settle it.

**TxLINE endpoints used:** `POST /auth/guest/start`; on-chain `subscribe` (program `9ExbZ…cKaA`, service level 12, the real-time free World Cup tier); `POST /api/token/activate`; `GET /api/scores/stream` (SSE); `GET /api/scores/historical/{fixtureId}` for backfill.

## Repo layout

- `server/`: backend (Node 20+, TypeScript, strict ESM). `npm install && npm run dev`; needs a funded keypair at `server/_keys/service-wallet.json` and a `.env` from `.env.example`.
- `frontend/`: React Three Fiber app. `npm install && npm run dev`.

## Built with

TxLINE (TxODDS) · Solana (`@coral-xyz/anchor`, SPL Memo) · Node/TypeScript · SQLite · WebSockets · React Three Fiber. Developed with Claude (backend, orchestration) and Kimi K3 (frontend) under the hackathon's AI-tooling-friendly rules.
