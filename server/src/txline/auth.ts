import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  type Account,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import axios from "axios";
import nacl from "tweetnacl";
import TxoracleJson from "./idl/txoracle.json" with { type: "json" };
import {
  API_BASE_URL,
  JWT_URL,
  PROGRAM_ID,
  SELECTED_LEAGUES,
  SERVICE_LEVEL_ID,
  SUBSCRIPTION_WEEKS,
} from "./config.js";

export interface TxLineSession {
  jwt: string;
  apiToken: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Detects the txoracle `ActiveSubscription` error (code 6016 / hex 0x1780)
 * across the various shapes Anchor and web3.js surface it in: parsed Anchor
 * errors, raw custom-program-error messages, and SendTransactionError logs.
 */
function isActiveSubscriptionError(err: unknown): boolean {
  const e = err as {
    error?: { errorCode?: { code?: string; number?: number } };
    code?: number;
    message?: unknown;
    logs?: unknown;
    transactionLogs?: unknown;
  };
  if (e?.error?.errorCode?.code === "ActiveSubscription") return true;
  if (e?.error?.errorCode?.number === 6016) return true;
  if (e?.code === 6016) return true;

  const texts: string[] = [];
  if (typeof e?.message === "string") texts.push(e.message);
  for (const logs of [e?.logs, e?.transactionLogs]) {
    if (Array.isArray(logs)) {
      texts.push(...logs.filter((l): l is string => typeof l === "string"));
    }
  }
  return texts.some(
    (t) =>
      t.includes("ActiveSubscription") ||
      t.includes("custom program error: 0x1780")
  );
}

/**
 * Subscribes the service wallet to TxLINE's free World Cup tier (if not already
 * subscribed) and returns the activated API session. Run once at service startup.
 *
 * If `existingApiToken` is provided, this bypasses all on-chain calls and
 * activation entirely — it just mints a fresh guest JWT and pairs it with the
 * persisted API token. This mirrors the TxODDS reference's existingApiToken
 * bypass (docs/txline/reference-code/mainnet/common/users.ts) and is what
 * makes restarts genuinely seamless once the entrypoint persists the token.
 */
export async function setupTxLineSession(
  serviceWallet: anchor.web3.Keypair,
  connection: anchor.web3.Connection,
  tokenMint: PublicKey,
  existingApiToken?: string
): Promise<TxLineSession> {
  if (existingApiToken) {
    const jwtResponse = await axios.post(JWT_URL);
    const jwt: string = jwtResponse.data.token;
    return { jwt, apiToken: existingApiToken };
  }

  const wallet = new anchor.Wallet(serviceWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(TxoracleJson as anchor.Idl, provider);
  if (!program.programId.equals(PROGRAM_ID)) {
    throw new Error(
      "Vendored IDL address does not match expected TxLINE program ID"
    );
  }

  const userTokenAccountAddress = getAssociatedTokenAddressSync(
    tokenMint,
    serviceWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const [pricingMatrixPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );

  const accountInfo = await connection.getAccountInfo(userTokenAccountAddress);
  if (!accountInfo) {
    const tx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        serviceWallet.publicKey,
        userTokenAccountAddress,
        serviceWallet.publicKey,
        tokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await anchor.web3.sendAndConfirmTransaction(connection, tx, [serviceWallet], {
      commitment: "confirmed",
    });
  }

  let userTokenAccount: Account | undefined;
  let attempts = 0;
  while (attempts < 5) {
    try {
      userTokenAccount = await getAccount(
        connection,
        userTokenAccountAddress,
        "confirmed",
        TOKEN_2022_PROGRAM_ID
      );
      break;
    } catch (err) {
      if (
        err instanceof TokenAccountNotFoundError ||
        (err as Error)?.name === "TokenAccountNotFoundError"
      ) {
        attempts++;
        console.log(`[TxLINE] RPC not synced. Retrying (${attempts}/5)...`);
        await delay(2000);
      } else {
        throw err;
      }
    }
  }

  if (!userTokenAccount) {
    throw new Error(
      "[TxLINE] RPC failed to sync the service wallet's token account after 5 attempts."
    );
  }

  const [tokenTreasuryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    tokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  const tx = await program.methods
    .subscribe(SERVICE_LEVEL_ID, SUBSCRIPTION_WEEKS)
    .accounts({
      user: serviceWallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .transaction();

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = serviceWallet.publicKey;
  tx.sign(serviceWallet);

  // The signature is fixed once the wallet signs, whether or not the
  // transaction ultimately lands on-chain.
  const txSig = anchor.utils.bytes.bs58.encode(tx.signature!);

  let alreadySubscribed = false;
  try {
    await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      {
        signature: txSig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );
  } catch (err) {
    if (isActiveSubscriptionError(err)) {
      alreadySubscribed = true;
      console.log("[TxLINE] Already subscribed — proceeding to activation");
    } else {
      throw err;
    }
  }

  const jwtResponse = await axios.post(JWT_URL);
  const jwt: string = jwtResponse.data.token;

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, serviceWallet.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  let activationResponse;
  try {
    activationResponse = await axios.post(
      `${API_BASE_URL}/token/activate`,
      { txSig, walletSignature, leagues: SELECTED_LEAGUES },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );
  } catch (err) {
    if (
      alreadySubscribed &&
      axios.isAxiosError(err) &&
      err.response &&
      err.response.status >= 400 &&
      err.response.status < 500
    ) {
      throw new Error(
        `[TxLINE] Wallet already has an active subscription (error 6016), but the ` +
          `activation endpoint rejected the attempted transaction signature ` +
          `(HTTP ${err.response.status}). The attempted subscribe transaction was ` +
          `not accepted on-chain, so TxLINE has no record of it. To recover, reuse ` +
          `the API token issued when the subscription was first activated (persist ` +
          `it across restarts), or activate with the original subscribe ` +
          `transaction's signature, or wait for the current subscription to expire ` +
          `and re-run.`
      );
    }
    throw err;
  }

  const apiToken: string = activationResponse.data.token ?? activationResponse.data;
  return { jwt, apiToken };
}

export async function renewJwt(): Promise<string> {
  const response = await axios.post(JWT_URL);
  return response.data.token;
}
