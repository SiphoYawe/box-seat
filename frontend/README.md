# Box Seat - Frontend

Live/replay match-story visualizer for the 2026 World Cup. A single match is
rendered as a 3D night-stadium scene: a glowing pressure terrain over the
pitch, a momentum ribbon above it that doubles as the replay scrubber, and
broadcast-style takeovers for goals, red cards, and VAR overturns.

Pure viewer: the only data source is the backend WebSocket
(`docs/frontend/BACKEND-CONTRACT.md`). No betting/odds, no wallet UI.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

- `http://localhost:5173/match/14790158?demo=1` - synthetic France vs Brazil
  final, replay mode (scrub the ribbon, transport at bottom center).
- `...&live=1` - same match through the live pipeline at 60x (takeovers fire).
- `...&minute=70` - deep-link the replay playhead to a match minute.
- Without `?demo=1` the app connects to the real backend (`ws://localhost:8787`).

## Env

| Var          | Default               | Purpose                  |
| ------------ | --------------------- | ------------------------ |
| `VITE_WS_URL` | `ws://localhost:8787` | Backend WS (use `wss://` in prod) |

## Build / test

```bash
npm run build      # tsc + vite build -> dist/ (static, needs SPA fallback)
npm run test       # vitest: unit tests on the ported reducer
```

Deploy to any static host with an SPA rewrite to `index.html` and `VITE_WS_URL`
set at build time.

## Layout

- `src/reducer/` - verbatim copy of `server/src/reducer/` (replay
  reconstruction must match the backend exactly; re-copy if the backend changes)
- `src/lib/` - ws wrapper (backoff + resubscribe), replay reconstruction,
  teams/fixtures/demo data
- `src/state/store.ts` - zustand: modes (live/replay), playhead, takeover queue
- `src/scene/` - R3F scene: pitch, terrain shaders, ribbon, camera rig
- `src/hud/` - DOM overlay: scorebug, event log, transport, takeovers
- `src/pages/` - match list and match view
- `scripts/gen-demo.mjs` - regenerates `src/data/demo-match.json`
- `scripts/shoot.mjs` - headless screenshot harness (system Chrome via CDP)
