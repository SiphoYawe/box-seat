import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getEnrichment, type EnrichPlayer } from "../lib/enrichment.js";
import { getTeam } from "../lib/teams.js";
import photosJson from "../data/player-photos.json";

const PHOTOS: Record<string, string> = photosJson as Record<string, string>;

function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
}

/** Split starters into formation lines: GK, then lines per "4-3-3" segments. */
function formationLines(players: EnrichPlayer[], formation: string | null): EnrichPlayer[][] {
  const starters = players.filter((p) => p.starter);
  if (starters.length === 0) return [];
  const segments = (formation ?? "")
    .split("-")
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const lines: EnrichPlayer[][] = [[starters[0]]]; // GK first
  let i = 1;
  if (segments.length > 0) {
    for (const size of segments) {
      const line = starters.slice(i, i + size);
      if (line.length > 0) lines.push(line);
      i += size;
    }
    // leftovers (formation string didn't sum to 10): spread into the last line
    if (i < starters.length) lines.push(starters.slice(i));
  } else {
    // no formation string: group by position bands
    const band = (want: RegExp) => starters.slice(i).filter((p) => want.test(p.position ?? ""));
    const defs = band(/^(d|df|cb|lb|rb|wb)/i);
    const mids = band(/^(m|mf|cm|dm|am|wm)/i);
    const fwds = band(/^(f|fw|st|cf|w)/i);
    for (const line of [defs, mids, fwds]) if (line.length > 0) lines.push(line);
    const used = new Set([...defs, ...mids, ...fwds].map((p) => p.name));
    const rest = starters.slice(1).filter((p) => !used.has(p.name));
    if (rest.length > 0) lines.splice(1, 0, rest);
  }
  return lines;
}

function PlayerChip({ player, primary }: { player: EnrichPlayer; primary: string }) {
  const photo = PHOTOS[player.name];
  return (
    <div className="flex flex-col items-center gap-1 w-14">
      <span
        className="tnum inline-flex items-center justify-center rounded-full font-condensed font-semibold overflow-hidden"
        style={{
          width: 34,
          height: 34,
          background: primary,
          color: "#E6EAF2",
          fontSize: 13,
          border: "1.5px solid rgba(255,255,255,0.25)",
        }}
      >
        {photo ? (
          <img src={import.meta.env.BASE_URL + photo} alt="" width={34} height={34} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          (player.jersey ?? "-")
        )}
      </span>
      <span className="text-[9px] text-text/85 uppercase tracking-wide truncate w-full text-center">
        {shortName(player.name)}
      </span>
    </div>
  );
}

/**
 * Pre-match formation view: both XIs laid out in formation lines, shown in
 * replay while the playhead is near kickoff (auto-hides as the match rolls).
 */
export function FormationOverlay({ meta }: { meta: FixtureMeta }) {
  const mode = useAppStore((s) => s.match.mode);
  const replay = useAppStore((s) => s.match.replay);
  const playheadTs = useAppStore((s) => s.match.playheadTs);
  const legendOpen = useAppStore((s) => s.legendOpen);
  const [dismissed, setDismissed] = useState(false);
  const [pinned, setPinned] = useState(false);

  const enrich = getEnrichment(meta.fixtureId);
  const visible =
    !dismissed &&
    !legendOpen &&
    mode === "replay" &&
    replay != null &&
    enrich != null &&
    (pinned || (playheadTs ?? 0) <= replay.kickoffTs + 30_000);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const lines1 = useMemo(
    () => formationLines(enrich?.rosters.participant1 ?? [], enrich?.rosters.formation1 ?? null),
    [enrich]
  );
  const lines2 = useMemo(
    () => formationLines(enrich?.rosters.participant2 ?? [], enrich?.rosters.formation2 ?? null),
    [enrich]
  );

  if (!enrich || (lines1.length === 0 && lines2.length === 0)) return null;

  const team1 = getTeam(meta.participant1);
  const team2 = getTeam(meta.participant2);

  const renderTeam = (
    lines: EnrichPlayer[][],
    team: ReturnType<typeof getTeam>,
    formation: string | null,
    name: string
  ) => (
    <div className="flex-1 flex flex-col items-center gap-2.5 min-w-0">
      <div
        className="font-condensed font-bold uppercase tracking-widest text-sm"
        style={{ color: team.primary === "#FFFFFF" ? "#E6EAF2" : team.primary }}
      >
        {name}
        {formation ? <span className="text-muted font-semibold"> · {formation}</span> : ""}
      </div>
      <div className="flex flex-col-reverse items-center gap-2.5">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-center gap-2">
            {line.map((p) => (
              <PlayerChip key={p.name} player={p} primary={team.primary} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-0 z-30 flex items-center justify-center bg-ink/45 backdrop-blur-[2px] cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setDismissed(true)}
        >
          <motion.div
            className="glass rounded-xl px-6 py-5 max-w-2xl w-[min(92vw,640px)] pointer-events-auto"
            initial={{ scale: 0.94, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
                Starting formations
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  className={`font-condensed font-semibold text-[10px] uppercase tracking-widest px-2 py-1 rounded cursor-pointer transition-colors ${
                    pinned ? "bg-white/15 text-text" : "text-muted hover:bg-white/10"
                  }`}
                  onClick={() => setPinned((v) => !v)}
                  title="Keep visible past kickoff"
                >
                  Pin
                </button>
                <button
                  className="w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer text-muted"
                  onClick={() => setDismissed(true)}
                  aria-label="Dismiss formations"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div className="flex gap-5">
              {renderTeam(lines1, team1, enrich.rosters.formation1, meta.participant1)}
              <div className="w-px bg-edge/60 self-stretch" />
              {renderTeam(lines2, team2, enrich.rosters.formation2, meta.participant2)}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
