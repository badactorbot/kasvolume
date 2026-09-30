import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { BotConfig } from "../config.js";
import {
  JupiterPerpsClient,
  normalizePositions,
} from "../market/jupiter.js";
import type { OrderIntent, PositionView } from "../types.js";

export interface ExecutionResult {
  dryRun: boolean;
  ok: boolean;
  detail: string;
  txid?: string;
}

/**
 * Jupiter Perps execution: build request tx via API → sign → /transaction/execute.
 * When DRY_RUN=true, only logs intents (no sign/broadcast).
 */
export class ExecutionService {
  constructor(
    private readonly cfg: BotConfig,
    private readonly client: JupiterPerpsClient,
    private readonly connection: Connection,
    private readonly keypair: Keypair | null,
  ) {}

  async listPositions(walletAddress: string): Promise<PositionView[]> {
    try {
      const raw = await this.client.getPositions(walletAddress);
      return normalizePositions(raw);
    } catch (err) {
      console.warn(
        "[execution] getPositions failed",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  }

  async execute(
    intent: OrderIntent,
    walletAddress: string,
  ): Promise<ExecutionResult> {
    if (this.cfg.dryRun) {
      const msg = `[DRY_RUN] would ${intent.kind} ${intent.side ?? ""} — ${intent.reason} collateralRaw=${intent.collateralRaw ?? "n/a"} lev=${intent.leverage ?? "n/a"}`;
      console.log(msg);
      return { dryRun: true, ok: true, detail: msg };
    }

    if (!this.keypair) {
      return {
        dryRun: false,
        ok: false,
        detail: "No keypair loaded for live execution",
      };
    }

    try {
      if (intent.kind === "flatten" || intent.kind === "close_all") {
        return await this.closeAll(walletAddress);
      }

      if (intent.kind === "increase" && intent.side) {
        return await this.increase(walletAddress, intent);
      }

      if (intent.kind === "decrease") {
        // TODO: map decrease fields once position pubkey + size delta confirmed
        return {
          dryRun: false,
          ok: false,
          detail: "decrease path not fully wired — use flatten/close-all",
        };
      }

      return { dryRun: false, ok: false, detail: `unknown intent ${intent.kind}` };
    } catch (err) {
      return {
        dryRun: false,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async increase(
    walletAddress: string,
    intent: OrderIntent,
  ): Promise<ExecutionResult> {
    const leverage = intent.leverage ?? this.cfg.maxLeverage;
    if (leverage > this.cfg.maxLeverage) {
      return {
        dryRun: false,
        ok: false,
        detail: `leverage ${leverage} > MAX_LEVERAGE ${this.cfg.maxLeverage}`,
      };
    }

    const built = await this.client.increasePosition({
      walletAddress,
      asset: "SOL",
      inputToken: "USDC",
      inputTokenAmount: intent.collateralRaw ?? "0",
      side: intent.side!,
      leverage: String(leverage),
      maxSlippageBps: String(intent.maxSlippageBps ?? this.cfg.maxSlippageBps),
    });

    return this.signAndExecute("increase-position", built.serializedTxBase64);
  }

  private async closeAll(walletAddress: string): Promise<ExecutionResult> {
    const built = await this.client.closeAllPositions(walletAddress);
    const first =
      built.serializedTxBase64 ??
      built.serializedTxs?.[0]?.serializedTxBase64;
    if (!first) {
      return {
        dryRun: false,
        ok: true,
        detail: "close-all: no open positions / empty serializedTxs",
      };
    }
    // TODO: if multiple positions, iterate serializedTxs and execute each
    return this.signAndExecute("close-all-positions", first);
  }

  private async signAndExecute(
    action: string,
    serializedTxBase64: string | undefined,
  ): Promise<ExecutionResult> {
    if (!serializedTxBase64) {
      return {
        dryRun: false,
        ok: false,
        detail: "API returned no serializedTxBase64",
      };
    }
    if (!this.keypair) {
      return { dryRun: false, ok: false, detail: "missing keypair" };
    }

    const raw = Buffer.from(serializedTxBase64, "base64");
    let signedBase64: string;

    // Prefer versioned txs; fall back to legacy Transaction.
    try {
      const vtx = VersionedTransaction.deserialize(raw);
      vtx.sign([this.keypair]);
      signedBase64 = Buffer.from(vtx.serialize()).toString("base64");
    } catch {
      const tx = Transaction.from(raw);
      tx.partialSign(this.keypair);
      signedBase64 = tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64");
    }

    // Primary path: Jupiter execute endpoint (keeper request submission helper).
    // TODO: some deployments also accept raw send via RPC — keep as fallback.
    try {
      const result = (await this.client.executeSigned({
        action,
        signedTransactionBase64: signedBase64,
      })) as { txid?: string; signature?: string };
      const txid = result.txid ?? result.signature;
      return {
        dryRun: false,
        ok: true,
        detail: `submitted ${action}`,
        txid,
      };
    } catch (err) {
      console.warn(
        "[execution] /transaction/execute failed; attempting RPC send",
        err instanceof Error ? err.message : err,
      );
      try {
        const vtx = VersionedTransaction.deserialize(
          Buffer.from(signedBase64, "base64"),
        );
        const txid = await this.connection.sendTransaction(vtx, {
          skipPreflight: false,
        });
        return {
          dryRun: false,
          ok: true,
          detail: `RPC send ${action}`,
          txid,
        };
      } catch (err2) {
        return {
          dryRun: false,
          ok: false,
          detail: err2 instanceof Error ? err2.message : String(err2),
        };
      }
    }
  }
}
