export type Side = "long" | "short";

export type BybitEvent =
  | { kind: "trade"; side: Side; notional: number; price: number }
  | { kind: "liq"; side: Side; notional: number }
  | {
      kind: "ticker";
      lastPrice: number | null;
      markPrice: number | null;
      fundingRate: number | null;
      openInterest: number | null;
      openInterestValue: number | null;
    }
  | {
      kind: "book";
      type: "snapshot" | "delta";
      bids: [number, number][];
      asks: [number, number][];
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function levels(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const row of v) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const price = num(row[0]);
    const size = num(row[1]);
    if (price == null || size == null || price <= 0 || size < 0) continue;
    out.push([price, size]);
  }
  return out;
}

function tradeSide(v: unknown): Side | null {
  if (v === "Buy") return "long";
  if (v === "Sell") return "short";
  return null;
}

export function parseBybit(raw: string): BybitEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(msg)) return [];
  if (msg.op === "pong" || msg.op === "ping" || msg.op === "subscribe") return [];
  if (typeof msg.topic !== "string") return [];

  if (msg.topic === "publicTrade.XRPUSDT" && Array.isArray(msg.data)) {
    const events: BybitEvent[] = [];
    for (const row of msg.data) {
      if (!isRecord(row)) continue;
      const side = tradeSide(row.S);
      const price = num(row.p);
      const qty = num(row.v);
      if (!side || price == null || qty == null || price <= 0 || qty <= 0) continue;
      events.push({ kind: "trade", side, notional: price * qty, price });
    }
    return events;
  }

  if (msg.topic === "allLiquidation.XRPUSDT" && Array.isArray(msg.data)) {
    const events: BybitEvent[] = [];
    for (const row of msg.data) {
      if (!isRecord(row) || row.s !== "XRPUSDT") continue;
      // Bybit position side: Buy means a long was liquidated.
      const side: Side | null =
        row.S === "Buy" ? "long" : row.S === "Sell" ? "short" : null;
      const price = num(row.p);
      const qty = num(row.v);
      if (!side || price == null || qty == null || price <= 0 || qty <= 0) continue;
      events.push({ kind: "liq", side, notional: price * qty });
    }
    return events;
  }

  if (msg.topic === "tickers.XRPUSDT" && isRecord(msg.data)) {
    const data = msg.data;
    if (data.symbol != null && data.symbol !== "XRPUSDT") return [];
    return [
      {
        kind: "ticker",
        lastPrice: num(data.lastPrice),
        markPrice: num(data.markPrice),
        fundingRate: num(data.fundingRate),
        openInterest: num(data.openInterest),
        openInterestValue: num(data.openInterestValue),
      },
    ];
  }

  if (msg.topic === "orderbook.50.XRPUSDT" && isRecord(msg.data)) {
    const data = msg.data;
    if (data.s != null && data.s !== "XRPUSDT") return [];
    const type = msg.type === "snapshot" ? "snapshot" : "delta";
    return [
      {
        kind: "book",
        type,
        bids: levels(data.b),
        asks: levels(data.a),
      },
    ];
  }

  return [];
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
