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

export default defineConfig({
  base,
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // Same public REST endpoint, fetched by the dev server when the browser
      // cannot read fapi.binance.com directly (CORS or an opaque network error).
      "/__binance": {
        target: "https://fapi.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__binance/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
  },
});
