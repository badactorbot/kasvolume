import { startSocket, type LinkStatus } from "./net";
import {
  isLedgerSubscribeAck,
  parseBybit,
  parseLedgerClose,
  type BybitEvent,
} from "./parse";

const BYBIT_URL = "wss://stream.bybit.com/v5/public/linear";
const BYBIT_TOPICS = [
  "publicTrade.XRPUSDT",
  "orderbook.50.XRPUSDT",
  "allLiquidation.XRPUSDT",
  "tickers.XRPUSDT",
];

export function startBybit(handlers: {
  onEvent: (event: BybitEvent) => void;
  onStatus: (status: LinkStatus) => void;
}): { stop: () => void } {
  let ping = 0;
  const socket = startSocket({
    urls: [BYBIT_URL],
    timeoutMs: 8000,
    staleMs: 20000,
    onOpen: (ws) => {
      window.clearInterval(ping);
      ws.send(JSON.stringify({ op: "subscribe", args: BYBIT_TOPICS }));
      ping = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: "ping" }));
        }
      }, 15000);
    },
    onMessage: (raw) => {
      const events = parseBybit(raw);
      if (!events.length) {
        try {
          const msg = JSON.parse(raw) as { op?: string; success?: boolean };
          if (msg.op === "pong" || msg.op === "ping") return true;
          if (msg.op === "subscribe") return msg.success !== false;
        } catch {
          return false;
        }
        return false;
      }
      for (const event of events) handlers.onEvent(event);
      return true;
    },
    onStatus: handlers.onStatus,
  });
  return {
    stop() {
      window.clearInterval(ping);
      socket.stop();
    },
  };
}

export function startXrpl(handlers: {
  onLedger: (index: number) => void;
}): { stop: () => void } {
  const socket = startSocket({
    urls: ["wss://xrplcluster.com", "wss://s2.ripple.com"],
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
    onStatus: () => {},
  });
  return { stop: () => socket.stop() };
}
