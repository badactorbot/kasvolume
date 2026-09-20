import {
  armAutomation,
  disarmAutomation,
  getAutomationState,
} from "./lib/kron-automation-service";
import { validateAutomatedSell } from "./lib/kron-live-service";

const command = process.argv[2] ?? "status";
const state = await getAutomationState();
const result =
  command === "validate-sell"
    ? await validateAutomatedSell(state.managedLots[0])
    : command === "arm"
    ? await armAutomation()
    : command === "disarm"
      ? await disarmAutomation()
      : state;
console.log(JSON.stringify(result, null, 2));