import { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import { getTeam } from "../lib/teams.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getEnrichment } from "../lib/enrichment.js";

import photosJson from "../data/player-photos.json";

const PHOTOS: Record<string, string> = photosJson as Record<string, string>;

function NumberChip({
  jersey,
  primary,
  text,
  name,
}: {
  jersey: string | null;
  primary: string;
  text: string;
  name?: string;
}) {
  const photo = name ? PHOTOS[name] : undefined;
  return (
    <span
      className="tnum inline-flex items-center justify-center rounded-full shrink-0 font-condensed font-semibold overflow-hidden"
      style={{ width: 22, height: 22, background: primary, color: text, fontSize: 11 }}
    >
      {photo ? (
        <img src={import.meta.env.BASE_URL + photo} alt="" width={22} height={22} className="w-full h-full object-cover" loading="lazy" />
      ) : (
        (jersey ?? "-")
      )}
    </span>
  );
}

function contrastText(hex: string): string {
  const c = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
  return lum > 0.55 ? "#05070C" : "#E6EAF2";
}

interface RosterPlayer {
  key: string;
  jersey: string | null;
  name: string;
  starter: boolean;
  goals: number;
  subbedIn: boolean;
  subbedOut: boolean;
}

/**
 * Right-edge lineups panel: starters (formation order) then subs, jersey
 * roundels in team colors, goal tallies in amber, formation label. Prefers
 * backend player metadata; falls back to the baked ESPN enrichment.
 */
export function LineupPanel({ meta }: { meta: FixtureMeta }) {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const backendPlayers = useAppStore((s) => (fixtureId != null ? s.players[fixtureId] : undefined));
  const [open, setOpen] = useState(true);

  const enrich = getEnrichment(fixtureId);
  const byTeam = (p: 1 | 2): RosterPlayer[] => {
    if (backendPlayers && backendPlayers.length > 0) {
      return backendPlayers
        .filter((pl) => pl.participant === p)
        .map((pl) => ({
          key: String(pl.id),
          jersey: pl.number ?? null,
          name: pl.name,
          starter: Boolean(pl.starter),
          goals: pl.goals ?? 0,
          subbedIn: false,
          subbedOut: false,
        }));
    }
    const roster = p === 1 ? enrich?.rosters.participant1 : enrich?.rosters.participant2;
    return (roster ?? []).map((pl) => ({
      key: pl.name,
      jersey: pl.jersey,
      name: pl.name,
      starter: pl.starter,
      goals: 0,
      subbedIn: pl.subbedIn,
      subbedOut: pl.subbedOut,
    }));
  };

  const list1 = byTeam(1);
  const list2 = byTeam(2);
  if (list1.length === 0 && list2.length === 0) return null;

  const formation = (p: 1 | 2) =>
    (p === 1 ? enrich?.rosters.formation1 : enrich?.rosters.formation2) ?? null;

  const renderTeam = (p: 1 | 2, name: string, list: RosterPlayer[]) => {
    const team = getTeam(name);
    const starters = list.filter((pl) => pl.starter);
    const subs = list.filter((pl) => !pl.starter || pl.subbedIn);
    const text = contrastText(team.primary);
    const form = formation(p);
    return (
      <div className="flex-1 min-w-0">
        <div
          className="font-condensed font-semibold text-[11px] uppercase tracking-widest mb-1.5 truncate"
          style={{ color: team.primary === "#FFFFFF" ? "#E6EAF2" : team.primary }}
        >
          {team.code}
          {form ? <span className="text-muted/80 normal-case tracking-normal"> · {form}</span> : ""}
        </div>
        <div className="flex flex-col gap-1">
          {starters.map((pl) => (
            <div key={pl.key} className="flex items-center gap-1.5">
              <NumberChip jersey={pl.jersey} primary={team.primary} text={text} name={pl.name} />
              <span className="text-xs text-text/90 truncate">{pl.name}</span>
              {pl.goals > 0 && (
                <span className="tnum text-[10px] font-semibold text-amber shrink-0">{pl.goals}g</span>
              )}
              {pl.subbedOut && <span className="text-[9px] text-muted shrink-0">off</span>}
            </div>
          ))}
        </div>
        {subs.length > 0 && (
          <>
            <div className="text-[9px] uppercase tracking-widest text-muted mt-2 mb-1">Subs</div>
            <div className="flex flex-col gap-1 opacity-70">
              {subs.map((pl) => (
                <div key={pl.key} className="flex items-center gap-1.5">
                  <NumberChip jersey={pl.jersey} primary={team.primary} text={text} name={pl.name} />
                  <span className="text-xs text-text/80 truncate">{pl.name}</span>
                  {pl.goals > 0 && (
                    <span className="tnum text-[10px] font-semibold text-amber shrink-0">{pl.goals}g</span>
                  )}
                  {pl.subbedIn && <span className="text-[9px] text-[#7BE3A8] shrink-0">on</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="glass rounded-md overflow-hidden pointer-events-auto w-72">
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
          Lineups
        </span>
        {open ? <CaretUp size={13} className="text-muted" /> : <CaretDown size={13} className="text-muted" />}
      </button>
      {open && (
        <div className="px-3 pb-3 flex gap-4 max-h-[46vh] overflow-y-auto">
          {renderTeam(1, meta.participant1, list1)}
          {renderTeam(2, meta.participant2, list2)}
        </div>
      )}
    </div>
  );
}
