import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { BotConfig } from "./config.js";

/**
 * Load a dedicated bot keypair from env (base58) or JSON file path.
 * Never log the secret. Prefer a wallet funded only with bot capital.
 */
export function loadKeypair(cfg: BotConfig): Keypair | null {
  if (cfg.solanaPrivateKey) {
    const raw = cfg.solanaPrivateKey.trim();
    // JSON byte array pasted into env
    if (raw.startsWith("[")) {
      const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
      return Keypair.fromSecretKey(bytes);
    }
    return Keypair.fromSecretKey(bs58.decode(raw));
  }

  if (cfg.keypairPath) {
    const text = readFileSync(cfg.keypairPath, "utf8").trim();
    if (text.startsWith("[")) {
      const bytes = Uint8Array.from(JSON.parse(text) as number[]);
      return Keypair.fromSecretKey(bytes);
    }
    return Keypair.fromSecretKey(bs58.decode(text));
  }

  return null;
}

export function publicKeyBase58(kp: Keypair | null): string | null {
  return kp ? kp.publicKey.toBase58() : null;
}
