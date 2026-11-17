// Starting positions. Seeded, so a game number always racks the same way.

import { R } from "./constants";
import type { Ball } from "./physics";
import { FOOT_X, HEAD_X } from "./table";

/** mulberry32: a small seeded generator, identical in every engine. */
export function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ball(id: number, x: number, y: number): Ball {
  return { id, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, on: true };
}

/**
 * An 8-ball rack: apex on the foot spot, the 8 in the middle of the third row, a solid and a stripe in the
 * back corners, the rest shuffled. Balls sit a hair apart with a little random play, as a real rack does.
 */
export function rack8(seed: number): Ball[] {
  const r = rng(seed);
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  shuffle(solids, r);
  shuffle(stripes, r);
  // Slots in rack order: row k (0-4) has k+1 balls.
  const slots: number[] = new Array(15).fill(0);
  const backLeft = 10, backRight = 14, eight = 4;
  slots[eight] = 8;
  const solidLeft = r() < 0.5;
  slots[backLeft] = solidLeft ? solids.pop()! : stripes.pop()!;
  slots[backRight] = solidLeft ? stripes.pop()! : solids.pop()!;
  const rest = shuffle([...solids, ...stripes], r);
  for (let i = 0; i < 15; i++) if (slots[i] === 0) slots[i] = rest.pop()!;

  const gap = 0.00008; // 0.08 mm between balls
  const d = 2 * R + gap;
  const rowStep = (d * Math.sqrt(3)) / 2;
  const balls: Ball[] = [ball(0, HEAD_X, 0)];
  let i = 0;
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j <= k; j++) {
      const jitter = 0.00006;
      const x = FOOT_X + k * rowStep + (r() - 0.5) * jitter;
      const y = (j - k / 2) * d + (r() - 0.5) * jitter;
      balls.push(ball(slots[i++], x, y));
    }
  }
  balls.sort((a, b) => a.id - b.id);
  return balls;
}

/** Fisher-Yates: never sort with a random comparison (engines sort differently). */
export function shuffle<T>(a: T[], r: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
