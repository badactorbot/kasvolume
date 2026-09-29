export type Side = "long" | "short";

export type MarketEvent =
  | {
      type: "trade";
      side: Side;
      notional: number;
      price: number;
      leverage: number | null;
    }
  | { type: "mark"; price: number; funding: number }
  | {
      type: "liquidation";
      side: Side;
      notional: number;
      price: number;
      leverage: number | null;
    };

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isXrp(v: unknown): boolean {
  return typeof v === "string" && v.toUpperCase() === "XRPUSDT";
}

function leverageOf(obj: Record<string, unknown>): number | null {
  for (const key of ["leverage", "lvg"]) {
    const n = num(obj[key]);
    if (n != null && n > 0 && n <= 200) return n;
  }
  return null;
}

function unwrap(msg: unknown): Record<string, unknown> | null {
  if (!isRecord(msg)) return null;
  if (isRecord(msg.data)) return msg.data;
  if (typeof msg.e === "string") return msg;
  return null;
}

function parseTrade(data: Record<string, unknown>): MarketEvent | null {
  if (!isXrp(data.s)) return null;
  const price = num(data.p);
  const qty = num(data.q);
  if (price == null || qty == null || price <= 0 || qty <= 0) return null;
  if (typeof data.m !== "boolean") return null;
  // m: buyer is the market maker. True means the taker sold.
  const side: Side = data.m ? "short" : "long";
  return {
    type: "trade",
    side,
    notional: price * qty,
    price,
    leverage: leverageOf(data),
  };
}

function parseMark(data: Record<string, unknown>): MarketEvent | null {
  if (!isXrp(data.s)) return null;
  const price = num(data.p);
  const funding = num(data.r);
  if (price == null || price <= 0 || funding == null) return null;
  return { type: "mark", price, funding };
}

function parseLiquidation(data: Record<string, unknown>): MarketEvent | null {
  if (!isRecord(data.o)) return null;
  const order = data.o;
  if (!isXrp(order.s)) return null;
  if (order.S !== "BUY" && order.S !== "SELL") return null;
  // SELL is a forced close of a long. BUY is a forced close of a short.
  const side: Side = order.S === "SELL" ? "long" : "short";
  const price = num(order.ap) ?? num(order.p);
  const qty = num(order.z) ?? num(order.q);
  if (price == null || qty == null || price <= 0 || qty <= 0) return null;
  return {
    type: "liquidation",
    side,
    notional: price * qty,
    price,
    leverage: leverageOf(order) ?? leverageOf(data),
  };
}

export function parseBinanceMessage(raw: string): MarketEvent | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = unwrap(msg);
  if (!data || typeof data.e !== "string") return null;
  if (data.e === "aggTrade") return parseTrade(data);
  if (data.e === "markPriceUpdate") return parseMark(data);
  if (data.e === "forceOrder") return parseLiquidation(data);
  return null;
}

export function parseLedgerClose(raw: string): number | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(msg) || msg.type !== "ledgerClosed") return null;
  const index = num(msg.ledger_index);
  if (index == null || index <= 0) return null;
  return index;
}

export function isLedgerSubscribeAck(raw: string): boolean {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isRecord(msg) || msg.type !== "response" || msg.status !== "success") {
    return false;
  }
  return isRecord(msg.result) && "ledger_index" in msg.result;
}

export function binanceRestricted(body: unknown, text: string): boolean {
  if (/restricted location/i.test(text)) return true;
  if (!isRecord(body)) return false;
  return typeof body.msg === "string" && /restricted location/i.test(body.msg);
}

export function readOpenInterest(body: unknown): number | null {
  if (!isRecord(body)) return null;
  if (body.symbol != null && !isXrp(body.symbol)) return null;
  const oi = num(body.openInterest);
  if (oi == null || oi < 0) return null;
  return oi;
}
