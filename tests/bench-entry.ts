import { Sim } from "../src/sim/physics";
import { rack8 } from "../src/sim/rack";
let pocketed = 0, cue = 0, steps = 0, time = 0, events = 0;
const t0 = performance.now();
const N = 200;
for (let g = 1; g <= N; g++) {
  const sim = new Sim(rack8(g));
  sim.strike({ dx: 1, dy: 0, speed: 8.5, side: 0, height: 0.1 });
  steps += sim.run();
  time += sim.t; events += sim.events.length;
  for (const e of sim.events) if (e.type === "pocket") { if (e.a === 0) cue++; else pocketed++; }
}
const ms = performance.now() - t0;
console.log(`${N} breaks at 8.5 m/s: ${(ms / N).toFixed(2)} ms each to simulate, ${(time / N).toFixed(1)} s of play each, ${(events / N).toFixed(0)} contacts, ${(pocketed / N).toFixed(2)} balls potted per break, cue ball scratched ${cue} times`);
