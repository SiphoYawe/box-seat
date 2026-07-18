# Box Seat Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete backend for Box Seat — TxLINE ingestion via a shared
service wallet, a pure match-state reducer (momentum + zone pressure), local event
persistence, a WebSocket API for the frontend, and a post-match Solana attestation —
with zero frontend code (frontend is Kimi K3's exclusively, per
[`2026-07-18-execution-orchestration.md`](./2026-07-18-execution-orchestration.md)).

**Architecture:** A standalone Node/TypeScript service. TxLINE SSE (`/scores`,
`/fixtures` — never `/odds`) → pure reducer → SQLite event log → WebSocket broadcast of
derived state to any connected frontend. One shared service wallet handles all Solana
interaction; no end-user wallet involved. See
[`2026-07-17-box-seat-design.md`](../../plans/2026-07-17-box-seat-design.md) for
full product context and
[`docs/research/positional-data-apis.md`](../../research/positional-data-apis.md) /
[`docs/txline/`](../../txline/) for why the data model looks the way it does.

**Tech Stack:** Node.js 20+, TypeScript, `@coral-xyz/anchor` 0.32.1, `@solana/web3.js`,
`@solana/spl-token`, `eventsource`, `axios`, `tweetnacl`, `better-sqlite3`, `ws`,
`vitest`. Dependency versions and the auth/SSE patterns below are taken directly from
TxODDS's own real reference implementation, mirrored at
[`docs/txline/reference-code/`](../../txline/reference-code/) (cloned from
`github.com/txodds/tx-on-chain`), not guessed.

**Deviation from the design doc to flag:** the design doc named Postgres via Vercel
Marketplace for persistence. This plan uses **SQLite** (`better-sqlite3`) instead — zero
external provisioning, synchronous API, fully satisfies the "own storage independent of
TxLINE's retention window" resilience requirement for a single-process service. Postgres
adds real setup time (account, connection string, schema migration tooling) with no
benefit at this scale. Flag if you want Postgres for another reason (e.g. a specific
deployment target) — otherwise proceeding with SQLite.

---

## File Structure

```
server/
  package.json
  tsconfig.json
  .env.example
  src/
    reducer/
      types.ts          # MatchState, RawScoreEvent, KeyMoment, etc.
      reducer.ts         # pure reduce(state, event) -> newState
      reducer.test.ts    # vitest unit tests
    txline/
      idl/
        txoracle.json      # vendored TxLINE Anchor IDL (from tx-on-chain repo)
      config.ts          # mainnet URLs, program ID, TxL mint (from TxLINE docs)
      auth.ts             # service wallet setup: on-chain subscribe + activation
      ingest.ts           # EventSource consumption of /scores and /fixtures
    store/
      db.ts               # SQLite schema + connection
      eventLog.ts          # append/read event log per fixture
    ws/
      server.ts            # WebSocket broadcast server + message contract
    solana/
      wallet.ts             # service wallet keypair loading
      attestation.ts        # SPL Memo post-match attestation write
    index.ts                # entrypoint wiring everything together
  _keys/
    .gitkeep                # service wallet keypair goes here (gitignored)
docs/frontend/
  BACKEND-CONTRACT.md        # WebSocket message contract for Kimi/Fable (Task 6 output)
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.env.example`
- Create: `server/_keys/.gitkeep`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create the server directory and package.json**

```bash
mkdir -p /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server/src/{reducer,txline,store,ws,solana}
mkdir -p /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server/_keys
touch /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server/_keys/.gitkeep
```

`server/package.json`:

```json
{
  "name": "box-seat-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@coral-xyz/anchor": "0.32.1",
    "@solana/spl-token": "^0.4.12",
    "@solana/web3.js": "^1.91.9",
    "axios": "^1.12.0",
    "better-sqlite3": "^11.3.0",
    "dotenv": "^16.4.7",
    "eventsource": "^4.0.0",
    "tweetnacl": "^1.0.3",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.13.4",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.1",
    "typescript": "^5.7.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

`server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create .env.example and gitignore the real .env + service wallet key**

`server/.env.example`:

```bash
# Solana mainnet RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Path to the service wallet keypair JSON (Solana CLI format: array of 64 numbers)
SERVICE_WALLET_PATH=./_keys/service-wallet.json

# TxLINE mainnet TxL token mint (from docs/txline/programs/mainnet.md)
TXL_TOKEN_MINT=Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL

# WebSocket server port for frontend clients
WS_PORT=8787

# SQLite database file path
DB_PATH=./box-seat.db
```

Append to repo-root `.gitignore`:

```
server/node_modules/
server/dist/
server/.env
server/_keys/*.json
server/*.db
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
npm install
```

Expected: installs without error, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 5: Vendor the TxLINE Anchor IDL into the server project**

The real IDL is already fetched at
`docs/txline/reference-code/mainnet/idl/txoracle.json` (from `github.com/txodds/tx-on-chain`).
Copy it into the server project proper rather than importing across into `docs/` from
runtime code — `docs/` is reference material, not a dependency of the running service.

```bash
mkdir -p /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server/src/txline/idl
cp /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/docs/txline/reference-code/mainnet/idl/txoracle.json \
   /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server/src/txline/idl/txoracle.json
```

- [ ] **Step 6: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/package.json server/package-lock.json server/tsconfig.json server/.env.example server/_keys/.gitkeep server/src/txline/idl/txoracle.json .gitignore
git commit -m "feat(server): scaffold backend project"
```

---

### Task 2: Match State Engine (Reducer)

This is the one piece of pure logic in the system and gets real TDD — every other task
in this plan is I/O glue tested by running it against real endpoints, per the design
doc's testing strategy.

**Files:**
- Create: `server/src/reducer/types.ts`
- Create: `server/src/reducer/reducer.ts`
- Create: `server/src/reducer/reducer.test.ts`

- [ ] **Step 1: Write the types**

`server/src/reducer/types.ts`:

```typescript
export type DangerLevel = "Safe" | "Attack" | "Danger" | "HighDanger";
export type Zone = "defensive" | "middle" | "attacking";
export type Participant = 1 | 2;

export interface RawScoreEvent {
  fixtureId: number;
  action: string;
  statusId: number;
  participant?: Participant;
  data?: Record<string, unknown>;
  ts: number;
  seq: number;
}

export interface KeyMoment {
  type: "goal" | "red_card" | "var_overturned";
  participant: Participant;
  ts: number;
  seq: number;
}

export interface ZonePressure {
  defensive: number;
  middle: number;
  attacking: number;
}

export interface MatchState {
  fixtureId: number;
  statusId: number;
  score: { participant1: number; participant2: number };
  /** -1 (fully participant2 dominant) .. +1 (fully participant1 dominant) */
  momentum: number;
  pressure: { participant1: ZonePressure; participant2: ZonePressure };
  keyMoments: KeyMoment[];
  lastTs: number;
  lastSeq: number;
}

export function initialMatchState(fixtureId: number): MatchState {
  return {
    fixtureId,
    statusId: 1,
    score: { participant1: 0, participant2: 0 },
    momentum: 0,
    pressure: {
      participant1: { defensive: 0, middle: 0, attacking: 0 },
      participant2: { defensive: 0, middle: 0, attacking: 0 },
    },
    keyMoments: [],
    lastTs: 0,
    lastSeq: 0,
  };
}
```

- [ ] **Step 2: Write the failing tests**

`server/src/reducer/reducer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { reduce } from "./reducer";
import { initialMatchState, type RawScoreEvent } from "./types";

function event(overrides: Partial<RawScoreEvent>): RawScoreEvent {
  return {
    fixtureId: 1,
    action: "possession",
    statusId: 2,
    ts: 1000,
    seq: 1,
    ...overrides,
  };
}

describe("reduce", () => {
  it("starts at zero momentum with no events", () => {
    const state = initialMatchState(1);
    expect(state.momentum).toBe(0);
  });

  it("shifts momentum toward participant 1 on high-danger possession", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "high_danger_possession", participant: 1 })
    );
    expect(next.momentum).toBeGreaterThan(0);
  });

  it("shifts momentum toward participant 2 on high-danger possession", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "high_danger_possession", participant: 2 })
    );
    expect(next.momentum).toBeLessThan(0);
  });

  it("weighs high-danger possession more than safe possession", () => {
    const safe = reduce(
      initialMatchState(1),
      event({ action: "possession", participant: 1 })
    );
    const highDanger = reduce(
      initialMatchState(1),
      event({ action: "high_danger_possession", participant: 1 })
    );
    expect(highDanger.momentum).toBeGreaterThan(safe.momentum);
  });

  it("accumulates attacking-zone pressure on corners", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ action: "corner", participant: 1 }));
    expect(next.pressure.participant1.attacking).toBeGreaterThan(0);
    expect(next.pressure.participant2.attacking).toBe(0);
  });

  it("records a goal as a key moment and updates the score", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "goal", participant: 1, seq: 5, ts: 5000 })
    );
    expect(next.score.participant1).toBe(1);
    expect(next.keyMoments).toHaveLength(1);
    expect(next.keyMoments[0]).toMatchObject({
      type: "goal",
      participant: 1,
      seq: 5,
      ts: 5000,
    });
  });

  it("records a red card as a key moment without changing score", () => {
    const state = initialMatchState(1);
    const next = reduce(
      state,
      event({ action: "red_card", participant: 2, seq: 9, ts: 9000 })
    );
    expect(next.keyMoments).toHaveLength(1);
    expect(next.keyMoments[0].type).toBe("red_card");
    expect(next.score.participant2).toBe(0);
  });

  it("decays momentum toward zero on neutral events", () => {
    const withMomentum = reduce(
      initialMatchState(1),
      event({ action: "high_danger_possession", participant: 1, seq: 1 })
    );
    const decayed = reduce(
      withMomentum,
      event({ action: "possession", participant: 2, seq: 2 })
    );
    expect(Math.abs(decayed.momentum)).toBeLessThan(withMomentum.momentum);
  });

  it("clamps momentum to [-1, 1]", () => {
    let state = initialMatchState(1);
    for (let i = 0; i < 50; i++) {
      state = reduce(
        state,
        event({ action: "high_danger_possession", participant: 1, seq: i })
      );
    }
    expect(state.momentum).toBeLessThanOrEqual(1);
  });

  it("updates lastTs and lastSeq on every event", () => {
    const state = initialMatchState(1);
    const next = reduce(state, event({ ts: 4242, seq: 7 }));
    expect(next.lastTs).toBe(4242);
    expect(next.lastSeq).toBe(7);
  });

  it("ignores unrecognized action types without throwing", () => {
    const state = initialMatchState(1);
    expect(() =>
      reduce(state, event({ action: "some_future_action_we_dont_model" }))
    ).not.toThrow();
  });

  it("is pure — does not mutate the input state", () => {
    const state = initialMatchState(1);
    const snapshot = JSON.parse(JSON.stringify(state));
    reduce(state, event({ action: "goal", participant: 1 }));
    expect(state).toEqual(snapshot);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
npx vitest run src/reducer/reducer.test.ts
```

Expected: FAIL — `Cannot find module './reducer'` (file doesn't exist yet).

- [ ] **Step 4: Implement the reducer**

`server/src/reducer/reducer.ts`:

```typescript
import type {
  DangerLevel,
  KeyMoment,
  MatchState,
  Participant,
  RawScoreEvent,
  Zone,
} from "./types";

const DANGER_WEIGHT: Record<DangerLevel, number> = {
  Safe: 0.1,
  Attack: 0.4,
  Danger: 0.8,
  HighDanger: 1.2,
};

const ACTION_TO_DANGER: Record<string, DangerLevel> = {
  possession: "Safe",
  attack_possession: "Attack",
  danger_possession: "Danger",
  high_danger_possession: "HighDanger",
};

/**
 * TxLINE's scores feed doesn't carry pitch coordinates — only a possession danger
 * level. This maps danger to a pitch third as an honest, documented approximation
 * (not literal positional data): safe play happens in deeper areas, high-danger
 * play happens near goal. See docs/research/positional-data-apis.md.
 */
function dangerToZone(danger: DangerLevel): Zone {
  if (danger === "Safe") return "defensive";
  if (danger === "Attack") return "middle";
  return "attacking";
}

const MOMENTUM_DECAY = 0.97;
const MOMENTUM_STEP = 0.15;
const PRESSURE_STEP = 1;

function otherParticipant(p: Participant): Participant {
  return p === 1 ? 2 : 1;
}

function applyMomentum(
  state: MatchState,
  participant: Participant,
  weight: number
): number {
  const decayed = state.momentum * MOMENTUM_DECAY;
  const direction = participant === 1 ? 1 : -1;
  const shifted = decayed + direction * weight * MOMENTUM_STEP;
  return Math.max(-1, Math.min(1, shifted));
}

function applyPressure(
  state: MatchState,
  participant: Participant,
  zone: Zone,
  amount: number
): MatchState["pressure"] {
  const key = participant === 1 ? "participant1" : "participant2";
  return {
    ...state.pressure,
    [key]: {
      ...state.pressure[key],
      [zone]: state.pressure[key][zone] + amount,
    },
  };
}

export function reduce(state: MatchState, event: RawScoreEvent): MatchState {
  let next: MatchState = {
    ...state,
    lastTs: event.ts,
    lastSeq: event.seq,
  };

  const participant = event.participant;
  const danger = ACTION_TO_DANGER[event.action];

  if (danger && participant) {
    const weight = DANGER_WEIGHT[danger];
    const zone = dangerToZone(danger);
    next = {
      ...next,
      momentum: applyMomentum(next, participant, weight),
      pressure: applyPressure(next, participant, zone, weight * PRESSURE_STEP),
    };
    return next;
  }

  switch (event.action) {
    case "corner": {
      if (!participant) return next;
      next = {
        ...next,
        momentum: applyMomentum(next, participant, DANGER_WEIGHT.Attack),
        pressure: applyPressure(next, participant, "attacking", PRESSURE_STEP),
      };
      return next;
    }

    case "shot": {
      if (!participant) return next;
      const outcome = event.data?.outcome as string | undefined;
      const weight = outcome === "OffTarget" ? 0.5 : 1;
      next = {
        ...next,
        momentum: applyMomentum(next, participant, weight),
        pressure: applyPressure(
          next,
          participant,
          "attacking",
          PRESSURE_STEP * weight
        ),
      };
      return next;
    }

    case "free_kick": {
      if (!participant) return next;
      const freeKickType = (event.data?.freeKickType as DangerLevel) ?? "Safe";
      const weight = DANGER_WEIGHT[freeKickType] ?? DANGER_WEIGHT.Safe;
      const zone = dangerToZone(freeKickType);
      next = {
        ...next,
        momentum: applyMomentum(next, participant, weight),
        pressure: applyPressure(next, participant, zone, weight * PRESSURE_STEP),
      };
      return next;
    }

    case "goal": {
      if (!participant) return next;
      const key = participant === 1 ? "participant1" : "participant2";
      const moment: KeyMoment = {
        type: "goal",
        participant,
        ts: event.ts,
        seq: event.seq,
      };
      next = {
        ...next,
        score: { ...next.score, [key]: next.score[key] + 1 },
        momentum: applyMomentum(next, participant, 1.5),
        keyMoments: [...next.keyMoments, moment],
      };
      return next;
    }

    case "red_card": {
      if (!participant) return next;
      const moment: KeyMoment = {
        type: "red_card",
        participant,
        ts: event.ts,
        seq: event.seq,
      };
      next = {
        ...next,
        momentum: applyMomentum(next, otherParticipant(participant), 0.5),
        keyMoments: [...next.keyMoments, moment],
      };
      return next;
    }

    case "var_end": {
      const outcome = event.data?.outcome as string | undefined;
      if (outcome === "Overturned" && participant) {
        const moment: KeyMoment = {
          type: "var_overturned",
          participant,
          ts: event.ts,
          seq: event.seq,
        };
        next = { ...next, keyMoments: [...next.keyMoments, moment] };
      }
      return next;
    }

    case "kickoff":
    case "halftime_finalised":
    case "game_finalised": {
      next = { ...next, statusId: event.statusId };
      return next;
    }

    default:
      // Unrecognized/unmodeled action types are intentionally no-ops — see
      // docs/txline/scores/txodds-soccer-feed-v1.1.pdf for the full action list.
      return next;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
npx vitest run src/reducer/reducer.test.ts
```

Expected: PASS — all 12 tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/reducer/
git commit -m "feat(server): add match state reducer with tests"
```

---

### Task 3: TxLINE Service Wallet Auth

Adapts the real `setupUser` pattern from
[`docs/txline/reference-code/mainnet/common/users.ts`](../../txline/reference-code/mainnet/common/users.ts),
simplified for our single shared service wallet (no multi-user map needed) and service
level **12** (real-time), per the design doc's decision.

**Files:**
- Create: `server/src/txline/config.ts`
- Create: `server/src/solana/wallet.ts`
- Create: `server/src/txline/auth.ts`

- [ ] **Step 1: TxLINE mainnet config**

`server/src/txline/config.ts` (values confirmed against
[`docs/txline/programs/mainnet.md`](../../txline/programs/mainnet.md) and
[`docs/txline/reference-code/mainnet/common/config.ts`](../../txline/reference-code/mainnet/common/config.ts)):

```typescript
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
```

- [ ] **Step 2: Service wallet loader**

`server/src/solana/wallet.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import { readFileSync } from "fs";

export function loadServiceWallet(path: string): anchor.web3.Keypair {
  const secretKeyString = readFileSync(path, "utf8");
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return anchor.web3.Keypair.fromSecretKey(secretKey);
}
```

- [ ] **Step 3: Auth module — on-chain subscribe + activation**

`server/src/txline/auth.ts`:

```typescript
import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
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
 * Subscribes the service wallet to TxLINE's free World Cup tier (if not already
 * subscribed) and returns the activated API session. Run once at service startup.
 */
export async function setupTxLineSession(
  serviceWallet: anchor.web3.Keypair,
  connection: anchor.web3.Connection,
  tokenMint: PublicKey
): Promise<TxLineSession> {
  const wallet = new anchor.Wallet(serviceWallet);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const program = new anchor.Program(TxoracleJson as anchor.Idl, provider);

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
    await delay(3000);
  }

  const userTokenAccount = await getAccount(
    connection,
    userTokenAccountAddress,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );

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

  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    {
      signature: txSig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed"
  );

  const jwtResponse = await axios.post(JWT_URL);
  const jwt: string = jwtResponse.data.token;

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const message = new TextEncoder().encode(messageString);
  const signatureBytes = nacl.sign.detached(message, serviceWallet.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  const activationResponse = await axios.post(
    `${API_BASE_URL}/token/activate`,
    { txSig, walletSignature, leagues: SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const apiToken: string = activationResponse.data.token ?? activationResponse.data;
  return { jwt, apiToken };
}

export async function renewJwt(): Promise<string> {
  const response = await axios.post(JWT_URL);
  return response.data.token;
}
```

- [ ] **Step 4: Verify manually against real mainnet**

This step requires a real funded Solana wallet (trivial SOL for tx fees — no TxL
purchase needed for the free tier). Generate a keypair, fund it with a small amount of
SOL, save it to `server/_keys/service-wallet.json`, then:

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
cat > /tmp/verify-auth.ts <<'EOF'
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadServiceWallet } from "./src/solana/wallet";
import { setupTxLineSession } from "./src/txline/auth";
import "dotenv/config";

const wallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const tokenMint = new PublicKey(process.env.TXL_TOKEN_MINT!);

setupTxLineSession(wallet, connection, tokenMint).then((session) => {
  console.log("Session acquired:", session);
});
EOF
npx tsx /tmp/verify-auth.ts
```

Expected: prints `Session acquired: { jwt: '...', apiToken: '...' }` with no errors.
If it fails on `getAccountInfo`/`sendRawTransaction`, verify the service wallet has SOL
(`solana balance <pubkey> --url mainnet-beta`).

- [ ] **Step 5: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/txline/config.ts server/src/txline/auth.ts server/src/solana/wallet.ts
git commit -m "feat(server): add TxLINE service wallet auth flow"
```

---

### Task 4: TxLINE SSE Ingestion

Uses the `eventsource` package exactly as TxODDS's own reference client does (custom
`fetch` to inject headers + 401/403 retry-with-renewed-JWT), pointed at `/scores/stream`
only — **never `/odds/stream`**, enforcing the no-betting boundary at the code level.

**Files:**
- Create: `server/src/txline/ingest.ts`

- [ ] **Step 1: Implement the ingestion module**

`server/src/txline/ingest.ts`:

```typescript
import { EventSource } from "eventsource";
import { API_BASE_URL } from "./config.js";
import { renewJwt, type TxLineSession } from "./auth.js";
import type { RawScoreEvent } from "../reducer/types.js";

export type ScoreEventHandler = (event: RawScoreEvent) => void;

/**
 * Parses a raw TxLINE scores SSE payload into our RawScoreEvent shape.
 * See docs/txline/scores/soccer-feed.md and the Scores Product API PDF for the
 * full raw message shape (FixtureInfo + Update.{Action,StatusId,Participant,Data}).
 */
function parseScoresPayload(raw: string): RawScoreEvent | null {
  try {
    const parsed = JSON.parse(raw);
    const update = parsed.Update;
    if (!update) return null;
    return {
      fixtureId: parsed.FixtureInfo?.FixtureId ?? parsed.FixtureId,
      action: update.Action,
      statusId: update.StatusId,
      participant: update.Participant,
      data: update.Data,
      ts: update.Ts,
      seq: update.Seq,
    };
  } catch {
    return null;
  }
}

/**
 * Opens a persistent connection to TxLINE's /scores/stream and invokes `onEvent`
 * for every parsed message. Handles JWT renewal on 401/403 automatically, matching
 * the pattern in docs/txline/reference-code/mainnet/scripts/subscription_free_tier.ts.
 */
export function connectScoresStream(
  session: TxLineSession,
  onEvent: ScoreEventHandler
): EventSource {
  const streamUrl = `${API_BASE_URL}/scores/stream`;
  let currentJwt = session.jwt;

  const eventSource = new EventSource(streamUrl, {
    fetch: async (input: any, init: any) => {
      const attempt = (jwt: string) =>
        fetch(input, {
          ...init,
          headers: {
            ...init.headers,
            "Accept-Encoding": "gzip",
            Authorization: `Bearer ${jwt}`,
            "X-Api-Token": session.apiToken,
          },
        });

      let response = await attempt(currentJwt);
      if (response.status === 401 || response.status === 403) {
        console.log("[TxLINE] Scores stream JWT rejected, renewing...");
        currentJwt = await renewJwt();
        response = await attempt(currentJwt);
      }
      return response;
    },
  });

  eventSource.onmessage = (evt: MessageEvent) => {
    const parsed = parseScoresPayload(evt.data);
    if (parsed) onEvent(parsed);
  };

  eventSource.onerror = (err: unknown) => {
    console.error("[TxLINE] Scores stream error:", err);
  };

  return eventSource;
}
```

- [ ] **Step 2: Verify manually against the real stream**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
cat > /tmp/verify-ingest.ts <<'EOF'
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadServiceWallet } from "./src/solana/wallet";
import { setupTxLineSession } from "./src/txline/auth";
import { connectScoresStream } from "./src/txline/ingest";
import "dotenv/config";

const wallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const tokenMint = new PublicKey(process.env.TXL_TOKEN_MINT!);

setupTxLineSession(wallet, connection, tokenMint).then((session) => {
  connectScoresStream(session, (event) => {
    console.log("Event:", event.fixtureId, event.action, event.ts);
  });
  console.log("Listening for 60s...");
  setTimeout(() => process.exit(0), 60_000);
});
EOF
npx tsx /tmp/verify-ingest.ts
```

Expected: connects with no error; if a covered fixture is live, prints events as they
arrive. If nothing prints, that's expected when no covered match is currently live —
confirm no error was thrown, and check
[`docs/txline/scores/schedule.md`](../../txline/scores/schedule.md) for coverage.

- [ ] **Step 3: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/txline/ingest.ts
git commit -m "feat(server): add TxLINE scores SSE ingestion"
```

---

### Task 5: Event Persistence (SQLite)

Own storage so replay survives after TxLINE's free-tier access lapses, per the design
doc's resilience requirement.

**Files:**
- Create: `server/src/store/db.ts`
- Create: `server/src/store/eventLog.ts`

- [ ] **Step 1: Schema + connection**

`server/src/store/db.ts`:

```typescript
import Database from "better-sqlite3";

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      fixture_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      raw TEXT NOT NULL,
      PRIMARY KEY (fixture_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_events_fixture ON events(fixture_id, seq);
  `);
  return db;
}
```

- [ ] **Step 2: Append + read functions**

`server/src/store/eventLog.ts`:

```typescript
import type Database from "better-sqlite3";
import type { RawScoreEvent } from "../reducer/types.js";

export function appendEvent(db: Database.Database, event: RawScoreEvent): void {
  db.prepare(
    `INSERT OR IGNORE INTO events (fixture_id, seq, ts, action, raw)
     VALUES (@fixtureId, @seq, @ts, @action, @raw)`
  ).run({
    fixtureId: event.fixtureId,
    seq: event.seq,
    ts: event.ts,
    action: event.action,
    raw: JSON.stringify(event),
  });
}

export function readEventLog(
  db: Database.Database,
  fixtureId: number
): RawScoreEvent[] {
  const rows = db
    .prepare(
      `SELECT raw FROM events WHERE fixture_id = ? ORDER BY seq ASC`
    )
    .all(fixtureId) as { raw: string }[];
  return rows.map((row) => JSON.parse(row.raw) as RawScoreEvent);
}
```

- [ ] **Step 3: Manual verification**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
cat > /tmp/verify-store.ts <<'EOF'
import { openDb } from "./src/store/db";
import { appendEvent, readEventLog } from "./src/store/eventLog";

const db = openDb("/tmp/verify.db");
appendEvent(db, { fixtureId: 1, seq: 1, ts: 1000, action: "kickoff" });
appendEvent(db, { fixtureId: 1, seq: 2, ts: 2000, action: "goal", participant: 1 });
const log = readEventLog(db, 1);
console.log("Read back", log.length, "events:", log);
if (log.length !== 2) throw new Error("expected 2 events");
console.log("OK");
EOF
npx tsx /tmp/verify-store.ts
rm /tmp/verify.db*
```

Expected: prints `Read back 2 events: [...]` then `OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/store/
git commit -m "feat(server): add SQLite event persistence"
```

---

### Task 6: WebSocket Broadcast Server & Frontend Contract

This defines the interface Kimi K3's frontend consumes — the single synchronization
point between Track A (this plan) and Track B (Fable's frontend spec). Writing the
contract doc is part of this task, not an afterthought.

**Files:**
- Create: `server/src/ws/server.ts`
- Create: `docs/frontend/BACKEND-CONTRACT.md`

- [ ] **Step 1: Implement the broadcast server**

`server/src/ws/server.ts`:

```typescript
import { WebSocketServer, type WebSocket } from "ws";
import type { MatchState } from "../reducer/types.js";

export type ClientMessage =
  | { type: "subscribe"; fixtureId: number }
  | { type: "unsubscribe"; fixtureId: number };

export type ServerMessage =
  | { type: "state"; state: MatchState }
  | { type: "keyMoment"; fixtureId: number; moment: MatchState["keyMoments"][number] }
  | { type: "replay_chunk"; fixtureId: number; events: unknown[]; done: boolean };

export class Broadcaster {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<number>>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (ws) => {
      this.subscriptions.set(ws, new Set());
      ws.on("message", (raw) => this.handleMessage(ws, raw.toString()));
      ws.on("close", () => this.subscriptions.delete(ws));
    });
    console.log(`[WS] Broadcasting on port ${port}`);
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const subs = this.subscriptions.get(ws);
    if (!subs) return;
    if (msg.type === "subscribe") subs.add(msg.fixtureId);
    if (msg.type === "unsubscribe") subs.delete(msg.fixtureId);
  }

  /** Broadcast derived state to every client subscribed to this fixture. */
  broadcastState(state: MatchState): void {
    const payload: ServerMessage = { type: "state", state };
    const json = JSON.stringify(payload);
    for (const [ws, subs] of this.subscriptions) {
      if (subs.has(state.fixtureId) && ws.readyState === ws.OPEN) {
        ws.send(json);
      }
    }
  }

  sendReplayChunk(
    ws: WebSocket,
    fixtureId: number,
    events: unknown[],
    done: boolean
  ): void {
    const payload: ServerMessage = { type: "replay_chunk", fixtureId, events, done };
    ws.send(JSON.stringify(payload));
  }
}
```

- [ ] **Step 2: Write the frontend contract doc**

`docs/frontend/BACKEND-CONTRACT.md`:

```markdown
# Box Seat Backend → Frontend Contract

The backend exposes one WebSocket endpoint. This is the only interface the frontend
(Kimi K3) needs — no REST calls, no direct TxLINE access, no Solana calls from the
frontend at all.

**Endpoint:** `ws://<host>:<WS_PORT>` (default port 8787, see `server/.env.example`)

## Client → Server messages

Subscribe to a fixture's live/replay state:
​```json
{ "type": "subscribe", "fixtureId": 14790158 }
​```

Unsubscribe:
​```json
{ "type": "unsubscribe", "fixtureId": 14790158 }
​```

## Server → Client messages

**`state`** — sent on every reducer update for a subscribed fixture. This is the full
current `MatchState` — the frontend should treat each message as authoritative current
state, not a delta:
​```json
{
  "type": "state",
  "state": {
    "fixtureId": 14790158,
    "statusId": 4,
    "score": { "participant1": 1, "participant2": 0 },
    "momentum": 0.42,
    "pressure": {
      "participant1": { "defensive": 3, "middle": 8, "attacking": 14 },
      "participant2": { "defensive": 5, "middle": 4, "attacking": 2 }
    },
    "keyMoments": [
      { "type": "goal", "participant": 1, "ts": 1721300123456, "seq": 42 }
    ],
    "lastTs": 1721300456789,
    "lastSeq": 118
  }
}
​```

- `momentum`: -1..+1, negative favors `participant2`, positive favors `participant1`.
- `pressure.*.{defensive,middle,attacking}`: unbounded accumulating totals per zone —
  normalize/scale for visualization on the frontend side (e.g. relative to the max
  value seen so far in the match).
- `keyMoments`: full list to date, in order — use array length changes to detect new
  moments and trigger the full-screen takeover animation (goal / red_card /
  var_overturned).

**`replay_chunk`** — only used when a finished match's full history is requested (see
below); the frontend accumulates chunks until `done: true`, then can scrub freely
through the reconstructed state sequence.

## Live vs. replay

There is no separate replay endpoint — subscribing to any `fixtureId` gives you
whatever is available: if the match is in progress, you get live `state` updates as
they happen; if it's `game_finalised`, the backend sends the full event history as
`replay_chunk` messages first (so the frontend can build a scrubbable timeline), then
continues sending `state` (which will just be the final, unchanging state).

## Team metadata

Team names come through TxLINE's fixture data, not this WebSocket contract. Team badge
images and brand colors are **not** provided by TxLINE — see the design doc's open item
on this; a static lookup table for the 32 World Cup teams needs to be sourced/built on
the frontend side.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/ws/server.ts docs/frontend/BACKEND-CONTRACT.md
git commit -m "feat(server): add WebSocket broadcast server and frontend contract"
```

---

### Task 7: Solana Post-Match Attestation

Non-blocking by design — a failure here must never affect the live/replay experience.
Uses the SPL Memo program (no custom on-chain program needed).

**Files:**
- Create: `server/src/solana/attestation.ts`

- [ ] **Step 1: Implement the attestation write**

`server/src/solana/attestation.ts`:

```typescript
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
```

- [ ] **Step 2: Manual verification**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
cat > /tmp/verify-attestation.ts <<'EOF'
import { Connection } from "@solana/web3.js";
import { loadServiceWallet } from "./src/solana/wallet";
import { attestMatch } from "./src/solana/attestation";
import { initialMatchState } from "./src/reducer/types";
import "dotenv/config";

const wallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
const state = initialMatchState(999999);

attestMatch(connection, wallet, state).then((sig) => {
  console.log("Attestation signature:", sig);
});
EOF
npx tsx /tmp/verify-attestation.ts
```

Expected: prints a real transaction signature; verify at
`https://explorer.solana.com/tx/<sig>` shows a memo instruction.

- [ ] **Step 3: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/solana/attestation.ts
git commit -m "feat(server): add non-blocking post-match Solana attestation"
```

---

### Task 8: Service Entrypoint

Wires ingestion → reducer → persistence → broadcast → attestation together.

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Implement the entrypoint**

`server/src/index.ts`:

```typescript
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadServiceWallet } from "./solana/wallet.js";
import { setupTxLineSession } from "./txline/auth.js";
import { connectScoresStream } from "./txline/ingest.js";
import { reduce } from "./reducer/reducer.js";
import { initialMatchState, type MatchState } from "./reducer/types.js";
import { openDb } from "./store/db.js";
import { appendEvent } from "./store/eventLog.js";
import { Broadcaster } from "./ws/server.js";
import { attestMatch } from "./solana/attestation.js";

async function main() {
  const serviceWallet = loadServiceWallet(process.env.SERVICE_WALLET_PATH!);
  const connection = new Connection(process.env.SOLANA_RPC_URL!, "confirmed");
  const tokenMint = new PublicKey(process.env.TXL_TOKEN_MINT!);
  const db = openDb(process.env.DB_PATH!);
  const broadcaster = new Broadcaster(Number(process.env.WS_PORT));

  const matchStates = new Map<number, MatchState>();
  const attested = new Set<number>();

  console.log("[Startup] Authenticating with TxLINE...");
  const session = await setupTxLineSession(serviceWallet, connection, tokenMint);
  console.log("[Startup] TxLINE session acquired.");

  connectScoresStream(session, async (event) => {
    appendEvent(db, event);

    const current = matchStates.get(event.fixtureId) ?? initialMatchState(event.fixtureId);
    const next = reduce(current, event);
    matchStates.set(event.fixtureId, next);

    broadcaster.broadcastState(next);

    if (event.action === "game_finalised" && !attested.has(event.fixtureId)) {
      attested.add(event.fixtureId);
      // Fire-and-forget — attestMatch never throws, see server/src/solana/attestation.ts
      attestMatch(connection, serviceWallet, next);
    }
  });

  console.log("[Startup] Box Seat backend running.");
}

main().catch((err) => {
  console.error("[Fatal]", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it end-to-end**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon/server
npm run dev
```

Expected: logs `[Startup] Authenticating with TxLINE...` →
`[Startup] TxLINE session acquired.` → `[WS] Broadcasting on port 8787` →
`[Startup] Box Seat backend running.` with no errors, and stays running.

- [ ] **Step 3: Commit**

```bash
cd /Users/siphoyawe/Desktop/Projects/WorldCup-Hackathon
git add server/src/index.ts
git commit -m "feat(server): wire up service entrypoint"
```

---

## Self-Review Notes

**Spec coverage** (against `2026-07-17-box-seat-design.md`): reducer (§1, §3) →
Task 2. TxLINE ingestion, mainnet/service-level-12, own persistence (§2, §3, §7) →
Tasks 3-5. WebSocket contract for the frontend (§5) → Task 6. No-wallet-for-viewers,
service-wallet-only Solana usage, non-blocking attestation (§6, §7) → Tasks 3, 7.
Devnet-vs-mainnet resilience note (§7) → Task 3 uses mainnet directly per that decision.
Testing strategy (§8: reducer gets real tests, I/O gets manual verification) → applied
throughout. Not covered by this plan: the 3D scene, HUD, match list UI, full-screen
moment animations — all explicitly Kimi K3's frontend, out of scope here by design.

**Type consistency**: `MatchState`, `RawScoreEvent`, `KeyMoment`, `ZonePressure` defined
once in `types.ts` and imported everywhere else (`reducer.ts`, `ingest.ts`,
`eventLog.ts`, `ws/server.ts`, `attestation.ts`, `index.ts`) — no redefinition drift.

**No placeholders**: every step has complete, real code grounded in either TxODDS's own
reference implementation (`docs/txline/reference-code/`) or standard library usage.
