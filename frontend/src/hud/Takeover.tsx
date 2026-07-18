import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useAppStore, type TakeoverRequest } from "../state/store.js";
import { resolveFixtureMeta } from "../lib/meta.js";
import { getTeam, type TeamMeta } from "../lib/teams.js";
import { getEnrichment, scorerFor } from "../lib/enrichment.js";
import { frameAt } from "../lib/reconstruct.js";
import { deriveClockDisplay } from "../lib/time.js";
import { Badge } from "./Badge.js";
import photosJson from "../data/player-photos.json";

const PHOTOS: Record<string, string> = photosJson as Record<string, string>;

/**
 * The one sanctioned break from the ambient language: a full-viewport
 * broadcast beat for goals, red cards, and VAR overturns. The timeline is
 * phase-driven (impact -> card -> release) with setTimeout beats, and every
 * animation starts on mount - no delayed animations. Skippable with any
 * click or Escape. Takeovers queue and never overlap.
 */

function shade(hex: string, f: number): string {
  const c = parseInt(hex.slice(1), 16);
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function resolveTeam(req: TakeoverRequest): TeamMeta {
  const { match, demo } = useAppStore.getState();
  const meta = resolveFixtureMeta(match.fixtureId ?? -1, { demo });
  const name = req.moment.participant === 1 ? meta.participant1 : meta.participant2;
  return getTeam(name);
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
type Phase = "impact" | "card" | "release";

/** Compact center card for yellow cards, woodwork, shootout kicks (~1.5s). */
function MiniCard({ req, onDone }: { req: TakeoverRequest; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const team = useMemo(() => resolveTeam(req), [req]);
  useEffect(() => {
    const t = setTimeout(onDone, 1500);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDone]);

  const conf = {
    yellow_card: { word: "Yellow card", color: "#F7D117", glyph: "yellow_card" },
    woodwork: { word: "Off the woodwork", color: "#FFB300", glyph: "var_overturned" },
    pen_scored: { word: "Penalty scored", color: "#2ECC71", glyph: "pen_scored" },
    pen_missed: { word: "Penalty missed", color: "#E30613", glyph: "pen_missed" },
  }[req.moment.type] ?? { word: req.moment.type, color: "#E6EAF2", glyph: "var_overturned" };

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink/30 cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onDone}
    >
      <motion.div
        className="glass rounded-xl px-8 py-5 flex flex-col items-center gap-2.5 pointer-events-auto"
        style={{ borderColor: conf.color, boxShadow: `0 0 60px ${conf.color}40, inset 0 1px 0 rgba(255,255,255,0.08)` }}
        initial={reduceMotion ? false : { scale: 0.6, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { scale: 0.85, opacity: 0, y: -12 }}
        transition={{ type: "spring", stiffness: 320, damping: 20 }}
      >
        <GlyphIcon kind={conf.glyph} size={44} />
        <span
          className="font-condensed font-bold uppercase tracking-wide"
          style={{ fontSize: 30, color: conf.color, lineHeight: 1 }}
        >
          {conf.word}
        </span>
        <span className="flex items-center gap-2.5">
          <Badge team={team} size={26} />
          <span className="font-condensed font-semibold uppercase text-sm tracking-widest text-text/90">
            {team.name}
          </span>
        </span>
      </motion.div>
    </motion.div>
  );
}

/** Bottom toast for corners and substitutions (~1.2s), never blocks input. */
function ToastCard({ req, onDone }: { req: TakeoverRequest; onDone: () => void }) {
  const team = useMemo(() => resolveTeam(req), [req]);
  useEffect(() => {
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [onDone]);

  const conf = {
    corner: { word: "Corner", color: "#7FB3D5", glyph: "corner" },
    substitution: { word: "Substitution", color: "#7BE3A8", glyph: "substitution" },
  }[req.moment.type] ?? { word: req.moment.type, color: "#E6EAF2", glyph: "corner" };

  return (
    <motion.div
      className="absolute inset-x-0 bottom-20 z-40 flex justify-center pointer-events-none"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 12, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
    >
      <div
        className="glass rounded-full pl-3 pr-4 py-2 flex items-center gap-2.5 pointer-events-auto cursor-pointer"
        style={{ borderColor: conf.color }}
        onClick={onDone}
      >
        <GlyphIcon kind={conf.glyph} size={20} />
        <span className="font-condensed font-semibold uppercase text-sm tracking-widest" style={{ color: conf.color }}>
          {conf.word}
        </span>
        <span className="font-condensed font-semibold uppercase text-sm tracking-widest text-text/90">
          {team.name}
        </span>
      </div>
    </motion.div>
  );
}

/** Canvas glyph icons for mini/toast variants. */
function GlyphIcon({ kind, size }: { kind: string; size: number }) {
  if (kind === "yellow_card") {
    return (
      <span
        className="inline-block rounded-[3px]"
        style={{ width: size * 0.62, height: size * 0.86, background: "#F7D117", boxShadow: "0 0 18px rgba(247,209,23,0.6)" }}
      />
    );
  }
  if (kind === "pen_scored" || kind === "pen_missed") {
    const scored = kind === "pen_scored";
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill={scored ? "#2ECC71" : "#E30613"} />
        {scored ? (
          <path d="M15 25 L21 31 L33 18" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M17 17 L31 31 M31 17 L17 31" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
        )}
      </svg>
    );
  }
  if (kind === "var_overturned") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <rect x="6" y="14" width="36" height="24" rx="2" fill="none" stroke="#FFB300" strokeWidth="4" />
        <path d="M24 26 L32 34 M32 26 L24 34" stroke="#FFB300" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "substitution") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <path d="M10 18 H30 M24 10 L32 18 L24 26" stroke="#7BE3A8" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 30 H18 M24 22 L16 30 L24 38" stroke="#E30613" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // corner flag
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path d="M12 44 V6" stroke="#E6EAF2" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M12 8 L34 13 L12 20 Z" fill="#7FB3D5" />
    </svg>
  );
}

function TakeoverCard({ req, onDone }: { req: TakeoverRequest; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const team = useMemo(() => resolveTeam(req), [req]);
  const kind = req.moment.type;
  const [phase, setPhase] = useState<Phase>("impact");

  // scorer name from the ESPN enrichment, correlated by team + match minute
  const scorer = useMemo(() => {
    if (kind !== "goal") return null;
    const { match } = useAppStore.getState();
    if (!match.replay) return null;
    const frame = frameAt(match.replay.frames, req.moment.ts);
    const minute = frame?.state.clock ? (deriveClockDisplay(frame.state.clock)?.minuteFloat ?? null) : null;
    return scorerFor(getEnrichment(match.fixtureId), req.moment.participant, minute);
  }, [req, kind]);

  useEffect(() => {
    const beats = req.compressed
      ? { card: 130, release: 1150, done: 1500 }
      : { card: 400, release: 3500, done: 4500 };
    const timers = [
      setTimeout(() => setPhase("card"), beats.card),
      setTimeout(() => setPhase("release"), beats.release),
      setTimeout(onDone, beats.done),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const t of timers) clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDone, req.compressed]);

  const bg =
    kind === "goal"
      ? `linear-gradient(135deg, ${team.primary} 0%, ${shade(team.primary, 0.28)} 100%)`
      : kind === "red_card"
        ? "linear-gradient(135deg, #7A0A12 0%, #3A040A 100%)"
        : kind === "penalty"
          ? "linear-gradient(135deg, #8A6400 0%, #2A1D04 100%)"
          : "linear-gradient(135deg, #0D1420 0%, #05070C 100%)";

  const flashColor =
    kind === "goal" ? team.primary : kind === "red_card" ? "#E30613" : "#FFB300";
  const releasing = phase === "release";

  const enter = (from: Record<string, number>) => ({
    initial: reduceMotion ? false : { ...from, opacity: 0 },
    animate: { x: 0, y: 0, scale: 1, opacity: 1 },
    transition: { duration: 0.5, ease: EASE_OUT },
  });

  return (
    <motion.div
      className="streaks absolute inset-0 z-40 flex items-center justify-center cursor-pointer overflow-hidden"
      style={{ background: bg }}
      onClick={onDone}
      initial={reduceMotion ? { opacity: 0 } : { clipPath: "inset(0 0 100% 0)", opacity: 1 }}
      animate={
        releasing
          ? reduceMotion
            ? { opacity: 0 }
            : { clipPath: "inset(0 0 100% 0)", opacity: 1 }
          : reduceMotion
            ? { opacity: 1 }
            : { clipPath: "inset(0 0 0% 0)", opacity: 1 }
      }
      transition={{ duration: reduceMotion ? 0.15 : releasing ? 0.5 : 0.45, ease: EASE_OUT }}
    >
      {/* impact flash */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: flashColor }}
        initial={{ opacity: req.compressed ? 0.55 : 0.9 }}
        animate={{ opacity: 0 }}
        transition={{ duration: req.compressed ? 0.25 : 0.45, ease: "easeOut" }}
      />

      {phase !== "impact" && (
        <div className="relative flex flex-col items-center gap-[2vh] px-8 text-center">
          {kind === "goal" && (
            <>
              <motion.div
                initial={reduceMotion ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 15 }}
              >
                <Badge team={team} size={Math.round(window.innerHeight * 0.26)} ringWidth={4} />
              </motion.div>
              <motion.div
                className="font-condensed font-bold uppercase leading-[0.9] tracking-tight text-white flex overflow-hidden"
                style={{ fontSize: "min(17vw, 34vh)", textShadow: "0 6px 60px rgba(0,0,0,0.45)" }}
              >
                {"GOAL".split("").map((ch, i) => (
                  <motion.span
                    key={i}
                    className="inline-block"
                    initial={reduceMotion ? false : { y: "105%", rotate: 6, opacity: 0 }}
                    animate={{ y: 0, rotate: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 22, delay: i * 0.07 }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.div>
              <motion.div
                {...enter({ y: 40 })}
                className="font-condensed font-semibold uppercase text-white/90"
                style={{ fontSize: "min(4vw, 7vh)", letterSpacing: "0.08em" }}
              >
                {team.name}
                {scorer && (
                  <span className="flex items-center justify-center gap-3 mt-2">
                    {PHOTOS[scorer] && (
                      <img
                        src={`/${PHOTOS[scorer]}`}
                        alt={scorer}
                        className="rounded-full object-cover"
                        style={{
                          width: "min(4.5vw, 8vh)",
                          height: "min(4.5vw, 8vh)",
                          border: "2px solid rgba(255,255,255,0.7)",
                          background: "rgba(255,255,255,0.12)",
                        }}
                      />
                    )}
                    <span
                      className="block text-white/75"
                      style={{ fontSize: "min(2.4vw, 4.2vh)", letterSpacing: "0.1em" }}
                    >
                      {scorer}
                    </span>
                  </span>
                )}
              </motion.div>
              <motion.div
                {...enter({ y: 30 })}
                className="tnum font-condensed font-bold text-white"
                style={{ fontSize: "min(6vw, 10vh)" }}
                key={`${req.scoreAfter.participant1}-${req.scoreAfter.participant2}`}
              >
                {req.scoreAfter.participant1} - {req.scoreAfter.participant2}
              </motion.div>
            </>
          )}

          {kind === "red_card" && (
            <>
              <motion.div
                className="cardspin rounded-md"
                style={{
                  width: "13vh",
                  height: "20vh",
                  background: "linear-gradient(160deg, #FF1E2D 0%, #B0061C 100%)",
                  boxShadow:
                    "0 20px 80px rgba(0,0,0,0.5), inset 0 2px 0 rgba(255,255,255,0.35)",
                }}
                initial={reduceMotion ? false : { scale: 0.3, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 16 }}
              />
              <motion.div
                {...enter({ y: 50 })}
                className="font-condensed font-bold uppercase leading-[0.95] tracking-tight text-white"
                style={{ fontSize: "min(9.5vw, 18vh)", textShadow: "0 6px 60px rgba(0,0,0,0.5)" }}
              >
                Red card
              </motion.div>
              <motion.div {...enter({ y: 30 })} className="flex items-center gap-4">
                <Badge team={team} size={44} />
                <span
                  className="font-condensed font-semibold uppercase text-white/90"
                  style={{ fontSize: "min(3.5vw, 6vh)", letterSpacing: "0.08em" }}
                >
                  {team.name}
                </span>
              </motion.div>
            </>
          )}

          {kind === "penalty" && (
            <>
              <motion.div
                className="font-condensed font-bold uppercase leading-none text-white"
                style={{ fontSize: "min(10vw, 18vh)", textShadow: "0 6px 60px rgba(0,0,0,0.5)" }}
                initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 220, damping: 16 }}
              >
                Penalty
              </motion.div>
              <motion.div {...enter({ y: 30 })} className="flex items-center gap-4">
                <Badge team={team} size={52} ringWidth={3} />
                <span
                  className="font-condensed font-semibold uppercase text-white/90"
                  style={{ fontSize: "min(4vw, 7vh)", letterSpacing: "0.08em" }}
                >
                  {team.name}
                </span>
              </motion.div>
            </>
          )}

          {kind === "var_overturned" && (
            <>
              <motion.div
                className="font-condensed font-bold uppercase leading-none"
                style={{
                  fontSize: "min(11vw, 20vh)",
                  color: "#FFB300",
                  textShadow: "0 0 80px rgba(255,179,0,0.35)",
                }}
                initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 16 }}
              >
                VAR
              </motion.div>
              <motion.div
                {...enter({ y: 40 })}
                className="font-condensed font-bold uppercase tracking-tight text-white"
                style={{ fontSize: "min(5.5vw, 10vh)" }}
              >
                Decision overturned
              </motion.div>
              <motion.div {...enter({ y: 30 })} className="flex items-center gap-4">
                <Badge team={team} size={40} />
                <span
                  className="font-condensed font-semibold uppercase text-white/85"
                  style={{ fontSize: "min(3vw, 5vh)", letterSpacing: "0.08em" }}
                >
                  {team.name}
                </span>
              </motion.div>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function TakeoverLayer() {
  const active = useAppStore((s) => s.match.activeTakeover);
  const dismiss = useAppStore((s) => s.dismissTakeover);
  return (
    <AnimatePresence>
      {active &&
        (active.variant === "mini" ? (
          <MiniCard
            key={`${active.moment.type}:${active.moment.seq}:${active.fxStartedAt ?? 0}`}
            req={active}
            onDone={dismiss}
          />
        ) : active.variant === "toast" ? (
          <ToastCard
            key={`${active.moment.type}:${active.moment.seq}:${active.fxStartedAt ?? 0}`}
            req={active}
            onDone={dismiss}
          />
        ) : (
          <TakeoverCard
            key={`${active.moment.type}:${active.moment.seq}:${active.fxStartedAt ?? 0}`}
            req={active}
            onDone={dismiss}
          />
        ))}
    </AnimatePresence>
  );
}
