import {
  executeLiveBuy,
  prepareLiveBuy,
  validateLiveBuySignature,
} from "./lib/kron-live-service";

const execute = process.argv.includes("--execute");
const signOnly = process.argv.includes("--sign-only");
const confirmation = process.argv
  .find((argument) => argument.startsWith("--confirm="))
  ?.slice("--confirm=".length);

try {
  const result = execute
    ? await executeLiveBuy(confirmation ?? "")
    : signOnly
      ? await validateLiveBuySignature()
      : await prepareLiveBuy();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Live-buy command failed");
  process.exitCode = 1;
}