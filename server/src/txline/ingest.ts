import { EventSource } from "eventsource";
import { API_BASE_URL } from "./config.js";
import { renewJwt, type TxLineSession } from "./auth.js";
import type { RawScoreEvent } from "../reducer/types.js";

export type ScoreEventHandler = (event: RawScoreEvent) => void;

/**
 * Parses a raw TxLINE scores SSE payload into our RawScoreEvent shape.
 * See docs/txline/scores/soccer-feed.md and the Scores Product API PDF for the
 * full raw message shape (FixtureInfo + Update.{Action,StatusId,Participant,Data}).
 */
function parseScoresPayload(raw: string): RawScoreEvent | null {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[TxLINE] Unparseable scores payload:", raw.slice(0, 200));
    return null;
  }

  const update = parsed.Update;
  if (!update) {
    console.warn("[TxLINE] Unparseable scores payload:", raw.slice(0, 200));
    return null;
  }

  const fixtureId = update.FixtureId ?? parsed.FixtureInfo?.FixtureId;
  if (fixtureId === undefined || fixtureId === null) {
    console.warn("[TxLINE] Unparseable scores payload:", raw.slice(0, 200));
    return null;
  }

  // Ts/Seq back NOT NULL DB columns (see store/eventLog.ts) — reject payloads
  // missing either rather than letting the insert throw downstream.
  if (update.Ts === undefined || update.Ts === null || update.Seq === undefined || update.Seq === null) {
    console.warn("[TxLINE] Unparseable scores payload:", raw.slice(0, 200));
    return null;
  }

  return {
    fixtureId,
    action: update.Action,
    statusId: update.StatusId,
    participant: update.Participant,
    data: update.Data,
    ts: update.Ts,
    seq: update.Seq,
  };
}

/**
 * Opens a persistent connection to TxLINE's /scores/stream and invokes `onEvent`
 * for every parsed message. Handles JWT renewal on 401/403 automatically, matching
 * the pattern in docs/txline/reference-code/mainnet/scripts/subscription_free_tier.ts.
 */
export function connectScoresStream(
  session: TxLineSession,
  onEvent: ScoreEventHandler,
  onAuthDeath?: () => void
): EventSource {
  const streamUrl = `${API_BASE_URL}/scores/stream`;
  let currentJwt = session.jwt;

  const eventSource = new EventSource(streamUrl, {
    fetch: async (input: any, init: any) => {
      const attempt = (jwt: string) =>
        fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            "Accept-Encoding": "gzip",
            Authorization: `Bearer ${jwt}`,
            "X-Api-Token": session.apiToken,
          },
        });

      let response = await attempt(currentJwt);
      if (response.status === 401 || response.status === 403) {
        console.log("[TxLINE] Scores stream JWT rejected, renewing...");
        currentJwt = await renewJwt();
        response = await attempt(currentJwt);
        if (response.status === 401 || response.status === 403) {
          // eventsource v4 treats a non-200 Response as fatal (failConnection,
          // readyState CLOSED, never retries). Throwing instead routes this
          // through eventsource's auto-retry path so the stream can recover
          // once the auth problem clears.
          onAuthDeath?.();
          throw new Error(
            `[TxLINE] Scores stream auth rejected twice (status ${response.status}) — will retry`
          );
        }
      }
      return response;
    },
  });

  eventSource.onmessage = (evt: MessageEvent) => {
    const parsed = parseScoresPayload(evt.data);
    if (parsed) onEvent(parsed);
  };

  eventSource.onerror = (err: unknown) => {
    console.error("[TxLINE] Scores stream error:", err);
  };

  return eventSource;
}
