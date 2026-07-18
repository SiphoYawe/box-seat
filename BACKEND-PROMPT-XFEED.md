# Backend Task Prompt: Live X feed per match (paste to the backend Claude)

You are working on the Box Seat backend (`server/` in this repo). Everything
else is shipped and live: ingestion, reducer, `state`, `replay_chunk`,
`fixture_list` (with `phase`/`hasData`), `fixture_players`, `attestation`.
This is the one remaining feature. Read `docs/frontend/BACKEND-CONTRACT.md`
first (ground truth - update it with the new message when done), then
`server/src/ws/server.ts` and `server/src/index.ts` for the existing message
patterns.

## Goal

A collapsible "Match chatter" panel in the frontend shows recent X posts
about the fixture. The frontend must NEVER call X directly (CORS, auth
secrets in the client, unmoderated content on a public demo). You build the
server-side proxy.

## What to build

1. **Poller**: for every fixture with active subscribers (and at most one
   shared polling loop for all of them), query recent X posts every 60-120s.
   Query per fixture: something like `"<team1 name>" "<team2 name>"`
   (e.g. `Argentina Switzerland`) or a match hashtag. Use whatever X API
   access you already have; do NOT mint new secrets from the frontend.
2. **Moderate server-side** before anything reaches a client:
   - drop posts containing URLs (no link unfurling ever), media-only posts,
     and anything matching a slur/profanity blocklist;
   - English only if you can't moderate other languages confidently;
   - cap text at 280 chars verbatim.
3. **Cache** the newest ~10 accepted posts per fixture in kv with a TTL
   (reuse the existing kv store), so a reconnecting client replays instantly
   without a fresh API call.
4. **WS message** (new type, backward-compatible - unknown types are ignored
   by older clients):

```json
{
  "type": "chatter",
  "fixtureId": 18222446,
  "posts": [
    { "id": "1234567890", "author": "Display Name", "handle": "user",
      "text": "verbatim post text", "ts": 1784400000000, "likes": 42 }
  ]
}
```

Send it on subscribe (after `fixture_players`, cached content is fine) and
again whenever the cached list changes.

5. **Read-only forever**: no posting, liking, retweeting, or any write
   action against X - not now, not later. Also no post images/avatars; the
   frontend renders text rows with an X source label and attribution.

## Notes

- Do NOT touch the shapes of `state`, `replay_chunk`, `fixture_list`,
  `fixture_players`, or `attestation` - the frontend depends on them.
- `docs/frontend/BACKEND-CONTRACT.md` must gain the `chatter` message spec
  when done; the frontend codes against the contract. The frontend panel is
  already designed against the shape above and will be implemented as soon
  as the message exists.
