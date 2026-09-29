import "./style.css";
import { Battle } from "./battle";
import { startBinance, startXrpl } from "./feeds";
import { Hud } from "./hud";
import { FieldView } from "./render";

const canvas = document.querySelector<HTMLCanvasElement>("#field");
const hudRoot = document.getElementById("hud");
if (!canvas || !hudRoot) throw new Error("Occupation markup is missing");

const battle = new Battle();
const view = new FieldView(canvas);
const hud = new Hud();

const binance = startBinance({
  onEvent: (event) => {
    if (event.type === "trade") battle.addTrade(event.side, event.notional, event.leverage);
    else if (event.type === "mark") battle.setMark(event.price, event.funding);
    else battle.liquidate(event.side, event.notional, event.leverage);
  },
  onOpenInterest: (update) => hud.setOi(update),
  onStatus: (status) => hud.setBinance(status),
});

const xrpl = startXrpl({
  onLedger: (index) => battle.ledger(index),
  onStatus: (status) => hud.setXrpl(status),
});

let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  battle.update(dt);
  view.draw(battle, dt);
  hud.sync(battle);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

window.addEventListener("pagehide", () => {
  binance.stop();
  xrpl.stop();
});
