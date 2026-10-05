import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Same-origin /api (Vite proxy or Vercel rewrite) needs no special CORS.
// When the UI calls a separate API host via VITE_API_BASE_URL, set CORS_ORIGIN
// to that UI origin (comma-separated list ok) so credentialed cookies work.
const corsOrigin = process.env.CORS_ORIGIN?.trim();
if (corsOrigin) {
  const allowed = corsOrigin.split(",").map((value) => value.trim()).filter(Boolean);
  app.use(
    cors({
      origin: allowed.length === 1 ? allowed[0] : allowed,
      credentials: true,
    }),
  );
} else {
  app.use(cors());
}

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Always-on hosts: serve the Vite UI from the same Node process as /api + scheduler.
// Set STATIC_DIR to the built UI folder (e.g. artifacts/kron-trading-bot/dist/public).
const staticDir = process.env.STATIC_DIR?.trim();
if (staticDir) {
  const root = path.resolve(staticDir);
  app.use(express.static(root, { index: false, fallthrough: true }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(root, "index.html"));
  });
  logger.info({ staticDir: root }, "Serving UI static files");
}

export default app;
