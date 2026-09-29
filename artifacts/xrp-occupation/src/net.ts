export interface LinkStatus {
  state: "connecting" | "live" | "disconnected" | "blocked";
  detail: string;
  retryInMs: number | null;
}

export interface LiveSocket {
  stop(): void;
  markBlocked(detail: string): void;
  clearBlocked(): void;
}

function delayFor(attempt: number): number {
  const base = Math.min(15000, 500 * 2 ** attempt);
  return base + Math.random() * base * 0.25;
}

export function startSocket(opts: {
  urls: readonly string[];
  timeoutMs?: number;
  staleMs?: number;
  onOpen: (ws: WebSocket) => void;
  onMessage: (raw: string) => boolean;
  onStatus: (status: LinkStatus) => void;
}): LiveSocket {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const staleMs = opts.staleMs ?? 12000;
  let stopped = false;
  let generation = 0;
  let attempt = 0;
  let urlIndex = 0;
  let ws: WebSocket | null = null;
  let retryTimer = 0;
  let openTimer = 0;
  let staleTimer = 0;
  let blocked: string | null = null;
  let state: LinkStatus["state"] = "connecting";
  let detail = "connecting";
  let retryInMs: number | null = null;

  const publish = () => {
    const showBlocked = blocked != null && state !== "live";
    opts.onStatus({
      state: showBlocked ? "blocked" : state,
      detail: showBlocked && blocked != null ? blocked : detail,
      retryInMs,
    });
  };

  const clearTimers = () => {
    window.clearTimeout(retryTimer);
    window.clearTimeout(openTimer);
    window.clearTimeout(staleTimer);
    retryTimer = 0;
    openTimer = 0;
    staleTimer = 0;
  };

  const armStale = (gen: number, socket: WebSocket) => {
    window.clearTimeout(staleTimer);
    staleTimer = window.setTimeout(() => {
      if (gen !== generation) return;
      detail = "stale";
      socket.close();
    }, staleMs);
  };

  const schedule = (ms: number) => {
    state = "disconnected";
    detail = detail || "disconnected";
    const due = performance.now() + ms;
    const tick = () => {
      if (stopped) return;
      const left = due - performance.now();
      if (left <= 0) {
        retryInMs = null;
        connect();
        return;
      }
      retryInMs = left;
      publish();
      retryTimer = window.setTimeout(tick, 250);
    };
    tick();
  };

  const connect = () => {
    if (stopped) return;
    clearTimers();
    const gen = ++generation;
    state = "connecting";
    detail = "connecting";
    retryInMs = null;
    publish();

    const url = opts.urls[urlIndex % opts.urls.length] ?? opts.urls[0];
    urlIndex += 1;
    if (!url) {
      detail = "no url";
      schedule(delayFor(attempt));
      attempt = Math.min(attempt + 1, 6);
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      detail = "socket error";
      schedule(delayFor(attempt));
      attempt = Math.min(attempt + 1, 6);
      return;
    }
    ws = socket;

    openTimer = window.setTimeout(() => {
      if (gen !== generation || socket.readyState === WebSocket.OPEN) return;
      detail = "timed out";
      socket.close();
    }, timeoutMs);

    socket.addEventListener("open", () => {
      if (gen !== generation) return;
      window.clearTimeout(openTimer);
      try {
        opts.onOpen(socket);
      } catch {
        detail = "subscribe failed";
      }
      armStale(gen, socket);
    });

    socket.addEventListener("message", (ev) => {
      if (gen !== generation || typeof ev.data !== "string") return;
      let healthy = false;
      try {
        healthy = opts.onMessage(ev.data);
      } catch {
        healthy = false;
      }
      if (!healthy) return;
      state = "live";
      detail = "live";
      attempt = 0;
      retryInMs = null;
      publish();
      armStale(gen, socket);
    });

    socket.addEventListener("error", () => {
      if (gen !== generation) return;
      detail = "socket error";
    });

    socket.addEventListener("close", () => {
      if (gen !== generation || stopped) return;
      generation += 1;
      clearTimers();
      if (!detail || detail === "connecting" || detail === "live") {
        detail = "disconnected";
      }
      const wait = delayFor(attempt);
      attempt = Math.min(attempt + 1, 6);
      schedule(wait);
    });
  };

  connect();

  return {
    stop() {
      stopped = true;
      generation += 1;
      clearTimers();
      ws?.close();
      ws = null;
    },
    markBlocked(reason: string) {
      blocked = reason;
      publish();
    },
    clearBlocked() {
      if (blocked == null) return;
      blocked = null;
      publish();
    },
  };
}
