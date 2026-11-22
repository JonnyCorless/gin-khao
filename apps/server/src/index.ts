import { loadConfig } from "./config.ts";
import { startServer } from "./server.ts";

const cfg = loadConfig();
const { port } = await startServer(cfg);
console.log(`SolanaSmash server on :${port}  mode=${cfg.mode}  fee=${cfg.feeBps / 100}%  stake=${Number(cfg.stakeLamports) / 1e9} SOL each`);
if (cfg.mode === "mock") console.log("MOCK CHAIN: no real funds move. Set CHAIN_MODE=solana for devnet.");
