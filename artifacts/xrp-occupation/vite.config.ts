import { defineConfig } from "vite";

const rawPort = process.env.PORT ?? "5199";
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const base =
  process.env.BASE_PATH && process.env.BASE_PATH.length > 0
    ? process.env.BASE_PATH
    : "/";

const binanceProxy = {
  "/__binance": {
    target: "https://fapi.binance.com",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/__binance/, ""),
  },
};

export default defineConfig({
  base,
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    proxy: binanceProxy,
  },
  preview: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    proxy: binanceProxy,
  },
});
