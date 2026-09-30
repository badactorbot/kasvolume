/**
 * SOL SI — Jupiter Perps SOL-PERP bot
 *
 * Default DRY_RUN=true: signals + risk intents are logged, no live orders.
 * This is automation with wipe risk at 10× — not a profit promise.
 */

import { Connection } from "@solana/web3.js";
import { DiscordAlerts } from "./alerts/discord.js";
import { loadConfig } from "./config.js";
import { ExecutionService } from "./execution/jupiter-perps.js";
import { JupiterPerpsClient, MarketDataService } from "./market/jupiter.js";
import { RiskManager } from "./risk/manager.js";
import { TrendRegimeStrategy } from "./strategy/trend-regime.js";
import { loadKeypair, publicKeyBase58 } from "./wallet.js";

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const alerts = new DiscordAlerts(cfg.discordWebhookUrl || undefined);
  const keypair = loadKeypair(cfg);
  const wallet = publicKeyBase58(keypair);

  console.log("=== SOL SI bot ===");
  console.log(`DRY_RUN=${cfg.dryRun} MAX_LEVERAGE=${cfg.maxLeverage} MARKET=${cfg.market}`);
  console.log(
    `Wallet: ${wallet ?? "(none — DRY_RUN can proceed without key)"}`,
  );
  console.log(
    "WARNING: 10× perps can wipe the dedicated bot wallet. No profit guarantee.",
  );

  if (!cfg.dryRun) {
    await alerts.send(
      `⚠️ SOL SI starting LIVE (DRY_RUN=false) lev≤${cfg.maxLeverage}x wallet=${wallet}`,
    );
  } else {
    await alerts.send(
      `SOL SI starting DRY_RUN=true lev≤${cfg.maxLeverage}x — no orders will broadcast`,
    );
  }

  const client = JupiterPerpsClient.fromConfig(cfg);
  const market = new MarketDataService(client);
  const strategy = new TrendRegimeStrategy(cfg);
  const risk = new RiskManager(cfg);
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const execution = new ExecutionService(cfg, client, connection, keypair);

  let lastDay = utcDayKey();
  let lastHeartbeat = 0;

  // Graceful emergency via SIGUSR1 (home host): kill -USR1 <pid>
  process.on("SIGUSR1", () => {
    risk.triggerEmergency("SIGUSR1");
    void alerts.kill("SIGUSR1 emergency flatten requested");
  });

  const tick = async (): Promise<void> => {
    try {
      const day = utcDayKey();
      const dayChanged = day !== lastDay;
      lastDay = day;

      const snapshot = await market.fetchSnapshot();
      const candles = await market.fetchCandles(120);

      let positions =
        wallet !== null ? await execution.listPositions(wallet) : [];
      positions = positions.filter(
        (p) => !p.asset || p.asset.toUpperCase() === "SOL",
      );
      const position = positions[0] ?? null;

      // Equity stub: collateral + unrealized when known; else collateral config baseline
      const equityUsd =
        (position
          ? position.collateralUsd + (position.unrealizedPnlUsd ?? 0)
          : 0) || cfg.collateralUsdc; // TODO: add USDC spot balance via RPC/ATA

      risk.markEquity(equityUsd, dayChanged);
      const status = risk.getStatus();

      if (status.paused) {
        await alerts.kill(status.pauseReason ?? "paused");
      }

      const signal = strategy.evaluate({ candles, snapshot, position });
      console.log(
        `[tick] price=${snapshot.price} signal=${signal.action} (${signal.reason}) paused=${status.paused} pos=${position ? position.side : "flat"}`,
      );

      const intent = risk.plan({ signal, position, equityUsd });
      if (intent && wallet) {
        if (
          intent.leverage !== undefined &&
          !risk.assertLeverage(intent.leverage)
        ) {
          await alerts.error(`blocked leverage ${intent.leverage}`);
        } else {
          const result = await execution.execute(intent, wallet);
          console.log("[execution]", result);
          if (!result.dryRun) {
            await alerts.fill(
              `${result.ok ? "ok" : "fail"} ${intent.kind} ${result.detail} ${result.txid ?? ""}`,
            );
          }
        }
      } else if (intent && !wallet) {
        console.log(
          `[DRY_RUN/no-wallet] intent ${intent.kind} ${intent.side ?? ""} — ${intent.reason}`,
        );
      }

      const now = Date.now();
      if (now - lastHeartbeat >= cfg.heartbeatIntervalMs) {
        lastHeartbeat = now;
        await alerts.heartbeat(
          `dryRun=${cfg.dryRun} price=${snapshot.price} equity≈${equityUsd.toFixed(2)} signal=${signal.action} paused=${status.paused}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[tick] error", msg);
      await alerts.error(msg);
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, cfg.pollIntervalMs);
}

main().catch((err) => {
  console.error("fatal", err);
  process.exit(1);
});
