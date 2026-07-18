import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowsLeftRight, Fire, HourglassMedium } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import type { FixtureMeta } from "../lib/meta.js";
import { getTeam, getTeamGlow } from "../lib/teams.js";
import { frameAt } from "../lib/reconstruct.js";
import {
  dominanceChip,
  droughtChip,
  flipChip,
  lastBigChanceFromEvents,
  replayPressureWindow,
  type StoryChip,
} from "../lib/stories.js";

const ICONS = {
  dominance: Fire,
  drought: HourglassMedium,
  flip: ArrowsLeftRight,
} as const;

function momentLabel(type: string): string {
  if (type === "goal") return "goal";
  if (type === "red_card") return "red card";
  return "VAR review";
}

/**
 * Live story chips: animated, derived insights about the run of play
 * (dominance spells, chance droughts, momentum flips). Descriptive only -
 * never a forecast.
 */
export function StoryChips({ meta }: { meta: FixtureMeta }) {
  const [chips, setChips] = useState<StoryChip[]>([]);

  useEffect(() => {
    const compute = () => {
      const { match } = useAppStore.getState();
      const names: [string, string] = [meta.participant1, meta.participant2];
      const out: StoryChip[] = [];

      if (match.mode === "live" && match.latest && match.latest.statusId !== 100 && match.latest.statusId !== 1) {
        const now = match.latest.lastTs;
        const flipKm = match.latest.keyMoments.at(-1);
        const flip = flipChip(
          match.momentumHistory,
          now,
          flipKm && now - flipKm.ts < 8 * 60000 ? momentLabel(flipKm.type) : null
        );
        if (flip) out.push(flip);
        const dom = dominanceChip(match.pressureWindow, now, names);
        if (dom) out.push(dom);
        const dry = droughtChip(match.bigDeltaAt, now, names);
        if (dry) out.push(dry);
      } else if (match.mode === "replay" && match.replay && match.playheadTs != null) {
        const now = match.playheadTs;
        const st = frameAt(match.replay.frames, now)?.state;
        if (st && st.statusId !== 100 && st.statusId !== 1) {
          const hist = match.replay.samples.filter((s) => s.t <= now).map((s) => ({ t: s.t, m: s.m }));
          const flipKm = st.keyMoments.at(-1);
          const flip = flipChip(
            hist,
            now,
            flipKm && now - flipKm.ts < 8 * 60000 ? momentLabel(flipKm.type) : null
          );
          if (flip) out.push(flip);
          const dom = dominanceChip(replayPressureWindow(match.replay.frames, now, 6 * 60000), now, names);
          if (dom) out.push(dom);
          const dry = droughtChip(lastBigChanceFromEvents(match.replay.events, now), now, names);
          if (dry) out.push(dry);
        }
      }
      setChips(out.slice(0, 2));
    };
    compute();
    const id = setInterval(compute, 2000);
    return () => clearInterval(id);
  }, [meta.participant1, meta.participant2]);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 pointer-events-none max-w-xs">
      <AnimatePresence>
        {chips.map((chip) => {
          const Icon = ICONS[chip.kind];
          const color = chip.participant
            ? getTeamGlow(getTeam(chip.participant === 1 ? meta.participant1 : meta.participant2))
            : "#E6EAF2";
          return (
            <motion.div
              key={chip.id}
              layout
              className="glass rounded-full pl-2.5 pr-3.5 py-1.5 flex items-center gap-2"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ type: "spring", stiffness: 280, damping: 24 }}
            >
              <Icon size={13} style={{ color }} weight="fill" className="shrink-0" />
              <span className="font-condensed font-semibold text-xs uppercase tracking-wider text-text/90 truncate">
                {chip.text}
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
