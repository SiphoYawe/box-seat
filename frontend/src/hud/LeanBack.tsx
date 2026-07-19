import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAppStore } from "../state/store.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getTeam } from "../lib/teams.js";
import { deriveClockDisplay } from "../lib/time.js";
import { FINISHED_STATUS_IDS } from "../reducer/types.js";
import { Badge } from "./Badge.js";
import { useNow, useViewState } from "./useViewState.js";

/**
 * Lean-back mode (M): the room-readable scoreboard for watching with friends
 * from the couch. Badges, a huge scoreline, the real clock, match chip, venue.
 * The scene stays dimly alive behind it.
 */
export function LeanBack({ meta }: { meta: FixtureMeta }) {
  const leanBack = useAppStore((s) => s.leanBack);
  const toggle = useAppStore((s) => s.toggleLeanBack);
  const mode = useAppStore((s) => s.match.mode);
  const view = useViewState(250);
  const now = useNow(1000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "m") toggle();
      else if (e.key === "Escape" && useAppStore.getState().leanBack) toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const team1 = getTeam(meta.participant1);
  const team2 = getTeam(meta.participant2);
  const state = view?.state ?? null;
  const finished = state ? FINISHED_STATUS_IDS.has(state.statusId) : false;
  const chipLabel = mode === "replay" ? "REPLAY" : finished ? "FT" : state?.statusId === 1 ? "SCHEDULED" : "LIVE";
  const clock = state?.clock ? (deriveClockDisplay(state.clock)?.text ?? "") : "";

  return (
    <AnimatePresence>
      {leanBack && (
        <motion.div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-ink/88 backdrop-blur-md cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          onClick={toggle}
        >
          <motion.div
            className="flex flex-col items-center gap-[3vh]"
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 200, damping: 22 }}
          >
            <div className="flex items-center gap-[3.5vw]">
              <div className="flex flex-col items-center gap-3">
                <Badge team={team1} size={Math.round(window.innerHeight * 0.2)} ringWidth={4} />
                <span
                  className="font-condensed font-bold uppercase tracking-[0.2em]"
                  style={{ fontSize: "min(3.4vw, 5vh)", color: team1.primary === "#FFFFFF" ? "#E6EAF2" : team1.primary }}
                >
                  {team1.code}
                </span>
              </div>

              <div className="tnum font-condensed font-bold text-white text-center" style={{ fontSize: "min(16vw, 30vh)", lineHeight: 1 }}>
                {state?.score.participant1 ?? 0}
                <span className="text-muted/60 mx-2">-</span>
                {state?.score.participant2 ?? 0}
              </div>

              <div className="flex flex-col items-center gap-3">
                <Badge team={team2} size={Math.round(window.innerHeight * 0.2)} ringWidth={4} />
                <span
                  className="font-condensed font-bold uppercase tracking-[0.2em]"
                  style={{ fontSize: "min(3.4vw, 5vh)", color: team2.primary === "#FFFFFF" ? "#E6EAF2" : team2.primary }}
                >
                  {team2.code}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <span className="tnum font-condensed font-semibold text-text/90" style={{ fontSize: "min(5vw, 9vh)" }}>
                {clock}
              </span>
              <span
                className="font-condensed font-bold uppercase tracking-[0.25em] px-4 py-1.5 rounded-md"
                style={{
                  fontSize: "min(2.6vw, 4.5vh)",
                  background: chipLabel === "LIVE" ? "rgba(227,6,19,0.25)" : "rgba(42,50,66,0.6)",
                  color: chipLabel === "LIVE" ? "#FF4D57" : "#E6EAF2",
                }}
              >
                {chipLabel}
              </span>
            </div>

            <span className="font-condensed font-semibold uppercase tracking-[0.22em] text-muted" style={{ fontSize: "min(2vw, 3.4vh)" }}>
              {meta.competition}
            </span>
            <span className="font-condensed text-muted/60 uppercase tracking-[0.3em]" style={{ fontSize: "min(1.4vw, 2.4vh)" }}>
              M to exit
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
