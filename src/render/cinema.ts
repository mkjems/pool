// The camera script of a replay seen from low (the winning shot), in the user's rules (21 November):
// - Every camera stands outside the table and looks in at the action; a camera inside the table filming out at a
//   cushion or a lone pocket tells nothing.
// - Never first person (along the cue). The opening films the shooter from the far side of the table, a little
//   off the line, or from the shooter's side but well off the line: third person.
// - Cuts are good: cut so that every collision that matters and every ball going down is seen.
//
// The shot is played once ahead (the physics is deterministic) to know where each ball is when.

import * as THREE from "three";
import { CUSHION_W, R, TABLE_L, TABLE_W } from "../sim/constants";
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
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** From (x, y), going along the unit (wx, wy): how far to the backs of the cushions. */
function toEdge(x: number, y: number, wx: number, wy: number) {
  let t = Infinity;
  if (wx > 1e-6) t = Math.min(t, (HX - x) / wx);
  if (wx < -1e-6) t = Math.min(t, (-HX - x) / wx);
  if (wy > 1e-6) t = Math.min(t, (HY - y) / wy);
  if (wy < -1e-6) t = Math.min(t, (-HY - y) / wy);
  return Math.max(0, t);
}

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
  // A phone held upright may open wider: what it holds is mostly side by side.
  const widest = aspect < 1 ? Math.min(85, maxFov / Math.sqrt(aspect)) : maxFov;
  const fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(need * 1.15 + 0.03)), minFov, widest);
  return { eye: eye.clone(), look: eye.clone().add(f), up: new THREE.Vector3(0, 0, 1), fov, shiftX: 0, shiftY: 0 };
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
    at(id: number, t: number) {
      const f = frames[clamp(Math.round(t / 0.01), 0, frames.length - 1)];
      return new THREE.Vector3(f[id * 2], f[id * 2 + 1], R);
    },
  };
}

const angle = (a: THREE.Vector2, b: THREE.Vector2) => Math.acos(clamp(a.dot(b) / (a.length() * b.length() || 1), -1, 1));
const rotate = (v: THREE.Vector2, deg: number) => v.clone().rotateAround(new THREE.Vector2(), THREE.MathUtils.degToRad(deg));

/**
 * The script, if an object ball went down. `tilt`: the sine of the cue's rise. `aspect`: the screen's width
 * over height.
 */
export function planCine(before: readonly Ball[], shot: Shot, tilt: number, aspect: number): Cine | null {
  const { events, at } = track(before, shot);
  const pots = events.filter((e) => e.type === "pocket") as Pot[];
  if (!pots.some((e) => e.a !== 0)) return null;
  const hits = events.filter((e) => e.type === "ball") as Hit[];
  const first = hits.find((e) => e.a === 0 || e.b === 0);
  const tFirst = first?.t ?? 0;

  // Each ball going down: from beyond its pocket, looking back along its last roll (it comes toward us), from
  // before the collision that sent it there, holding that collision, its path and the pocket.
  type Down = { pot: Pot; from: number; pose: Pose; push: Pose; dir: THREE.Vector2; weight: number };
  const away = aspect < 1 ? 1.45 : 1; // further back on a phone held upright, or the pocket fills the picture
  const downs: Down[] = pots.map((pot) => {
    const P = TABLE.pockets[pot.pocket];
    const u = new THREE.Vector2(pot.vx, pot.vy);
    if (u.lengthSq() < 1e-8) u.set(P.ux, P.uy);
    u.normalize();
    const hit = hits.filter((e) => (e.a === pot.a || e.b === pot.a) && e.t < pot.t).pop();
    let from = !hit ? pot.t - 0.6 : hit === first ? tFirst + 0.12 : hit.t - 0.3;
    from = Math.max(0.3, Math.min(from, pot.t - 0.45));
    const pts = [new THREE.Vector3(P.hx, P.hy, 0), at(pot.a, from), new THREE.Vector3(P.hx * 0.65, P.hy * 0.65, 0)];
    if (hit && hit.t >= from - 0.05) pts.push(at(hit.a, hit.t), at(hit.b, hit.t));
    const eye = new THREE.Vector3(P.hx + u.x * 0.55 * away, P.hy + u.y * 0.55 * away, 0.36 * away);
    const pose = framed(eye, pts, aspect, 34, 62);
    return { pot, from, pose, push: closer(pose, pts, aspect, 0.12, 34, 64), dir: u.clone().negate(), weight: pot.a === 8 ? 3 : pot.a === 0 ? 1 : 2 };
  });
  // Close together (under 0.7 s): one camera for both, the one for the ball that matters more.
  const kept: Down[] = [];
  for (const d of downs.sort((a, b) => a.from - b.from)) {
    const prev = kept[kept.length - 1];
    if (prev && d.from < prev.from + 0.7) {
      if (d.weight > prev.weight) kept[kept.length - 1] = { ...d, from: prev.from };
    } else kept.push(d);
  }

  // The opening: the cue ball, the ball it hits and where they meet, filmed from the far side of the table a
  // little off the line (the cue ball comes toward us), or from the shooter's side well off it. Not from where
  // the first pocket camera stands (a cut there would hardly change the picture), not cramped, not far.
  const c0 = at(0, 0);
  const d = new THREE.Vector2(shot.dx, shot.dy).normalize();
  const shotPts = first
    ? [c0, at(0, first.t), at(first.a === 0 ? first.b : first.a, 0)]
    : [c0, at(0, Math.min(1, tFirst + 1))];
  const tanTilt = tilt / Math.sqrt(1 - tilt * tilt);
  const firstDown = kept[0];
  let best: { pose: Pose; score: number } | null = null;
  for (const [deg, behind] of [[25, false], [-25, false], [40, false], [-40, false], [150, true], [-150, true]] as const) {
    const w = rotate(d, deg); // from the cue ball toward the camera
    const D = toEdge(c0.x, c0.y, w.x, w.y) + 0.3;
    let h = clamp(0.22 + 0.2 * D, 0.3, 0.6);
    // On the shooter's side the cue rises toward the camera: stay above it.
    if (behind) h = Math.max(h, R + Math.min(D, 1.6) * 0.87 * tanTilt + 0.12);
    const pose = framed(new THREE.Vector3(c0.x + w.x * D, c0.y + w.y * D, h), shotPts, aspect, 26, 60);
    const look = new THREE.Vector2(-w.x, -w.y);
    let score = Math.abs(D - 1.1) + (behind ? 0.35 : 0) + (Math.abs(deg) === 40 ? 0.15 : 0) + Math.max(0, pose.fov - 50) * 0.05;
    if (firstDown && angle(look, firstDown.dir) < THREE.MathUtils.degToRad(40)) score += 0.8;
    if (!best || score < best.score) best = { pose, score };
  }
  const opening = best!.pose;

  const beats: Beat[] = [{ from: 0, pose: opening, push: closer(opening, shotPts, aspect, 0.1, 26, 62), cut: true }];
  for (const k of kept) beats.push({ from: k.from, pose: k.pose, push: k.push, cut: true });

  // Slow motion: the stroke and first contact; round each ball going down. Stretches close together join.
  const spans: Array<[number, number]> = [[0, tFirst + 0.35], ...kept.map((k): [number, number] => [k.from - 0.1, k.pot.t + 0.35])];
  const slow: Array<[number, number]> = [];
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = slow[slow.length - 1];
    if (last && s[0] <= last[1] + 0.6) last[1] = Math.max(last[1], s[1]);
    else slow.push([s[0], s[1]]);
  }
  const lastDown = Math.max(...kept.map((k) => k.pot.t));
  return { beats, next: 1, slow, riseAt: lastDown + 0.35, rising: false };
}

/** Pace at simulated time t: `slowRate` in the slow stretches, easing to normal speed between them. */
export function cineRate(c: Cine, t: number, slowRate: number) {
  let gap = Infinity;
  for (const [a, b] of c.slow) gap = Math.min(gap, t < a ? a - t : t > b ? t - b : 0);
  const k = Math.min(1, gap / 0.3);
  return slowRate + (1 - slowRate) * k * k * (3 - 2 * k);
}
