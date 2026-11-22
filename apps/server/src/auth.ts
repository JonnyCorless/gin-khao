import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { LOGIN_PREFIX } from "@solanasmash/sim";

export const newNonce = () => randomBytes(16).toString("hex");

/** Verify a wallet's ed25519 signature over the login challenge. Returns the base58 pubkey or null. */
export function verifyLogin(pubkey: string, signatureB64: string, nonce: string): string | null {
  try {
    const pk = bs58.decode(pubkey);
    if (pk.length !== 32) return null;
    const sig = Buffer.from(signatureB64, "base64");
    if (sig.length !== 64) return null;
    const msg = new TextEncoder().encode(LOGIN_PREFIX + nonce);
    return nacl.sign.detached.verify(msg, sig, pk) ? pubkey : null;
  } catch {
    return null;
  }
}
