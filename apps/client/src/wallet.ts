import nacl from "tweetnacl";
import bs58 from "bs58";

export interface Wallet {
  kind: "phantom" | "dev";
  pubkey: string;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
  /** Sign + submit a server-built unsigned tx (base64). Returns the signature. */
  signAndSend(txB64: string): Promise<string>;
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function connectPhantom(): Promise<Wallet> {
  const w = window as any;
  const p = w.phantom?.solana ?? w.solana;
  if (!p?.isPhantom) throw new Error("Phantom wallet not found. Install it from phantom.app, or use the dev wallet.");
  const r = await p.connect();
  return {
    kind: "phantom",
    pubkey: r.publicKey.toString(),
    async signMessage(msg) {
      const { signature } = await p.signMessage(msg, "utf8");
      return signature;
    },
    async signAndSend(txB64) {
      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(b64ToBytes(txB64));
      const { signature } = await p.signAndSendTransaction(tx);
      return signature;
    },
  };
}

/** Throwaway keypair in localStorage. Works against the mock chain only; it holds no funds. */
export function devWallet(): Wallet {
  let secret: Uint8Array;
  try {
    const saved = localStorage.getItem("smash.dev.secret");
    secret = saved ? b64ToBytes(saved) : nacl.sign.keyPair().secretKey;
    if (!saved) localStorage.setItem("smash.dev.secret", btoa(String.fromCharCode(...secret)));
  } catch {
    secret = nacl.sign.keyPair().secretKey;
  }
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  return {
    kind: "dev",
    pubkey: bs58.encode(kp.publicKey),
    async signMessage(msg) { return nacl.sign.detached(msg, kp.secretKey); },
    async signAndSend() { return "dev-wallet"; },
  };
}
