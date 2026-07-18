# Othniel — Manual Action Checklist

Living doc of everything that needs YOUR hands (auth, funds, external accounts,
judgment calls). I keep this updated as the build progresses — check it whenever
you come back. Items are ordered by urgency.

## 🔴 Needed soon (blocks parts of the build)

- [x] **Fund the service wallet** — done 2026-07-18 (0.05 SOL).
- [x] **Live TxLINE auth + stream** — done 2026-07-18 ~14:30: on-chain subscribe
  landed (after adding priority-fee + blockhash-retry — first attempt expired on
  the public RPC), activation succeeded, real-time scores stream open, backend
  running live on mainnet. Session token persisted — restarts won't re-pay.
- [ ] **Capture one real match to full time** (backend does this automatically
  while running — just keep it running during today's/tomorrow's covered
  fixtures). Confirms: real events flow, which finish signal the live feed
  actually sends (docs disagree; we accept both), replay chunks for a real
  match, and the first real on-chain attestation (watch for the printed
  explorer signature). I'm monitoring the server logs and will report.

- [ ] **Kick off Kimi K3 on the frontend** — the build spec is ready:
  `docs/frontend/KIMI-BUILD-SPEC.md` (self-contained; tells Kimi what else to read).
  The backend WebSocket contract is inlined in it, so Kimi can start immediately —
  no need to wait for the backend to finish. Frontend is 100% Kimi's per your
  boundary; none of my agents will touch it.

## 🟡 Needed before submission (Sun 12:00 local / 23:59 UTC)

- [ ] **Record the demo video (≤5 min, Loom/YouTube)** — the single most
  judge-weighted deliverable (matches end before judging, so they mostly watch
  video). Must show: the problem, live app walkthrough, and how TxLINE powers the
  backend. Budget real time for this — don't leave it to the last 30 minutes.
  The frontend spec includes a `?demo=1` synthetic-match mode specifically so you
  can record without depending on a live fixture.

- [x] **GitHub repo + push** — done 2026-07-18: `github.com/SiphoYawe/box-seat`,
  branch `main`, all commits pushed individually. Remaining sliver: confirm the
  repo is (or will be made) PUBLIC before submission — the form requires a public
  link.

- [x] **Deploy** — done 2026-07-19 ~02:00: frontend on GitHub Pages
  (https://siphoyawe.github.io/box-seat/), backend on this laptop behind a
  Cloudflare tunnel (Railway free tier refused new provisions). CONSTRAINT:
  keep this laptop plugged in, online, lid open (caffeinate is running)
  through judging. If the tunnel URL ever rotates, tell me — rebuild+redeploy
  is 3 minutes.

- [ ] **Submit on Superteam Earn** — the actual submission form on the
  [Consumer and Fan Experiences listing](https://superteam.fun/earn/listing/consumer-and-fan-experiences),
  needs your Superteam account (+ wallet, + possible X/Twitter verification — one
  participant reported X-verification issues in the comments, so don't leave the
  first submission attempt to the final hour; you can edit after submitting per
  the comments). Form includes: demo video link, repo link, app link, brief tech
  doc (I'll draft this for you), and TxLINE API feedback (I'll draft this too).

- [ ] **In-person logistics** — if pitching live at Encode Hub: local submission
  deadline is Sun 12:00 noon, finale 17:30. Global Earn deadline is later
  (23:59 UTC) but build to the local one if you're presenting.

## 🟢 Optional / as-needed

- [ ] **X API bearer token (only if you want the "Match chatter" panel)** — Kimi's
  backend work order item 4 proposes a moderated live-X-posts feed per match. It
  requires an X API key (paid tier for recent search) and your call on whether
  showing third-party social content in the demo is worth it. If yes: get a
  bearer token from developer.x.com and hand it to me; I'll build the proxied,
  server-moderated, read-only version Kimi specced. If no: we skip it — the
  frontend hides the panel gracefully.

- [ ] **TxODDS dev support access** — if we hit TxLINE API issues I can't debug:
  [Discord](https://discord.gg/pPXPpZ6bwM) / [Telegram](https://t.me/TxLINEChat).
  Joining now (before you need help) is cheap insurance.

- [ ] **Read the TxODDS Hackathon T&Cs** —
  https://txline.txodds.com/documentation/legal/hackathon-terms — mostly relevant
  to Track C's AI-agent clause, but worth 5 minutes since AI tooling built this.

## ✅ Done

- [x] Service wallet keypair generated (gitignored at `server/_keys/service-wallet.json`) — 2026-07-18
- [x] Local `server/.env` created from example — 2026-07-18
- [x] Frontend build spec authored for Kimi (`docs/frontend/KIMI-BUILD-SPEC.md`) — 2026-07-18
