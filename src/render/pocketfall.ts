// A pocketed ball's last moments: tipping over the lip, glancing off the jaws or the back of the pocket, and
// dropping out of sight. Drawing only. The game's physics has already decided the ball is down; this takes the
// ball's position, velocity and spin at that moment and plays out the fall in 3D with gravity, so it may use
// any maths.

import * as THREE from "three";
import { R, TABLE_L, TABLE_W } from "../sim/constants";
import { TABLE, type Segment } from "../sim/table";
import { CAP_TOP, CUSHION_H, CUSHION_W, OPENINGS } from "./table";

const G = 9.81;
const SUB = 1 / 2000; // the fall's own step
const HL = TABLE_L / 2 + CUSHION_W, HW = TABLE_W / 2 + CUSHION_W; // the cushions' backs, where the rails begin
const I_INV = 5 / (2 * R * R); // 1 / moment of inertia, per unit mass

/** Restitution and friction of what the ball meets. */
const BED = { e: 0, mu: 0.2 };
const LIP = { e: 0.1, mu: 0.25 };
const BACK = { e: 0.25, mu: 0.12 }; // the pocket's liner and the rail facing behind it: soft, a little slippery
/** How far the facing under the rail leans in over the hole, per metre of height. */
const LEAN = 0.7;
const RUBBER = { e: 0.65, mu: 0.2 };

const v3 = () => new THREE.Vector3();
const n = v3(), r = v3(), vc = v3(), vt = v3(), J = v3(), tmp = v3();

export class Fall {
  readonly p: THREE.Vector3;
  readonly v: THREE.Vector3;
  readonly w: THREE.Vector3;
  /** Time simulated since the drop, and the time to simulate up to. */
  private t = 0;
  target = 0;
  /** Set in the frame the fall begins, so that frame does not also add its own time. */
  fresh = false;
  done = false;
  private walls: Segment[];
  private o: (typeof OPENINGS)[number];
  private rot = new THREE.Quaternion();

  /** air: how long the ball had already been falling when the physics called it down. */
  constructor(pocket: number, x: number, y: number, vx: number, vy: number, wx: number, wy: number, wz: number, air = 0) {
    this.p = new THREE.Vector3(x, y, R - 0.5 * G * air * air);
    this.v = new THREE.Vector3(vx, vy, -G * air);
    this.w = new THREE.Vector3(wx, wy, wz);
    this.o = OPENINGS[pocket];
    // Cushion faces near this pocket: its jaws and the ends of the rails beside it.
    const P = TABLE.pockets[pocket];
    this.walls = TABLE.segments.filter((s) => {
      const d = Math.min(Math.hypot(s.ax - P.mx, s.ay - P.my), Math.hypot(s.bx - P.mx, s.by - P.my));
      return d < 0.2;
    });
  }

  /** Advance to `target`; turns the mesh with the ball's spin. Returns the ball's centre. */
  update(mesh: THREE.Object3D): THREE.Vector3 {
    while (this.t < this.target && !this.done) {
      this.step();
      this.t += SUB;
      const w = this.w.length();
      if (w > 1e-6) {
        this.rot.setFromAxisAngle(tmp.copy(this.w).divideScalar(w), w * SUB);
        mesh.quaternion.premultiply(this.rot);
      }
    }
    return this.p;
  }

  private step() {
    const { p, v } = this;
    v.z -= G * SUB;
    p.addScaledVector(v, SUB);

    // The opening: the nearest point of its rim. Inside it there is no cloth under the ball.
    const o = this.o;
    const dx = o.bx - o.ax, dy = o.by - o.ay;
    const k = Math.max(0, Math.min(1, ((p.x - o.ax) * dx + (p.y - o.ay) * dy) / (dx * dx + dy * dy)));
    const cx = o.ax + dx * k, cy = o.ay + dy * k;
    const ex = p.x - cx, ey = p.y - cy, ed = Math.hypot(ex, ey);
    if (ed >= o.r) {
      // On the cloth.
      if (p.z < R) this.contact(0, 0, 1, R - p.z, BED);
    } else {
      // The pocket's wall, as a profile in (distance from the opening's axis, height). It is straight down below
      // the cloth. On the cloth side of the pocket it ends at the lip; under the rails the facing goes on up to
      // the cap, leaning in over the hole as real facings do, so a ball riding up it is turned back down.
      const ux = ex / Math.max(ed, 1e-9), uy = ey / Math.max(ed, 1e-9);
      const qx = cx + ux * o.r, qy = cy + uy * o.r;
      const underRail = Math.abs(qx) > HL - 1e-4 || Math.abs(qy) > HW - 1e-4;
      // Closest point of the profile to the ball's centre (rho = ed, z = p.z).
      let cr = o.r, cz = Math.min(p.z, 0);
      if (underRail && p.z > 0) {
        // The leaning part, from (r, 0) to (r - LEAN * CAP_TOP, CAP_TOP).
        const lx = -LEAN * CAP_TOP, lz = CAP_TOP, ll = lx * lx + lz * lz;
        const t = Math.max(0, Math.min(1, ((ed - o.r) * lx + p.z * lz) / ll));
        cr = o.r + lx * t; cz = lz * t;
      }
      const nr = ed - cr, nz = p.z - cz, d = Math.hypot(nr, nz);
      // Inside the opening the ball is on the inner side of the wall (nr < 0) or above the lip.
      if (d < R && d > 1e-9) this.contact((ux * nr) / d, (uy * nr) / d, nz / d, R - d, underRail ? BACK : LIP);
    }

    // The cushion faces by the pocket, from the cloth to the top of the rubber.
    if (p.z > -R) {
      for (const s of this.walls) {
        const t = Math.max(0, Math.min(1, ((p.x - s.ax) * s.tx + (p.y - s.ay) * s.ty) / s.len));
        const sx = s.ax + s.tx * s.len * t, sy = s.ay + s.ty * s.len * t;
        const sz = Math.max(0, Math.min(CUSHION_H, p.z));
        const nx = p.x - sx, ny = p.y - sy, nz = p.z - sz;
        const d = Math.hypot(nx, ny, nz);
        // Only from the playing side of the face.
        if (d < R && d > 1e-9 && nx * s.nx + ny * s.ny > 0) this.contact(nx / d, ny / d, nz / d, R - d, RUBBER);
      }
    }

    // Gone below the pocket (or, should anything ever hold it up, after two seconds).
    if (p.z < -0.2 || this.t > 2) this.done = true;
  }

  /** Push the ball out along the normal and apply the collision impulse with friction (unit mass). */
  private contact(nx: number, ny: number, nz: number, depth: number, m: { e: number; mu: number }) {
    const { p, v, w } = this;
    n.set(nx, ny, nz);
    p.addScaledVector(n, depth);
    r.copy(n).multiplyScalar(-R);
    vc.copy(w).cross(r).add(v);
    const vn = vc.dot(n);
    if (vn >= 0) return;
    const jn = -(1 + m.e) * vn;
    v.addScaledVector(n, jn);
    vt.copy(vc).addScaledVector(n, -vn);
    const slip = vt.length();
    if (slip < 1e-7) return;
    // Friction: up to mu times the normal impulse, never more than stops the slipping (2/7 for a solid ball).
    const jt = Math.min(m.mu * jn, (2 / 7) * slip);
    J.copy(vt).multiplyScalar(-jt / slip);
    v.add(J);
    w.addScaledVector(tmp.copy(r).cross(J), I_INV);
  }
}
