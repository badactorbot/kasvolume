import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

function envBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

const schema = z.object({
  rpcUrl: z.string().url(),
  solanaPrivateKey: z.string().optional(),
  keypairPath: z.string().optional(),
  jupiterPerpsApiUrl: z.string().url(),
  discordWebhookUrl: z.string().url().optional().or(z.literal("")),
  dryRun: z.boolean(),
  maxLeverage: z.number().positive().max(100),
  market: z.literal("SOL"),
  collateralToken: z.literal("USDC"),
  collateralUsdc: z.number().positive(),
  maxSlippageBps: z.number().int().positive(),
  dailyLossKillPct: z.number().positive(),
  maxDrawdownPct: z.number().positive(),
  maxCollateralFraction: z.number().gt(0).lte(1),
  pollIntervalMs: z.number().int().positive(),
  heartbeatIntervalMs: z.number().int().positive(),
  emaFast: z.number().int().positive(),
  emaSlow: z.number().int().positive(),
  atrPeriod: z.number().int().positive(),
  regimeAtrPctFloor: z.number().positive(),
  /** Public OHLCV source for trend/regime (default: binance market-data API). */
  candleSource: z.enum(["binance"]),
  candleBaseUrl: z.string().url(),
  candleSymbol: z.string().min(1),
  candleInterval: z.string().min(1),
  candleLimit: z.number().int().positive().max(1000),
});

export type BotConfig = z.infer<typeof schema>;

export function loadConfig(): BotConfig {
  const dryRun = envBool(process.env.DRY_RUN, true);

  const cfg = schema.parse({
    rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
    solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY || undefined,
    keypairPath: process.env.KEYPAIR_PATH || undefined,
    jupiterPerpsApiUrl:
      process.env.JUPITER_PERPS_API_URL ?? "https://perps-api.jup.ag/v1",
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? "",
    dryRun,
    maxLeverage: Number(process.env.MAX_LEVERAGE ?? 10),
    market: (process.env.MARKET ?? "SOL") as "SOL",
    collateralToken: (process.env.COLLATERAL_TOKEN ?? "USDC") as "USDC",
    collateralUsdc: Number(process.env.COLLATERAL_USDC ?? 10),
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS ?? 100),
    dailyLossKillPct: Number(process.env.DAILY_LOSS_KILL_PCT ?? 5),
    maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? 15),
    maxCollateralFraction: Number(process.env.MAX_COLLATERAL_FRACTION ?? 0.7),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 300_000),
    emaFast: Number(process.env.EMA_FAST ?? 20),
    emaSlow: Number(process.env.EMA_SLOW ?? 50),
    atrPeriod: Number(process.env.ATR_PERIOD ?? 14),
    regimeAtrPctFloor: Number(process.env.REGIME_ATR_PCT_FLOOR ?? 0.8),
    candleSource: (process.env.CANDLE_SOURCE ?? "binance") as "binance",
    // Prefer data-api.binance.vision (market-data only, no API key; geo-friendlier than api.binance.com)
    candleBaseUrl:
      process.env.CANDLE_BASE_URL ?? "https://data-api.binance.vision",
    candleSymbol: process.env.CANDLE_SYMBOL ?? "SOLUSDT",
    candleInterval: process.env.CANDLE_INTERVAL ?? "1h",
    candleLimit: Number(process.env.CANDLE_LIMIT ?? 120),
  });

  if (cfg.emaFast >= cfg.emaSlow) {
    throw new Error("EMA_FAST must be < EMA_SLOW");
  }

  if (!cfg.dryRun && !cfg.solanaPrivateKey && !cfg.keypairPath) {
    throw new Error(
      "Live mode requires SOLANA_PRIVATE_KEY or KEYPAIR_PATH (dedicated bot wallet)",
    );
  }

  return cfg;
}
