# Deploying the Box Seat backend

The backend is one long-lived Node process (SSE ingest + WebSocket out + SQLite on
disk). It needs a host that runs persistent processes with a persistent disk —
**Railway** is the recommended default (simplest volume + secrets story); Fly.io works
identically. It is not a fit for serverless-per-request platforms.

Everything below is ready in the repo (`server/Dockerfile`); only the account/auth
steps need a human.

## Railway (recommended)

1. `railway login` (Othniel — browser auth)
2. From `server/`: `railway init` → new project "box-seat"
3. `railway volume add --mount-path /data` (1GB is plenty)
4. Set variables (Railway dashboard or CLI):
   - `SOLANA_RPC_URL=https://api.mainnet-beta.solana.com`
   - `TXL_TOKEN_MINT=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL`
   - `WS_PORT=8787`
   - `DB_PATH=/data/box-seat.db`
   - `SERVICE_WALLET_PATH=/data/service-wallet.json`
5. Upload the service wallet keypair to the volume (one-time):
   `railway run bash -c 'cat > /data/service-wallet.json'` and paste the JSON array
   from `server/_keys/service-wallet.json` (or use `railway shell`). Never commit it.
6. `railway up` (builds via the Dockerfile) — then expose port 8787 (TCP proxy or
   HTTP with WS upgrade; Railway supports WebSockets on the default HTTP proxy).
7. Frontend connects to `wss://<railway-domain>` — update the frontend's WS URL env.

Notes:
- The TxLINE session persists in SQLite (`kv` table), so redeploys/restarts reuse the
  activated API token instead of re-running the on-chain subscribe — restarts are safe
  and cheap by design.
- The service self-heals: stream watchdog reconnects; 5 consecutive auth failures
  trigger a full re-subscription automatically.
- One instance only (SQLite + in-memory state) — do not scale horizontally.

## Local fallback for the demo

If hosting fights back on the day, the demo works entirely from a laptop:
`cd server && npm run dev` + frontend pointed at `ws://localhost:8787`. The recorded
demo video doesn't care where the backend runs.
