import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import type { MatchState } from "../reducer/types.js";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

function fingerprint(state: MatchState): string {
  const canonical = JSON.stringify({
    fixtureId: state.fixtureId,
    score: state.score,
    keyMoments: state.keyMoments,
    lastSeq: state.lastSeq,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Writes a compact on-chain attestation of a finished match's final state via the
 * SPL Memo program. Never throws to the caller — attestation failures are logged
 * and swallowed so they can't break the live/replay experience (see design doc §7).
 */
export async function attestMatch(
  connection: anchor.web3.Connection,
  serviceWallet: anchor.web3.Keypair,
  state: MatchState
): Promise<string | null> {
  try {
    const memo = `boxseat:${state.fixtureId}:${fingerprint(state)}`;
    const instruction = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf8"),
    });

    const tx = new Transaction().add(instruction);
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latestBlockhash.blockhash;
    tx.feePayer = serviceWallet.publicKey;
    tx.sign(serviceWallet);

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );
    console.log(`[Attestation] Fixture ${state.fixtureId} attested: ${sig}`);
    return sig;
  } catch (err) {
    console.error(
      `[Attestation] Failed for fixture ${state.fixtureId} (non-fatal):`,
      err
    );
    return null;
  }
}
