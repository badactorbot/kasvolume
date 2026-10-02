import app from "./app";
import { logger } from "./lib/logger";
import { startAutomationScheduler } from "./lib/kron-automation-service";
import { startUserAutomationScheduler } from "./lib/user-automation-service";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = process.env.HOST?.trim() || "0.0.0.0";

app.listen(port, host, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host }, "Server listening");
  if (process.env.NODE_ENV !== "production") {
    startAutomationScheduler();
  }
  startUserAutomationScheduler();
});
