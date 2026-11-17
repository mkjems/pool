// Reference shots: the physics must reproduce what is known about real pool.
import { describe, expect, it } from "vitest";
import { R, MASS } from "../src/sim/constants";
import { Sim, fingerprint, type Ball } from "../src/sim/physics";
import { ball, rack8 } from "../src/sim/rack";
import { TABLE, onSurface } from "../src/sim/table";

const deg = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;
const angleBetween = (ax: number, ay: number, bx: number, by: number) => {
  let d = Math.abs(deg(ax, ay) - deg(bx, by));
  if (d > 180) d = 360 - d;
  return d;
};

/** Run until the cue ball has hit the object ball, and report both velocities right after. */
function afterFirstContact(sim: Sim) {
  while (sim.moving()) {
    sim.step();
    if (sim.events.some((e) => e.type === "ball")) break;
  }
  return { cue: { ...sim.balls[0] }, obj: { ...sim.balls[1] } };
}

function energy(balls: Ball[]) {
  let e = 0;
  for (const b of balls) {
    if (!b.on) continue;
    e += 0.5 * MASS * (b.vx * b.vx + b.vy * b.vy);
    e += 0.5 * 0.4 * MASS * R * R * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);
  }
  return e;
}

describe("ball on cloth", () => {
  it("a stun shot slides, then rolls at 5/7 of its speed", () => {
    const sim = new Sim([ball(0, -0.8, 0)]);
    sim.balls[0].vx = 2;
    for (let i = 0; i < 400; i++) sim.step(); // 1 s, long enough to start rolling
    const b = sim.balls[0];
    // After sliding: v = 5/7 * v0, minus a little rolling resistance.
    expect(b.vx).toBeGreaterThan((5 / 7) * 2 - 0.1);
    expect(b.vx).toBeLessThan((5 / 7) * 2);
    expect(Math.abs(b.vx - R * b.wy)).toBeLessThan(1e-6); // rolling: no slip
  });

  it("a rolling ball 1 m/s travels about 5 m before stopping", () => {
    const sim = new Sim([ball(0, 0, 0)]);
    // Pretend the table is endless: measure the analytic distance instead.
    const b = sim.balls[0];
    b.vx = 1; b.wy = 1 / R;
    let x = 0;
    for (let i = 0; i < 40000 && b.vx > 0; i++) { const x0 = b.x; sim.step(); x += b.x - x0; if (b.x > 0.6) b.x -= 1.2; }
    expect(x).toBeGreaterThan(4);
    expect(x).toBeLessThan(6);
  });
});

describe("ball on ball", () => {
  it("full-ball stun: the cue ball stops dead", () => {
    const sim = new Sim([ball(0, -2 * R - 0.001, 0), ball(1, 0, 0)]);
    sim.balls[0].vx = 2; // sliding, no spin, just before contact
    const { cue, obj } = afterFirstContact(sim);
    expect(Math.abs(cue.vx)).toBeLessThan(0.08);
    expect(obj.vx).toBeGreaterThan(1.9);
  });

  it("stun cut: the cue ball leaves at 90° to the object ball (the 90° rule)", () => {
    const sim = new Sim([ball(0, -0.06, R), ball(1, 0, 0)]); // half-ball hit
    sim.balls[0].vx = 2;
    const { cue, obj } = afterFirstContact(sim);
    // Throw (friction between the balls) closes the angle by a few degrees, as on a real table.
    const a = angleBetween(cue.vx, cue.vy, obj.vx, obj.vy);
    expect(a).toBeGreaterThan(83);
    expect(a).toBeLessThan(93);
  });

  it("cut throw: the object ball goes a little off the line of centres", () => {
    const sim = new Sim([ball(0, -0.2, R), ball(1, 0, 0)]);
    sim.balls[0].vx = 1; // slow stun cut: most throw
    const { obj } = afterFirstContact(sim);
    // Line of centres is 30° below the x axis (half-ball); throw pushes it toward the cue's path.
    const throwDeg = deg(obj.vx, obj.vy) - -30;
    expect(throwDeg).toBeGreaterThan(1);
    expect(throwDeg).toBeLessThan(5);
  });

  it("rolling half-ball hit: the cue ball ends up about 30° off its line (the 30° rule)", () => {
    const sim = new Sim([ball(0, -0.4, R), ball(1, 0, 0)]);
    const c = sim.balls[0];
    c.vx = 1.5; c.wy = 1.5 / R; // rolling
    afterFirstContact(sim);
    for (let i = 0; i < 300; i++) sim.step(); // let the cue ball's path bend until it rolls
    const a = deg(c.vx, c.vy);
    expect(a).toBeGreaterThan(27);
    expect(a).toBeLessThan(37);
  });

  it("draw: low on the cue ball brings it back", () => {
    const sim = new Sim([ball(0, -0.5, 0), ball(1, 0, 0)]);
    sim.strike({ dx: 1, dy: 0, speed: 3, side: 0, height: -0.5 });
    sim.run();
    expect(sim.balls[0].x).toBeLessThan(-0.25);
  });

  it("follow: high on the cue ball carries it through", () => {
    const sim = new Sim([ball(0, -0.5, 0), ball(1, 0, 0)]);
    sim.strike({ dx: 1, dy: 0.2, speed: 2, side: 0, height: 0.4 });
    sim.run();
    expect(sim.balls[0].x).toBeGreaterThan(0.1);
  });
});

describe("cushions and pockets", () => {
  it("a ball straight into a cushion comes straight back, slower", () => {
    const sim = new Sim([ball(0, 0.5, 0)]);
    sim.balls[0].vx = 2; sim.balls[0].wy = 2 / R;
    while (sim.moving() && !sim.events.some((e) => e.type === "cushion")) sim.step();
    const b = sim.balls[0];
    expect(b.vx).toBeLessThan(-1.2);
    expect(b.vx).toBeGreaterThan(-2);
    expect(Math.abs(b.vy)).toBeLessThan(1e-9);
  });

  it("side spin widens or narrows the angle off a cushion", () => {
    const off = (side: number) => {
      const sim = new Sim([ball(0, -0.5, -0.25)]);
      sim.strike({ dx: Math.SQRT1_2, dy: Math.SQRT1_2, speed: 2, side, height: 0 });
      while (sim.moving() && !sim.events.some((e) => e.type === "cushion")) sim.step();
      expect(sim.events.some((e) => e.type === "cushion")).toBe(true);
      return deg(sim.balls[0].vx, -sim.balls[0].vy); // angle off the top cushion, from the x axis
    };
    // Moving up and right into the top cushion: right spin sends it further right (a smaller angle).
    expect(off(0.4)).toBeLessThan(off(0) - 5);
    // Reverse spin has a weaker effect: cushion friction saturates. To tune by feel (docs/Plan.md, phase 1).
    expect(off(-0.4)).toBeGreaterThan(off(0) + 0.5);
  });

  it("pots a straight ball in the corner and in the side", () => {
    const corner = TABLE.pockets[3];
    // Object ball 40 cm from the corner pocket, cue ball 30 cm behind it on the same line.
    const ox = corner.mx - corner.ux * 0.4, oy = corner.my - corner.uy * 0.4;
    const sim = new Sim([ball(0, ox - corner.ux * 0.3, oy - corner.uy * 0.3), ball(1, ox, oy)]);
    sim.strike({ dx: corner.ux, dy: corner.uy, speed: 2, side: 0, height: 0 });
    sim.run();
    expect(sim.events.find((e) => e.type === "pocket")).toMatchObject({ a: 1, pocket: 3 });

    const side = new Sim([ball(0, 0, -0.2), ball(1, 0, 0.2)]);
    side.strike({ dx: 0, dy: 1, speed: 2.5, side: 0, height: -0.2 });
    side.run();
    expect(side.events.find((e) => e.type === "pocket")).toMatchObject({ a: 1, pocket: 4 });
  });

  it("no ball ever leaves the table", () => {
    for (let g = 1; g <= 30; g++) {
      const sim = new Sim(rack8(g));
      sim.strike({ dx: 1, dy: (g % 7) * 0.01 - 0.03, speed: 9.5, side: 0, height: 0 });
      sim.run();
      for (const b of sim.balls) {
        if (!b.on || onSurface(b.x, b.y)) continue;
        // Off the rectangle only while hanging in a pocket mouth.
        const near = TABLE.pockets.some((p) => Math.hypot(b.x - p.mx, b.y - p.my) < 0.07);
        expect(near, `ball ${b.id} at ${b.x}, ${b.y}`).toBe(true);
      }
    }
  });
});

describe("the simulation as a whole", () => {
  it("energy never grows during a break", () => {
    const sim = new Sim(rack8(7));
    sim.strike({ dx: 1, dy: 0, speed: 9, side: 0.1, height: 0.2 });
    let e = energy(sim.balls);
    while (sim.moving()) {
      sim.step();
      const e2 = energy(sim.balls);
      expect(e2).toBeLessThanOrEqual(e * (1 + 1e-9) + 1e-12);
      e = e2;
    }
  });

  it("is deterministic: the same break twice is identical", () => {
    const play = () => {
      const sim = new Sim(rack8(42));
      sim.strike({ dx: 0.999, dy: 0.0447, speed: 8, side: 0.2, height: -0.1 });
      sim.run();
      return fingerprint(sim.balls);
    };
    expect(play()).toBe(play());
  });
});
