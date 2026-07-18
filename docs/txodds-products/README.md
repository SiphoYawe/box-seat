# TxODDS — Company & Full Product Suite

Source: https://txodds.net (scraped 2026-07-17). Company background and the 6 other
products in TxODDS' catalog, for context beyond TxLINE (the one product actually usable
for free this weekend). Raw scrapes cached in `../../.firecrawl/txodds-*.md` and
`.firecrawl/txodds-product-*.md`.

## Company
- 25 years in sports betting data (founded ~2000/2001), London-based.
- Clients include Bet365, Betway, William Hill, Flutter, Entain, Caesars, Fanatics, OpenBet, LaLiga, HK Jockey Club, TAB, 188BET — i.e. tier-one sportsbooks globally.
- Claimed stats: ~1ms avg feed latency (Fusion), 99.9% uptime SLA, 5M+ historical fixtures archived, 25 years of odds history.
- CEO: **Einar Knobel**. Blockchain Systems Engineer (TxLINE): **Aidan Rolfe**.
- Contact: hello@txodds.com / +44 203 376 0442 (general). TxLINE-specific: txline@txodds.com, [Discord](https://discord.gg/pPXPpZ6bwM), [Telegram](https://t.me/TxLINEOfficial), [X](https://x.com/TXODDSOfficial).

## The 7 products
| Product | What it is | Relevance to us |
|---|---|---|
| **TxLINE** | On-chain (Solana) data distribution layer — wraps the institutional feeds into a wallet-authenticated, consumption-based product. Launched June 2026, timed to the World Cup. | **This is the hackathon product** — see [`docs/txline/`](../txline/) |
| **Tx FUSION ODDS** | The core enterprise live odds feed — 8-10ms latency, 250+ bookmakers, 30+ sports, 100+ market types. "The heartbeat of TxODDS." | Underlying data/schema TxLINE exposes — see [`docs/fusion/`](../fusion/) |
| **Tx SCORES** | US college football/basketball play-by-play, sourced from in-venue human scouts (not repackaged media), verified against Fusion. | Not in World Cup free tier; soccer/football score encodings exist in TxLINE docs (`scores/soccer-feed.md`) which is the equivalent for our use case |
| **Tx LAB** | Historical archive: 5M+ fixtures, 800+ bookmakers, decades of odds history for backtesting/model validation. | Could be relevant if a track idea wants historical calibration, but not part of the free World Cup tier |
| **Tx SOCCER ELITE** | Lacerta-powered soccer-specific pricing across 350+ leagues, tunable margination, live cash-out/bet-builder ready. | Enterprise-only, not accessible this weekend |
| **Tx CRICKET ELITE** | Lacerta-powered ball-by-ball cricket pricing, format-tuned (T20/ODI/Test), 2500+ matches/year. | Not relevant to a soccer World Cup hackathon |
| **Tx ALL SPORTED** | Horse & greyhound racing odds + pre-race content, sub-250ms updates, PA/SIS/Racing Post integration. | Not relevant |

All products share delivery infrastructure (REST + WebSocket APIs, JSON payloads, SDKs) and the same underlying identifier system (**Merlin IDs** — the current canonical ID scheme fixtures/competitions/teams/players/bookmakers/countries/sports all use; legacy AHC/xml2 IDs are also carried for backward compatibility, see `LegacyFixtureId` etc. fields in Fusion messages).

## Origin story (from press releases)
- **10 June 2026** — TxODDS launches TxLINE ahead of the World Cup: USDT-funded, TxL token-gated, four-week minimum subscription cycles, zero-cost World Cup + Int'l Friendlies coverage across all 104 matches (both Real-Time and 60s-delay, both StablePrice odds and Tx Scores modules).
- **24 June 2026** — TxODDS + Solana + Superteam launch the World Cup hackathon to introduce TxLINE to developers: $50k stablecoin pool, data fees waived, open to individuals/teams/AI agents across 3 tracks. CEO quote: "This World Cup hackathon is where we prove what's possible when you break down traditional gatekeepers and give access to talented, motivated builders."

## Notable product-page framing for TxLINE (useful positioning language for our pitch)
- "On-chain sports data feed with zero signing required" / "Go from raw odds to live markets without signing a single contract."
- "Institutional data. No sales call required." — go live today, pay only for what you use, blockchain-verified/tamper-proof, same feed speed as tier-one sportsbooks.
- FAQ confirms: a Solana wallet is **required even for the free tier** (entitlements are on-chain), but no TxL/crypto payment is required for the free World Cup tier.
- On-chain verification pitch: "every score, odds figure, and fixture [is] cryptographically anchored onto Solana via Merkle proofs... foundation for trustless smart-contract settlement" — this is the core hook for our Prediction Markets track angle specifically.
