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
  /**
   * The hole in the bed, seen from above: a capsule (segment a-b thickened by r) across the mouth. Its near edge
   * is the drop line: past it a ball's centre is over the hole and the ball starts to fall.
   */
  opening: { ax: number; ay: number; bx: number; by: number; r: number };
}

/** The opening's capsule for a pocket: as wide as the mouth, the near edge on the drop line. */
function opening(kind: Pocket["kind"], mx: number, my: number, ux: number, uy: number, drop: number): Pocket["opening"] {
  const r = kind === "corner" ? 0.06 : 0.047, half = kind === "corner" ? 0.01 : 0.02;
  const cx = mx + ux * (drop + r), cy = my + uy * (drop + r);
  return { ax: cx - uy * half, ay: cy + ux * half, bx: cx + uy * half, by: cy - ux * half, r };
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
      pockets.push({
        id, kind, mx, my, ux, uy, drop: CORNER_DROP, hx: mx + ux * hd, hy: my + uy * hd, hr: 0.064, noses: [p1, p2],
        opening: opening(kind, mx, my, ux, uy, CORNER_DROP),
      });
    } else {
      const p1: Point = { x: -SIDE_MOUTH / 2, y: sy * HW };
      const p2: Point = { x: SIDE_MOUTH / 2, y: sy * HW };
      segments.push(segment(p1.x, p1.y, p1.x + sjx * JAW_LEN, p1.y + sy * sjy * JAW_LEN, 0, sy * HW, "jaw"));
      segments.push(segment(p2.x, p2.y, p2.x - sjx * JAW_LEN, p2.y + sy * sjy * JAW_LEN, 0, sy * HW, "jaw"));
      points.push(p1, p2);
      const hd = 0.036;
      pockets.push({
        id, kind, mx: 0, my: sy * HW, ux: 0, uy: sy, drop: SIDE_DROP, hx: 0, hy: sy * (HW + hd), hr: 0.06, noses: [p1, p2],
        opening: opening(kind, 0, sy * HW, 0, sy, SIDE_DROP),
      });
    }
  }
  return { segments, points, pockets };
}

export const TABLE = build();

/** Squared distance from (x, y) to a pocket opening's middle segment, and where along it (0..1). */
export function openingDist2(o: Pocket["opening"], x: number, y: number): { d2: number; k: number } {
  const dx = o.bx - o.ax, dy = o.by - o.ay;
  let k = ((x - o.ax) * dx + (y - o.ay) * dy) / (dx * dx + dy * dy);
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const ex = x - o.ax - dx * k, ey = y - o.ay - dy * k;
  return { d2: ex * ex + ey * ey, k };
}

/** Which pocket's opening a ball centre at (x, y) is over, or -1. */
export function openingAt(x: number, y: number): number {
  for (const p of TABLE.pockets) {
    const o = p.opening;
    if (openingDist2(o, x, y).d2 < o.r * o.r) return p.id;
  }
  return -1;
}

/** The pocket whose mouth is nearest (x, y). */
export function nearestPocket(x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (const p of TABLE.pockets) {
    const d = (x - p.mx) * (x - p.mx) + (y - p.my) * (y - p.my);
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}

/** True when a ball centred at (x, y) lies fully on the playing surface (inside the cushion noses). */
export function onSurface(x: number, y: number): boolean {
  return x >= -HL + R && x <= HL - R && y >= -HW + R && y <= HW - R;
}
