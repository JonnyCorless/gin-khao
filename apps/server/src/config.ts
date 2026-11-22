import { DEFAULT_FEE_BPS, type ChainMode } from "@solanasmash/sim";

export interface Config {
  port: number;
  mode: ChainMode;
  rpcUrl: string;
  programId: string;
  authoritySecret: string | null; // JSON array of bytes, server's settlement key
  treasury: string | null;
  feeBps: number;
  stakeUsd: number;
  fallbackSolUsd: number | null;
  tickMs: number;
  startStocks: number | undefined;
  countdownMs: number;
  depositTimeoutMs: number;
  graceMs: number;
  dataDir: string;
  allowedOrigins: string[]; // empty => allow all (dev)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.CHAIN_MODE ?? "mock") as ChainMode;
  if (mode !== "mock" && mode !== "solana") throw new Error("CHAIN_MODE must be mock|solana");
  const feeBps = Number(env.FEE_BPS ?? DEFAULT_FEE_BPS);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) throw new Error("FEE_BPS must be 0..1000");
  return {
    port: Number(env.PORT ?? 8787),
    mode,
    rpcUrl: env.RPC_URL ?? "https://api.devnet.solana.com",
    programId: env.PROGRAM_ID ?? "3WPvDvnKhi4gKCJreiGGFDX4XTJSKp6yzrCZmL1itRWd",
    authoritySecret: env.AUTHORITY_SECRET ?? null,
    treasury: env.TREASURY ?? null,
    feeBps,
    stakeUsd: Number(env.STAKE_USD ?? 1),
    fallbackSolUsd: env.FALLBACK_SOL_USD ? Number(env.FALLBACK_SOL_USD) : mode === "mock" ? 150 : null,
    tickMs: Number(env.TICK_MS ?? 1000 / 60),
    startStocks: env.START_STOCKS ? Number(env.START_STOCKS) : undefined,
    countdownMs: Number(env.COUNTDOWN_MS ?? 3000),
    depositTimeoutMs: Number(env.DEPOSIT_TIMEOUT_MS ?? 90_000),
    graceMs: Number(env.GRACE_MS ?? 10_000),
    dataDir: env.DATA_DIR ?? "./data",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
