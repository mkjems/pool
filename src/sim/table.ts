// Table geometry: cushion noses as line segments, pocket jaws, and where a ball drops.
// Origin at the table's centre, x along the length (head end at -x), y across, z up.

import { R, TABLE_L, TABLE_W } from "./constants";

export interface Segment {
  ax: number; ay: number; bx: number; by: number;
  /** Unit direction a -> b. */
  tx: number; ty: number;
  len: number;
  /** Unit normal pointing into the playing area (away from the cushion). */
  nx: number; ny: number;
  kind: "rail" | "jaw";
}

export interface Point { x: number; y: number }

export interface Pocket {
  id: number;
  kind: "corner" | "side";
  /** Middle of the mouth, between the two cushion noses. */
  mx: number; my: number;
  /** Unit direction from the mouth into the pocket. */
  ux: number; uy: number;
  /** A ball drops once its centre is this far past the mouth, along (ux, uy). */
  drop: number;
  /** Where the hole is drawn: centre and radius. */
  hx: number; hy: number; hr: number;
  /** The two cushion noses. */
  noses: [Point, Point];
}

export const CORNER_MOUTH = 0.117; // between the noses, 4.6 in
export const SIDE_MOUTH = 0.13; // 5.1 in
const CORNER_DROP = 0.021;
const SIDE_DROP = 0.014;
const JAW_LEN = 0.075;

const HL = TABLE_L / 2;
const HW = TABLE_W / 2;
const A = CORNER_MOUTH / Math.sqrt(2);

/** Head string (the break line) and the spots. */
export const HEAD_X = -TABLE_L / 4;
export const FOOT_X = TABLE_L / 4;

function unit(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  return [x / l, y / l];
}

function segment(ax: number, ay: number, bx: number, by: number, insideX: number, insideY: number, kind: Segment["kind"]): Segment {
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const tx = dx / len, ty = dy / len;
  let nx = -ty, ny = tx;
  if (nx * (insideX - ax) + ny * (insideY - ay) < 0) { nx = -nx; ny = -ny; }
  return { ax, ay, bx, by, tx, ty, len, nx, ny, kind };
}

function build() {
  const segments: Segment[] = [];
  const points: Point[] = [];
  const pockets: Pocket[] = [];

  // Rails, between the noses.
  for (const sy of [-1, 1]) {
    segments.push(segment(-HL + A, sy * HW, -SIDE_MOUTH / 2, sy * HW, 0, 0, "rail"));
    segments.push(segment(SIDE_MOUTH / 2, sy * HW, HL - A, sy * HW, 0, 0, "rail"));
  }
  for (const sx of [-1, 1]) segments.push(segment(sx * HL, -HW + A, sx * HL, HW - A, 0, 0, "rail"));

  // Pockets, counter-clockwise from the head-end corner at (-, -).
  const order: Array<["corner" | "side", number, number]> = [
    ["corner", -1, -1], ["side", 0, -1], ["corner", 1, -1], ["corner", 1, 1], ["side", 0, 1], ["corner", -1, 1],
  ];
  // Corner jaws converge 7° (142° pocket cut), side jaws 14° (104°): directions as rational vectors, normalised.
  const [cjx, cjy] = unit(0.788, 0.6157);
  const [sjx, sjy] = unit(0.2419, 0.9703);
  for (const [kind, sx, sy] of order) {
    const id = pockets.length;
    if (kind === "corner") {
      const p1: Point = { x: sx * (HL - A), y: sy * HW }; // nose on the long rail
      const p2: Point = { x: sx * HL, y: sy * (HW - A) }; // nose on the short rail
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const [ux, uy] = unit(sx, sy);
      segments.push(segment(p1.x, p1.y, p1.x + sx * cjx * JAW_LEN, p1.y + sy * cjy * JAW_LEN, mx, my, "jaw"));
      segments.push(segment(p2.x, p2.y, p2.x + sx * cjy * JAW_LEN, p2.y + sy * cjx * JAW_LEN, mx, my, "jaw"));
      points.push(p1, p2);
      const hd = 0.034;
      pockets.push({ id, kind, mx, my, ux, uy, drop: CORNER_DROP, hx: mx + ux * hd, hy: my + uy * hd, hr: 0.064, noses: [p1, p2] });
    } else {
      const p1: Point = { x: -SIDE_MOUTH / 2, y: sy * HW };
      const p2: Point = { x: SIDE_MOUTH / 2, y: sy * HW };
      segments.push(segment(p1.x, p1.y, p1.x + sjx * JAW_LEN, p1.y + sy * sjy * JAW_LEN, 0, sy * HW, "jaw"));
      segments.push(segment(p2.x, p2.y, p2.x - sjx * JAW_LEN, p2.y + sy * sjy * JAW_LEN, 0, sy * HW, "jaw"));
      points.push(p1, p2);
      const hd = 0.036;
      pockets.push({ id, kind, mx: 0, my: sy * HW, ux: 0, uy: sy, drop: SIDE_DROP, hx: 0, hy: sy * (HW + hd), hr: 0.06, noses: [p1, p2] });
    }
  }
  return { segments, points, pockets };
}

export const TABLE = build();

/** Which pocket a ball centre at (x, y) has dropped into, or -1. */
export function pocketAt(x: number, y: number): number {
  for (const p of TABLE.pockets) {
    if ((x - p.mx) * p.ux + (y - p.my) * p.uy > p.drop) return p.id;
  }
  return -1;
}

/** True when a ball centred at (x, y) lies fully on the playing surface (inside the cushion noses). */
export function onSurface(x: number, y: number): boolean {
  return x >= -HL + R && x <= HL - R && y >= -HW + R && y <= HW - R;
}
