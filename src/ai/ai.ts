// The computer opponent. It finds candidate shots, plays each many times on the real physics with the small
// errors its level makes, judges every outcome with the real rules, and picks the best average. It never sees
// anything a player couldn't: same table, same physics, same rules.

import { MAX_SPEED, R, TABLE_L } from "../sim/constants";
import { Sim, type Ball, type Shot } from "../sim/physics";
import { rng } from "../sim/rack";
import { advanceGame, groupOf, judge, legalFirst, onEight, target, type GameState } from "../sim/rules";
import { HEAD_X, TABLE, onSurface } from "../sim/table";

export type Level = "easy" | "medium" | "hard";

interface Spec {
  /** Standard deviation of the aim error, radians. */
  aim: number;
  /** Relative standard deviation of the speed. */
  speed: number;
  /** Standard deviation of the tip position, in R. */
  tip: number;
  /** Trials per candidate. */
  trials: number;
  /** Thinks about where the cue ball ends up. */
  position: boolean;
  /** Tip heights and speed factors it considers. */
  heights: number[];
  speeds: number[];
  /** How many of the most promising pots it studies. */
  breadth: number;
}

export const LEVELS: Record<Level, Spec> = {
  easy: { aim: 0.016, speed: 0.12, tip: 0.08, trials: 5, position: false, heights: [0], speeds: [1], breadth: 6 },
  medium: { aim: 0.0065, speed: 0.07, tip: 0.05, trials: 7, position: true, heights: [-0.3, 0.05, 0.3], speeds: [0.8, 1.25], breadth: 8 },
  hard: { aim: 0.0024, speed: 0.04, tip: 0.03, trials: 9, position: true, heights: [-0.4, 0, 0.35], speeds: [0.7, 1, 1.4], breadth: 10 },
};

export interface Decision {
  /** Where to put the cue ball first (ball in hand), or null. */
  place: { x: number; y: number } | null;
  /** The shot as planned (shown while aiming) and as actually played (with the level's errors). */
  planned: Shot;
  played: Shot;
  /** Pocket called for the 8, or null. */
  called: number | null;
  /** What it thinks of the shot, for the curious: average score, candidates studied, ms spent. */
  score: number;
  studied: number;
  ms: number;
}

interface Candidate { shot: Shot; called: number | null; place: { x: number; y: number } | null; ease: number }

const sq = (x: number) => x * x;

/** Distance from point p to segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function clear(balls: readonly Ball[], ax: number, ay: number, bx: number, by: number, skip: number[]) {
  for (const b of balls) {
    if (!b.on || skip.includes(b.id)) continue;
    if (segDist(b.x, b.y, ax, ay, bx, by) < 2 * R - 0.001) return false;
  }
  return true;
}

/** The point to send an object ball at: a little inside the pocket's mouth. */
function aimPoint(pk: number) {
  const p = TABLE.pockets[pk];
  const d = p.kind === "corner" ? 0.012 : 0.02;
  return { x: p.mx + p.ux * d, y: p.my + p.uy * d };
}

interface Pot { obj: number; pocket: number; gx: number; gy: number; ux: number; uy: number; d2: number }

/** Every way ball `obj` could go straight into a pocket (ignoring where the cue ball is). */
function pots(balls: readonly Ball[], obj: number): Pot[] {
  const o = balls[obj];
  const out: Pot[] = [];
  for (const p of TABLE.pockets) {
    const a = aimPoint(p.id);
    let ux = a.x - o.x, uy = a.y - o.y;
    const d2 = Math.hypot(ux, uy);
    ux /= d2; uy /= d2;
    // Side pockets refuse balls coming in too flat.
    if (p.kind === "side" && ux * p.ux + uy * p.uy < 0.45) continue;
    if (p.kind === "corner" && ux * p.ux + uy * p.uy < 0.35) continue;
    if (!clear(balls, o.x, o.y, a.x, a.y, [0, obj])) continue;
    out.push({ obj, pocket: p.id, gx: o.x - ux * 2 * R, gy: o.y - uy * 2 * R, ux, uy, d2 });
  }
  return out;
}

/** How easy a pot is from a cue-ball position, 0 (impossible) to about 1 (hanging in the jaws). */
function ease(balls: readonly Ball[], cx: number, cy: number, p: Pot): number {
  let dx = p.gx - cx, dy = p.gy - cy;
  const d1 = Math.hypot(dx, dy);
  if (d1 < 1e-6) return 0;
  dx /= d1; dy /= d1;
  const cos = dx * p.ux + dy * p.uy;
  if (cos < 0.17) return 0; // cuts beyond ~80°
  if (!clear(balls, cx, cy, p.gx, p.gy, [0, p.obj])) return 0;
  return (cos * cos) / (1 + 0.9 * d1 + 1.4 * p.d2);
}

function targets(state: GameState, balls: readonly Ball[]): number[] {
  const t = target(state, balls);
  return balls.filter((b) => b.on && b.id !== 0 && (t === "open" ? b.id !== 8 : groupOf(b.id) === t)).map((b) => b.id);
}

/** The best pot available to the player whose turn it is in `state`, 0-1. */
function bestEase(state: GameState, balls: readonly Ball[]): number {
  if (state.ballInHand !== "none") return 0.9;
  const c = balls[0];
  let best = 0;
  for (const id of targets(state, balls)) for (const p of pots(balls, id)) best = Math.max(best, ease(balls, c.x, c.y, p));
  return best;
}

/** A reasonable cue-ball speed for a pot: enough to reach the pocket with some to spare. */
function potSpeed(d1: number, d2: number, cos: number) {
  return Math.min(MAX_SPEED * 0.7, 0.9 + 1.1 * d1 + (1.5 * d2) / Math.max(0.35, cos));
}

export function decide(state: GameState, balls: readonly Ball[], level: Level, seed: number): Decision {
  const t0 = performance.now();
  const spec = LEVELS[level];
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const noisy = (s: Shot, k = 1): Shot => {
    const a = gauss() * spec.aim * k;
    const ca = Math.cos(a), sa = Math.sin(a);
    return {
      dx: s.dx * ca - s.dy * sa, dy: s.dx * sa + s.dy * ca,
      speed: Math.max(0.1, s.speed * (1 + gauss() * spec.speed * k)),
      side: s.side + gauss() * spec.tip * k, height: s.height + gauss() * spec.tip * k,
    };
  };

  // The break: hard, a touch of follow, from near the head spot.
  if (state.breakShot) {
    const y = (r() - 0.5) * 0.1;
    const fx = TABLE_L / 4 - (HEAD_X - 0.02), fy = -y;
    const l = Math.hypot(fx, fy);
    const planned: Shot = { dx: fx / l, dy: fy / l, speed: MAX_SPEED * (0.86 + r() * 0.08), side: 0, height: 0.1 };
    return { place: { x: HEAD_X - 0.02, y }, planned, played: noisy(planned, 0.6), called: null, score: 0, studied: 1, ms: performance.now() - t0 };
  }

  const me = state.turn;
  const candidates: Candidate[] = [];
  const shootingEight = onEight(state, balls);

  // Where the cue ball could be. With ball in hand: straight-in spots behind the easiest pots.
  const spots: Array<{ x: number; y: number } | null> = [];
  if (state.ballInHand === "none") spots.push(null);
  else {
    const all: Array<{ x: number; y: number; e: number }> = [];
    for (const id of targets(state, balls)) {
      for (const p of pots(balls, id)) {
        for (const back of [0.2, 0.34]) {
          for (const turn of [0, 0.25, -0.25]) {
            // Behind the ghost ball, slightly off the straight line so the cue ball can move on.
            const ux = p.ux * Math.cos(turn) - p.uy * Math.sin(turn), uy = p.ux * Math.sin(turn) + p.uy * Math.cos(turn);
            const x = p.gx - ux * back, y = p.gy - uy * back;
            if (!onSurface(x, y) || (state.ballInHand === "kitchen" && x > HEAD_X)) continue;
            if (balls.some((b) => b.on && b.id !== 0 && sq(b.x - x) + sq(b.y - y) < sq(2 * R + 0.003))) continue;
            const e = ease(balls, x, y, p);
            if (e > 0) all.push({ x, y, e });
          }
        }
      }
    }
    all.sort((a, b) => b.e - a.e);
    for (const s of all.slice(0, 4)) spots.push({ x: s.x, y: s.y });
    if (spots.length === 0) {
      // Nothing straight: somewhere central behind the line (or anywhere, mid-table).
      const x = state.ballInHand === "kitchen" ? HEAD_X - 0.15 : 0;
      spots.push({ x, y: 0 });
    }
  }

  // Pots: from each possible cue-ball position, the most promising ones, in several speeds and spins.
  for (const spot of spots) {
    const cx = spot ? spot.x : balls[0].x, cy = spot ? spot.y : balls[0].y;
    const options: Array<{ p: Pot; e: number }> = [];
    for (const id of targets(state, balls)) for (const p of pots(balls, id)) {
      const e = ease(balls, cx, cy, p);
      if (e > 0.02) options.push({ p, e });
    }
    options.sort((a, b) => b.e - a.e);
    for (const { p, e } of options.slice(0, spec.breadth)) {
      let dx = p.gx - cx, dy = p.gy - cy;
      const d1 = Math.hypot(dx, dy);
      dx /= d1; dy /= d1;
      const base = potSpeed(d1, p.d2, dx * p.ux + dy * p.uy);
      for (const h of spec.heights) for (const k of spec.speeds) {
        candidates.push({ shot: { dx, dy, speed: Math.min(MAX_SPEED, base * k), side: 0, height: h }, called: shootingEight ? p.pocket : null, place: spot, ease: e });
      }
    }
  }

  // Safeties, for when no pot is on: roll into a legal ball at a few thicknesses and speeds.
  const potsFound = candidates.length;
  if (potsFound < 4) {
    const spot = spots[0];
    const cx = spot ? spot.x : balls[0].x, cy = spot ? spot.y : balls[0].y;
    for (const id of targets(state, balls)) {
      const o = balls[id];
      const dist = Math.hypot(o.x - cx, o.y - cy);
      for (const off of [0, 0.6, -0.6, 1.4, -1.4]) {
        // Aim at a point beside the ball's centre: off * R sideways.
        const nx = -(o.y - cy) / dist, ny = (o.x - cx) / dist;
        let dx = o.x + nx * off * R - cx, dy = o.y + ny * off * R - cy;
        const l = Math.hypot(dx, dy);
        dx /= l; dy /= l;
        for (const sp of [0.7 + dist * 0.8, 1.4 + dist * 1.2]) {
          candidates.push({ shot: { dx, dy, speed: sp, side: 0, height: 0 }, called: null, place: spot, ease: 0 });
        }
      }
    }
    // Nothing legal in sight at all: try a spread of directions (kicks off a cushion) and keep what works.
    if (candidates.length === 0) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        candidates.push({ shot: { dx: Math.cos(a), dy: Math.sin(a), speed: 2.5, side: 0, height: 0 }, called: null, place: spot, ease: 0 });
      }
    }
  }

  // Study each candidate: play it several times with this level's errors, judge each outcome.
  const value = (c: Candidate): number => {
    const start = balls.map((b) => ({ ...b }));
    if (c.place) { start[0].on = true; start[0].x = c.place.x; start[0].y = c.place.y; }
    const st: GameState = { ...state, ballInHand: "none" };
    if (!legalOpening(st, start, c.shot)) return -8;
    let sum = 0;
    for (let i = 0; i < spec.trials; i++) {
      const sim = new Sim(start);
      sim.strike(noisy(c.shot));
      sim.run(25);
      const v = judge(st, start, sim.balls, sim.events, c.called);
      if (v.winner !== null) { sum += v.winner === me ? 100 : -100; continue; }
      const next = advanceGame(st, sim.balls, sim.events, v);
      if (v.foul) { sum += -12; continue; }
      if (next.turn === me) sum += 20 + (spec.position ? 14 * bestEase(next, sim.balls) : 5);
      else sum += -9 * bestEase(next, sim.balls); // what we leave the opponent
    }
    return sum / spec.trials;
  };

  let best: Candidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = value(c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  if (!best) best = { shot: { dx: 1, dy: 0, speed: 2, side: 0, height: 0 }, called: null, place: spots[0], ease: 0 };
  return {
    place: best.place,
    planned: best.shot,
    played: noisy(best.shot),
    called: best.called,
    score: bestScore,
    studied: candidates.length,
    ms: performance.now() - t0,
  };
}

/** Cheap pre-check: does the cue ball, sent straight along the aim, hit a legal ball first? */
function legalOpening(state: GameState, balls: readonly Ball[], s: Shot): boolean {
  const c = balls[0];
  let first = -1, bestT = Infinity;
  for (const b of balls) {
    if (!b.on || b.id === 0) continue;
    const px = b.x - c.x, py = b.y - c.y;
    const along = px * s.dx + py * s.dy;
    if (along <= 0) continue;
    const perp2 = px * px + py * py - along * along;
    if (perp2 > 4 * R * R) continue;
    const t = along - Math.sqrt(4 * R * R - perp2);
    if (t < bestT) { bestT = t; first = b.id; }
  }
  // Nothing straight ahead: may still be a kick off a cushion, let the trials decide.
  return first < 0 || legalFirst(state, balls, first);
}

