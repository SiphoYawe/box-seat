import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getTeam, getTeamGlow } from "../lib/teams.js";
import {
  formatMinute,
  livePlayMinutes,
  minuteLabel,
  playMinutesAt,
} from "../lib/time.js";
import { clockAnchor } from "../scene/sceneUtils.js";
import { frameAt } from "../lib/reconstruct.js";
import { FINISHED_STATUS_IDS, type MatchState } from "../reducer/types.js";
import { getEnrichment, scorerFor } from "../lib/enrichment.js";
import { deriveClockDisplay } from "../lib/time.js";
import { useNow, useViewState } from "./useViewState.js";
import photosJson from "../data/player-photos.json";

const PHOTOS: Record<string, string> = photosJson as Record<string, string>;

interface LogRow {
  id: string;
  minute: string;
  sortTs: number;
  kind: "goal" | "red_card" | "var" | "whistle" | "yellow" | "sub" | "corner" | "shot" | "woodwork";
  label: string;
  color?: string;
  photo?: string;
}

function Shape({ kind, color }: { kind: LogRow["kind"]; color?: string }) {
  const c = color ?? "#8A93A6";
  if (kind === "goal") {
    return <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: c, boxShadow: `0 0 6px ${c}` }} />;
  }
  if (kind === "red_card") {
    return <span className="inline-block rounded-[1px]" style={{ width: 8, height: 11, background: "#E30613", boxShadow: "0 0 6px rgba(227,6,19,0.7)" }} />;
  }
  if (kind === "yellow") {
    return <span className="inline-block rounded-[1px]" style={{ width: 8, height: 11, background: "#F7D117", boxShadow: "0 0 6px rgba(247,209,23,0.6)" }} />;
  }
  if (kind === "var" || kind === "woodwork") {
    return <span className="inline-block" style={{ width: 9, height: 9, background: "#FFB300", transform: "rotate(45deg)", boxShadow: "0 0 6px rgba(255,179,0,0.6)" }} />;
  }
  if (kind === "corner") {
    return (
      <span
        className="inline-block"
        style={{
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `8px solid ${c}`,
        }}
      />
    );
  }
  if (kind === "shot") {
    return <span className="inline-block rounded-full" style={{ width: 8, height: 8, border: `1.5px solid ${c}` }} />;
  }
  if (kind === "sub") {
    return (
      <span className="inline-flex flex-col items-center" style={{ gap: 1 }}>
        <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: "5px solid #7FB3D5" }} />
        <span style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "5px solid #7FB3D5" }} />
      </span>
    );
  }
  return <span className="inline-block rounded-full" style={{ width: 7, height: 7, border: "1.5px solid #8A93A6" }} />;
}

/**
 * Right-edge event log: last ~8 key events, newest on top, older rows fading.
 * Row minutes come from the real game clock (per-frame clock readings in
 * replay, kickoff-anchored estimate live). Replay shows only rows at or
 * before the playhead.
 */
export function EventLog({ meta }: { meta: FixtureMeta }) {
  const mode = useAppStore((s) => s.match.mode);
  const replay = useAppStore((s) => s.match.replay);
  const playheadTs = useAppStore((s) => s.match.playheadTs);
  const view = useViewState(250);
  const now = useNow(1000);
  const [open, setOpen] = useState(true);

  const rows = useMemo(() => {
    const state = view?.state;
    const anchor = clockAnchor();
    if (!state || !anchor) return [];
    const out: LogRow[] = [];

    const clockMinuteOf = (ts: number): string => {
      if (mode === "replay" && replay) {
        const label = minuteLabel(frameAt(replay.frames, ts)?.state.clock ?? null);
        if (label) return label;
      }
      return formatMinute(
        mode === "replay" ? playMinutesAt(ts, anchor) : livePlayMinutes(ts, anchor.kickoffTs)
      );
    };
    const stateClockMinute = (): string | null => minuteLabel(state.clock);

    const push = (id: string, minute: string, sortTs: number, kind: LogRow["kind"], label: string, color?: string, photo?: string) =>
      out.push({ id, minute, sortTs, kind, label, color, photo });

    const finished = FINISHED_STATUS_IDS.has(state.statusId);
    if (finished) {
      push("ft", stateClockMinute() ?? "90'", state.lastTs, "whistle", "FULL TIME");
    }

    for (const km of state.keyMoments) {
      const teamName = km.participant === 1 ? meta.participant1 : meta.participant2;
      const team = getTeam(teamName);
      const minute = clockMinuteOf(km.ts);
      if (km.type === "goal") {
        let scorer: string | null = null;
        if (mode === "replay" && replay) {
          const frame = frameAt(replay.frames, km.ts);
          const mf = frame?.state.clock ? (deriveClockDisplay(frame.state.clock)?.minuteFloat ?? null) : null;
          scorer = scorerFor(getEnrichment(meta.fixtureId), km.participant, mf);
        }
        push(
          `g${km.seq}`,
          minute,
          km.ts,
          "goal",
          `GOAL ${teamName}${scorer ? ` · ${scorer}` : ""}`,
          getTeamGlow(team),
          scorer ? PHOTOS[scorer] : undefined
        );
      }
      else if (km.type === "red_card") push(`r${km.seq}`, minute, km.ts, "red_card", `RED CARD ${teamName}`, "#E30613");
      else {
        // replay: label the review type from the preceding `var` action row
        let suffix = "";
        if (mode === "replay" && replay) {
          const review = [...replay.events]
            .reverse()
            .find((e) => e.action === "var" && e.ts <= km.ts);
          const type = review?.data?.Type as string | undefined;
          if (type) suffix = ` (${type.replace(/([A-Z])/g, " $1").trim().toUpperCase()})`;
        }
        push(`v${km.seq}`, minute, km.ts, "var", `VAR OVERTURNED ${teamName}${suffix}`, "#FFB300");
      }
    }

    const htTs = mode === "replay" ? replay?.halftimeTs : null;
    const showHt =
      (htTs != null && (playheadTs ?? 0) >= htTs) ||
      (mode === "live" && !finished && state.statusId !== 1 && state.statusId >= 3);
    if (showHt) {
      const htMinute = htTs != null ? clockMinuteOf(htTs) : "45'";
      push("ht", htMinute === "HT" ? "45'" : htMinute, htTs ?? anchor.kickoffTs + 46 * 60000, "whistle", "HALF TIME");
    }
    push("ko", "1'", anchor.kickoffTs, "whistle", "KICK OFF");

    // replay-only enrichment from the raw event log (live mode never sees
    // these - the asymmetry is honest, not a gap)
    if (mode === "replay" && replay) {
      const playhead = playheadTs ?? replay.endTs;
      const teamOf = (p: number | undefined) => {
        const name = p === 1 ? meta.participant1 : p === 2 ? meta.participant2 : null;
        return name ? { name, team: getTeam(name) } : null;
      };
      const seenPens = new Set<number>();
      for (const e of replay.events) {
        if (e.ts > playhead) continue;
        const p = e.participant ?? (e.data?.Participant as number | undefined);
        const t = teamOf(p);
        const minute = clockMinuteOf(e.ts);
        const glow = t ? getTeamGlow(t.team) : undefined;
        if (e.action === "penalty_outcome") {
          const key = e.id ?? e.seq;
          if (seenPens.has(key)) continue;
          seenPens.add(key);
        }
        switch (e.action) {
          case "yellow_card":
            push(`y${e.seq}`, minute, e.ts, "yellow", `YELLOW CARD ${t?.name ?? ""}`.trim(), "#F7D117");
            break;
          case "substitution":
            push(`s${e.seq}`, minute, e.ts, "sub", `SUBSTITUTION ${t?.name ?? ""}`.trim(), "#7FB3D5");
            break;
          case "injury":
            push(`i${e.seq}`, minute, e.ts, "whistle", "INJURY STOPPAGE");
            break;
          case "additional_time": {
            const mins = e.data?.Minutes as number | undefined;
            push(`at${e.seq}`, minute, e.ts, "whistle", mins ? `${mins} MIN ADDED TIME` : "ADDED TIME");
            break;
          }
          case "corner":
            push(`c${e.seq}`, minute, e.ts, "corner", `CORNER ${t?.name ?? ""}`.trim(), glow);
            break;
          case "shot": {
            const outcome = (e.data?.Outcome ?? e.data?.outcome) as string | undefined;
            if (outcome === "Woodwork") {
              push(`w${e.seq}`, minute, e.ts, "woodwork", `OFF THE WOODWORK ${t?.name ?? ""}`.trim(), "#FFB300");
            } else if (outcome === "OnTarget" || outcome === "Blocked" || outcome === "OffTarget") {
              const suffix = outcome === "OffTarget" ? " (OFF TARGET)" : outcome === "Blocked" ? " (BLOCKED)" : "";
              push(`sh${e.seq}`, minute, e.ts, "shot", `SHOT ${t?.name ?? ""}${suffix}`.trim(), glow);
            }
            break;
          }
          case "penalty":
            // a penalty awarded in open play (shootout kicks are penalty_outcome)
            push(`p${e.seq}`, minute, e.ts, "var", `PENALTY ${t?.name ?? ""}`.trim(), "#FFB300");
            break;
          case "penalty_outcome": {
            const scored = (e.data?.Outcome as string | undefined) === "Scored";
            push(
              `po${e.seq}`,
              "PENS",
              e.ts,
              scored ? "goal" : "red_card",
              `PENALTY ${scored ? "SCORED" : "MISSED"} ${t?.name ?? ""}`.trim(),
              scored ? glow : "#E30613"
            );
            break;
          }
          case "penalty_shootout_team":
            if (!out.some((r) => r.id === "pst")) push("pst", "PENS", e.ts, "whistle", "PENALTY SHOOTOUT");
            break;
          default:
            break;
        }
      }
    }

    return out.sort((a, b) => b.sortTs - a.sortTs).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, replay, playheadTs, now, meta]);

  return (
    <div className="glass rounded-md overflow-hidden pointer-events-auto w-56">
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
          Event log
        </span>
        {open ? <CaretUp size={13} className="text-muted" /> : <CaretDown size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 flex flex-col gap-1.5">
          {rows.length === 0 && <span className="text-muted text-xs py-1">No events yet</span>}
          {rows.map((row, i) => {
            const minuteColor =
              row.kind === "goal"
                ? (row.color ?? "#E6EAF2")
                : row.kind === "yellow"
                  ? "#F7D117"
                  : row.kind === "red_card"
                    ? "#FF4D57"
                    : row.kind === "var" || row.kind === "woodwork"
                      ? "#FFB300"
                      : "#8A93A6";
            return (
              <motion.div
                key={row.id}
                className="flex items-center gap-2.5"
                style={{ opacity: 1 - Math.min(i, 6) * 0.11 }}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1 - Math.min(i, 6) * 0.11, x: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <span
                  className="tnum text-[11px] font-semibold w-9 shrink-0 text-right"
                  style={{ color: minuteColor }}
                >
                  {row.minute}
                </span>
                <span className="w-3.5 flex items-center justify-center shrink-0">
                  <Shape kind={row.kind} color={row.color} />
                </span>
                {row.photo && (
                  <img
                    src={`/${row.photo}`}
                    alt=""
                    className="rounded-full object-cover shrink-0"
                    style={{ width: 18, height: 18, border: "1px solid rgba(255,255,255,0.35)" }}
                  />
                )}
                <span
                  className="font-condensed font-semibold text-sm uppercase tracking-wide truncate"
                  style={{ color: row.kind === "whistle" ? "#8A93A6" : (row.color ?? "#E6EAF2") }}
                >
                  {row.label}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
