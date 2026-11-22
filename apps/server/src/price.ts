/** Quote the stake: ~$1 in lamports, locked when the match is created. */
const PYTH_SOL_USD = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
// Hermes is configurable: the public endpoint may require auth or rate-limit you. Point HERMES_URL at your provider
// and put any auth header in HERMES_HEADERS as JSON, e.g. {"Authorization":"Bearer <key>"}.
const HERMES = process.env.HERMES_URL ?? "https://hermes.pyth.network/v2/updates/price/latest";
const HERMES_HEADERS: Record<string, string> = (() => { try { return JSON.parse(process.env.HERMES_HEADERS ?? "{}"); } catch { return {}; } })();
const MAX_AGE_S = 60;

export interface Quote { lamports: bigint; solUsd: number }

export function usdToLamports(usd: number, solUsd: number): bigint {
  if (!(solUsd > 0) || !(usd > 0)) throw new Error("bad price");
  const raw = Math.round((usd / solUsd) * 1e9);
  // round to nearest 10_000 lamports (0.00001 SOL) so stakes look tidy
  return BigInt(Math.round(raw / 10_000) * 10_000);
}

export async function fetchSolUsd(fetchImpl: typeof fetch = fetch): Promise<number> {
  const r = await fetchImpl(`${HERMES}?ids[]=${PYTH_SOL_USD}&parsed=true`, { signal: AbortSignal.timeout(4000), headers: HERMES_HEADERS });
  if (!r.ok) throw new Error(`pyth ${r.status}`);
  const j: any = await r.json();
  const p = j?.parsed?.[0]?.price;
  if (!p) throw new Error("pyth: no price");
  const age = Date.now() / 1000 - Number(p.publish_time);
  if (age > MAX_AGE_S) throw new Error(`pyth price stale (${Math.round(age)}s)`);
  const v = Number(p.price) * 10 ** Number(p.expo);
  if (!(v > 1 && v < 10_000)) throw new Error("pyth price out of sane range");
  return v;
}

export async function quoteStake(stakeUsd: number, fallback: number | null, fetchImpl: typeof fetch = fetch): Promise<Quote> {
  let solUsd: number;
  try {
    solUsd = await fetchSolUsd(fetchImpl);
  } catch (e) {
    if (fallback == null) throw new Error(`no SOL price available: ${(e as Error).message}`);
    solUsd = fallback;
  }
  return { lamports: usdToLamports(stakeUsd, solUsd), solUsd };
}
