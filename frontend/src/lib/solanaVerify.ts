import type { MatchState } from "../reducer/types.js";

/**
 * Client-side replay integrity proof. The backend attests each finished
 * match on Solana as `boxseat:<fixtureId>:<sha256(canonical final state)>`,
 * where the canonical state is {fixtureId, score, keyMoments, lastSeq} in
 * exact key order. The frontend recomputes the same fingerprint from the
 * replay it is showing, reads the memo back from the chain, and compares -
 * the proof happens in the browser, with no trusted intermediary.
 */

export type VerifyStatus = "verified" | "stale" | "rpc_error" | "pending";

export interface VerifyResult {
  status: VerifyStatus;
  localHash: string;
  onchainMemo?: string;
  txSig?: string;
}

export async function fingerprintHex(state: MatchState): Promise<string> {
  // EXACT replica of server/src/solana/attestation.ts fingerprint() - same
  // object shape and key order, or the hash differs.
  const canonical = JSON.stringify({
    fixtureId: state.fixtureId,
    score: state.score,
    keyMoments: state.keyMoments,
    lastSeq: state.lastSeq,
  });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * CORS-open community RPC endpoints (the default api.mainnet-beta.solana.com
 * 403s browser requests; PublicNode serves the same JSON-RPC with an open
 * origin policy). The chain read itself is public data.
 */
function rpcUrlFor(cluster: string): string {
  return cluster === "devnet"
    ? "https://solana-devnet-rpc.publicnode.com"
    : "https://solana-rpc.publicnode.com";
}

async function fetchMemoText(txSig: string, cluster: string): Promise<string | null> {
  const res = await fetch(rpcUrlFor(cluster), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        txSig,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ],
    }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = await res.json();
  const ixs = (json?.result?.transaction?.message?.instructions ?? []) as Array<{
    program?: string;
    parsed?: unknown;
  }>;
  for (const ix of ixs) {
    if (ix.program === "spl-memo" && typeof ix.parsed === "string") return ix.parsed;
  }
  return null;
}

export async function verifyReplay(
  finalState: MatchState,
  txSig: string,
  cluster: string
): Promise<VerifyResult> {
  const localHash = await fingerprintHex(finalState);
  try {
    const memo = await fetchMemoText(txSig, cluster);
    if (!memo) return { status: "rpc_error", localHash, txSig };
    const expected = `boxseat:${finalState.fixtureId}:${localHash}`;
    return {
      status: memo === expected ? "verified" : "stale",
      localHash,
      onchainMemo: memo,
      txSig,
    };
  } catch {
    return { status: "rpc_error", localHash, txSig };
  }
}

export function solscanTxUrl(txSig: string, cluster: string): string {
  return `https://solscan.io/tx/${txSig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}

export function explorerTxUrl(txSig: string, cluster: string): string {
  return `https://explorer.solana.com/tx/${txSig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}
