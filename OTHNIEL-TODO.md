# Othniel — Manual Action Checklist

Living doc of everything that needs YOUR hands (auth, funds, external accounts,
judgment calls). I keep this updated as the build progresses — check it whenever
you come back. Items are ordered by urgency.

## 🔴 Needed soon (blocks parts of the build)

- [ ] **Fund the service wallet** — send **~0.02 SOL** (mainnet) to
  `3ZaqDgaLBcfZQKzMxFt1N8wPVcV76PzQTPrjcyapvop1`
  Covers: token-account rent + TxLINE `subscribe` tx + post-match attestations.
  The backend is now FULLY BUILT and verified offline — this is the only thing
  standing between it and live World Cup data. Once funded, tell me (or any
  session) to "run the live TxLINE verification" — the checklist is:
  (1) start the server (`cd server && npm run dev`) and confirm the on-chain
  subscribe + activation succeeds, (2) confirm real scores events flow during a
  covered live fixture, (3) let one covered match run to full time and confirm
  BOTH that replay chunks arrive for it afterwards AND that the attestation
  lands on-chain (printed explorer signature). Step 3 matters extra: TxLINE's
  docs and the underlying Fusion schema disagree on how "match finished" is
  signaled (action=game_finalised/statusId=100 vs. status/StatusId 5|10|13) —
  the backend accepts either, but which one the live feed actually sends should
  be confirmed against a real match, not assumed.

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

- [ ] **Deploy the app publicly** — submission needs a working deployed link.
  Backend needs a host that supports long-lived processes (WS + SSE). Likely needs
  your account auth on whatever platform we pick (Vercel/Railway/Fly). Flag your
  preference when ready; I'll do the setup up to the login step.

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
