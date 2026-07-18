import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";

/**
 * Loads the service wallet keypair. Prefers the SERVICE_WALLET_JSON env var
 * (the keypair JSON array inline — how cloud hosts inject secrets) and falls
 * back to reading the file at `path` (local dev, `server/_keys/`).
 */
export function loadServiceWallet(path: string): anchor.web3.Keypair {
  const inline = process.env.SERVICE_WALLET_JSON;
  const secretKeyString = inline && inline.trim() ? inline : readFileSync(path, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return anchor.web3.Keypair.fromSecretKey(secretKey);
}
