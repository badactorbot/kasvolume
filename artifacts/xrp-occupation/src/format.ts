export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`;
  if (v >= 100) return `${sign}$${v.toFixed(0)}`;
  return `${sign}$${v.toFixed(2)}`;
}

export function formatXrp(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B XRP`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M XRP`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K XRP`;
  return `${n.toFixed(0)} XRP`;
}

export function formatFunding(rate: number): string {
  const pct = rate * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(4)}%`;
}

export function formatRetry(ms: number | null): string {
  if (ms == null) return "";
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `RETRY ${seconds}s`;
}
