# Box Seat

**A live 3D match visualizer for the 2026 World Cup. See the match the way the data sees it.**

**App:** https://siphoyawe.github.io/box-seat/

Built solo for the [TxODDS x Solana World Cup Hackathon](https://superteam.fun/earn/hackathon/world-cup), Consumer & Fan Experiences track.

## What it is

Box Seat turns TxLINE's live World Cup scores feed into a 3D match story: a real pitch, pressure terrain rising over the zones each team threatens, and a momentum ribbon as the match timeline. Goals, red cards, and VAR overturns take over the full screen. A finished match becomes a scrubbable replay driven by the same engine: the same stored events fold through the same reducer, so the replay tells the story the live view told.

No betting, no odds, no predictions. The backend reads only TxLINE's `/scores` and `/fixtures` data. That is a values decision, and the code enforces it.

## Solana (no wallet needed to watch)

- The backend's service wallet performs TxLINE's on-chain `subscribe` transaction and signed activation on mainnet. Viewers never connect a wallet.
- At full time the backend writes an SPL Memo attestation, `boxseat:<fixtureId>:<sha256 of final state>`, to mainnet. The app checks each replay against its attestation and shows REPLAY VERIFIED.

## Architecture

```
TxLINE SSE (/scores)
   → service-wallet auth (on-chain subscribe → activation, persisted session)
   → pure match-state reducer (momentum, zone pressure, key moments)
   → SQLite event log (replays survive feed-access expiry)
   → WebSocket broadcast  ←  3D frontend (React Three Fiber)
   → SPL Memo attestation at full time
```

- Live and replay share one reducer: same events, same result.
- Restarts rebuild state from the event log and reuse the persisted TxLINE session; the server handles `ActiveSubscription` rejections and re-subscribes after stale-token failures.
- The server isolates malformed feed events and malformed WebSocket clients instead of crashing, the SSE stream self-heals via a watchdog, and attestation never blocks the pipeline.

## Repo layout

- `server/`: backend (Node 20+, TypeScript, strict ESM). `npm install && npm run dev`; needs a funded keypair at `server/_keys/service-wallet.json` and a `.env` from `.env.example`.
- `frontend/`: React Three Fiber app. `npm install && npm run dev`.

## Built with

TxLINE (TxODDS) · Solana (`@coral-xyz/anchor`, SPL Memo) · Node/TypeScript · SQLite · WebSockets · React Three Fiber. Developed with Claude (backend, orchestration) and Kimi K3 (frontend) under the hackathon's AI-tooling-friendly rules.
