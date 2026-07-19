import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ShieldCheck } from "@phosphor-icons/react";
import { useAppStore, type FixtureListEntry } from "../state/store.js";
import { socket } from "../lib/ws.js";
import { getTeam } from "../lib/teams.js";
import { stageOf } from "../lib/meta.js";
import { solscanTxUrl } from "../lib/solanaVerify.js";
import { Badge } from "../hud/Badge.js";
import logoUrl from "../assets/box-seat-logo.svg";

const SUBSCRIBE_WINDOW_MS = 6 * 60 * 60 * 1000;

function formatKickoff(ms: number | null): string {
  if (ms == null) return "TBD";
  const d = new Date(ms);
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

function FixtureCard({ entry, query, index }: { entry: FixtureListEntry; query: string; index: number }) {
  const team1 = getTeam(entry.participant1);
  const team2 = getTeam(entry.participant2);
  const liveState = useAppStore((s) => s.listStates[entry.fixtureId]);
  const live = entry.phase === "live";
  const upcoming = entry.phase === "upcoming";
  // hasData false: the 0-0 is meaningless - never display it
  const showScore = !upcoming && entry.hasData;
  const score = liveState?.score ?? entry.score;
  const clickable = upcoming || entry.hasData;

  const middle = upcoming ? (
    <>
      <div className="font-condensed font-semibold text-sm text-muted uppercase tracking-widest">
        vs
      </div>
      <div className="font-condensed font-semibold text-[11px] uppercase tracking-widest mt-1 text-text/80">
        {formatKickoff(entry.startTime)}
      </div>
    </>
  ) : showScore ? (
    <>
      <div className="tnum font-condensed font-bold text-4xl leading-none">
        {score.participant1} - {score.participant2}
      </div>
      <div
        className="font-condensed font-semibold text-[11px] uppercase tracking-widest mt-1.5"
        style={{ color: live ? "#FF4D57" : "#8A93A6" }}
      >
        {live ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-live" />
            </span>
            Live
          </span>
        ) : (
          "Full time"
        )}
      </div>
    </>
  ) : (
    <div className="font-condensed font-semibold text-sm text-muted uppercase tracking-widest">
      FT
    </div>
  );

  const body = (
    <>
      <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
        <span className="font-condensed font-semibold text-xl uppercase tracking-wide truncate">
          {entry.participant1}
        </span>
        <Badge team={team1} size={38} />
      </div>
      <div className="w-28 shrink-0 text-center">{middle}</div>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Badge team={team2} size={38} />
        <span className="font-condensed font-semibold text-xl uppercase tracking-wide truncate">
          {entry.participant2}
        </span>
      </div>
    </>
  );

  const style = {
    background: `linear-gradient(100deg, ${team1.primary}2E 0%, rgba(10,14,20,0.9) 42%, rgba(10,14,20,0.9) 58%, ${team2.primary}2E 100%)`,
  };

  const attestedDot = entry.attestation ? (
    <a
      href={solscanTxUrl(entry.attestation.txSig, entry.attestation.cluster)}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="absolute top-2.5 right-3 flex items-center gap-1 text-[#2ECC71] hover:text-[#7BE3A8] transition-colors"
      title="Attested on Solana - view on Solscan"
    >
      <ShieldCheck size={13} weight="fill" />
      <span className="font-condensed font-semibold text-[9px] uppercase tracking-widest">On-chain</span>
    </a>
  ) : null;

  const content = !clickable ? (
    <div
      className="rounded-xl flex items-center gap-4 px-5 py-4 border border-edge opacity-45 cursor-default select-none relative"
      style={style}
      title="No data coverage for this match"
    >
      {body}
      {attestedDot}
    </div>
  ) : (
    <Link
      to={`/match/${entry.fixtureId}${query}`}
      className="rounded-xl flex items-center gap-4 px-5 py-4 border hover:border-white/25 active:scale-[0.99] transition-all overflow-hidden relative"
      style={{
        ...style,
        borderColor: live ? "rgba(227,6,19,0.45)" : undefined,
        boxShadow: live ? "0 0 24px rgba(227,6,19,0.14), inset 0 0 18px rgba(227,6,19,0.05)" : undefined,
      }}
    >
      {body}
      {attestedDot}
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.6), ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
}

/** stage label -> display group, in screen order */
const ROUND_GROUPS = [
  "Final",
  "Third place play-off",
  "Semi-finals",
  "Quarter-finals",
  "Round of 16",
  "Round of 32",
  "Other fixtures",
] as const;

function roundGroup(fixtureId: number): (typeof ROUND_GROUPS)[number] {
  const stage = stageOf(fixtureId);
  if (stage === "Semi-final") return "Semi-finals";
  if (stage === "Quarter-final") return "Quarter-finals";
  if (stage === "Round of 16") return "Round of 16";
  if (stage === "Round of 32") return "Round of 32";
  if (stage === "Third place play-off") return "Third place play-off";
  if (stage === "Final") return "Final";
  return "Other fixtures";
}

/**
 * Entry point: real fixtures from the backend's `fixture_list`, grouped by
 * round, team-color identity cards. Subscribes to fixtures kicking off within
 * +/- 6h so live cards tick.
 */
export function MatchList() {
  const fixtures = useAppStore((s) => s.fixtures);
  const [searchParams] = useSearchParams();
  const query = searchParams.get("demo") === "1" ? "?demo=1" : "";

  useEffect(() => {
    socket.connect();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const nearby = fixtures.filter(
      (f) =>
        f.phase !== "finished" &&
        f.startTime != null &&
        Math.abs(f.startTime - now) <= SUBSCRIBE_WINDOW_MS
    );
    for (const f of nearby) socket.subscribe(f.fixtureId);
    return () => {
      for (const f of nearby) socket.unsubscribe(f.fixtureId);
    };
  }, [fixtures]);

  const { live, byRound } = useMemo(() => {
    const live: FixtureListEntry[] = [];
    const byRound = new Map<string, FixtureListEntry[]>();
    for (const entry of fixtures) {
      // server-computed phase is the only classification (contract)
      if (entry.phase === "live") {
        live.push(entry);
        continue;
      }
      const group = roundGroup(entry.fixtureId);
      const arr = byRound.get(group) ?? [];
      arr.push(entry);
      byRound.set(group, arr);
    }
    const byStart = (a: FixtureListEntry, b: FixtureListEntry) =>
      (a.startTime ?? 0) - (b.startTime ?? 0);
    live.sort(byStart);
    for (const arr of byRound.values()) arr.sort((a, b) => byStart(b, a));
    return { live, byRound };
  }, [fixtures]);

  return (
    <div className="min-h-[100dvh] bg-ink text-text">
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-16">
        <header className="mb-10">
          <h1 className="leading-none">
            <img
              src={logoUrl}
              alt="Box Seat"
              className="h-10 md:h-12 w-auto"
              style={{ maxWidth: "100%" }}
            />
          </h1>
          <p className="text-muted mt-2 text-sm">
            The 2026 World Cup, rendered as a living pitch. Pick a match.
          </p>
        </header>

        {fixtures.length === 0 && (
          <div className="glass rounded-lg px-6 py-8 text-center text-muted text-sm">
            Connecting for the fixture list
          </div>
        )}

        <div className="flex flex-col gap-9">
          {live.length > 0 && (
            <section>
              <h2 className="font-condensed font-semibold text-xs uppercase tracking-[0.22em] text-muted mb-3">
                Live now
              </h2>
              <div className="flex flex-col gap-3">
                {live.map((entry, i) => (
                  <FixtureCard key={entry.fixtureId} entry={entry} query={query} index={i} />
                ))}
              </div>
            </section>
          )}

          {ROUND_GROUPS.map((group, gi) => {
            const entries = byRound.get(group);
            if (!entries || entries.length === 0) return null;
            return (
              <section key={group}>
                <h2 className="font-condensed font-semibold text-xs uppercase tracking-[0.22em] text-muted mb-3">
                  {group}
                </h2>
                <div className="flex flex-col gap-3">
                  {entries.map((entry, i) => (
                    <FixtureCard key={entry.fixtureId} entry={entry} query={query} index={gi * 2 + i} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
