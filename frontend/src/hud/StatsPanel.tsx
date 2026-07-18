import { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import { getTeam } from "../lib/teams.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getEnrichment, STAT_ROWS } from "../lib/enrichment.js";

/**
 * Collapsible full-match stats drawer (numbers only - no bars, no charts).
 * Data: ESPN enrichment, baked at build time.
 */
export function StatsPanel({ meta }: { meta: FixtureMeta }) {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const [open, setOpen] = useState(false);
  const enrich = getEnrichment(fixtureId);

  if (!enrich) return null;
  const team1 = getTeam(meta.participant1);
  const team2 = getTeam(meta.participant2);
  const rows = STAT_ROWS.filter(
    ([key]) => enrich.stats.participant1[key] != null || enrich.stats.participant2[key] != null
  );
  if (rows.length === 0) return null;

  return (
    <div className="glass rounded-md overflow-hidden pointer-events-auto w-72">
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
          Match stats
        </span>
        {open ? <CaretUp size={13} className="text-muted" /> : <CaretDown size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="px-3 pb-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-condensed font-bold text-sm uppercase w-10" style={{ color: team1.primary === "#FFFFFF" ? "#E6EAF2" : team1.primary }}>
              {team1.code}
            </span>
            <span className="font-condensed font-bold text-sm uppercase w-10 text-right" style={{ color: team2.primary === "#FFFFFF" ? "#E6EAF2" : team2.primary }}>
              {team2.code}
            </span>
          </div>
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between py-1 border-t border-edge/50">
              <span className="tnum text-sm text-text w-10">{enrich.stats.participant1[key] ?? "-"}</span>
              <span className="text-[11px] text-muted uppercase tracking-wider">{label}</span>
              <span className="tnum text-sm text-text w-10 text-right">{enrich.stats.participant2[key] ?? "-"}</span>
            </div>
          ))}
          <div className="text-[9px] text-muted/60 uppercase tracking-widest mt-2">Enrichment: ESPN</div>
        </div>
      )}
    </div>
  );
}
