// The pool physics. Deterministic: only + - * / and Math.sqrt (see constants.ts).
//
// A ball is sliding (its contact point slips on the cloth), rolling, spinning in place, or still. Between
// contacts its motion is integrated exactly (friction is constant in each state), so the step size only
// matters for finding contacts, and those are found at their exact moment inside each step.

import {
  DT, E_BALL, EPS_V, EPS_W, G, MAX_SPEED, MAX_TIP, MU_CUSHION, MU_ROLL, MU_SLIDE,
  CUSHION_COS, CUSHION_SIN, R, SPIN_DECEL, SQUIRT, eCushion, muBall,
} from "./constants";
import { TABLE, pocketAt, type Segment, type Point } from "./table";

export interface Ball {
  /** 0 is the cue ball, 1-15 the object balls. */
  id: number;
  x: number; y: number;
  vx: number; vy: number;
  /** Angular velocity, rad/s. wx, wy roll the ball; wz is side spin. */
  wx: number; wy: number; wz: number;
  /** Still on the table (false once pocketed). */
  on: boolean;
}

export type SimEvent =
  | { t: number; type: "ball"; a: number; b: number; speed: number }
  | { t: number; type: "cushion"; a: number; speed: number; x: number; y: number }
  | { t: number; type: "pocket"; a: number; pocket: number; speed: number }
  | { t: number; type: "cue"; a: number; speed: number; miscue: boolean };

export interface Shot {
  /** Aim direction, a unit vector. Sent as numbers, never as an angle. */
  dx: number; dy: number;
  /** Cue-ball speed off the tip, m/s. */
  speed: number;
  /** Tip offset from the ball's centre as a fraction of R: side (+ is right) and height (+ is above). */
  side: number; height: number;
}

const SLIDE_A = MU_SLIDE * G;
const ROLL_A = MU_ROLL * G;
const SLIDE_SPIN = (5 * SLIDE_A) / (2 * R); // angular acceleration while sliding
const EPS_V2 = EPS_V * EPS_V;
const EPS_U2 = (EPS_V * 2) * (EPS_V * 2);
const D2 = 4 * R * R;

export function cloneBalls(balls: readonly Ball[]): Ball[] {
  return balls.map((b) => ({ ...b }));
}

export function isMoving(b: Ball): boolean {
  if (!b.on) return false;
  const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
  return b.vx * b.vx + b.vy * b.vy > EPS_V2 || ux * ux + uy * uy > EPS_U2 || b.wz > EPS_W || b.wz < -EPS_W;
}

function translating(b: Ball): boolean {
  return b.vx * b.vx + b.vy * b.vy > EPS_V2;
}

function decaySpin(b: Ball, h: number) {
  const d = SPIN_DECEL * h;
  if (b.wz > d) b.wz -= d;
  else if (b.wz < -d) b.wz += d;
  else b.wz = 0;
}

/** Move a ball through time t on the cloth, with no contacts. Exact for each state. */
export function advance(b: Ball, t: number) {
  let guard = 0;
  while (t > 0 && guard++ < 4) {
    const ux = b.vx - R * b.wy, uy = b.vy + R * b.wx;
    const u2 = ux * ux + uy * uy;
    if (u2 > EPS_U2) {
      // Sliding: friction opposes the slip, whose direction stays fixed until the ball rolls.
      const u = Math.sqrt(u2);
      const sx = ux / u, sy = uy / u;
      const ts = (2 * u) / (7 * SLIDE_A);
      const h = ts < t ? ts : t;
      b.x += b.vx * h - 0.5 * SLIDE_A * sx * h * h;
      b.y += b.vy * h - 0.5 * SLIDE_A * sy * h * h;
      b.vx -= SLIDE_A * sx * h;
      b.vy -= SLIDE_A * sy * h;
      b.wx -= SLIDE_SPIN * sy * h;
      b.wy += SLIDE_SPIN * sx * h;
      decaySpin(b, h);
      t -= h;
      if (h === ts) { b.wx = -b.vy / R; b.wy = b.vx / R; } // now rolling
    } else {
      const s2 = b.vx * b.vx + b.vy * b.vy;
      if (s2 > EPS_V2) {
        // Rolling: a small constant resistance along the path, a straight line.
        const s = Math.sqrt(s2);
        const dx = b.vx / s, dy = b.vy / s;
        const tr = s / ROLL_A;
        const h = tr < t ? tr : t;
        b.x += b.vx * h - 0.5 * ROLL_A * dx * h * h;
        b.y += b.vy * h - 0.5 * ROLL_A * dy * h * h;
        if (h === tr) { b.vx = 0; b.vy = 0; }
        else { b.vx -= ROLL_A * dx * h; b.vy -= ROLL_A * dy * h; }
        b.wx = -b.vy / R; b.wy = b.vx / R;
        decaySpin(b, h);
        t -= h;
      } else {
        b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
        decaySpin(b, t);
        t = 0;
      }
    }
  }
}

// ---------------------------------------------------------------- time of impact (straight-line motion)

/** Time until two balls touch, within [0, max], or Infinity. */
function toiBalls(a: Ball, b: Ball, max: number): number {
  const px = b.x - a.x, py = b.y - a.y;
  const qx = b.vx - a.vx, qy = b.vy - a.vy;
  const pq = px * qx + py * qy;
  if (pq >= 0) return Infinity; // separating
  const c = px * px + py * py - D2;
  if (c <= 0) return 0; // touching and approaching
  const qq = qx * qx + qy * qy;
  // Quick reject: can't close the gap in time.
  if (-pq * max < c * 0.5 && pq * pq < qq * c) return Infinity;
  const disc = pq * pq - qq * c;
  if (disc < 0) return Infinity;
  const t = c / (-pq + Math.sqrt(disc)); // the smaller root, stable form
  return t <= max ? t : Infinity;
}

function toiPoint(b: Ball, p: Point, max: number): number {
  const px = p.x - b.x, py = p.y - b.y;
  const pq = -(px * b.vx + py * b.vy);
  if (pq >= 0) return Infinity;
  const c = px * px + py * py - R * R;
  if (c <= 0) return 0;
  const qq = b.vx * b.vx + b.vy * b.vy;
  const disc = pq * pq - qq * c;
  if (disc < 0) return Infinity;
  const t = c / (-pq + Math.sqrt(disc));
  return t <= max ? t : Infinity;
}

function toiSegment(b: Ball, s: Segment, max: number): number {
  const vn = b.vx * s.nx + b.vy * s.ny;
  if (vn >= 0) return Infinity;
  const d = (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny;
  if (d < -R) return Infinity; // behind the cushion: not ours
  let t = (R - d) / vn;
  if (t < 0) t = 0;
  if (t > max) return Infinity;
  const along = (b.x + b.vx * t - s.ax) * s.tx + (b.y + b.vy * t - s.ay) * s.ty;
  return along >= 0 && along <= s.len ? t : Infinity;
}

// ---------------------------------------------------------------- collisions

function collideBalls(a: Ball, b: Ball): number {
  let nx = b.x - a.x, ny = b.y - a.y;
  const d = Math.sqrt(nx * nx + ny * ny);
  nx /= d; ny /= d;
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn <= 0) return 0;
  const jn = ((1 + E_BALL) / 2) * vn; // per unit mass

  // Slip between the surfaces at the contact point (3D), from both balls' spin.
  // Contact is at +R n from a and -R n from b; w x n = (-wz ny, wz nx, wx ny - wy nx).
  const cx = a.vx - b.vx + R * (-(a.wz + b.wz) * ny);
  const cy = a.vy - b.vy + R * ((a.wz + b.wz) * nx);
  const cz = R * (a.wx * ny - a.wy * nx + b.wx * ny - b.wy * nx);
  const cn = cx * nx + cy * ny;
  const tx = cx - cn * nx, ty = cy - cn * ny, tz = cz;
  const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (slip > 1e-9) {
    // Friction: limited by mu * normal impulse, and by what stops the slip (effective mass m / 7).
    const jt = Math.min(muBall(slip) * jn, slip / 7);
    const fx = (-jt * tx) / slip, fy = (-jt * ty) / slip, fz = (-jt * tz) / slip; // on a; b gets the opposite
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
    // dw = (r x f) / I per unit mass, I = 2/5 R² ; both balls turn the same way: (R n) x f for a, (-R n) x (-f) for b.
    const k = 5 / (2 * R);
    const rx = ny * fz, ry = -nx * fz, rz = nx * fy - ny * fx; // n x f
    a.wx += k * rx; a.wy += k * ry; a.wz += k * rz;
    b.wx += k * rx; b.wy += k * ry; b.wz += k * rz;
  }
  a.vx -= jn * nx; a.vy -= jn * ny;
  b.vx += jn * nx; b.vy += jn * ny;
  return vn;
}

/** n: unit normal pointing from the cushion into the table. */
function collideCushion(b: Ball, nx: number, ny: number): number {
  const vn = -(b.vx * nx + b.vy * ny); // approach speed
  if (vn <= 0) return 0;
  const e = eCushion(vn);
  const ph = (1 + e) * vn; // horizontal normal impulse per unit mass
  const jn = ph / CUSHION_COS; // along the contact normal; the slate takes the vertical part

  // Contact point, above the centre on the cushion side: r = R(-cos n + sin z).
  const rx = -R * CUSHION_COS * nx, ry = -R * CUSHION_COS * ny, rz = R * CUSHION_SIN;
  // Its velocity: v + w x r.
  const cx = b.vx + (b.wy * rz - b.wz * ry);
  const cy = b.vy + (b.wz * rx - b.wx * rz);
  const cz = b.wx * ry - b.wy * rx;
  // Contact normal N = cos n - sin z; remove the normal part.
  const Nx = CUSHION_COS * nx, Ny = CUSHION_COS * ny, Nz = -CUSHION_SIN;
  const cN = cx * Nx + cy * Ny + cz * Nz;
  const tx = cx - cN * Nx, ty = cy - cN * Ny, tz = cz - cN * Nz;
  const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (slip > 1e-9) {
    const jt = Math.min(MU_CUSHION * jn, (2 * slip) / 7);
    const fx = (-jt * tx) / slip, fy = (-jt * ty) / slip, fz = (-jt * tz) / slip;
    b.vx += fx; b.vy += fy;
    const k = 5 / (2 * R * R);
    b.wx += k * (ry * fz - rz * fy);
    b.wy += k * (rz * fx - rx * fz);
    b.wz += k * (rx * fy - ry * fx);
  }
  b.vx += ph * nx; b.vy += ph * ny;
  return vn;
}

// ---------------------------------------------------------------- the simulation

export class Sim {
  balls: Ball[];
  /** Simulated time since the shot, seconds. */
  t = 0;
  events: SimEvent[] = [];
  /** Optional listener, called as each event happens (sound, effects). */
  onEvent: ((e: SimEvent) => void) | null = null;

  constructor(balls: readonly Ball[]) {
    this.balls = cloneBalls(balls);
  }

  private emit(e: SimEvent) {
    this.events.push(e);
    if (this.onEvent) this.onEvent(e);
  }

  /** Strike the cue ball. Returns false for a miscue (the tip slipped off; the ball barely moves). */
  strike(shot: Shot): boolean {
    const cue = this.balls[0];
    let side = shot.side, height = shot.height;
    const off2 = side * side + height * height;
    const miscue = off2 > MAX_TIP * MAX_TIP;
    let speed = Math.min(Math.max(shot.speed, 0), MAX_SPEED);
    if (miscue) {
      // The tip skids off: a weak, wild hit with some of the intended spin.
      const s = MAX_TIP / Math.sqrt(off2);
      side *= s * 0.6; height *= s * 0.6; speed *= 0.25;
    }
    // Squirt: side spin pushes the cue ball off the aim line, away from the side struck.
    const rx = shot.dy, ry = -shot.dx; // right of the aim
    let dx = shot.dx - SQUIRT * side * rx, dy = shot.dy - SQUIRT * side * ry;
    const l = Math.sqrt(dx * dx + dy * dy);
    dx /= l; dy /= l;
    cue.vx = dx * speed; cue.vy = dy * speed;
    // w = 5v/(2R) (side z + height (z x d)); height 0.4 is natural roll.
    const k = (5 * speed) / (2 * R);
    cue.wx = k * height * -dy;
    cue.wy = k * height * dx;
    cue.wz = k * side;
    this.t = 0;
    this.events = [];
    this.emit({ t: 0, type: "cue", a: 0, speed, miscue });
    return !miscue;
  }

  moving(): boolean {
    for (const b of this.balls) if (isMoving(b)) return true;
    return false;
  }

  /** Advance one fixed step, handling every contact inside it in order. */
  step() {
    const balls = this.balls;
    const n = balls.length;
    let rem = DT;
    let guard = 0;
    while (rem > 0) {
      let best = rem;
      let kind = 0; // 0 none, 1 ball-ball, 2 segment, 3 point
      let ia = -1, ib = -1;
      for (let i = 0; i < n; i++) {
        const a = balls[i];
        if (!a.on) continue;
        const am = translating(a);
        for (let j = i + 1; j < n; j++) {
          const b = balls[j];
          if (!b.on || (!am && !translating(b))) continue;
          const t = toiBalls(a, b, best);
          if (t < best) { best = t; kind = 1; ia = i; ib = j; }
        }
        if (!am) continue;
        const segs = TABLE.segments;
        for (let s = 0; s < segs.length; s++) {
          const t = toiSegment(a, segs[s], best);
          if (t < best) { best = t; kind = 2; ia = i; ib = s; }
        }
        const pts = TABLE.points;
        for (let p = 0; p < pts.length; p++) {
          const t = toiPoint(a, pts[p], best);
          if (t < best) { best = t; kind = 3; ia = i; ib = p; }
        }
      }

      if (best > 0) {
        for (const b of balls) if (b.on && isMoving(b)) advance(b, best);
        this.t += best;
        rem -= best;
        this.checkPockets();
      }
      if (kind === 1) {
        const a = balls[ia], b = balls[ib];
        if (a.on && b.on) {
          const s = collideBalls(a, b);
          if (s > 0) this.emit({ t: this.t, type: "ball", a: a.id, b: b.id, speed: s });
        }
      } else if (kind === 2 || kind === 3) {
        const b = balls[ia];
        if (b.on) {
          let nx: number, ny: number;
          if (kind === 2) { nx = TABLE.segments[ib].nx; ny = TABLE.segments[ib].ny; }
          else {
            const p = TABLE.points[ib];
            nx = b.x - p.x; ny = b.y - p.y;
            const d = Math.sqrt(nx * nx + ny * ny);
            nx /= d; ny /= d;
          }
          const s = collideCushion(b, nx, ny);
          if (s > 0) this.emit({ t: this.t, type: "cushion", a: b.id, speed: s, x: b.x, y: b.y });
        }
      }
      if (++guard > 400) {
        // A pathological pile-up: finish the step without contacts rather than stall.
        for (const b of balls) if (b.on && isMoving(b)) advance(b, rem);
        this.t += rem;
        this.checkPockets();
        break;
      }
    }
  }

  private checkPockets() {
    for (const b of this.balls) {
      if (!b.on) continue;
      const p = pocketAt(b.x, b.y);
      if (p < 0) continue;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      b.on = false;
      b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0; b.wz = 0;
      this.emit({ t: this.t, type: "pocket", a: b.id, pocket: p, speed });
    }
  }

  /** Run until everything is still (or maxTime passes). Returns the number of steps. */
  run(maxTime = 60): number {
    let steps = 0;
    while (this.moving() && this.t < maxTime) { this.step(); steps++; }
    return steps;
  }
}

/** The exact state, as a string of hex bits: for determinism checks and network checksums. */
export function fingerprint(balls: readonly Ball[]): string {
  const f = new Float64Array(1), w = new Uint32Array(f.buffer);
  let h = 2166136261;
  const mix = (v: number) => {
    f[0] = v;
    for (let k = 0; k < 2; k++) { h = Math.imul(h ^ w[k], 16777619) >>> 0; }
  };
  for (const b of balls) { mix(b.on ? 1 : 0); mix(b.x); mix(b.y); mix(b.vx); mix(b.vy); mix(b.wz); }
  return h.toString(16).padStart(8, "0");
}
