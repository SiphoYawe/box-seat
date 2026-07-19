# Demo Video: Script & Shot List (≤5:00)

Judges watch this video more than they touch the app: the matches end before judging
starts. Target 4:00 to 4:30. Loom or QuickTime plus a mic, 1080p or better, one full
rehearsal first. Dark room. Talk faster than feels natural; cut harder than feels
safe. If you can lay a low crowd-noise bed under the replay sections, do it.

**The hero asset:** France 4-6 England, third place play-off, 2026-07-18, Hard Rock
Stadium, fixtureId `18257865`. Ten goals, a disallowed goal, an 87' penalty,
stoppage-time goals at both ends. The maddest match of the tournament, and you own
every second of it as data.

## Structure

**0:00-0:15 · COLD OPEN (no intro, no logo, straight into the chaos)**
Start already scrubbing: the ribbon whipping through the stoppage-time double, goal
takeover slamming in full screen, crowd bed rising.
> "Ninety-sixth minute. France score. Four-five. Ninety seconds later England answer.
> Four-six. Ten goals. Last night's bronze final was the maddest game of this World
> Cup, and I captured every second of it as data."

**0:15-0:40 · The reveal**
Cut to the full scene, slow orbit: pitch, twin pressure terrains glowing, ribbon
threading through goal rings, the penalty beacon.
> "This is Box Seat. A real pitch. Pressure rises as glowing terrain over the zones
> each team threatens. The ribbon is the match: time flows along it and bends toward
> whoever is on top. You can feel momentum in a stadium. Here, you can see it."

**0:40-1:50 · Ride the story (pace this like a highlight reel)**
Scrub hard between beats. Let takeovers hit at full volume.
- **The blitz.** Playhead to 15'. "Three England goals in eighteen minutes. Watch
  their terrain swallow France's third. That's a blitz, drawn live." 18' takeover
  slams in; goal-cam swings behind the goal line.
- **The retraction.** "Then the referee chalks one off. Watch the timeline. The goal
  retracts itself. The feed corrected, so the story corrected. This app cannot show
  you a goal that never counted."
- **The fightback.** "Second half, the game flips. Two France goals in six minutes,
  the ribbon bends back, and the story chip calls it: France camping in England's
  third." 54' takeover, scorer photo on the card.
- **The penalty.** "England's fifth, from the spot, eighty-seventh minute." Beacon
  pulse, takeover.
- **The finale.** "Then the ending you already saw. Ten goals. Every one of them a
  beat on this ribbon you can scrub, forever."

**1:50-2:25 · Live mode**
If any covered fixture is live while recording, show it; otherwise `?demo=1` and say
so on camera. (Tonight's final kicks off at 8PM UK: recording during it turns this
section into the real thing.)
> "And this is the part that matters: replay and live are the same engine. Live, the
> terrain grows and the ribbon extends with every event off TxLINE's real-time feed.
> The replay you scrub is the story you watched. Same code, same math, provable."

**2:25-3:15 · TxLINE + Solana (over the app's proof panel, not a slide)**
Open the on-chain proof panel, then the explorer tab:
`https://explorer.solana.com/tx/55kj3fkDswjmruEeeHjAvHcYoxZvzKfUJz1zgFj4UbUct9iLimmBR2hRqB4D7iF58e1iZEfmL9DtsuUannYvSMuK`
> "Under the hood: our service wallet subscribes to TxLINE's World Cup tier with a
> Solana transaction. Score events stream in, fold through a deterministic reducer,
> persist locally. And at full time, the backend fingerprints the final match state
> and writes it to Solana mainnet. This transaction is that fingerprint. The app
> checks its own replay against it: REPLAY VERIFIED. You watched the real story, and
> the chain can prove it. No wallet needed to watch. Zero odds data consumed. No
> betting anywhere, by design."

**3:15-4:00 · Rapid-fire craft + close (two-second cuts)**
Match list with real scores and on-chain chips on all thirteen finished matches.
Lineups with player photos and scorers. Match Chatter: real X posts, server-moderated.
Share-card export, one click. One last rip through the blitz. One second of the test
suite: 81 green.
> "One weekend. Every knockout match of this World Cup, captured, verified, and
> replayable in 3D. Box Seat: see the match the way the data sees it."
End card: Box Seat · siphoyawe.github.io/box-seat · built on TxLINE + Solana.

## Checklist before recording
- [x] France-England captured in full: 1,197 events, 10/10 goal moments, 51 players,
  7 scorers attributed
- [x] Attestation open in an explorer tab (the re-attested tx; fingerprint matches
  the final reducer)
- [x] Beats chosen: blitz, retraction, fightback, penalty, stoppage-time pair
- [x] Replay path polished
- [ ] Mic check, notifications off, 1080p+, dark room, crowd bed ready (optional)
- [ ] One rehearsal at full speed, record, upload, paste the link into
  SUBMISSION-DRAFT.md
