// The cue's tilt: how far a player raises the butt so the cue clears the rails and the other balls. It is part
// of the shot (a raised cue drives the ball into the cloth and makes side spin curve, see Sim.strike), so it is
// worked out here, deterministically, like the physics (only + - * / and Math.sqrt).
//
// The tilt is the sine of the cue's angle above the cloth. The tip offset (side, height, in R) is measured
// across the cue, as a player sees it along the cue: a raised cue aimed at the centre puts no spin on the ball.

import { CUSHION_H, CUSHION_W, R, RAIL_W, TABLE_L, TABLE_W, WOOD_H } from "./constants";
import type { Ball } from "./physics";

/** The cue: tip and butt radius, length, metres. */
export const CUE_TIP_R = 0.0064, CUE_BUTT_R = 0.0145, CUE_LENGTH = 1.5;
/** The tip, as it strikes, is this far back along the cue from where its axis enters the ball. */
export const CUE_GAP = 0.012;
/** Tilt of a player's natural stance (about 7°), and the most a player raises the cue (about 68°). */
export const MIN_TILT = 0.12, MAX_TILT = 0.93;
const STEP = 0.01; // tried in these steps of the sine
const CLEAR = 0.004; // air between the cue and a rail or a ball
const RAIL_TOP = WOOD_H + 0.001; // the leather lip round the pockets stands this high

/** The cue's axis: where it enters the ball (q) and the unit direction it points, forward and down (f). */
export interface CueAxis { qx: number; qy: number; qz: number; fx: number; fy: number; fz: number }

/** The axis of a cue at `tilt` behind the ball at (x, y), aiming (dx, dy), tip at (side, height). */
export function cueAxis(x: number, y: number, dx: number, dy: number, side: number, height: number, tilt: number): CueAxis {
  const s = tilt, c = Math.sqrt(1 - s * s);
  const fx = dx * c, fy = dy * c, fz = -s;
  const ux = dx * s, uy = dy * s, uz = c; // "up", across the cue
  const rx = dy, ry = -dx; // right of the aim
  // The axis passes the ball's centre at the tip offset; it enters the ball this far before the centre.
  const off = Math.min(side * side + height * height, 0.81);
  const back = R * Math.sqrt(1 - off);
  return {
    qx: x + (rx * side + ux * height) * R - fx * back,
    qy: y + (ry * side + uy * height) * R - fy * back,
    qz: R + uz * height * R - fz * back,
    fx, fy, fz,
  };
}

/** Height of the cushion or the wood at a point, 0 on the cloth and beyond the table. */
function railHeight(x: number, y: number): number {
  const out = Math.max(Math.abs(x) - TABLE_L / 2, Math.abs(y) - TABLE_W / 2);
  if (out <= 0) return 0;
  if (out <= CUSHION_W) return CUSHION_H;
  return out <= CUSHION_W + RAIL_W ? RAIL_TOP : 0;
}

/** Radius of the cue `t` metres back from where its axis enters the ball. */
function cueRadius(t: number): number {
  return CUE_TIP_R + (CUE_BUTT_R - CUE_TIP_R) * (Math.max(0, t - CUE_GAP) / CUE_LENGTH);
}

/** Whether the cue, tip as it strikes, misses the rails and every ball on the cloth but the cue ball. */
function clears(a: CueAxis, balls: readonly Ball[]): boolean {
  const end = CUE_GAP + CUE_LENGTH;
  const flat = Math.sqrt(1 - a.fz * a.fz); // the cue's lowest point is radius / flat below its axis
  for (let i = 0; ; i++) {
    const t = CUE_GAP + i * 0.01;
    if (t > end) break;
    const px = a.qx - a.fx * t, py = a.qy - a.fy * t;
    const h = railHeight(px, py);
    if (h > 0 && a.qz - a.fz * t - cueRadius(t) / flat < h + CLEAR) return false;
  }
  for (const b of balls) {
    if (b.id === 0 || !b.on || b.air >= 0) continue;
    // The point of the cue's axis closest to the ball's centre, kept between the tip and the butt.
    const vx = b.x - a.qx, vy = b.y - a.qy, vz = R - a.qz;
    const along = -(vx * a.fx + vy * a.fy + vz * a.fz);
    if (along < CUE_GAP - R - CUE_BUTT_R || along > end + R + CUE_BUTT_R) continue;
    const t = Math.min(Math.max(along, CUE_GAP), end);
    const cx = a.qx - a.fx * t - b.x, cy = a.qy - a.fy * t - b.y, cz = a.qz - a.fz * t - R;
    const min = R + cueRadius(t) + CLEAR;
    if (cx * cx + cy * cy + cz * cz < min * min) return false;
  }
  return true;
}

/**
 * The least tilt, from a natural stance up, at which a cue aiming (dx, dy) at the cue ball with the tip at
 * (side, height) clears the rails and the other balls; the most a player raises it if nothing clears.
 */
export function cueTilt(balls: readonly Ball[], dx: number, dy: number, side: number, height: number): number {
  const c = balls[0];
  for (let i = 0; ; i++) {
    const s = MIN_TILT + i * STEP;
    if (s >= MAX_TILT) return MAX_TILT;
    if (clears(cueAxis(c.x, c.y, dx, dy, side, height, s), balls)) return s;
  }
}
