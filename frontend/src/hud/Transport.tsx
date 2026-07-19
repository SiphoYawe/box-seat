import { useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import { replayMinuteLabel } from "../scene/sceneUtils.js";

/**
 * Broadcast-style replay transport: restart, jump to previous/next key
 * moment, play/pause, speed (1x/2x/4x), minute readout. Keyboard: space =
 * play/pause, left/right arrows = prev/next key moment. Drives the same
 * playhead as ribbon scrubbing.
 */
// log-scale slider: position 0..1 maps to 1x..128x (2^0 .. 2^7)
const posFromSpeed = (speed: number) => Math.log2(speed) / 7;
const speedFromPos = (pos: number) => Math.round(Math.pow(2, pos * 7) * 10) / 10;
const fmtSpeed = (speed: number) => `${speed >= 10 ? Math.round(speed) : speed}×`;

export function Transport() {
  const playing = useAppStore((s) => s.match.playing);
  const speed = useAppStore((s) => s.match.speed);
  const instantReplay = useAppStore((s) => s.match.instantReplay);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const setPlayhead = useAppStore((s) => s.setPlayhead);
  const stepMoment = useAppStore((s) => s.stepMoment);

  const [minute, setMinute] = useState("1'");
  useEffect(() => {
    const id = setInterval(() => {
      const { match } = useAppStore.getState();
      if (match.playheadTs != null) {
        setMinute(replayMinuteLabel(match.playheadTs));
      }
    }, 200);
    return () => clearInterval(id);
  }, []);

  // broadcast keyboard control
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        const s = useAppStore.getState();
        s.setPlaying(!s.match.playing);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        useAppStore.getState().stepMoment(-1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        useAppStore.getState().stepMoment(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const restart = () => {
    const { match } = useAppStore.getState();
    if (match.replay) setPlayhead(match.replay.kickoffTs, { manual: true });
  };

  const btn =
    "flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer text-text";

  return (
    <div className="glass rounded-full h-12 pl-2 pr-4 flex items-center gap-1 pointer-events-auto">
      <button className={btn} onClick={restart} aria-label="Restart match" title="Restart">
        <ArrowCounterClockwise size={16} />
      </button>
      <button
        className={btn}
        onClick={() => stepMoment(-1)}
        aria-label="Previous key moment"
        title="Previous key moment (left arrow)"
      >
        <SkipBack size={17} weight="fill" />
      </button>
      <button
        className={btn}
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (space)" : "Play (space)"}
      >
        {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
      </button>
      <button
        className={btn}
        onClick={() => stepMoment(1)}
        aria-label="Next key moment"
        title="Next key moment (right arrow)"
      >
        <SkipForward size={17} weight="fill" />
      </button>
      <span className="flex items-center gap-1.5 px-1">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={posFromSpeed(speed)}
          onChange={(e) => setSpeed(speedFromPos(Number(e.target.value)))}
          className="w-20 h-1 accent-white/80 cursor-pointer"
          aria-label="Playback speed"
          title={`Playback speed: ${fmtSpeed(speed)}`}
        />
        <span className="tnum font-condensed font-semibold text-sm text-muted w-9 text-center">
          {fmtSpeed(speed)}
        </span>
      </span>
      <span className="w-px h-5 bg-edge mx-1" />
      <span className="tnum font-condensed font-semibold text-base text-muted w-14 text-center">
        {minute}
      </span>
      {instantReplay && (
        <span className="flex items-center gap-1.5 pl-2 pr-1">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber" />
          </span>
          <span className="font-condensed font-semibold text-xs uppercase tracking-widest text-amber">
            Goal-cam
          </span>
        </span>
      )}
    </div>
  );
}
