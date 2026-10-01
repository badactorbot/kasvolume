import { cp, mkdir, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const botDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiServerDist = path.resolve(botDir, "../api-server/dist");
const targetApiDir = path.resolve(botDir, "api");

async function main() {
  await access(path.join(apiServerDist, "app.mjs"));
  await mkdir(targetApiDir, { recursive: true });

  const staged = [];
  for (const file of await readdir(apiServerDist)) {
    const isApp = file === "app.mjs";
    const isWorker =
      file.startsWith("pino-") || file.startsWith("thread-stream-");
    if ((!isApp && !isWorker) || file.endsWith(".map")) continue;
    await cp(path.join(apiServerDist, file), path.join(targetApiDir, file));
    staged.push(file);
  }

  console.log(
    `Staged API into kron-trading-bot/api: ${staged.join(", ") || "(none)"}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
