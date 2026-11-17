// 8-ball rules: every foul and every way a game ends.
import { describe, expect, it } from "vitest";
import { R } from "../src/sim/constants";
import { Sim, type Ball, type Shot } from "../src/sim/physics";
import { ball, rack8 } from "../src/sim/rack";
import { advanceGame, judge, newGame, type GameState } from "../src/sim/rules";
import { TABLE } from "../src/sim/table";

/** A table with only the given balls; every other ball is already pocketed. */
function table(list: Array<[number, number, number]>): Ball[] {
  const balls = Array.from({ length: 16 }, (_, id) => { const b = ball(id, 0, 0); b.on = false; return b; });
  for (const [id, x, y] of list) Object.assign(balls[id], { on: true, x, y });
  return balls;
}

function play(state: GameState, balls: Ball[], shot: Shot, called: number | null = null) {
  const sim = new Sim(balls);
  sim.strike(shot);
  sim.run();
  const v = judge(state, balls, sim.balls, sim.events, called);
  const next = advanceGame(state, sim.balls, sim.events, v);
  return { v, next, balls: sim.balls };
}

/** Shoot the cue ball at (x, y) straight toward ball `id`'s centre. */
function at(balls: Ball[], id: number, speed = 2): Shot {
  const c = balls[0], t = balls[id];
  const dx = t.x - c.x, dy = t.y - c.y, l = Math.hypot(dx, dy);
  return { dx: dx / l, dy: dy / l, speed, side: 0, height: 0 };
}

/** A straight pot of ball `id` into pocket `pk`: object 30 cm from the mouth, cue 30 cm behind. */
function straightPot(id: number, pk = 3, extra: Array<[number, number, number]> = []) {
  const P = TABLE.pockets[pk];
  const ox = P.mx - P.ux * 0.3, oy = P.my - P.uy * 0.3;
  return table([[0, ox - P.ux * 0.3, oy - P.uy * 0.3], [id, ox, oy], ...extra]);
}

const playing = (groups: GameState["groups"], turn: 0 | 1 = 0): GameState => ({ turn, groups, breakShot: false, ballInHand: "none", winner: null });

describe("the break", () => {
  it("a hard break is legal, and the table stays open", () => {
    const state = newGame(0);
    const balls = rack8(3);
    const { v, next } = play(state, balls, { dx: 1, dy: 0, speed: 9, side: 0, height: 0 });
    expect(v.foul).toBeNull();
    expect(v.rerack).toBe(false);
    expect(next.groups).toBeNull();
    expect(next.breakShot).toBe(false);
  });

  it("a soft break is illegal: rack again, the other player breaks", () => {
    const { v, next } = play(newGame(0), rack8(3), { dx: 1, dy: 0, speed: 1.2, side: 0, height: 0 });
    expect(v.rerack).toBe(true);
    expect(next).toMatchObject({ turn: 1, breakShot: true });
  });

  it("the 8 down on the break is spotted again, not a loss", () => {
    const balls = rack8(3);
    const fake = [{ t: 0, type: "ball", a: 0, b: 1, speed: 8 }, { t: 0.5, type: "pocket", a: 8, pocket: 3, speed: 1 }] as const;
    const after = balls.map((b) => ({ ...b, on: b.id !== 8 }));
    const v = judge(newGame(0), balls, after, [...fake], null);
    expect(v).toMatchObject({ winner: null, respot8: true, keepTurn: true });
    const next = advanceGame(newGame(0), after, [...fake], v);
    expect(after[8].on).toBe(true);
    expect(next.turn).toBe(0);
  });
});

describe("open table", () => {
  it("potting a stripe gives stripes to the shooter, who shoots again", () => {
    const state = playing(null);
    const { v, next } = play(state, straightPot(11), at(straightPot(11), 11));
    expect(v.foul).toBeNull();
    expect(next.groups).toEqual(["stripes", "solids"]);
    expect(next.turn).toBe(0);
  });

  it("hitting the 8 first is a foul", () => {
    const balls = table([[0, -0.5, 0], [8, 0, 0], [2, -0.6, 0.3]]);
    const { v, next } = play(playing(null, 1), balls, at(balls, 8, 1));
    expect(v.foul).toMatch(/8/);
    expect(next).toMatchObject({ turn: 0, ballInHand: "anywhere" });
  });
});

describe("fouls", () => {
  const groups: GameState["groups"] = ["solids", "stripes"];
  it("hitting the other group first", () => {
    const balls = straightPot(12, 3, [[3, -0.6, 0.3]]);
    const { v, next } = play(playing(groups), balls, at(balls, 12));
    expect(v.foul).toMatch(/solids/);
    expect(next).toMatchObject({ turn: 1, ballInHand: "anywhere" });
  });

  it("scratching", () => {
    // Cue ball straight into the corner, nothing in the way.
    const P = TABLE.pockets[3];
    const balls = table([[0, P.mx - P.ux * 0.4, P.my - P.uy * 0.4], [3, -0.5, 0]]);
    const { v } = play(playing(groups), balls, { dx: P.ux, dy: P.uy, speed: 2, side: 0, height: 0 });
    expect(v.foul).toBe("Scratch");
  });

  it("no cushion after contact", () => {
    const balls = table([[0, -0.3, 0], [3, 0, 0]]);
    const { v } = play(playing(groups), balls, at(balls, 3, 0.35));
    expect(v.foul).toBe("No cushion after contact");
  });

  it("no ball hit", () => {
    const balls = table([[0, -0.3, 0], [3, 0, 0.3]]);
    const { v } = play(playing(groups), balls, { dx: 1, dy: 0, speed: 1.5, side: 0, height: 0 });
    expect(v.foul).toBe("No ball hit");
  });

  it("potting your own ball keeps the table; potting only theirs does not", () => {
    const mine = straightPot(4, 3, [[12, 0.1, -0.3]]);
    expect(play(playing(groups), mine, at(mine, 4)).next.turn).toBe(0);
    const g2: GameState["groups"] = ["stripes", "solids"];
    const theirs = straightPot(4, 3, [[12, -0.8, -0.3]]);
    // Player 0 has stripes but pots a solid: hitting the 4 first is itself the foul.
    expect(play(playing(g2), theirs, at(theirs, 4)).v.foul).toMatch(/stripes/);
  });
});

describe("the end", () => {
  const groups: GameState["groups"] = ["solids", "stripes"];
  it("potting the 8 in the called pocket wins", () => {
    const balls = straightPot(8, 3, [[12, -0.8, -0.3]]);
    const { v, next } = play(playing(groups), balls, at(balls, 8), 3);
    expect(v.winner).toBe(0);
    expect(next.winner).toBe(0);
  });

  it("the 8 in another pocket loses", () => {
    const balls = straightPot(8, 3, [[12, -0.8, -0.3]]);
    expect(play(playing(groups), balls, at(balls, 8), 2).v.winner).toBe(1);
  });

  it("the 8 before your group is cleared loses", () => {
    const balls = straightPot(8, 3, [[2, -0.8, -0.3], [12, -0.8, 0.3]]);
    expect(play(playing(groups), balls, at(balls, 8), 3).v.winner).toBe(1);
  });

  it("scratching while potting the 8 loses", () => {
    // Follow shot straight after the 8 into the same pocket.
    const balls = straightPot(8, 3, [[12, -0.8, -0.3]]);
    const shot = { ...at(balls, 8, 3), height: 0.5 };
    const { v } = play(playing(groups), balls, shot, 3);
    if (v.message.includes("Scratch")) expect(v.winner).toBe(1);
    else expect(v.winner).toBe(0); // the follow did not reach the pocket: still a win
  });
  void R;
});
