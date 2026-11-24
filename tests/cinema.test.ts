// The camera plan of a replay with camera angles (src/render/cinema.ts). Shots whose balls go down fast (under
// 0.3 s), or whose cue ball goes down before a later camera, once made the planner loop forever: the page hung
// (24 November, "the game crashes" in friend matches, where the winning shot is replayed on both screens).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { planCine } from "../src/render/cinema";
import type { Pose } from "../src/render/scene";
import { Sim, type Ball, type Shot } from "../src/sim/physics";
import { ball, rack8, rng } from "../src/sim/rack";
import { HEAD_X, TABLE } from "../src/sim/table";

const finite = (p: Pose) => [p.eye.x, p.eye.y, p.eye.z, p.look.x, p.look.y, p.look.z, p.fov].every(Number.isFinite);
const DOWN = new THREE.Vector2(-1, 0);

function plan(before: Ball[], shot: Shot) {
  const c = planCine(before, shot, 0.1, 16 / 9, DOWN);
  for (const b of c.beats) {
    expect(finite(b.pose), `camera at ${b.from}`).toBe(true);
    expect(finite(b.push), `push at ${b.from}`).toBe(true);
  }
  expect(Number.isFinite(c.riseAt)).toBe(true);
  return c;
}

/** All sixteen balls, as the game has them (index = number), only those listed on the table. */
function place(list: Array<[number, number, number]>): Ball[] {
  const balls = Array.from({ length: 16 }, (_, id) => ({ ...ball(id, 0, 0), on: false }));
  for (const [id, x, y] of list) Object.assign(balls[id], { on: true, x, y });
  return balls;
}

/** Straight from the middle of the table into a pocket: a ball `gap` from its mouth, the cue ball `back` behind. */
function straightIn(pocket: number, gap: number, back: number) {
  const P = TABLE.pockets[pocket];
  const l = Math.sqrt(P.hx * P.hx + P.hy * P.hy), dx = -P.hx / l, dy = -P.hy / l; // from the pocket inward
  const at = (d: number): [number, number] => [P.hx + dx * d, P.hy + dy * d];
  return { at: (d: number) => at(gap + d), shot: { dx: -dx, dy: -dy, speed: 4, side: 0, height: 0 } as Shot, cue: at(gap + back) };
}

function potTimes(balls: Ball[], shot: Shot) {
  const sim = new Sim(balls);
  sim.strike(shot);
  sim.run(30);
  return new Map(sim.events.flatMap((e) => (e.type === "pocket" ? [[e.a, e.t] as const] : [])));
}

describe("replay camera plan", () => {
  it("the 8 dropping within 0.3 s, as a winning shot often does", () => {
    const s = straightIn(0, 0.09, 0.12);
    const balls = place([[0, ...s.cue], [8, ...s.at(0)], [12, 0.5, 0.3]]);
    expect(potTimes(balls, s.shot).get(8)).toBeLessThan(0.3);
    plan(balls, s.shot);
  });

  it("the cue ball going straight down without touching a ball", () => {
    const s = straightIn(2, 0.1, 0);
    const balls = place([[0, ...s.at(0)], [5, -0.6, 0.2]]);
    expect(potTimes(balls, s.shot).has(0)).toBe(true);
    plan(balls, s.shot);
  });

  it("random shots through whole racks", () => {
    const r = rng(12345);
    let balls = rack8(1), racks = 1;
    for (let i = 0; i < 300; i++) {
      if (balls.filter((b) => b.on && b.id !== 0).length < 2) balls = rack8(++racks);
      const targets = balls.filter((b) => b.on && b.id !== 0);
      const t = targets[Math.floor(r() * targets.length)];
      let dx = t.x - balls[0].x + (r() - 0.5) * 0.08, dy = t.y - balls[0].y + (r() - 0.5) * 0.08;
      const l = Math.sqrt(dx * dx + dy * dy);
      dx /= l; dy /= l;
      const shot: Shot = { dx, dy, speed: 0.5 + r() * 5, side: (r() - 0.5) * 0.6, height: (r() - 0.5) * 0.8 };
      plan(balls, shot);
      const sim = new Sim(balls);
      sim.strike(shot);
      sim.run(30);
      balls = sim.balls;
      if (!balls[0].on) Object.assign(balls[0], { on: true, air: -1, x: HEAD_X - 0.12, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 });
    }
  });
});
