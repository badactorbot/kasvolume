import "./style.css";
import { Battle } from "./battle";
import { startBybit, startXrpl } from "./feeds";
import { FieldView } from "./render";

const canvas = document.querySelector<HTMLCanvasElement>("#field");
const live = document.getElementById("live");
if (!canvas || !live) throw new Error("Occupation markup is missing");

const battle = new Battle();
const view = new FieldView(canvas);

const bybit = startBybit({
  onEvent: (event) => {
    if (event.kind === "trade") battle.addTrade(event.side, event.notional, event.price);
    else if (event.kind === "liq") battle.addLiquidation(event.side, event.notional);
    else if (event.kind === "ticker") battle.applyTicker(event);
    else battle.applyBook(event.type, event.bids, event.asks);
  },
  onStatus: (status) => battle.setLink(status),
});

const xrpl = startXrpl({
  onLedger: () => battle.pulseLedger(),
});

let last = performance.now();
let readout = "";
const frame = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  battle.update(dt);
  view.draw(battle, dt);
  const next = battle.readout();
  if (next !== readout) {
    readout = next;
    live.textContent = next;
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

window.addEventListener("pagehide", () => {
  bybit.stop();
  xrpl.stop();
});
