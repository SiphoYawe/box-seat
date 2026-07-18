import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAppStore } from "../state/store.js";
import { getTeam } from "../lib/teams.js";
import type { FixtureMeta } from "../lib/meta.js";
import { deriveClockDisplay } from "../lib/time.js";
import { FINISHED_STATUS_IDS } from "../reducer/types.js";
import { Badge } from "./Badge.js";
import { useNow, useViewState } from "./useViewState.js";

/** White or near-black text on a team-primary block, by luminance. */
function contrastText(hex: string): string {
  const c = parseInt(hex.slice(1), 16);
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#05070C" : "#E6EAF2";
}

function RollingDigit({ value }: { value: number }) {
  return (
    <span className="relative inline-block overflow-hidden" style={{ width: "0.62em", height: "1.05em" }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ y: "105%" }}
          animate={{ y: 0 }}
          exit={{ y: "-105%" }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function CodeBlock({ name }: { name: string }) {
  const team = getTeam(name);
  return (
    <span
      className="font-condensed font-semibold uppercase flex items-center justify-center px-2.5 h-full"
      style={{
        background: team.primary,
        color: contrastText(team.primary),
        fontSize: 17,
        letterSpacing: "0.06em",
      }}
    >
      {team.code}
    </span>
  );
}

/**
 * Top-left broadcast scorebug: badges, code blocks in team primaries, the
 * authoritative score with rolling digits, the real game clock (state.clock,
 * ticked locally while running), LIVE / REPLAY / FT chip. participant1 is
 * always the left slot (they attack screen-right in the default camera).
 */
export function Scorebug({ meta }: { meta: FixtureMeta }) {
  const mode = useAppStore((s) => s.match.mode);
  const latest = useAppStore((s) => s.match.latest);
  const latestReceivedAt = useAppStore((s) => s.match.latestReceivedAt);
  const replay = useAppStore((s) => s.match.replay);
  const playheadTs = useAppStore((s) => s.match.playheadTs);
  const view = useViewState(200);
  const now = useNow(500);

  const team1 = getTeam(meta.participant1);
  const team2 = getTeam(meta.participant2);
  const state = view?.state ?? null;
  const statusId = state?.statusId ?? 1;
  const finished = FINISHED_STATUS_IDS.has(statusId);

  let clock = "";
  let chip: { label: string; kind: "live" | "replay" | "ft" | "sched" };

  if (mode === "replay") {
    chip = { label: "REPLAY", kind: "replay" };
    clock = deriveClockDisplay(state?.clock ?? null)?.text ?? "--:--";
  } else if (finished) {
    chip = { label: "FT", kind: "ft" };
    clock = "FT";
  } else if (statusId === 1 && meta.startTime != null && meta.startTime > now) {
    chip = { label: "SCHEDULED", kind: "sched" };
    clock = formatLocalTime(meta.startTime);
  } else {
    chip = { label: "LIVE", kind: "live" };
    // the feed's seconds counts down; advance it locally while running
    const tickMs = latestReceivedAt ? now - latestReceivedAt : 0;
    clock = deriveClockDisplay(latest?.clock ?? null, tickMs)?.text ?? "--:--";
  }

  const s1 = state?.score.participant1 ?? 0;
  const s2 = state?.score.participant2 ?? 0;

  // shootout scoreline: penalty_outcome events at or before the playhead,
  // deduped by action id (the feed re-sends kicks across confirm updates)
  const pens = useMemo(() => {
    if (mode !== "replay" || !replay) return null;
    const ph = playheadTs ?? replay.endTs;
    const seen = new Set<number>();
    let p1 = 0;
    let p2 = 0;
    for (const e of replay.events) {
      if (e.action !== "penalty_outcome" || e.ts > ph) continue;
      const key = e.id ?? e.seq;
      if (seen.has(key)) continue;
      seen.add(key);
      if ((e.data?.Outcome as string | undefined) !== "Scored") continue;
      if (e.participant === 1) p1 += 1;
      else if (e.participant === 2) p2 += 1;
    }
    return seen.size > 0 ? { p1, p2 } : null;
  }, [mode, replay, playheadTs]);

  return (
    <div className="flex items-stretch gap-2 pointer-events-auto">
      <div className="glass flex items-stretch h-12 rounded-md overflow-hidden">
        <div className="flex items-center pl-2.5 pr-1">
          <Badge team={team1} size={30} />
        </div>
        <CodeBlock name={meta.participant1} />
        <div className="tnum font-condensed font-bold flex items-center gap-1 px-3 text-2xl tracking-wide">
          <RollingDigit value={s1} />
          <span className="text-muted text-xl pb-0.5">-</span>
          <RollingDigit value={s2} />
        </div>
        <CodeBlock name={meta.participant2} />
        <div className="flex items-center pr-2.5 pl-1">
          <Badge team={team2} size={30} />
        </div>
      </div>

      <div className="glass rounded-md h-12 px-3 flex items-center">
        <span className="tnum font-condensed font-semibold text-xl tracking-wide">{clock}</span>
      </div>

      <div className="glass rounded-md h-12 px-3 flex items-center gap-2">
        {chip.kind === "live" && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-live" />
          </span>
        )}
        <span
          className="font-condensed font-semibold text-sm uppercase tracking-widest"
          style={{ color: chip.kind === "live" ? "#FF4D57" : chip.kind === "sched" ? "#8A93A6" : "#E6EAF2" }}
        >
          {chip.label}
        </span>
      </div>

      {pens && (
        <div className="glass rounded-md h-12 px-3 flex items-center gap-2">
          <span className="font-condensed font-semibold text-xs uppercase tracking-widest text-muted">
            Pens
          </span>
          <span className="tnum font-condensed font-bold text-xl">
            {pens.p1} - {pens.p2}
          </span>
        </div>
      )}
    </div>
  );
}

function formatLocalTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
