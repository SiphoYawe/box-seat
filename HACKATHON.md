# TxODDS x Solana — World Cup Hackathon (London, Superteam UK x Encode Club)

Source pages:
- Luma event: https://luma.com/TxOddsWorldCup-LondonHack?tk=AMZ6UG
- Superteam Earn hub: https://superteam.fun/earn/hackathon/world-cup
- TxLINE docs: https://txline.txodds.com/documentation/*

Raw scrapes cached in `.firecrawl/` (gitignored) for re-reference.

**Full local documentation mirrors** (fetched 2026-07-17, safe to browse offline):
- [`docs/txline/`](./docs/txline/) — complete TxLINE docs site (18 pages) + full OpenAPI 3.1 spec, mirrored as clean markdown/yaml
- [`docs/fusion/`](./docs/fusion/) — TxODDS Fusion feed technical reference (condensed from the 80-page PDF, which is also saved there in full) — the underlying data/schema/market-type vocabulary TxLINE wraps
- [`docs/txodds-products/`](./docs/txodds-products/) — TxODDS company background + all 7 products (TxLINE, Fusion, Scores, Lab, Soccer Elite, Cricket Elite, All Sported)

---

## 1. TL;DR

- **This weekend.** Doors open Saturday morning, building closes Sunday afternoon, submission deadline is Sunday at noon London time / **23:59 UTC July 19**.
- Build something real on **TxLINE** — TxODDS' live, cryptographically-verifiable World Cup data feed, anchored on Solana.
- **$50,000 global prize pool** across 3 tracks (Superteam Earn, submissions open to anyone globally), plus a **$5,000 local prize pool** specifically for the London/Encode Hub venue.
- No smart-contract experience required — it's an API-first data feed with optional on-chain verification/settlement.
- Free tier: **World Cup + International Friendlies data with zero cost** through the event (waived commercial fees).

---

## 2. Key Dates

| Milestone | Date/Time |
|---|---|
| In-person hackathon (Encode Hub, London) | **Sat 18 – Sun 19 July 2026** |
| Doors open | Sat 18 July, 11:00 AM (GMT+1) |
| Kick-off | Sat 18 July, 12:00 PM |
| Global online submissions open (Superteam Earn) | 24 June 2026, 15:00 UTC |
| Global submission deadline | **19 July 2026, 23:59 UTC** |
| In-person submission deadline (local) | Sun 19 July, 12:00 PM (noon) |
| Local finale / pitches | Sun 19 July, 5:30 PM |
| World Cup Final watch party (same venue) | Sun 19 July, 8:00 PM |
| Winner announcement (all 3 tracks) | 29 July 2026, 15:00 UTC |
| TxODDS free/waived data access ends | Sat 19 July 2026, 23:59 UTC |

Note: the in-person deadline (Sun noon) is earlier than the global Earn deadline (Sun 23:59 UTC) — build to the tighter in-person cutoff if presenting live, but the formal Superteam Earn submission has until 23:59 UTC.

---

## 3. Location & Logistics

- **Venue**: Encode Hub, 41 Pitfield St, London N1 6DA, UK
- Venue runs around the clock: food, drinks, **overnight access**, mentors on hand, rooftop party Saturday night.
- Free to enter, limited spots, registration requires host approval + wallet verification (token ownership check) via Luma.
- Hosted by **Superteam UK** and **Encode Club**; presented by **Superteam**.

### Full schedule
**Saturday**
- 11:00 — Doors open
- 12:00 — Kick-off event
- 13:00 — Lunch
- 13:00 onward — Build
- 18:00 — Dinner

**Sunday**
- 12:00 — Submission deadline (local/in-person)
- 13:00 — Lunch
- 17:30 — Finale event (pitches)
- 20:00 — World Cup Final watch party 🏆

---

## 4. Prize Structure

- **Global pool**: $50,000 across 3 tracks on Superteam Earn (open globally, not just London attendees)
- **Local pool**: $5,000 for the London Encode Hub venue specifically (on top of global track prizes)
- Submissions happen via **Superteam Earn** listings (one listing per track)

### Track prizes (global, per Superteam Earn listings)

| Track | Total | 1st | 2nd | 3rd |
|---|---|---|---|---|
| Prediction Markets and Settlement | $18,000 USDT | $12,000 | $4,000 | $2,000 |
| Consumer and Fan Experiences | $16,000 USDT | $10,000 | $4,000 | $2,000 |
| Trading Tools and Agents | $16,000 USDT | $10,000 | $4,000 | $2,000 |
| **Total** | **$50,000** | | | |

(Submission counts as of scrape time: Prediction Markets 82, Consumer/Fan 57, Trading Tools 63 — all "Submissions Open".)

---

## 5. The Three Tracks

Sponsor for all three: **TxODDS** (contact: [Telegram](https://t.me/TxLINEChat), [Discord](https://discord.gg/txodds)). Skills tagged on all: Frontend, Backend, Blockchain, Mobile, Design, Other.

### Track A — Prediction Markets and Settlement ($18k)
**Listing**: https://superteam.fun/earn/listing/prediction-markets-and-settlement

**Description**: TxLINE streams real-time World Cup data (scores, match events, odds) backed by cryptographic signatures anchored on Solana. Build prediction platforms, sportsbook interfaces, or data dashboards. Open-ended architecture:
1. **Data-driven Web3 platforms** — use the SSE stream to power a frontend, trigger prediction resolutions.
2. **Experimental verification layer (optional)** — use TxLINE's Merkle proofs to verify match data signatures; custom validation logic is highly valued by judges.

**Architectural notes**:
- TxLINE's internal credit token (TxL) is locked to the program for data-authorization only — **cannot** be used for P2P wagering/staking/transfers.
- Teams are encouraged to build trustless P2P wagering pools, escrows, AMMs settled in *other* Solana tokens (e.g. USDC), using TxLINE Merkle proofs as the oracle.
- Can write custom on-chain settlement programs that CPI into TxLINE's `validate_stat` instruction to confirm outcomes trustlessly.

**Idea seeds from sponsor**:
- Full-Tournament Auto-Market (auto winner/total-goals/first-scorer markets across all 104 matches)
- Verifiable Resolution UI (shows the Merkle-proof "receipt" for a match outcome)
- Prediction Market Viewer / analytics dashboard (odds, implied probability, liquidity)
- Decentralized AMM/order-book prediction market with on-chain escrow settled via TxLINE CPI validation
- Parametric sports insurance / prop bets (e.g. "Team A + Team B corners > 10" auto-payout via PDA + TxLINE proof)

**Judging criteria**: core functionality (live/simulated data ingestion), UX & use case appeal, code quality/determinism of resolution logic.

---

### Track B — Consumer and Fan Experiences ($16k)
**Listing**: https://superteam.fun/earn/listing/consumer-and-fan-experiences

**Description**: Fan-facing apps for the 104 World Cup matches — mobile-first, live scores/odds/events, "the kind of data only big operators had until now."

**Idea seeds from sponsor**:
- Group Sweepstake with live leaderboard driven by TxLINE data
- AI Pundit Bot (Telegram bot narrating goals/cards/odds swings, bonus for TTS)
- Hi-Lo Stats Game (predict next stat higher/lower, streak-based, replayable across 104 games)

**Judging criteria**: fan accessibility/UX (would a non-technical fan use this regularly?), real-time responsiveness, originality, commercial/monetization viability, completeness of execution (small scope done well > big scope half-done).

**Note**: must "sign up through Solana" (wallet-based) per eligibility text.

---

### Track C — Trading Tools and Agents ($16k)
**Listing**: https://superteam.fun/earn/listing/trading-tools-and-agents

**Description**: Autonomous agents/tools acting on TxLINE's live odds/scores without manual intervention.

**Idea seeds from sponsor**:
- Sharp Movement Detector (flags significant odds shifts every 60s, tracks predictive accuracy)
- Agent vs Agent Arena (two agents, opposing strategies, same feed, settle on-chain, best strategy wins over the tournament)
- In-Play Market Maker (quotes buy/sell on in-play outcomes, adjusts live)

**Judging criteria**: core functionality/data ingestion, full autonomy (no manual intervention once deployed), logic/architecture quality, novelty, production-readiness (could a real trading team deploy this?).

---

### Shared rules across all 3 tracks

**Eligibility**:
- Individuals, teams (**max 3 members**), or AI agents — but submission must be owned by a real person/team/entity eligible to receive prizes via Superteam Earn.
- Must use TxLINE data as a **primary/live** data source.
- Deployed build (mainnet or devnet) — **no concepts, wireframes, or pitch decks** (automatic disqualification).

**Submission requirements** (same for all tracks):
1. Demo video, ≤5 min (Loom/YouTube) — showing problem, live walkthrough, how TxLINE powers the backend. **Hard requirement to pass screening.**
2. Public GitHub repo link.
3. Working link to deployed app OR functional API/devnet endpoint for judges.
4. Brief technical doc: core idea, technical highlights, list of specific TxLINE endpoints used.
5. Feedback on the TxLINE API dev experience (what worked, where you hit friction).

**Judging process**:
- Submissions close 19 July 2026, 23:59 UTC → shortlist compiled → live interview rounds for finalists → winners (1st/2nd/3rd per track) announced ~29 July 2026.
- Judged heavily on the **demo video** since live matches will have ended by review time.

**Legal**: participants responsible for complying with gambling/gaming/financial/securities laws in their jurisdiction; TxODDS/Superteam do not endorse illegal betting activity. Must agree to [TxODDS Hackathon T&Cs](https://txline.txodds.com/documentation/legal/hackathon-terms) + Superteam Earn's standard terms. (One commenter flagged a possible tension in the T&Cs between "AI agents welcome" and a clause requiring human-created/submitted entries not materially controlled by agents — worth reading the actual T&C doc if leaning heavily on autonomous agents for Track C.)

---

## 6. TxLINE — The Technical Platform

**What it is**: TxODDS' high-performance sports data layer — real-time scores, match events, and consensus betting odds — with a single normalized JSON schema across all competitions. Data integrity is cryptographically anchored on Solana (Merkle proofs, on-chain validation instructions), while the actual data delivery is off-chain (REST/SSE), keeping it fast.

### Auth flow (required for every integration)
1. **Guest JWT**: `POST /auth/guest/start` → `{ token }`. Send as `Authorization: Bearer <jwt>`.
2. **Subscribe on-chain**: Anchor program call `program.methods.subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)` — even the free tier requires this on-chain tx (costs SOL for fees/rent, no TxL payment needed for free tiers).
3. **Activate API token**: sign message `${txSig}:${leagues.join(",")}:${jwt}` with your wallet, `POST /api/token/activate` → returns `apiToken`.
4. **Use both credentials** on every data call: `Authorization: Bearer <jwt>` + `X-Api-Token: <apiToken>`.

### Network config

| Network | Program ID | TxL Mint | Guest Auth Host | API Base |
|---|---|---|---|---|
| Mainnet | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` | `Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL` | `https://txline.txodds.com/auth/guest/start` | `https://txline.txodds.com/api/` |
| Devnet | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` | `https://txline-dev.txodds.com/auth/guest/start` | `https://txline-dev.txodds.com/api/` |

Rule: RPC, program ID, TxL mint, guest JWT host, and API host must **all** be on the same network — mixing mainnet/devnet credentials causes 401/403s.

### Free World Cup tier (what we'll almost certainly use this weekend)
- **Service Level 1**: World Cup + Int'l Friendlies, 60-second delay (mainnet).
- **Service Level 12**: World Cup + Int'l Friendlies, real-time (mainnet). ← best for live-demo tracks.
- Devnet: Service Level 1 only, `samplingIntervalSec = 0` currently.
- **No TxL purchase needed** for free tier, but you still need real SOL/devnet SOL for the on-chain `subscribe` tx fees.
- No rate limits on the free tier.
- Free tier usable for commercial projects too (per FAQ), but recommend real-time paid tier for production.

### Data endpoints available
- **Fixtures** — upcoming/current fixture metadata (incl. `GameState`: `1`=Scheduled, `6`=Cancelled)
- **Odds** — snapshots, historical updates, live SSE stream (`GET /api/odds/stream`) — "StablePrice" odds
- **Scores** — snapshots, historical updates, live SSE stream (`GET /api/scores/stream`); historical endpoint `GET /api/scores/historical/{fixtureId}` (only for fixtures started 2 weeks–6 hours ago)
- **Validation proofs** — fixture/odds/score Merkle proofs for on-chain verification:
  - `GET /api/scores/stat-validation?fixtureId=...&seq=...&statKey=...` → legacy `validateStat` (single/dual stat)
  - `GET /api/scores/stat-validation?fixtureId=...&seq=...&statKeys=1,2,...` → `validateStatV2` (multi-stat, indexed predicates, multi-leg strategies) — this is the current/preferred path
- Final match outcome record: `action=game_finalised`, `statusId=100`, `period=100` — this is the canonical record to key settlement logic off, regardless of regulation/ET/penalties/abandonment.
- SSE streams support gzip compression (`Accept-Encoding: gzip`) for 70-80% bandwidth reduction.

### Stack requirements
- Node.js 20+ (SSE client dependency requirement)
- `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `axios`, `tweetnacl`
- Reference repo with runnable devnet example scripts: `github.com/txodds/tx-on-chain` (`examples/devnet/scripts/*.ts` — free-tier sub, odds stream, scores stream + validation, fixture validation)

### Pricing (if we ever go beyond free tier — probably N/A this weekend)
1 USD = 1,000 TxL. Paid tiers start at 500,000 TxL ($500)/28 days for 10 leagues @ 60s delay, up to $25,000/28 days for all-leagues real-time. Irrelevant for the World Cup free tier but useful context on how "expensive" real-time+global data normally is — reinforces that the hackathon access is a meaningful unlock.

### Support & resources
- Canonical docs domain: **https://txline-docs.txodds.com** (aliased at `txline.txodds.com` — identical content; append `.md` to any docs URL, e.g. `txline-docs.txodds.com/documentation/quickstart.md`, to fetch clean markdown directly, no scraping needed)
- Full local mirror of all 18 doc pages + OpenAPI spec: [`docs/txline/`](./docs/txline/) (see its README for the page index)
- Dev support: [Discord](https://discord.gg/pPXPpZ6bwM), [Telegram](https://t.me/TxLINEOfficial), [X](https://x.com/TXODDSOfficial), txline@txodds.com
- Devnet faucet mentioned by other participants (unofficial): https://www.devnetfaucet.org/
- Underlying data schema reference (SuperOddsTypes, market vocabulary): [`docs/fusion/`](./docs/fusion/)

Additional TxLINE-specific docs beyond what's summarized above (all mirrored in `docs/txline/`):
- **Odds**: StablePrice overview + covered competitions list (`odds/overview.md`, `odds/odds-coverage.md`)
- **Scores**: soccer/football/basketball score encodings + live coverage schedule (`scores/*.md`) — `scores/soccer-feed.md` is the one most relevant to World Cup builds
- **Solana Programs**: mainnet/devnet program addresses, PDA derivation, validation accounts (`programs/*.md`)
- **Examples**: snapshot fetching, on-chain validation walkthroughs (`examples/fetching-snapshots.md`, `examples/onchain-validation.md`)

---

## 7. Open Questions / Things to Verify On-Site

- The World Cup final itself lands on the same day submissions close (Sun 19 July) — several commenters on the Superteam listing flagged that live in-game data may not be available during judging/review since matches conclude right at the deadline. **Design demo videos to carry the "live" story since judges may only see historical/replayed behavior.**
- FAQ accordion on the Superteam hub page (team eligibility specifics, multi-track entry, multi-prize wins, legacy project reuse) is JS-rendered and didn't yield text via scrape — worth checking in-browser or asking organizers directly at the venue if it affects our track/team strategy.
- Track C (Trading Tools and Agents) has a flagged tension in the comments between "AI agents welcome" and Hackathon T&C §5.1 (entries must be human-created/submitted, may be disqualified if materially agent-controlled) — read the actual T&C doc (https://txline.txodds.com/documentation/legal/hackathon-terms) before leaning hard on autonomous-agent framing for prize eligibility.
- Can enter multiple tracks / win multiple prizes — not explicitly confirmed in scraped text; ask organizers.

---

## 8. Brainstorming Angles (jumping-off points, not decisions)

- All three tracks share the same underlying primitive: **verifiable, low-latency match state (scores/odds) + Merkle proof validation on Solana**. The core technical challenge is the same regardless of track — ingest TxLINE SSE streams, react to state changes, optionally settle/verify on-chain.
- Given team size cap of 3 and ~24 build hours (Sat 1pm – Sun 12pm), favor **narrow and polished** over broad — judging criteria repeatedly reward completeness/execution over scope (see Track B judging criteria explicitly).
- Demo video is the single highest-leverage deliverable across all tracks — matches end right as submissions close, so judges are largely watching video, not live-testing. Plan to record/rehearse the demo well before the Sunday noon local cutoff, not after.
- Given "no smart contract experience needed" language on the Luma page but the technical docs clearly support on-chain settlement/CPI into `validate_stat`, there's a spectrum from pure-API app (fast, safe) to full on-chain settlement engine (harder, more differentiated, more aligned with "Solana hackathon" judging expectations) — worth deciding deliberately where on that spectrum to sit.
