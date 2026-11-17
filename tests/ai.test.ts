// The computer opponent: sensible choices, and whole games that always finish.
import { describe, expect, it } from "vitest";
import { decide } from "../src/ai/ai";
import { Sim, type Ball } from "../src/sim/physics";
import { ball, rack8 } from "../src/sim/rack";
import { advanceGame, judge, newGame, onEight, type GameState } from "../src/sim/rules";
import { HEAD_X } from "../src/sim/table";

function table(list: Array<[number, number, number]>): Ball[] {
  const balls = Array.from({ length: 16 }, (_, id) => { const b = ball(id, 0, 0); b.on = false; return b; });
  for (const [id, x, y] of list) Object.assign(balls[id], { on: true, x, y });
  return balls;
}
const playing = (groups: GameState["groups"], extra: Partial<GameState> = {}): GameState => ({ turn: 0, groups, breakShot: false, ballInHand: "none", winner: null, ...extra });

describe("computer opponent", () => {
  it("pots an easy ball of its own group, not the other group's", () => {
    // Solid 2 hangs over the top-right corner; stripe 10 is just as easy elsewhere.
    const balls = table([[0, 0.3, 0.1], [2, 0.92, 0.42], [10, -0.92, -0.42], [12, -0.3, 0.3]]);
    const d = decide(playing(["solids", "stripes"]), balls, "hard", 1);
    const sim = new Sim(balls);
    sim.strike(d.planned);
    sim.run();
    expect(sim.events.some((e) => e.type === "pocket" && e.a === 2)).toBe(true);
  });

  it("calls the pocket it plays the 8 into", () => {
    const balls = table([[0, 0.3, 0.1], [8, 0.92, 0.42], [12, -0.3, 0.3]]);
    const d = decide(playing(["solids", "stripes"]), balls, "medium", 2);
    expect(d.called).toBe(3);
  });

  it("with ball in hand behind the line, places the cue ball behind the line", () => {
    const balls = rack8(5);
    balls[0].on = false;
    const d = decide({ ...newGame(0), breakShot: false, ballInHand: "kitchen" }, balls, "medium", 3);
    expect(d.place).not.toBeNull();
    expect(d.place!.x).toBeLessThanOrEqual(HEAD_X);
  });

  it("finishes whole games against itself", () => {
    for (let g = 0; g < 2; g++) {
      let balls = rack8(77 + g);
      let state = newGame(0);
      let n = 0;
      while (state.winner === null && n < 120) {
        const d = decide(state, balls, "easy", g * 100 + n);
        if (d.place) Object.assign(balls[0], { on: true, x: d.place.x, y: d.place.y });
        const sim = new Sim(balls);
        sim.strike(d.played);
        sim.run(30);
        const v = judge(state, balls, sim.balls, sim.events, onEight(state, balls) ? d.called : null);
        state = advanceGame(state, sim.balls, sim.events, v);
        balls = v.rerack ? rack8(900 + n) : sim.balls;
        if (!balls[0].on) Object.assign(balls[0], { on: true, x: -0.6, y: 0 });
        n++;
      }
      expect(state.winner).not.toBeNull();
    }
  }, 60000);
});
