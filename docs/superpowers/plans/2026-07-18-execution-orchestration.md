# Box Seat — Execution Orchestration Plan

**Goal:** Define who/what builds each part of Box Seat for the remaining hackathon
window, so model/agent assignment is unambiguous for every task from here forward.

---

## Roles

| Role | Who | When |
|---|---|---|
| **Implementer (default)** | Sonnet 5 (this session) | All backend/non-frontend code, always, unless a task explicitly requires Opus 4.8's capability. |
| **Implementer (escalation)** | Opus 4.8 | Only when a specific backend task explicitly requires it (e.g. a genuinely hard debugging/design problem Sonnet is visibly struggling with) — not a default. |
| **Orchestrator / Advisor** | Opus (via `Agent` tool, `model: "opus"`) and Fable 5 (via `Agent` tool, `model: "fable"`) | Dispatched for strategic decisions, plan review, or architecture judgment calls where the extra capability is clearly warranted. **Fable is expensive — use only where its added intelligence is evident, not routinely.** |
| **Frontend implementer** | Kimi K3 (external — run by Othniel directly, not invoked through this session's Agent tool) | **Exclusively.** No other role writes or edits frontend code. |
| **Frontend spec author** | Fable 5 (via `Agent` tool, `model: "fable"`) | Produces the direction/spec document Kimi K3 will build from. Fable writes *docs*, never frontend code. |

**Hard boundary:** nothing in this session (Sonnet, Opus, or Fable) touches frontend
source files. Sonnet's job is the backend being **fully complete** — TxLINE ingestion,
the match-state reducer, persistence, the WebSocket API, and the Solana service-wallet
integration — with a clean, documented contract at the edge for Kimi to build against.

## Two Parallel Tracks

**Track A — Backend (this session, Sonnet as implementer)**
Full implementation plan: [`2026-07-18-backend-implementation.md`](./2026-07-18-backend-implementation.md).
Executed via `superpowers:subagent-driven-development` — see that plan's execution
handoff section.

**Track B — Frontend spec (Fable, dispatched now, runs independent of Track A)**
A Fable-model agent produces `docs/frontend/KIMI-BUILD-SPEC.md`: the full direction
document for Kimi K3 — the 3D scene design (pitch geometry, pressure terrain, momentum
ribbon, key-moment takeovers, broadcast HUD) from
[`2026-07-17-box-seat-design.md`](../../plans/2026-07-17-box-seat-design.md) §§3-4,
translated into concrete build direction, PLUS the exact WebSocket message contract
Track A defines (Task 6 of the backend plan) so Kimi has a real, non-guessed API to
build against. This doc is a deliverable handed to Othniel to give to Kimi — nothing in
this session executes it.

**Sequencing:** Track A's WebSocket contract (backend Task 6) must exist before Track B
can be finalized with a real (not assumed) API shape — Fable's dispatch will draft
everything else first, then the contract gets folded in once Task 6 lands. Given both
tracks touch the contract, that's the one synchronization point; everything else is
independent.

## What Sonnet does NOT do

- Write, edit, or suggest edits to any file under a `frontend/`, `app/`, `components/`,
  or `.tsx`/`.jsx` UI path (whatever Kimi's project structure ends up being) — that's
  Kimi's exclusively, per Othniel's explicit boundary.
- Use Opus/Fable for routine implementation decisions — only dispatch them where the
  judgment call genuinely needs more than Sonnet provides.

## Status Tracking

- [x] Track A: Backend implementation plan written and self-reviewed
- [x] Track B: Fable dispatched to author `docs/frontend/KIMI-BUILD-SPEC.md`
- [x] Track A: Task 6 (WebSocket contract) complete → `docs/frontend/BACKEND-CONTRACT.md`
- [x] Track A: Backend fully implemented, review-hardened, offline-E2E-verified — final review verdict: SHIP (commit b230eca)
- [x] Track B: Spec doc finalized — awaiting Othniel handing it to Kimi

**Outcome notes (2026-07-18):** all 8 tasks went through implement → spec-review →
quality-review loops (Sonnet implementers/reviewers, Opus for the final comprehensive
gate). The loops caught and fixed 7 real defects before any live run: Offside pressure
leak, wrong live-schema fixtureId field, PascalCase data-field mismatch, two WS
process-crash vectors, auth restart-crash (ActiveSubscription 6016), and
single-source finish detection (resolved dual-signal after TxLINE docs vs. Fusion PDF
schema conflict). Remaining work is on Othniel's checklist (`OTHNIEL-TODO.md`): wallet
funding → live validation against a real match, Kimi frontend build, deployment,
demo video, submission.
