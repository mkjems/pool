// Highlights: which shots get replayed by themselves (src/sim/highlight.ts).
import { describe, expect, it } from "vitest";
import { HIGHLIGHT, highlight } from "../src/sim/highlight";
import { Sim, type Ball, type Shot } from "../src/sim/physics";
import { ball, rack8 } from "../src/sim/rack";
import { judge, newGame, type GameState } from "../src/sim/rules";
import { TABLE } from "../src/sim/table";

/** A table with only the given balls; every other ball is already pocketed. */
function table(list: Array<[number, number, number]>): Ball[] {
  const balls = Array.from({ length: 16 }, (_, id) => { const b = ball(id, 0, 0); b.on = false; return b; });
  for (const [id, x, y] of list) Object.assign(balls[id], { on: true, x, y });
  return balls;
}

const solids: GameState = { turn: 0, groups: ["solids", "stripes"], breakShot: false, ballInHand: "none", winner: null };

function play(state: GameState, balls: Ball[], dx: number, dy: number, speed: number, called: number | null = null) {
  const shot: Shot = { dx, dy, speed, side: 0, height: 0 };
  const sim = new Sim(balls);
  sim.strike(shot);
  sim.run();
  const v = judge(state, balls, sim.balls, sim.events, called);
  return { v, h: highlight(state, balls, shot, v) };
}

/** Cue ball and ball `id` in a line with pocket `p`'s mouth: `near` from the mouth, the cue ball `far` behind. */
function inLine(id: number, p: number, near: number, far: number, others: Array<[number, number, number]> = []) {
  const P = TABLE.pockets[p];
  const bx = P.mx - P.ux * near, by = P.my - P.uy * near;
  return { balls: table([[0, bx - P.ux * far, by - P.uy * far], [id, bx, by], ...others]), dx: P.ux, dy: P.uy };
}

// Layouts and aims found by sweeping the aim round the cue ball (every 0.1°) and keeping one of each kind.
const MID: Array<[number, number, number]> = [[0, -0.5, -0.1], [1, 0, 0.25], [9, -0.9, 0.4]];
const PAIR: Array<[number, number, number]> = [[0, -0.6, 0], [1, 0.2, 0.1], [2, 0.5, -0.2], [9, -0.9, 0.4]];

describe("highlights", () => {
  it("a short straight pot is not one", () => {
    const { balls, dx, dy } = inLine(1, 3, 0.3, 0.3);
    const { v, h } = play(solids, balls, dx, dy, 1.5);
    expect(v.keepTurn).toBe(true);
    expect(h).not.toBeNull();
    expect(h!.score).toBeLessThan(HIGHLIGHT);
    expect(h!.label).toBe("");
  });

  it("a bank shot is", () => {
    const { h } = play(solids, table(MID), 0.8553642601605067, 0.5180270093731302, 2.5);
    expect(h!.kinds.map((k) => k.kind)).toEqual(["bank"]);
    expect(h!.score).toBeGreaterThanOrEqual(HIGHLIGHT);
    expect(h!.label).toBe("Bank shot");
  });

  it("a double bank weighs more", () => {
    const { h } = play(solids, table(MID), 0.8471219213821372, 0.5313985795180829, 2.5);
    expect(h!.label).toBe("Double bank");
    expect(h!.score).toBeGreaterThan(HIGHLIGHT);
  });

  it("a kick shot: the cue ball off a cushion first", () => {
    const { h } = play(solids, table(MID), 0.9735789028731603, 0.22835087011065572, 2.5);
    expect(h!.label).toBe("Kick shot");
  });

  it("a combination: one object ball sends another down", () => {
    const { h } = play(solids, table(PAIR), 0.9882283814465528, 0.15298583628403806, 3);
    expect(h!.label).toBe("Combination");
    expect(h!.score).toBeGreaterThanOrEqual(HIGHLIGHT);
  });

  it("a straight combination toward a corner", () => {
    // Cue ball, the 1, the 2, the pocket in one line.
    const { balls, dx, dy } = inLine(2, 3, 0.25, 0.25, []);
    const P = TABLE.pockets[3];
    const one: [number, number, number] = [1, balls[2].x - P.ux * 0.2, balls[2].y - P.uy * 0.2];
    Object.assign(balls[1], { on: true, x: one[1], y: one[2] });
    Object.assign(balls[0], { x: one[1] - P.ux * 0.3, y: one[2] - P.uy * 0.3 });
    const { h } = play(solids, balls, dx, dy, 2);
    expect(h!.kinds[0].kind).toBe("combination");
    expect(h!.balls).toEqual([2]);
  });

  it("a carom: the cue ball glances off one ball into another, which goes down", () => {
    const { h } = play(solids, table(PAIR), 0.9964928592495044, 0.0836778433323155, 3);
    expect(h!.label).toBe("Carom");
  });

  it("the winning 8 is marked as the win", () => {
    const { balls, dx, dy } = inLine(8, 3, 0.3, 0.3);
    const { v, h } = play(solids, balls, dx, dy, 1.5, 3);
    expect(v.winner).toBe(0);
    expect(h!.win).toBe(true);
    expect(h!.balls).toEqual([8]);
  });

  it("not a foul, not the opponent's ball, not the break", () => {
    // The cue ball follows the 1 into the pocket: a scratch.
    const s = inLine(1, 3, 0.1, 0.2);
    const scratch: Shot = { dx: s.dx, dy: s.dy, speed: 3, side: 0, height: 0.5 };
    const sim = new Sim(s.balls); sim.strike(scratch); sim.run();
    const v = judge(solids, s.balls, sim.balls, sim.events, null);
    expect(v.foul).toBe("Scratch");
    expect(highlight(solids, s.balls, scratch, v)).toBeNull();
    // The 9 is the opponent's: legal, but nothing of the shooter's went down.
    const o = inLine(9, 3, 0.3, 0.3, [[1, -0.5, 0.3]]);
    expect(play(solids, o.balls, o.dx, o.dy, 1.5).h).toBeNull();
    // The break.
    const rack = rack8(7);
    const brk = play(newGame(0), rack, 1, 0, 8);
    expect(brk.h).toBeNull();
  });

  it("is the same every time (both browsers must agree)", () => {
    const a = play(solids, table(PAIR), 0.9882283814465528, 0.15298583628403806, 3).h;
    const b = play(solids, table(PAIR), 0.9882283814465528, 0.15298583628403806, 3).h;
    expect(a).toEqual(b);
  });
});
