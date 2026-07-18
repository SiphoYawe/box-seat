import { PublicKey } from "@solana/web3.js";

export const API_BASE_URL = "https://txline.txodds.com/api";
export const JWT_URL = "https://txline.txodds.com/auth/guest/start";
export const PROGRAM_ID = new PublicKey(
  "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"
);

/** World Cup free tier, real-time (no 60s delay) — see docs/txline/subscription-tiers.md */
export const SERVICE_LEVEL_ID = 12;
export const SUBSCRIPTION_WEEKS = 4;
export const SELECTED_LEAGUES: number[] = [];
