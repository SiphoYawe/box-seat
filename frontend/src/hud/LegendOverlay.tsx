import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X } from "@phosphor-icons/react";

const SEEN_KEY = "boxseat-legend-seen";

function MoundIcon() {
  return (
    <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
      <path d="M1 14 Q7 2 13 14 Z" fill="none" stroke="#6CACE4" strokeWidth="1.6" />
      <path d="M13 14 Q19 2 25 14 Z" fill="none" stroke="#DA291C" strokeWidth="1.6" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
      <path
        d="M1 8 Q5 1 9 8 T17 8 T25 8"
        fill="none"
        stroke="#E6EAF2"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BeaconIcon() {
  return (
    <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden>
      <circle cx="5" cy="8" r="3.2" fill="none" stroke="#2ECC71" strokeWidth="1.6" />
      <rect x="11.5" y="4.8" width="5" height="6.4" rx="0.8" fill="#E30613" />
      <path d="M21 4 L24 8 L21 12 L18 8 Z" fill="none" stroke="#FFB300" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * "How to read it" - the 10-second decoder for first-time viewers. Shown once
 * (localStorage), dismissible by click, X, or Escape.
 */
export function LegendOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // private mode - just don't show again this session
    }
  };

  if (!visible) return null;

  const rows = [
    { icon: <MoundIcon />, label: "Terrain", text: "Rising ground over a third means that team is applying pressure there." },
    { icon: <WaveIcon />, label: "Ribbon", text: "The wave above the pitch is momentum through the match, left to right." },
    { icon: <BeaconIcon />, label: "Beacons", text: "Markers on the ribbon are goals, red cards, and VAR overturns." },
  ];

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-center justify-center bg-ink/40 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      onClick={dismiss}
    >
      <motion.div
        className="glass rounded-xl px-7 py-6 max-w-md mx-4 pointer-events-auto"
        initial={{ scale: 0.92, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-condensed font-bold uppercase tracking-wide text-xl">How to read it</h2>
          <button
            className="w-7 h-7 rounded-full hover:bg-white/10 flex items-center justify-center cursor-pointer text-muted"
            onClick={dismiss}
            aria-label="Dismiss legend"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-4">
              <span className="w-8 shrink-0 flex justify-center">{row.icon}</span>
              <p className="text-sm text-text/90 leading-snug">
                <span className="font-condensed font-semibold uppercase tracking-wider mr-2">
                  {row.label}
                </span>
                {row.text}
              </p>
            </div>
          ))}
        </div>
        <button
          className="mt-5 w-full rounded-md bg-white/10 hover:bg-white/15 active:scale-[0.98] transition-all py-2 font-condensed font-semibold uppercase tracking-widest text-sm cursor-pointer"
          onClick={dismiss}
        >
          Got it
        </button>
      </motion.div>
    </motion.div>
  );
}
