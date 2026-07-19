# Demo Video — Script & Shot List (≤5:00)

The single most judge-weighted artifact: matches end before judging, so judges
experience the product mostly through this video. Target 4:00–4:30 — never crowd the
5:00 limit. Record with Loom or QuickTime + mic; 1080p+; rehearse once end-to-end
before recording. Dark-room screen recording flatters the stadium-at-night aesthetic.

**Tonight's match (the hero asset):** France 4–6 England, third place play-off,
2026-07-18, Hard Rock Stadium — fixtureId `18257865`. Ten goals, a disallowed goal
that self-corrects, an 87' penalty, and stoppage-time drama at both ends. The arc writes
itself; just point the camera at it.

## Structure

**0:00–0:25 — The problem (voice over a real broadcast-style still or the match list)**
> "When you watch a football match, you can feel momentum shift — but you can't see
> it. Stats pages give you numbers after the fact. Box Seat makes the invisible
> structure of a live match visible — in 3D, as it happens."

**0:25–1:00 — The reveal (the money shot)**
Open the France–England replay (`/match/18257865`, replay mode, at full time 4–6).
Slow orbit of the full 3D scene: pitch, both pressure terrains glowing, momentum
ribbon threading through, goal rings and the penalty beacon on it. Name what they're
seeing:
> "A real pitch. Each team's territorial pressure rises as glowing terrain over the
> zones they're threatening from. And this ribbon is the match itself — time flows
> along it, and it bends toward whoever's on top. This is France–England from last
> night, the six-four third-place game — every event you'll see is real TxLINE World
> Cup data."

**1:00–2:00 — Reading a real story (tonight's actual arc)**
Scrub the ribbon through the match's real arc, in this order:
- **3'–18', the England blitz.** Park the playhead around 15'. "Three goals in
  eighteen minutes. Watch England's terrain pile into France's attacking third —
  that's what a blitz looks like as data." Let the **18' goal takeover** play full
  screen, then the **goal-cam** swing behind the goal line while the buildup replays.
- **The honesty beat (~2 goals later).** "One of those early England goals was
  chalked off on review — and watch: the moment retracts itself from the story. The
  feed corrects, the story self-corrects. No phantom goals, ever."
- **48'–54', the France fightback.** "Now the game flips. Two France goals in six
  minutes — the ribbon bends back, the story chip says France are camping." (Story
  chip visible: "France camping in England's third".) Let the **54' goal takeover**
  play — scorer name and photo on the card.
- **87', the penalty.** "England's fifth was a penalty — and a penalty goal is a
  goal here, full takeover and all."
- **90+6' and 90+8', the stoppage-time drama.** "France pulls one back at ninety
  plus six — four-five, game on — and England kill it ninety seconds later. Four-six.
  Nine goals, every one of them a beat on this ribbon."

**2:00–2:45 — Live mode**
Switch to live view (if a covered fixture is live while recording; otherwise demo
mode with the `?demo=1` synthetic match, said honestly):
> "Live, the same engine runs in real time — the terrain grows and the ribbon extends
> with every event from TxLINE's real-time feed. Live and replay are the same pure
> state engine, so the replay you scrub is provably the story you watched."

**2:45–3:30 — How TxLINE + Solana power it (over an architecture slide or terminal)**
> "The backend authenticates on-chain: our service wallet subscribes to TxLINE's
> World Cup tier with a Solana transaction and a wallet-signed activation — that's
> the entitlement layer. Every score event streams in over SSE, folds through a
> deterministic reducer, and persists locally, so replays outlive the feed. And when
> a match hits full time, we write its fingerprint to Solana as an SPL Memo —"
Show tonight's real attestation in explorer.solana.com (already confirmed on-chain):
`https://explorer.solana.com/tx/55kj3fkDswjmruEeeHjAvHcYoxZvzKfUJz1zgFj4UbUct9iLimmBR2hRqB4D7iF58e1iZEfmL9DtsuUannYvSMuK`
> "— a permanent public record of the match story you just watched. Viewers never
> touch a wallet. And by design, Box Seat consumes zero odds data: no betting,
> anywhere."

**3:30–4:15 — Craft + close**
Quick cuts: the match list with real scores, round groupings, and the "on-chain"
attested chips per fixture; the lineups/formation panel with real player photos and
goalscorers; the Match Chatter panel (real X posts, server-moderated, text-only);
the share-card export of tonight's scene (one click, postable PNG); a second scrub
through the 18' blitz; two seconds of the WS contract/tests in an editor.
> "One weekend, one deterministic engine, two ways to experience every match. Box
> Seat — see the match the way the data sees it."
End card: Box Seat · repo URL · built on TxLINE + Solana.

## Checklist before recording
- [x] France–England fully captured — complete authoritative log on disk (1,197
  events, 10/10 goal moments, 51 players with 7 scorers attributed)
- [x] Real attestation signature ready in an explorer tab (link above — the RE-attested
  tx whose fingerprint matches the final reducer; confirmed on mainnet)
- [x] The actual best momentum swings identified: 3'–18' blitz, the retraction,
  48'–54' fightback, 87' penalty, 90+6'/90+8' stoppage-time double
- [x] Frontend polished on the replay path (the video leans hardest on it)
- [ ] Mic check; kill notifications; 1080p+; dark room
- [ ] One full rehearsal, then record; upload; paste link into SUBMISSION-DRAFT.md
