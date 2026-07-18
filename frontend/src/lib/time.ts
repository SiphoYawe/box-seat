/**
 * Match-clock derivation. The authoritative source is `state.clock`. Feed
 * reality (captured fixtures): `seconds` counts UP from 0 and accumulates
 * across periods - H1 0-2700, H2 2700-5400, ET1 5400-6300, ET2 6300-7200,
 * stoppage beyond each. (The contract documents a countdown; observed data
 * contradicts it, and correct minutes are the goal.)
 */

const HT_BREAK_MIN = 15;

export interface ClockAnchor {
  kickoffTs: number;
  halftimeTs: number | null;
}

export interface ClockReading {
  running: boolean;
  seconds: number;
  statusId: number;
}

export interface DisplayClock {
  /** scorebug text: "67:42", "45+2'", "HT" */
  text: string;
  /** fractional minute for row labels (stoppage keeps counting past the period) */
  minuteFloat: number;
  /** short stoppage text when past the period allocation, e.g. "45+2'" */
  stoppageText: string | null;
}

/** statusId -> stoppage threshold minute for that period (contract). */
const STOPPAGE_BASE: Record<number, number> = { 2: 45, 4: 90, 7: 105, 9: 120 };

/**
 * Derive the display clock, verbatim from the backend contract: the feed's
 * seconds counts UP as cumulative match time from 0 at kickoff, so
 * minute = ceil(seconds/60). Past the period's stoppage threshold, render
 * "45+X'" / "90+X'" / "105+X'" / "120+X'". `tickMs` advances a running clock
 * locally between updates.
 */
export function deriveClockDisplay(clock: ClockReading | null, tickMs = 0): DisplayClock | null {
  if (!clock) return null;
  if (clock.statusId === 3 || clock.statusId === 8) {
    return { text: "HT", minuteFloat: 45, stoppageText: null };
  }
  // terminal phase ids (100 game_finalised, 5 F, 10 FET, 13 FPE)
  if (clock.statusId === 100 || clock.statusId === 5 || clock.statusId === 10 || clock.statusId === 13) {
    return { text: "FT", minuteFloat: 90, stoppageText: null };
  }
  const base = STOPPAGE_BASE[clock.statusId];
  if (base == null) return null;

  const seconds = Math.max(0, clock.seconds + (clock.running ? tickMs / 1000 : 0));
  const minute = Math.ceil(seconds / 60);

  if (minute > base) {
    const x = minute - base;
    return {
      text: `${base}+${x}'`,
      minuteFloat: seconds / 60,
      stoppageText: `${base}+${x}'`,
    };
  }

  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return {
    text: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`,
    minuteFloat: seconds / 60,
    stoppageText: null,
  };
}

/** Row-label minute from a clock reading: "25'", or the stoppage form. */
export function minuteLabel(clock: ClockReading | null): string | null {
  const d = deriveClockDisplay(clock, 0);
  if (!d) return null;
  if (d.stoppageText) return d.stoppageText;
  if (d.text === "HT") return "HT";
  return `${Math.max(1, Math.ceil(d.minuteFloat))}'`;
}

/** Play minutes elapsed at wall-clock `ts` (ht-adjusted when known). */
export function playMinutesAt(ts: number, anchor: ClockAnchor): number {
  if (!anchor.kickoffTs) return 0;
  const raw = (ts - anchor.kickoffTs) / 60000;
  if (raw <= 0) return 0;
  const afterHt = anchor.halftimeTs !== null && ts > anchor.halftimeTs;
  return afterHt ? raw - HT_BREAK_MIN : raw;
}

/** Live anchor when we never saw the halftime event: assume HT after 60 raw min. */
export function livePlayMinutes(now: number, kickoffTs: number): number {
  if (!kickoffTs) return 0;
  const raw = (now - kickoffTs) / 60000;
  if (raw <= 0) return 0;
  return raw > 60 ? raw - HT_BREAK_MIN : raw;
}

/** "67:42" style; beyond regulation shows "90+4". */
export function formatClock(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m > 90.99) {
    return `90+${Math.ceil(m - 90)}'`;
  }
  const whole = Math.floor(m);
  const secs = Math.floor((m - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** "25'" style for event-log rows and ribbon tick labels. */
export function formatMinute(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m > 90.99) return `90+${Math.ceil(m - 90)}'`;
  return `${Math.max(1, Math.round(m))}'`;
}

export function formatLocalKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatLocalDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
