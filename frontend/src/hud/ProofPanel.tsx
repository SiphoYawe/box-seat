import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CaretDown, CaretUp, CheckCircle, ShieldCheck, Warning, SpinnerGap, Link as LinkIcon } from "@phosphor-icons/react";
import { useAppStore } from "../state/store.js";
import { verifyReplay, solscanTxUrl, type VerifyResult } from "../lib/solanaVerify.js";

function short(sig: string): string {
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}

/**
 * On-chain proof panel: the attestation tx plus a LIVE replay-integrity
 * check - the browser recomputes the match fingerprint and compares it
 * against the memo on Solana. The proof happens here, in the open.
 */
export function ProofPanel() {
  const fixtureId = useAppStore((s) => s.match.fixtureId);
  const att = useAppStore((s) => (fixtureId != null ? s.attestations[fixtureId] : undefined));
  const replay = useAppStore((s) => s.match.replay);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setResult(null);
    if (!open || !att || !replay || replay.frames.length === 0) return;
    const finalState = replay.frames[replay.frames.length - 1].state;
    setChecking(true);
    let cancelled = false;
    verifyReplay(finalState, att.txSig, att.cluster)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, att, replay, fixtureId]);

  if (!att) return null;

  const integrity = checking ? (
    <span className="flex items-center gap-1.5 text-muted">
      <SpinnerGap size={12} className="animate-spin" />
      <span className="text-[11px]">verifying on-chain…</span>
    </span>
  ) : result?.status === "verified" ? (
    <span className="flex items-center gap-1.5 text-[#7BE3A8]">
      <CheckCircle size={13} weight="fill" />
      <span className="text-[11px] font-semibold uppercase tracking-wider">Replay verified</span>
    </span>
  ) : result?.status === "stale" ? (
    <span className="flex items-center gap-1.5 text-amber">
      <Warning size={13} weight="fill" />
      <span className="text-[11px] font-semibold uppercase tracking-wider">Attestation predates log</span>
    </span>
  ) : result ? (
    <span className="flex items-center gap-1.5 text-muted">
      <Warning size={13} weight="fill" />
      <span className="text-[11px] uppercase tracking-wider">RPC unreachable</span>
    </span>
  ) : null;

  return (
    <div className="glass rounded-md overflow-hidden pointer-events-auto w-72 border-[#2ECC71]/25" style={{ borderWidth: 1 }}>
      <button
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ShieldCheck size={13} className="text-[#2ECC71]" />
          <span className="font-condensed font-semibold text-xs uppercase tracking-[0.18em] text-muted">
            On-chain proof
          </span>
        </span>
        <span className="flex items-center gap-2">
          {!open && integrity}
          {open ? <CaretUp size={13} className="text-muted" /> : <CaretDown size={13} className="text-muted" />}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between border-t border-edge/50 pt-2">
            <span className="text-[11px] text-muted uppercase tracking-wider">Attestation</span>
            <a
              href={solscanTxUrl(att.txSig, att.cluster)}
              target="_blank"
              rel="noreferrer"
              className="tnum flex items-center gap-1 text-[11px] text-[#7BE3A8] hover:underline"
            >
              {short(att.txSig)} <LinkIcon size={10} />
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted uppercase tracking-wider">Status</span>
            <span className="text-[11px] text-[#7BE3A8] font-semibold uppercase tracking-wider">
              {att.status ?? "confirmed"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted uppercase tracking-wider">Replay integrity</span>
            {integrity}
          </div>
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="overflow-hidden"
              >
                <div className="rounded bg-white/[0.04] px-2 py-1.5">
                  <div className="tnum text-[9.5px] text-muted/80 break-all leading-relaxed">
                    boxseat:{fixtureId}:{result.localHash.slice(0, 24)}…
                  </div>
                </div>
                <p className="text-[9.5px] text-muted/60 leading-snug mt-1.5">
                  Fingerprint recomputed in your browser from the replay you are
                  watching, compared against the SPL Memo on {att.cluster === "devnet" ? "devnet" : "mainnet"}.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
