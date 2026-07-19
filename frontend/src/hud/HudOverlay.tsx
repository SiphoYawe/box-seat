import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { House, ShareNetwork, ShieldCheck, VideoCamera } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import { stageOf, type FixtureMeta } from "../lib/meta.js";
import { CAMERA_PRESETS } from "../scene/CameraRig.js";
import { Scorebug } from "./Scorebug.js";
import { EventLog } from "./EventLog.js";
import { NotebookPanel } from "./NotebookPanel.js";
import { ChatterPanel } from "./ChatterPanel.js";
import { Transport } from "./Transport.js";
import { LineupPanel } from "./LineupPanel.js";
import { StatsPanel } from "./StatsPanel.js";
import { ProofPanel } from "./ProofPanel.js";
import { StoryChips } from "./StoryChips.js";
import { useViewState } from "./useViewState.js";
import { getEnrichment } from "../lib/enrichment.js";
import { exportShareCard } from "../lib/shareCard.js";
import { deriveClockDisplay } from "../lib/time.js";
import { currentViewFrame } from "../scene/sceneUtils.js";

function ConnectionDot() {
  const connection = useAppStore((s) => s.connection);
  if (connection === "demo") {
    return (
      <div className="glass rounded-full h-9 px-3 flex items-center pointer-events-auto">
        <span className="font-condensed font-semibold text-xs uppercase tracking-widest text-amber">
          Demo
        </span>
      </div>
    );
  }
  const ok = connection === "open";
  return (
    <div
      className="glass rounded-full h-9 w-9 flex items-center justify-center pointer-events-auto"
      title={ok ? "Connected" : "Reconnecting"}
    >
      <span className="relative flex h-2.5 w-2.5">
        {!ok && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber opacity-75" />
        )}
        <span
          className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ background: ok ? "#2ECC71" : "#FFB300" }}
        />
      </span>
    </div>
  );
}

function DemoToggle() {
  const demoLive = useAppStore((s) => s.demoLive);
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const [, setSearchParams] = useSearchParams();
  if (fixtureId == null) return null;
  return (
    <button
      className="glass rounded-full h-9 px-3.5 pointer-events-auto cursor-pointer hover:bg-white/10 active:scale-95 transition-all"
      onClick={() =>
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (demoLive) next.delete("live");
          else next.set("live", "1");
          return next;
        })
      }
    >
      <span className="font-condensed font-semibold text-xs uppercase tracking-widest text-text">
        {demoLive ? "Show replay" : "Simulate live"}
      </span>
    </button>
  );
}

function AttestationChip() {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const att = useAppStore((s) => (fixtureId != null ? s.attestations[fixtureId] : undefined));
  if (!att) return null;
  const clusterParam = att.cluster === "devnet" ? "?cluster=devnet" : "";
  return (
    <a
      href={`https://solscan.io/tx/${att.txSig}${clusterParam}`}
      target="_blank"
      rel="noreferrer"
      className="rounded-full h-7 px-2.5 flex items-center gap-1.5 pointer-events-auto border border-[#2ECC71]/30 bg-[#2ECC71]/10 hover:bg-[#2ECC71]/20 transition-all"
      title="View the attestation transaction on Solscan"
    >
      <ShieldCheck size={12} className="text-[#2ECC71]" />
      <span className="font-condensed font-semibold text-[10px] uppercase tracking-widest text-[#7BE3A8]">
        {att.status === "pending" ? "Attestation pending" : "Attested on Solana"}
      </span>
    </a>
  );
}

function ShareButton({ meta }: { meta: FixtureMeta }) {
  const [busy, setBusy] = useState(false);
  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const view = currentViewFrame();
      const state = view?.state;
      exportShareCard({
        meta,
        score1: state?.score.participant1 ?? 0,
        score2: state?.score.participant2 ?? 0,
        clockText: state?.clock ? (deriveClockDisplay(state.clock)?.text ?? "") : "",
      }).finally(() => setBusy(false));
    } catch {
      setBusy(false);
    }
  };
  return (
    <button
      className="glass rounded-full h-9 w-9 flex items-center justify-center pointer-events-auto cursor-pointer hover:bg-white/10 active:scale-95 transition-all"
      onClick={onShare}
      aria-label="Export share card"
      title="Export share card"
    >
      <ShareNetwork size={15} className="text-text" />
    </button>
  );
}

function CameraPresetButton() {
  const preset = useAppStore((s) => s.cameraPreset);
  const cycle = useAppStore((s) => s.cycleCameraPreset);
  const name = CAMERA_PRESETS[preset % CAMERA_PRESETS.length].name;
  return (
    <button
      className="glass rounded-full h-9 pl-3 pr-3.5 flex items-center gap-2 pointer-events-auto cursor-pointer hover:bg-white/10 active:scale-95 transition-all"
      onClick={cycle}
      aria-label="Cycle camera angle"
      title="Camera angle"
    >
      <VideoCamera size={16} className="text-muted" />
      <span className="font-condensed font-semibold text-xs uppercase tracking-widest text-text">
        {name}
      </span>
    </button>
  );
}

function Mount({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function CenterNotice({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="absolute inset-x-0 top-[38%] flex justify-center pointer-events-none">
      <div className="glass rounded-lg px-6 py-4 flex flex-col items-center gap-1 max-w-sm text-center">
        <span className="font-condensed font-semibold text-lg uppercase tracking-widest text-text">
          {title}
        </span>
        {sub && <span className="text-sm text-muted">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * The 2D HUD layer over the canvas: scorebug, clock, chips, event log,
 * stage/venue, transport, connection state. Numbers and text only - all
 * visualization lives in the 3D scene.
 */
export function HudOverlay({ meta }: { meta: FixtureMeta }) {
  const mode = useAppStore((s) => s.match.mode);
  const demo = useAppStore((s) => s.demo);
  const coverageNotice = useAppStore((s) => s.match.coverageNotice);
  const everReceived = useAppStore((s) => s.match.everReceived);
  const view = useViewState(500);

  const statusId = view?.state.statusId ?? 1;
  const kickoffFuture = meta.startTime != null && meta.startTime > Date.now();
  const waitingForKickoff =
    !coverageNotice && mode !== "replay" && statusId === 1 && kickoffFuture;
  const connecting =
    !coverageNotice && !waitingForKickoff && !everReceived && mode !== "replay";

  const enrich = getEnrichment(meta.fixtureId);
  const enrichVenue = enrich?.venue
    ? `${enrich.venue.name}${enrich.venue.attendance ? ` · ${enrich.venue.attendance.toLocaleString()}` : ""}`
    : null;

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {/* top bar */}
      <div className="absolute top-0 inset-x-0 flex items-start justify-between p-4">
        <div className="flex flex-col gap-2">
          <Mount delay={0}>
            <Scorebug meta={meta} />
          </Mount>
          <Mount delay={0.1}>
            <NotebookPanel meta={meta} />
          </Mount>
          <Mount delay={0.18}>
            <ChatterPanel />
          </Mount>
        </div>
        <div className="flex items-center gap-2">
          {demo && <DemoToggle />}
          <ShareButton meta={meta} />
          <ConnectionDot />
          <Link
            to="/"
            className="glass rounded-full h-9 w-9 flex items-center justify-center pointer-events-auto hover:bg-white/10 active:scale-95 transition-all"
            aria-label="Back to match list"
          >
            <House size={16} className="text-text" />
          </Link>
        </div>
      </div>

      {/* event log + lineups + stats + on-chain proof, right edge */}
      <div className="absolute right-4 top-20 flex flex-col items-end gap-2">
        <Mount delay={0.16}>
          <EventLog meta={meta} />
        </Mount>
        <Mount delay={0.24}>
          <LineupPanel meta={meta} />
        </Mount>
        <Mount delay={0.32}>
          <StatsPanel meta={meta} />
        </Mount>
        <Mount delay={0.4}>
          <ProofPanel />
        </Mount>
      </div>

      {/* bottom bar */}
      <div className="absolute bottom-0 inset-x-0 flex items-end justify-between p-4">
        <div className="flex flex-col items-start gap-2">
          <StoryChips meta={meta} />
          <div className="glass rounded-md px-3 py-2">
            <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
              {meta.competition}
              {stageOf(meta.fixtureId) ? ` · ${stageOf(meta.fixtureId)}` : ""}
              {enrichVenue ? ` · ${enrichVenue}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <AttestationChip />
            <CameraPresetButton />
          </div>
          <span className="text-[10px] text-muted/70 pr-1 select-none">
            Data: TxLINE by TxODDS · finality attested on Solana
          </span>
        </div>
        {mode === "replay" && (
          <div className="absolute bottom-4 inset-x-0 flex justify-center">
            <Transport />
          </div>
        )}
      </div>

      {/* quiet states - never a blank screen */}
      {coverageNotice && (
        <CenterNotice
          title="Live data coverage unavailable"
          sub="This match has no data coverage. The pitch stays up in case that changes."
        />
      )}
      {waitingForKickoff && meta.startTime != null && (
        <CenterNotice
          title="Waiting for kickoff"
          sub={`${formatDay(meta.startTime)} · ${formatTime(meta.startTime)}`}
        />
      )}
      {connecting && mode !== "replay-loading" && (
        <CenterNotice title="Connected" sub="Waiting for the next match update" />
      )}
      {mode === "replay-loading" && <CenterNotice title="Loading replay" />}
    </div>
  );
}

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
