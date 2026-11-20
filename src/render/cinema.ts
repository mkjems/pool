// The camera script of a replay seen from low (the winning shot), in the user's rules (21 November):
// - Every camera stands outside the table and looks in at the action; a camera inside the table filming out at a
//   cushion or a lone pocket tells nothing.
// - Never first person (along the cue). The opening films the shooter from the far side of the table, a little
//   off the line, or from the shooter's side but well off the line: third person.
// - Cuts are good: cut so that every collision that matters and every ball going down is seen.
// - Every camera stays on the bottom side of the table as the top view shows it (where the player stands);
//   flying round the table confuses.
// - Long lenses from further back (about 30°), not wide ones up close: a wide lens near the table stretches it
//   (the near rail huge, the far end tiny). The action may sit off the middle of the picture for that.
// - A replay tells what happened, so it stays wide: the opening is an establishing shot holding every ball and
//   pocket that matters, and the cuts hold the collision, the ball's path and the pocket. Close-ups belong to a
//   montage (the cinematic break), not here.
//
// The shot is played once ahead (the physics is deterministic) to know where each ball is when.

import * as THREE from "three";
import { CUSHION_W, R, RAIL_W, TABLE_L, TABLE_W, WOOD_H } from "../sim/constants";
import { Sim, type Ball, type Shot, type SimEvent } from "../sim/physics";
import { TABLE } from "../sim/table";
import type { Pose } from "./scene";

/** From simulated time `from`, this camera; `push` is where it eases to while it is on. `cut`: a cut, not a glide. */
export interface Beat { from: number; pose: Pose; push: Pose; cut: boolean }

/**
 * Times are simulated seconds. `slow`: the stretches played in slow motion (the stroke and first contact, and
 * round each ball going down); between them, normal speed. `riseAt`: up into the top view.
 */
export interface Cine { beats: Beat[]; next: number; slow: Array<[number, number]>; riseAt: number; rising: boolean }

type Pot = Extract<SimEvent, { type: "pocket" }>;
type Hit = Extract<SimEvent, { type: "ball" }>;

const HX = TABLE_L / 2 + CUSHION_W, HY = TABLE_W / 2 + CUSHION_W; // the backs of the cushions
const OX = HX + RAIL_W, OY = HY + RAIL_W; // the outer edges of the wooden rails
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** From (x, y), going along the unit (wx, wy): how far to the backs of the cushions (or to the box ex, ey). */
function toEdge(x: number, y: number, wx: number, wy: number, ex = HX, ey = HY) {
  let t = Infinity;
  if (wx > 1e-6) t = Math.min(t, (ex - x) / wx);
  if (wx < -1e-6) t = Math.min(t, (-ex - x) / wx);
  if (wy > 1e-6) t = Math.min(t, (ey - y) / wy);
  if (wy < -1e-6) t = Math.min(t, (-ey - y) / wy);
  return Math.max(0, t);
}

/** A phone held upright may open wider: what it holds is mostly side by side. */
const widen = (fov: number, aspect: number) => (aspect < 1 ? Math.min(85, fov / Math.sqrt(aspect)) : fov);

/** A camera at `eye` turned to hold every point, with a little room round them; the field of view is vertical. */
export function framed(eye: THREE.Vector3, points: THREE.Vector3[], aspect: number, minFov: number, maxFov: number): Pose {
  const f = new THREE.Vector3();
  for (const p of points) f.add(p.clone().sub(eye).normalize());
  f.normalize();
  const right = f.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
  const up = right.clone().cross(f);
  let need = 0;
  for (const p of points) {
    const v = p.clone().sub(eye), ahead = Math.max(0.05, v.dot(f));
    need = Math.max(need, Math.abs(v.dot(up)) / ahead, Math.abs(v.dot(right)) / ahead / aspect);
  }
  const widest = widen(maxFov, aspect);
  const fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(need * 1.15 + 0.03)), minFov, widest);
  return { eye: eye.clone(), look: eye.clone().add(f), up: new THREE.Vector3(0, 0, 1), fov, shiftX: 0, shiftY: 0 };
}

/**
 * A wide shot of `points` from the side `w` points to (unit, from them toward the camera): outside the table,
 * at least `minD` from their middle and backed away until they all fit in `maxFov`, looking down at about `elev`
 * degrees. `edges`: the table's wooden edges, near and far along the line of sight, in the picture too (bottom
 * and top), so it is clearly a table seen whole across. Returns the points it framed.
 */
function establish(w: THREE.Vector2, actors: THREE.Vector3[], aspect: number, minFov: number, maxFov: number, elev = 25, minD = 0.9, edges = false) {
  const cx = actors.reduce((s, p) => s + p.x, 0) / actors.length, cy = actors.reduce((s, p) => s + p.y, 0) / actors.length;
  const points = actors.slice();
  if (edges) {
    // A little past the wood, so it shows with some room round it.
    const near = toEdge(cx, cy, w.x, w.y, OX, OY) + 0.07, far = toEdge(cx, cy, -w.x, -w.y, OX, OY) + 0.1;
    points.push(new THREE.Vector3(cx + w.x * near, cy + w.y * near, WOOD_H), new THREE.Vector3(cx - w.x * far, cy - w.y * far, WOOD_H));
  }
  const tan = Math.tan(THREE.MathUtils.degToRad(elev));
  let D = Math.max(minD, toEdge(cx, cy, w.x, w.y) + 0.3), pose: Pose;
  for (;; D += 0.1) {
    pose = framed(new THREE.Vector3(cx + w.x * D, cy + w.y * D, clamp(D * tan, 0.4, 3)), points, aspect, minFov, 120);
    if (pose.fov <= widen(maxFov, aspect) || D > 8) break;
  }
  return { pose: framed(pose.eye, points, aspect, minFov, maxFov), D, points };
}

/** The same camera a little closer to what it looks at, framed on the same points: to ease toward. */
function closer(p: Pose, points: THREE.Vector3[], aspect: number, k: number, minFov: number, maxFov: number) {
  const centre = points.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const eye = p.eye.clone().lerp(new THREE.Vector3(centre.x, centre.y, p.eye.z), k);
  return framed(eye, points, aspect, minFov, maxFov);
}

/** Where every ball is, every 10 ms of the shot. */
function track(before: readonly Ball[], shot: Shot) {
  const sim = new Sim(before);
  sim.strike(shot);
  const frames: Float64Array[] = [];
  const snap = () => frames.push(Float64Array.from(sim.balls.flatMap((b) => [b.x, b.y])));
  snap();
  for (let i = 1; sim.moving() && sim.t < 30; i++) {
    sim.step();
    if (i % 4 === 0) snap();
  }
  snap();
  return {
    events: sim.events,
    /** When everything is still. */
    end: sim.t,
    at(id: number, t: number) {
      const f = frames[clamp(Math.round(t / 0.01), 0, frames.length - 1)];
      return new THREE.Vector3(f[id * 2], f[id * 2 + 1], R);
    },
  };
}

const angle = (a: THREE.Vector2, b: THREE.Vector2) => Math.acos(clamp(a.dot(b) / (a.length() * b.length() || 1), -1, 1));
const rotate = (v: THREE.Vector2, deg: number) => v.clone().rotateAround(new THREE.Vector2(), THREE.MathUtils.degToRad(deg));

/** Sides a camera may film from: within 45° of "down" (from the action toward the bottom of the screen). */
const SIDES = [0, -15, 15, -30, 30, -45, 45];

/**
 * The script. `tilt`: the sine of the cue's rise. `aspect`: the screen's width over height. `down`: the way to
 * the bottom of the screen in the top view (table coordinates): every camera stands on that side of the table,
 * as a player at the bottom of the screen would, so the table never swings round and the rise into the top view
 * only tilts up.
 */
export function planCine(before: readonly Ball[], shot: Shot, tilt: number, aspect: number, down: THREE.Vector2): Cine {
  const { events, at, end } = track(before, shot);
  const pots = events.filter((e) => e.type === "pocket") as Pot[];
  const hits = events.filter((e) => e.type === "ball") as Hit[];
  const first = hits.find((e) => e.a === 0 || e.b === 0);
  const tFirst = first?.t ?? 0;

  // Each ball going down: from the bottom side, the way most along its last roll (it comes toward us when it
  // can), from before the collision that sent it there, holding that collision, its path and the pocket.
  type Down = { pot: Pot; from: number; pose: Pose; push: Pose; weight: number };
  const downs: Down[] = pots.map((pot) => {
    const P = TABLE.pockets[pot.pocket];
    const u = new THREE.Vector2(pot.vx, pot.vy);
    if (u.lengthSq() < 1e-8) u.set(P.ux, P.uy);
    u.normalize();
    const hit = hits.filter((e) => (e.a === pot.a || e.b === pot.a) && e.t < pot.t).pop();
    let from = !hit ? pot.t - 0.6 : hit === first ? tFirst + 0.12 : hit.t - 0.3;
    from = Math.max(0.3, Math.min(from, pot.t - 0.45));
    const pts = [new THREE.Vector3(P.hx, P.hy, 0), at(pot.a, from), at(0, from), new THREE.Vector3(P.hx * 0.6, P.hy * 0.6, 0)];
    if (hit && hit.t >= from - 0.05) pts.push(at(hit.a, hit.t), at(hit.b, hit.t));
    let w = down, best = Infinity;
    for (const deg of SIDES) {
      const c = rotate(down, deg), score = -0.5 * c.dot(u) + Math.abs(deg) * 0.006;
      if (score < best) { best = score; w = c; }
    }
    const { pose } = establish(w, pts, aspect, 28, 36, 32, 1.6);
    return { pot, from, pose, push: closer(pose, pts, aspect, 0.03, 28, 37), weight: pot.a === 8 ? 3 : pot.a === 0 ? 1 : 2 };
  });
  // Close together (under 0.7 s): one camera for both, the one for the ball that matters more.
  const kept: Down[] = [];
  for (const d of downs.sort((a, b) => a.from - b.from)) {
    const prev = kept[kept.length - 1];
    if (prev && d.from < prev.from + 0.7) {
      if (d.weight > prev.weight) kept[kept.length - 1] = { ...d, from: prev.from };
    } else kept.push(d);
  }

  // The opening, an establishing shot from the bottom side: the cue ball, the ball it hits and where they meet,
  // every ball that goes down and its pocket, and the table's wood near and far. Third person: never looking
  // along the shot from behind the cue ball. Straight on is easiest to read.
  const c0 = at(0, 0);
  const d = new THREE.Vector2(shot.dx, shot.dy).normalize();
  const shotPts = first
    ? [c0, at(0, first.t), at(first.a === 0 ? first.b : first.a, 0)]
    : [c0, at(0, Math.min(end, 1))];
  for (const pot of pots) {
    if (pot.a === 0) continue;
    const P = TABLE.pockets[pot.pocket];
    shotPts.push(at(pot.a, 0), new THREE.Vector3(P.hx, P.hy, 0));
  }
  const tanTilt = tilt / Math.sqrt(1 - tilt * tilt);
  let best: { pose: Pose; score: number; points: THREE.Vector3[] } | null = null;
  for (const deg of SIDES) {
    const w = rotate(down, deg); // from the action toward the camera
    const est = establish(w, shotPts, aspect, 24, 32, 34, 0.9, true);
    let pose = est.pose;
    // Behind the shooter, the cue rises toward the camera: stay above it.
    const look = new THREE.Vector2(-w.x, -w.y);
    const behind = look.dot(d) > 0;
    const cueTop = R + Math.min(pose.eye.distanceTo(c0), 1.6) * 0.87 * tanTilt + 0.12;
    if (behind && pose.eye.z < cueTop) pose = framed(new THREE.Vector3(pose.eye.x, pose.eye.y, cueTop), est.points, aspect, 24, 34);
    let score = Math.max(0, est.D - 3) * 0.3 + Math.abs(deg) * 0.006;
    if (angle(look, d) < THREE.MathUtils.degToRad(30)) score += 1; // first person
    if (!best || score < best.score) best = { pose, score, points: est.points };
  }
  const opening = best!.pose;

  const beats: Beat[] = [{ from: 0, pose: opening, push: framed(opening.eye.clone().lerp(new THREE.Vector3(0, 0, opening.eye.z), 0.02), best!.points, aspect, 24, 33), cut: true }];
  for (const k of kept) {
    // Hardly a different picture: glide over rather than cut (a jump cut).
    const prev = beats[beats.length - 1].pose;
    const same = prev.eye.distanceTo(k.pose.eye) < 0.6 &&
      prev.look.clone().sub(prev.eye).angleTo(k.pose.look.clone().sub(k.pose.eye)) < THREE.MathUtils.degToRad(20);
    beats.push({ from: k.from, pose: k.pose, push: k.push, cut: !same });
  }

  // Slow motion: the stroke and first contact; round each ball going down. Stretches close together join.
  const spans: Array<[number, number]> = [[0, tFirst + 0.35], ...kept.map((k): [number, number] => [k.from - 0.1, k.pot.t + 0.35])];
  const slow: Array<[number, number]> = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = slow[slow.length - 1];
    if (last && s[0] <= last[1] + 0.6) last[1] = Math.max(last[1], s[1]);
    else slow.push([s[0], s[1]]);
  }
  // Up into the top view after the last ball down; with none, once the first contact has played out.
  const riseAt = kept.length
    ? Math.max(...kept.map((k) => k.pot.t)) + 0.35
    : Math.min(Math.max(tFirst + 1.5, 1.2), Math.max(1.2, end - 0.3));
  return { beats, next: 1, slow, riseAt, rising: false };
}

/** Pace at simulated time t: `slowRate` in the slow stretches, easing to normal speed between them. */
export function cineRate(c: Cine, t: number, slowRate: number) {
  let gap = Infinity;
  for (const [a, b] of c.slow) gap = Math.min(gap, t < a ? a - t : t > b ? t - b : 0);
  const k = Math.min(1, gap / 0.3);
  return slowRate + (1 - slowRate) * k * k * (3 - 2 * k);
}
