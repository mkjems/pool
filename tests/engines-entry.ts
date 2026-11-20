// Plays a fixed set of shots and prints a fingerprint of each result. Bundled and run in Node (V8, as in
// Chrome) and in jsc (JavaScriptCore, as in Safari and every iPhone browser) by tests/engines.mjs.
import { Sim, fingerprint } from "../src/sim/physics";
import { rack8, rng } from "../src/sim/rack";
import { highlight } from "../src/sim/highlight";
import { judge, type GameState } from "../src/sim/rules";

declare const print: ((s: string) => void) | undefined;
const out = typeof print === "function" ? print : (s: string) => console.log(s);

const r = rng(12345);
const open: GameState = { turn: 0, groups: null, breakShot: false, ballInHand: "none", winner: null };
for (let game = 1; game <= 40; game++) {
  let balls = rack8(game);
  const sim = new Sim(balls);
  // The break, then a few random shots on what's left.
  const a = (r() - 0.5) * 0.06;
  const l = Math.sqrt(1 + a * a);
  sim.strike({ dx: 1 / l, dy: a / l, speed: 6 + r() * 3.5, side: (r() - 0.5) * 0.4, height: (r() - 0.5) * 0.6 });
  sim.run();
  const prints = [fingerprint(sim.balls) + ":" + sim.events.length];
  for (let s = 0; s < 4; s++) {
    balls = sim.balls;
    if (!balls[0].on) { balls[0].on = true; balls[0].x = -0.5; balls[0].y = 0; }
    const s2 = new Sim(balls);
    const before = s2.balls.map((b) => ({ ...b }));
    let dx = r() - 0.5, dy = r() - 0.5;
    const n = Math.sqrt(dx * dx + dy * dy);
    dx /= n; dy /= n;
    const shot = { dx, dy, speed: 0.5 + r() * 5, side: (r() - 0.5) * 0.9, height: (r() - 0.5) * 0.9 };
    s2.strike(shot);
    s2.run();
    // The highlight too: both browsers must pick the same shots to replay.
    const h = highlight(open, before, shot, judge(open, before, s2.balls, s2.events, null));
    prints.push(fingerprint(s2.balls) + ":" + s2.events.length + ":" + (h ? h.score + h.label : "-"));
    sim.balls = s2.balls;
  }
  out("game " + game + " " + prints.join(" "));
}
