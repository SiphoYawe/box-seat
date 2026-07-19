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

/**
 * The referee's card, raised: whip up from below, settle into a slow menacing
 * tilt, one gloss sweep across the face. Shared by red (big) and yellow.
 */
function Card3D({
  width,
  height,
  from,
  to,
  glow,
  delay = 0,
  reduceMotion,
}: {
  width: number;
  height: number;
  from: string;
  to: string;
  glow: string;
  delay?: number;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.div
      className="relative"
      initial={reduceMotion ? false : { y: height * 1.2, rotate: -22, scale: 0.55, opacity: 0 }}
      animate={{ y: 0, rotate: 0, scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 210, damping: 15, delay }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <motion.div
        className="relative overflow-hidden"
        style={{
          width,
          height,
          borderRadius: Math.max(6, width * 0.09),
          background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)`,
          boxShadow: `0 18px 70px rgba(0,0,0,0.55), 0 0 50px ${glow}, inset 0 2px 0 rgba(255,255,255,0.5), inset 0 -3px 0 rgba(0,0,0,0.25)`,
        }}
        animate={reduceMotion ? undefined : { rotate: [-7, -3, -7, -11, -7] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: delay + 0.5 }}
      >
        {/* gloss sweep */}
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, transparent 32%, rgba(255,255,255,0.55) 46%, rgba(255,255,255,0.15) 52%, transparent 64%)",
          }}
          initial={{ x: "-130%" }}
          animate={{ x: "130%" }}
          transition={{ delay: delay + 0.45, duration: 0.7, ease: "easeOut" }}
        />
        {/* inner edge light */}
        <div
          className="absolute inset-0"
          style={{ border: "1.5px solid rgba(255,255,255,0.35)", borderRadius: "inherit" }}
        />
      </motion.div>
    </motion.div>
  );
}

/** Yellow card, raised like the ref would (~1.9s). */
function YellowCardMini({ req, onDone, team }: { req: TakeoverRequest; onDone: () => void; team: TeamMeta }) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(onDone, 1900);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDone]);

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink/35 cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onDone}
    >
      <motion.div
        className="glass rounded-xl px-9 py-6 flex flex-col items-center gap-3 pointer-events-auto"
        style={{ borderColor: "#F7D117", boxShadow: "0 0 70px rgba(247,209,23,0.3), inset 0 1px 0 rgba(255,255,255,0.08)" }}
        initial={reduceMotion ? false : { scale: 0.7, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { scale: 0.85, opacity: 0, y: -14 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <Card3D width={44} height={62} from="#FFE14D" to="#D9AE0B" glow="rgba(247,209,23,0.55)" reduceMotion={reduceMotion} />
        <span className="flex overflow-hidden">
          {"YELLOW CARD".split("").map((ch, i) => (
            <motion.span
              key={i}
              className="font-condensed font-bold uppercase inline-block"
              style={{ fontSize: 30, color: "#F7D117", lineHeight: 1.1 }}
              initial={reduceMotion ? false : { y: "110%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 24, delay: 0.25 + i * 0.035 }}
            >
              {ch === " " ? " " : ch}
            </motion.span>
          ))}
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

/** Woodwork: the ball clangs off the crossbar and ricochets (~1.9s). */
function WoodworkMini({ req, onDone, team }: { req: TakeoverRequest; onDone: () => void; team: TeamMeta }) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(onDone, 1900);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDone]);

  const CLANG = 0.5;
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink/35 cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onDone}
    >
      <motion.div
        className="glass rounded-xl px-9 py-6 flex flex-col items-center gap-3 pointer-events-auto"
        style={{ borderColor: "#FFB300", boxShadow: "0 0 70px rgba(255,179,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)" }}
        initial={reduceMotion ? false : { scale: 0.7, opacity: 0, y: 30 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { scale: 0.85, opacity: 0, y: -14 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <motion.div
          animate={reduceMotion ? undefined : { x: [0, -3, 3, -2, 2, -1, 0] }}
          transition={{ delay: CLANG, duration: 0.45, ease: "easeOut" }}
        >
          <svg width={150} height={92} viewBox="0 0 150 92" fill="none">
            {/* goal frame */}
            <path d="M20 86 V24 H130 V86" stroke="#E8F1EA" strokeWidth="5" strokeLinecap="round" />
            <path d="M20 24 H130" stroke="#E8F1EA" strokeWidth="5" strokeLinecap="round" />
            {/* ball: in from the left, clang off the bar, ricochet down-right */}
            <motion.circle
              r="7"
              fill="#FFFFFF"
              initial={{ cx: 6, cy: 74, opacity: 1 }}
              animate={reduceMotion ? { cx: 75, cy: 24 } : { cx: [6, 75, 108], cy: [74, 24, 62], opacity: [1, 1, 0.15] }}
              transition={{ duration: 1.0, times: [0, CLANG / 1.0, 1], ease: "easeOut" }}
            />
            {/* impact ring at the bar */}
            <motion.circle
              cx="75"
              cy="24"
              fill="none"
              stroke="#FFB300"
              strokeWidth="3"
              initial={{ r: 3, opacity: 0 }}
              animate={reduceMotion ? { r: 10, opacity: 0 } : { r: [3, 22], opacity: [0.9, 0] }}
              transition={{ delay: CLANG, duration: 0.5, ease: "easeOut" }}
            />
          </svg>
        </motion.div>
        <span className="flex overflow-hidden">
          {"OFF THE WOODWORK".split("").map((ch, i) => (
            <motion.span
              key={i}
              className="font-condensed font-bold uppercase inline-block"
              style={{ fontSize: 27, color: "#FFB300", lineHeight: 1.1 }}
              initial={reduceMotion ? false : { y: "110%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 24, delay: CLANG + 0.25 + i * 0.03 }}
            >
              {ch === " " ? " " : ch}
            </motion.span>
          ))}
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

/** The final whistle: split team gradients, both badges, the final score. */
function FullTimeCard({ req, onDone }: { req: TakeoverRequest; onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("impact");
  const meta = resolveFixtureMeta(
    useAppStore.getState().match.fixtureId ?? -1,
    { demo: useAppStore.getState().demo }
  );
  const team1 = getTeam(meta.participant1);
  const team2 = getTeam(meta.participant2);
  const winner = req.moment.participant === 1 ? team1 : team2;

  useEffect(() => {
    const beats = req.compressed ? { card: 130, release: 1150, done: 1500 } : { card: 350, release: 4200, done: 5200 };
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

  const enter = (from: Record<string, number>) => ({
    initial: reduceMotion ? false : { ...from, opacity: 0 },
    animate: { x: 0, y: 0, scale: 1, opacity: 1 },
    transition: { duration: 0.5, ease: EASE_OUT },
  });
  const releasing = phase === "release";

  return (
    <motion.div
      className="streaks absolute inset-0 z-40 flex items-center justify-center cursor-pointer overflow-hidden"
      style={{
        background: `linear-gradient(110deg, ${shade(team1.primary, 0.4)} 0%, #05070C 42%, #05070C 58%, ${shade(team2.primary, 0.4)} 100%)`,
      }}
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
      <motion.div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "#FFFFFF" }}
        initial={{ opacity: 0.35 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />

      {phase !== "impact" && (
        <div className="relative flex flex-col items-center gap-[2.2vh] px-8 text-center">
          <motion.span
            {...enter({ y: -18 })}
            className="font-condensed font-semibold uppercase tracking-[0.22em] text-muted"
            style={{ fontSize: "min(2.2vw, 3.6vh)" }}
          >
            {meta.competition}
          </motion.span>

          <div className="flex items-center gap-[4vw]">
            <motion.div
              initial={reduceMotion ? false : { scale: 0.5, opacity: 0, x: -30 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 17 }}
            >
              <Badge team={team1} size={Math.round(window.innerHeight * 0.13)} ringWidth={3} />
            </motion.div>
            <motion.div
              {...enter({ y: 30 })}
              className="tnum font-condensed font-bold text-white"
              style={{ fontSize: "min(11vw, 20vh)", lineHeight: 1, textShadow: "0 6px 60px rgba(0,0,0,0.5)" }}
            >
              {req.scoreAfter.participant1} - {req.scoreAfter.participant2}
            </motion.div>
            <motion.div
              initial={reduceMotion ? false : { scale: 0.5, opacity: 0, x: 30 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 17 }}
            >
              <Badge team={team2} size={Math.round(window.innerHeight * 0.13)} ringWidth={3} />
            </motion.div>
          </div>

          <span className="flex overflow-hidden">
            {"FULL TIME".split("").map((ch, i) => (
              <motion.span
                key={i}
                className="font-condensed font-bold uppercase inline-block tracking-tight text-white"
                style={{ fontSize: "min(8.5vw, 15vh)", lineHeight: 1, textShadow: "0 6px 60px rgba(0,0,0,0.45)" }}
                initial={reduceMotion ? false : { y: "108%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 280, damping: 22, delay: 0.3 + i * 0.05 }}
              >
                {ch === " " ? " " : ch}
              </motion.span>
            ))}
          </span>

          <motion.div
            {...enter({ y: 24 })}
            className="font-condensed font-semibold uppercase tracking-widest"
            style={{ fontSize: "min(3.2vw, 5.5vh)", color: winner.primary === "#FFFFFF" ? "#E6EAF2" : winner.primary }}
          >
            {winner.name} take it
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

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

  if (req.moment.type === "yellow_card") return <YellowCardMini req={req} onDone={onDone} team={team} />;
  if (req.moment.type === "woodwork") return <WoodworkMini req={req} onDone={onDone} team={team} />;

  const conf = {
    pen_scored: { word: "Penalty scored", color: "#2ECC71", glyph: "pen_scored" },
    pen_missed: { word: "Penalty missed", color: "#E30613", glyph: "pen_missed" },
    halftime: { word: "Half time", color: "#B9C4D6", glyph: "whistle" },
  }[req.moment.type] ?? { word: req.moment.type, color: "#E6EAF2", glyph: "whistle" };

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
    kickoff: { word: "Kick off", color: "#E6EAF2", glyph: "whistle" },
    kickoff2: { word: "Second half", color: "#E6EAF2", glyph: "whistle" },
  }[req.moment.type] ?? { word: req.moment.type, color: "#E6EAF2", glyph: "corner" };

  const showTeam = req.moment.type === "corner" || req.moment.type === "substitution";

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
        {showTeam && (
          <span className="font-condensed font-semibold uppercase text-sm tracking-widest text-text/90">
            {team.name}
          </span>
        )}
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
  if (kind === "whistle") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="17" fill="none" stroke="#B9C4D6" strokeWidth="4" />
        <path d="M24 14 V24 L32 29" stroke="#B9C4D6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
              {/* double impact flash - the whistle blows twice */}
              {[0, 0.22].map((d) => (
                <motion.div
                  key={d}
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "#FF1E2D" }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.5, 0] }}
                  transition={{ delay: d, duration: 0.28, ease: "easeOut" }}
                />
              ))}
              <Card3D
                width={Math.round(window.innerHeight * 0.145)}
                height={Math.round(window.innerHeight * 0.22)}
                from="#FF1E2D"
                to="#B0061C"
                glow="rgba(227,6,19,0.55)"
                reduceMotion={reduceMotion}
              />
              <span className="flex overflow-hidden">
                {"RED CARD".split("").map((ch, i) => (
                  <motion.span
                    key={i}
                    className="font-condensed font-bold uppercase inline-block tracking-tight text-white"
                    style={{ fontSize: "min(9.5vw, 18vh)", lineHeight: 1, textShadow: "0 6px 60px rgba(0,0,0,0.5)" }}
                    initial={reduceMotion ? false : { y: "108%", rotate: 5, opacity: 0 }}
                    animate={{ y: 0, rotate: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 22, delay: 0.35 + i * 0.06 }}
                  >
                    {ch === " " ? " " : ch}
                  </motion.span>
                ))}
              </span>
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
        (active.moment.type === "full_time" ? (
          <FullTimeCard
            key={`${active.moment.type}:${active.moment.seq}:${active.fxStartedAt ?? 0}`}
            req={active}
            onDone={dismiss}
          />
        ) : active.variant === "mini" ? (
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
