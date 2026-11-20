// The camera script of a replay seen from low (the winning shot). Every camera stands outside the table and
// looks in at the action, framed to hold what matters: for the stroke, behind the cue ball (beyond the rail
// behind it) with the cue ball and the ball it hits in the picture; then a cut to beyond the pocket, the ball
// rolling toward us across the table and dropping in the foreground. A camera inside the table looking out at a
// cushion tells nothing (the user, 21 November).

import * as THREE from "three";
import { CUSHION_W, R, TABLE_L, TABLE_W } from "../sim/constants";
import type { Ball, Shot, SimEvent } from "../sim/physics";
import { TABLE } from "../sim/table";
import type { Pose } from "./scene";

/**
 * Times are simulated seconds. `slow`: the stretches played in slow motion (the stroke and first contact, the
 * last moments before the drop and the fall); between them, normal speed.
 */
export interface Cine {
  stroke: Pose; strokeIn: Pose; pocket: Pose; pocketIn: Pose;
  cut: number; pot: number; slow: Array<[number, number]>;
  cutDone: boolean; rising: boolean;
}

const HX = TABLE_L / 2 + CUSHION_W, HY = TABLE_W / 2 + CUSHION_W; // the backs of the cushions
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
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

/**
 * The script, if a ball went down (the 8 if it did, else the last one). `tilt`: the sine of the cue's rise.
 * `aspect`: the screen's width over height.
 */
export function planCine(before: readonly Ball[], shot: Shot, tilt: number, events: readonly SimEvent[], aspect: number): Cine | null {
  const pots = events.filter((e) => e.type === "pocket" && e.a !== 0) as Extract<SimEvent, { type: "pocket" }>[];
  const pot = pots.find((e) => e.a === 8) ?? pots[pots.length - 1];
  if (!pot) return null;
  const c = before[0];
  const d = new THREE.Vector2(shot.dx, shot.dy).normalize(), n = new THREE.Vector2(-d.y, d.x);
  const first = events.find((e) => e.type === "ball");
  const firstHit = events.find((e) => e.type === "ball" && (e.a === 0 || e.b === 0)) as Extract<SimEvent, { type: "ball" }> | undefined;

  // The stroke: beyond the rail behind the cue ball, looking along the shot. Higher the further back (to see
  // over the cloth) and the more the cue is raised (to stay above it).
  const back = toEdge(c.x, c.y, -d.x, -d.y) + 0.28;
  const tanTilt = tilt / Math.sqrt(1 - tilt * tilt);
  let h = clamp(0.16 + 0.16 * back, 0.24, 0.5);
  if (back < 1.6) h = Math.max(h, R + back * tanTilt + 0.12);
  const cue = v3(c.x, c.y, R);
  const hitId = firstHit ? (firstHit.a === 0 ? firstHit.b : firstHit.a) : -1;
  const target = hitId >= 0 ? v3(before[hitId].x, before[hitId].y, R) : v3(c.x + d.x * 0.8, c.y + d.y * 0.8, R);
  const strokeAt = (k: number) => v3(c.x - d.x * k + n.x * 0.04, c.y - d.y * k + n.y * 0.04, h);
  const stroke = framed(strokeAt(back), [cue, target], aspect, 24, 55);
  const strokeIn = framed(strokeAt(back * 0.88), [cue, target], aspect, 24, 58);

  // The pot: beyond the pocket, looking back along the ball's last roll, holding the pocket, where the ball
  // started, and some of the table toward its middle.
  const P = TABLE.pockets[pot.pocket];
  const u = new THREE.Vector2(pot.vx, pot.vy);
  if (u.lengthSq() < 1e-8) u.set(P.ux, P.uy);
  u.normalize();
  const hole = v3(P.hx, P.hy, 0), start = v3(before[pot.a].x, before[pot.a].y, R);
  const toward = v3(P.hx * 0.65, P.hy * 0.65, 0);
  // Further back on a phone held upright, or the pocket fills the picture.
  const away = aspect < 1 ? 1.45 : 1;
  const pocketAt = (k: number, z: number) => v3(P.hx + u.x * k * away, P.hy + u.y * k * away, z * away);
  const pocket = framed(pocketAt(0.55, 0.36), [hole, start, toward], aspect, 34, 60);
  const pocketIn = framed(pocketAt(0.47, 0.33), [hole, start, toward], aspect, 34, 62);

  // The cut: as the ball is hit, but at least 0.45 s before it drops (so a ball near the pocket is seen being
  // struck from there), and not in the first quarter second (the stroke is seen from behind).
  const hit = events.find((e) => e.type === "ball" && (e.a === pot.a || e.b === pot.a));
  const cut = Math.max(0.25, Math.min((hit?.t ?? pot.t) + 0.03, pot.t - 0.45));
  const opening: [number, number] = [0, (first?.t ?? 0) + 0.35];
  const drop: [number, number] = [Math.max(cut - 0.2, pot.t - 0.7), pot.t + 0.35];
  const slow: Array<[number, number]> = drop[0] <= opening[1] + 0.6 ? [[0, drop[1]]] : [opening, drop];
  return { stroke, strokeIn, pocket, pocketIn, cut, pot: pot.t, slow, cutDone: false, rising: false };
}

/** Pace at simulated time t: `slowRate` in the slow stretches, easing to normal speed between them. */
export function cineRate(c: Cine, t: number, slowRate: number) {
  let gap = Infinity;
  for (const [a, b] of c.slow) gap = Math.min(gap, t < a ? a - t : t > b ? t - b : 0);
  const k = Math.min(1, gap / 0.3);
  return slowRate + (1 - slowRate) * k * k * (3 - 2 * k);
}
