# Demo Video — Script & Shot List (≤5:00)

The single most judge-weighted artifact: matches end before judging, so judges
experience the product mostly through this video. Target 4:00–4:30 — never crowd the
5:00 limit. Record with Loom or QuickTime + mic; 1080p+; rehearse once end-to-end
before recording. Dark-room screen recording flatters the stadium-at-night aesthetic.

## Structure

**0:00–0:25 — The problem (voice over a real broadcast-style still or the match list)**
> "When you watch a football match, you can feel momentum shift — but you can't see
> it. Stats pages give you numbers after the fact. Box Seat makes the invisible
> structure of a live match visible — in 3D, as it happens."

**0:25–1:00 — The reveal (the money shot)**
Open the France–England replay (real captured match, fixtureId 18257865). Slow orbit
of the full 3D scene: pitch, both pressure terrains glowing, momentum ribbon
threading through. Name what they're seeing:
> "A real pitch. Each team's territorial pressure rises as glowing terrain over the
> zones they're threatening from. And this ribbon is the match itself — time flows
> along it, and it bends toward whoever's on top. This is France–England from last
> night — every event you'll see is real TxLINE World Cup data."

**1:00–2:00 — Reading a real story**
Scrub the ribbon through the match's actual arc. Pause at the real momentum swings:
> "Watch what happens around [minute X] — England's terrain builds in the attacking
> third… and here's the goal." Let a full-screen goal takeover play. "Goals, red
> cards, VAR overturns take over the screen — like a broadcast, because fans already
> speak that language."
(Fill [minute X] etc. from the actual captured match after tonight.)

**2:00–2:45 — Live mode**
Switch to live view (if any covered fixture is live while recording; otherwise demo
mode with the ?demo=1 synthetic match, said honestly):
> "Live, the same engine runs in real time — the terrain grows and the ribbon extends
> with every event from TxLINE's real-time feed. Live and replay are the same pure
> state engine, so the replay you scrub is provably the story you watched."

**2:45–3:30 — How TxLINE + Solana power it (over an architecture slide or terminal)**
> "The backend authenticates on-chain: our service wallet subscribes to TxLINE's
> World Cup tier with a Solana transaction and a wallet-signed activation — that's
> the entitlement layer. Every score event streams in over SSE, folds through a
> deterministic reducer, and persists locally, so replays outlive the feed. And when
> a match hits full time, we write its fingerprint to Solana as an SPL Memo —"
Show the real attestation on explorer.solana.com (from tonight's match):
> "— a permanent public record of the match story you just watched. Viewers never
> touch a wallet. And by design, Box Seat consumes zero odds data: no betting,
> anywhere."

**3:30–4:15 — Craft + close**
Quick cuts: match list, a second scrub moment, key-moment takeover, maybe the WS
contract/tests in an editor for two seconds.
> "One weekend, one deterministic engine, two ways to experience every match. Box
> Seat — see the match the way the data sees it."
End card: Box Seat · repo URL · built on TxLINE + Solana.

## Checklist before recording
- [ ] France–England fully captured (backend ran through tonight's match)
- [ ] Real attestation signature ready in an explorer tab
- [ ] Identify the actual best 2–3 momentum swings in the captured match to narrate
- [ ] Frontend polished on the replay path (the video leans hardest on it)
- [ ] Mic check; kill notifications; 1080p+; dark room
- [ ] One full rehearsal, then record; upload; paste link into SUBMISSION-DRAFT.md
