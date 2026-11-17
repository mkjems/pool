// Computer against computer: every game must finish; reports win rates, game length and thinking time.
import { decide, type Level } from "../src/ai/ai";
import { Sim, type Ball } from "../src/sim/physics";
import { rack8 } from "../src/sim/rack";
import { advanceGame, judge, newGame, onEight, type GameState } from "../src/sim/rules";

declare const process: { argv: string[] };
const [la, lb, gamesArg] = process.argv.slice(2);
const levels: [Level, Level] = [(la as Level) ?? "medium", (lb as Level) ?? "easy"];
const games = Number(gamesArg ?? 10);
let wins = [0, 0], stuck = 0, shots = 0, ms = 0, decisions = 0, maxMs = 0, fouls = 0;
for (let g = 0; g < games; g++) {
  let balls: Ball[] = rack8(1000 + g);
  let state: GameState = newGame((g % 2) as 0 | 1);
  let n = 0;
  while (state.winner === null && n < 150) {
    const d = decide(state, balls, levels[state.turn], g * 1000 + n);
    ms += d.ms; decisions++; maxMs = Math.max(maxMs, d.ms);
    if (d.place) { balls[0].on = true; balls[0].x = d.place.x; balls[0].y = d.place.y; }
    const sim = new Sim(balls);
    sim.strike(d.played);
    sim.run(30);
    const v = judge(state, balls, sim.balls, sim.events, onEight(state, balls) ? d.called : null);
    if (v.foul) fouls++;
    const next = advanceGame(state, sim.balls, sim.events, v);
    balls = sim.balls;
    if (v.rerack) balls = rack8(5000 + g * 10 + n);
    if (!balls[0].on && next.winner === null) { balls[0].on = true; balls[0].x = -0.6; balls[0].y = 0; }
    state = next;
    n++;
  }
  shots += n;
  if (state.winner === null) stuck++; else wins[state.winner]++;
}
console.log(`${levels[0]} vs ${levels[1]}, ${games} games: wins ${wins[0]}-${wins[1]}, unfinished ${stuck}, ` +
  `${(shots / games).toFixed(1)} shots a game, ${(fouls / games).toFixed(1)} fouls a game, ` +
  `thinking ${(ms / decisions).toFixed(0)} ms on average, ${maxMs.toFixed(0)} ms at most`);
