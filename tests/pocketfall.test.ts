// The drawn fall into a pocket must agree with the physics: a ball the physics has called down never comes back
// onto the cloth (it used to ride up the lip, roll on for two seconds, then vanish).
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { R } from "../src/sim/constants";
import { Sim } from "../src/sim/physics";
import { ball } from "../src/sim/rack";
import { TABLE, openingDist2 } from "../src/sim/table";
import { Fall } from "../src/render/pocketfall";

describe("pocket fall", () => {
  it("a potted ball thrown back towards the table stays in the pocket", () => {
    let downs = 0, outward = 0;
    const back: string[] = [];
    for (const pid of [3, 4]) {
      const P = TABLE.pockets[pid];
      const px = -P.uy, py = P.ux;
      for (let speed = 2; speed <= 9.5; speed += 0.5) {
        for (let off = -0.04; off <= 0.0401; off += 0.01) {
          for (const ang of [-0.15, 0, 0.15]) {
            let dx = P.ux + px * ang, dy = P.uy + py * ang;
            const l = Math.hypot(dx, dy); dx /= l; dy /= l;
            const b = ball(1, P.mx - P.ux * 0.4 + px * off, P.my - P.uy * 0.4 + py * off);
            b.vx = dx * speed; b.vy = dy * speed; b.wx = -b.vy / R; b.wy = b.vx / R;
            const sim = new Sim([b]);
            sim.run(10);
            const e = sim.events.find((e) => e.type === "pocket");
            if (!e || e.type !== "pocket") continue;
            downs++;
            if (e.vx * P.ux + e.vy * P.uy < 0) outward++;
            const o = TABLE.pockets[e.pocket].opening;
            const { x, y } = sim.balls[0];
            expect(openingDist2(o, x, y).d2).toBeLessThan(o.r * o.r);
            const f = new Fall(e.pocket, x, y, e.vx, e.vy, e.wx, e.wy, e.wz, e.air);
            const mesh = new THREE.Object3D();
            for (let t = 1 / 60; !f.done; t += 1 / 60) {
              f.target = t;
              const p = f.update(mesh);
              if (openingDist2(o, p.x, p.y).d2 >= o.r * o.r && p.z > 0.9 * R) {
                back.push(`pocket ${pid}, ${speed} m/s, offset ${off.toFixed(2)}, angle ${ang}`);
                break;
              }
            }
          }
        }
      }
    }
    expect(outward).toBeGreaterThan(10); // the sweep does throw balls back out of the pocket
    expect(back).toEqual([]);
  });
});
