import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Notebook } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getEnrichment, type Enrichment } from "../lib/enrichment.js";
import { getTeam } from "../lib/teams.js";

interface Fact {
  id: string;
  text: string;
  accent?: string;
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** Derive commentator facts from the enrichment (never invented text). */
function buildFacts(enrich: Enrichment, meta: FixtureMeta): Fact[] {
  const facts: Fact[] = [];
  const t1 = meta.participant1;
  const t2 = meta.participant2;
  const glow1 = getTeam(t1).glow ?? getTeam(t1).primary;
  const glow2 = getTeam(t2).glow ?? getTeam(t2).primary;
  const startMs = meta.startTime ?? 0;

  // head-to-head, excluding the current match itself
  const prior = enrich.h2h.filter(
    (e) => Math.abs(new Date(e.date).getTime() - startMs) > 12 * 3600_000
  );
  if (prior.length > 0) {
    const last = prior[0];
    const winner = last.result === "W" ? t1 : last.result === "L" ? t2 : null;
    const when = last.competition?.replace("FIFA ", "") ?? "friendly";
    const where = last.round && when.includes(yearOf(last.date)) ? `${when}, ${last.round}` : `${when}${last.round ? `, ${last.round}` : ""}, ${yearOf(last.date)}`;
    facts.push({
      id: "last-meeting",
      text: winner ? `Last meeting: ${winner} won ${last.score} (${where})` : `Last meeting ended ${last.score} (${where})`,
      accent: winner === t1 ? glow1 : winner === t2 ? glow2 : undefined,
    });

    const wins1 = prior.filter((e) => e.result === "W").length;
    const wins2 = prior.filter((e) => e.result === "L").length;
    const draws = prior.filter((e) => e.result === "D").length;
    if (wins1 > wins2) {
      facts.push({
        id: "h2h-record",
        text: `${t1} have won ${wins1} of the last ${prior.length} meetings vs ${t2}${draws > 0 ? ` (${draws} drawn)` : ""}`,
        accent: glow1,
      });
    } else if (wins2 > wins1) {
      facts.push({
        id: "h2h-record",
        text: `${t2} have won ${wins2} of the last ${prior.length} meetings vs ${t1}${draws > 0 ? ` (${draws} drawn)` : ""}`,
        accent: glow2,
      });
    } else if (prior.length > 1) {
      facts.push({
        id: "h2h-record",
        text: `Nothing between them: ${wins1} win${wins1 === 1 ? "" : "s"} each in the last ${prior.length} meetings`,
      });
    }
  }

  // current form, excluding the current match
  const formOf = (key: "participant1" | "participant2", name: string, glow: string) => {
    const seq = enrich.form[key].filter(
      (e) => Math.abs(new Date(e.date).getTime() - startMs) > 12 * 3600_000
    );
    if (seq.length === 0) return;
    const results = seq.map((e) => e.result);
    facts.push({
      id: `form-${key}`,
      text: `${name} form: ${results.join(" ")} in their last ${results.length}`,
      accent: glow,
    });
    const streak: string[] = [];
    for (const r of results) {
      if (r === "W") streak.push(r);
      else break;
    }
    if (streak.length >= 3) {
      facts.push({
        id: `streak-${key}`,
        text: `${name} are on a ${streak.length}-match winning run`,
        accent: glow,
      });
    }
    const unbeaten = results.findIndex((r) => r === "L");
    if (unbeaten === -1 && results.length >= 4) {
      facts.push({
        id: `unbeaten-${key}`,
        text: `${name} unbeaten across their last ${results.length}`,
        accent: glow,
      });
    }
  };
  formOf("participant1", t1, glow1);
  formOf("participant2", t2, glow2);

  if (enrich.venue?.attendance) {
    facts.push({
      id: "crowd",
      text: `${enrich.venue.attendance.toLocaleString()} in at ${enrich.venue.name} for this one`,
    });
  }
  if (enrich.article?.headline) {
    facts.push({ id: "headline", text: enrich.article.headline });
  }
  return facts;
}

const ROTATE_MS = 7000;

/**
 * The commentator's notebook: rotating, animated match facts (head-to-head,
 * streaks, form, crowd) derived from the ESPN enrichment. Top-left, under
 * the scorebug.
 */
export function NotebookPanel({ meta }: { meta: FixtureMeta }) {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const enrich = getEnrichment(fixtureId);
  const facts = useMemo(() => (enrich ? buildFacts(enrich, meta) : []), [enrich, meta]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [fixtureId]);
  useEffect(() => {
    if (facts.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % facts.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [facts.length]);

  if (facts.length === 0) return null;
  const fact = facts[index % facts.length];

  return (
    <div className="glass rounded-md pl-3 pr-4 py-2.5 w-[21rem] pointer-events-auto overflow-hidden">
      <div className="flex items-center gap-2 mb-1">
        <Notebook size={13} className="text-muted shrink-0" />
        <span className="font-condensed font-semibold text-[10px] uppercase tracking-[0.2em] text-muted">
          Notebook
        </span>
        <span className="tnum text-[10px] text-muted/60 ml-auto">
          {(index % facts.length) + 1}/{facts.length}
        </span>
      </div>
      <div className="h-9 flex items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={fact.id}
            className="text-[13px] leading-snug text-text/90"
            style={fact.accent ? { borderLeft: `2px solid ${fact.accent}`, paddingLeft: 8 } : undefined}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          >
            {fact.text}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
