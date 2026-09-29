import {
  binanceRestricted,
  isLedgerSubscribeAck,
  parseBinanceMessage,
  parseLedgerClose,
  readOpenInterest,
  type MarketEvent,
} from "./parse";
import { startSocket, type LinkStatus } from "./net";

const BINANCE_WS =
  "wss://fstream.binance.com/stream?streams=xrpusdt@aggTrade/xrpusdt@markPrice@1s/xrpusdt@forceOrder";

const OPEN_INTEREST_URL =
  "https://fapi.binance.com/fapi/v1/openInterest?symbol=XRPUSDT";

const OPEN_INTEREST_DEV_PROXY =
  "/__binance/fapi/v1/openInterest?symbol=XRPUSDT";

const XRPL_URLS = ["wss://xrplcluster.com", "wss://s2.ripple.com"] as const;

export interface OpenInterestUpdate {
  xrp: number | null;
  ok: boolean;
  blocked: boolean;
  detail: string;
}

async function readInterest(url: string): Promise<OpenInterestUpdate | "throw"> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.status === 451 || binanceRestricted(body, text)) {
    return {
      xrp: null,
      ok: false,
      blocked: true,
      detail: "restricted location",
    };
  }
  if (!res.ok) {
    return {
      xrp: null,
      ok: false,
      blocked: false,
      detail: `HTTP ${res.status}`,
    };
  }
  const xrp = readOpenInterest(body);
  if (xrp == null) {
    return {
      xrp: null,
      ok: false,
      blocked: false,
      detail: "unexpected payload",
    };
  }
  return { xrp, ok: true, blocked: false, detail: "live" };
}

export async function fetchOpenInterest(): Promise<OpenInterestUpdate> {
  // Dev/preview proxy first so a 451 from fapi.binance.com is readable.
  // The proxy target is that same public URL. Direct fetch is the fallback.
  const urls = [OPEN_INTEREST_DEV_PROXY, OPEN_INTEREST_URL];
  let last = "unreachable";
  for (const url of urls) {
    try {
      const result = await readInterest(url);
      if (result === "throw") continue;
      if (result.blocked || result.ok) return result;
      last = result.detail;
    } catch {
      last = "unreachable";
    }
  }
  return { xrp: null, ok: false, blocked: false, detail: last };
}

export function startBinance(handlers: {
  onEvent: (event: MarketEvent) => void;
  onOpenInterest: (update: OpenInterestUpdate) => void;
  onStatus: (status: LinkStatus) => void;
}): { stop: () => void } {
  const socket = startSocket({
    urls: [BINANCE_WS],
    timeoutMs: 8000,
    staleMs: 12000,
    onOpen: () => {},
    onMessage: (raw) => {
      const event = parseBinanceMessage(raw);
      if (!event) return false;
      handlers.onEvent(event);
      return true;
    },
    onStatus: handlers.onStatus,
  });

  let stopped = false;
  const poll = async () => {
    while (!stopped) {
      const update = await fetchOpenInterest();
      if (stopped) return;
      if (update.ok) socket.clearBlocked();
      else if (update.blocked) socket.markBlocked(update.detail);
      handlers.onOpenInterest(update);
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }
  };
  void poll();

  return {
    stop() {
      stopped = true;
      socket.stop();
    },
  };
}

export function startXrpl(handlers: {
  onLedger: (index: number) => void;
  onStatus: (status: LinkStatus) => void;
}): { stop: () => void } {
  const socket = startSocket({
    urls: XRPL_URLS,
    timeoutMs: 8000,
    staleMs: 20000,
    onOpen: (ws) => {
      ws.send(JSON.stringify({ command: "subscribe", streams: ["ledger"] }));
    },
    onMessage: (raw) => {
      const index = parseLedgerClose(raw);
      if (index != null) {
        handlers.onLedger(index);
        return true;
      }
      return isLedgerSubscribeAck(raw);
    },
    onStatus: handlers.onStatus,
  });
  return { stop: () => socket.stop() };
}
