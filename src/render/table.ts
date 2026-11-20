// The table, built in the simulation's coordinates (x along, y across, z up, cloth at z = 0) inside a group
// that the scene turns upright.

import * as THREE from "three";
import { CUSHION_H, CUSHION_W, R, RAIL_W, TABLE_L, TABLE_W, WOOD_H } from "../sim/constants";
import { TABLE, type Segment } from "../sim/table";

export { CUSHION_H, CUSHION_W, RAIL_W, WOOD_H };
/** Top of the leather lip round each pocket, just proud of the wood. */
export const RIM_TOP = WOOD_H + 0.001;
/** Width of that lip where it shows, between the hole and the wood. */
const RIM_W = 0.012;
const HL = TABLE_L / 2, HW = TABLE_W / 2;
/** The floor, below the cloth. */
const FLOOR_Z = -0.78;

export const CLOTHS = {
  green: "#1b6b45",
  blue: "#1f5f9e",
  slate: "#3c5466",
  wine: "#6d2433",
} as const;
export type Cloth = keyof typeof CLOTHS;

/** Lamps over the table, in table coordinates (z is height above the cloth). */
export const LAMPS = [new THREE.Vector3(-0.62, 0, 1.0), new THREE.Vector3(0, 0, 1.0), new THREE.Vector3(0.62, 0, 1.0)];

export interface TableView {
  group: THREE.Group;
  /** Ball positions for the shadows: x, y, z (table coordinates), visible flag. */
  shadowBalls: THREE.Vector4[];
  setCloth(c: Cloth): void;
}

function noiseTexture(size: number, draw: (g: CanvasRenderingContext2D, img: ImageData) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  draw(g, img);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function clothTexture() {
  return noiseTexture(256, (g, img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4, x = p % 256, y = (p / 256) | 0;
      // Fine weave plus speckle: subtle, it is felt.
      const weave = ((x + y) % 2 === 0 ? 6 : -6) + ((x % 4) < 2 ? 3 : -3);
      const v = 228 + weave + (Math.random() - 0.5) * 26;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

function woodTexture() {
  // Value noise, stretched along x: long irregular grain lines in dark mahogany.
  const N = 64;
  const lattice = Array.from({ length: N * N }, () => Math.random());
  const at = (i: number, j: number) => lattice[((j % N + N) % N) * N + ((i % N + N) % N)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y), fx = smooth(x - i), fy = smooth(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return noiseTexture(512, (g, img) => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4, x = p % 512, y = (p / 512) | 0;
      const u = (x / 512) * N, v = (y / 512) * N;
      const warp = noise(u * 0.08, v * 0.5) * 6 + noise(u * 0.3, v * 1.5) * 1.2;
      const grain = 0.5 + 0.5 * Math.sin((v * 0.9 + warp) * 3.1);
      const streak = noise(u * 0.05, v * 6) * 0.5 + noise(u * 0.15, v * 14) * 0.3;
      const k = 0.62 + 0.22 * Math.pow(grain, 3) + 0.22 * streak + (Math.random() - 0.5) * 0.05;
      d[i] = 104 * k; d[i + 1] = 36 * k; d[i + 2] = 14 * k; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/**
 * Adds the lamp shadows of every ball to a standard material, computed exactly per pixel, and the lamps' pools of
 * light. `direct` scales the overhead light's mirror reflection (seen straight from above it washes out metal).
 * `side`: how much the lamps light faces that stand up (the cushions' faces, seen from a low camera; the one
 * light from straight above leaves them black). Faces looking up are lit by the pools already.
 */
function withBallShadows(m: THREE.MeshStandardMaterial, balls: THREE.Vector4[], strength = 1, shadows = true, direct = 1, side = 0) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBalls = { value: balls };
    sh.uniforms.uLamps = { value: LAMPS };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTablePos;")
      // Shadowed meshes sit untransformed in the table group, so their positions are table coordinates.
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTablePos = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vTablePos;
uniform vec4 uBalls[16];
uniform vec3 uLamps[3];
// Light pools under the three lamps, fading toward the rails and corners.
float lampPool(vec3 p) {
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    vec2 d = (p.xy - uLamps[k].xy) * vec2(1.5, 2.1);
    s += 1.0 / (1.0 + dot(d, d));
  }
  return mix(0.34, 1.22, clamp(s / 1.9, 0.0, 1.0));
}
float ballShadow(vec3 p) {
  float sh = 1.0;
  for (int i = 0; i < 16; i++) {
    vec4 b = uBalls[i];
    if (b.w < 0.5) continue;
    float h = p.z;
    vec2 d0 = p.xy - b.xy;
    if (dot(d0, d0) > 0.01) continue;
    float lift = max(b.z - h, 0.0);
    // Contact occlusion: a gentle darkening that hugs the ball where it sits on the cloth.
    float r0 = length(d0);
    sh *= 1.0 - 0.42 * (1.0 - smoothstep(${(R * 0.7).toFixed(5)}, ${(R * 1.5).toFixed(5)}, r0)) * step(h, 0.002);
    // One shadow per lamp. Each lamp gives only part of the light, so no shadow is black, and a lamp ~0.46 m
    // wide a metre up blurs the edge by only a few millimetres.
    for (int k = 0; k < 3; k++) {
      vec3 L = uLamps[k];
      float s = (L.z - h) / (L.z - b.z);
      if (s <= 0.0) continue;
      vec2 c = L.xy + (b.xy - L.xy) * s;
      float rr = ${R.toFixed(5)} * s;
      float pen = 0.0015 + 0.23 * lift / (L.z - b.z);
      float dd = length(p.xy - c);
      sh *= 1.0 - ${(0.23 * strength).toFixed(3)} * (1.0 - smoothstep(rr - pen, rr + pen, dd));
    }
  }
  return sh;
}
// The three lamps on a face that stands up (normal n in table coordinates): Lambert with distance falloff.
float sideLight(vec3 p, vec3 n) {
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    vec3 L = uLamps[k] - p;
    float d2 = dot(L, L);
    s += max(0.0, dot(n, L)) * inversesqrt(d2) / (0.5 + d2);
  }
  return s * (1.0 - max(n.z, 0.0));
}`,
      )
      .replace("#include <aomap_fragment>", `reflectedLight.directSpecular *= ${direct.toFixed(3)};\n#include <aomap_fragment>`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\ngl_FragColor.rgb *= ${shadows ? "ballShadow(vTablePos) * " : ""}lampPool(vTablePos);${side > 0 ? `
{
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  gl_FragColor.rgb += diffuseColor.rgb * ${side.toFixed(3)} * sideLight(vTablePos, vec3(nW.x, -nW.z, nW.y));
}` : ""}`);
  };
  m.customProgramCacheKey = () => `pool-shadowed-${strength}-${shadows}-${direct}-${side}`;
}

/** A pocket's opening in the physics, seen from above: a capsule across the mouth (src/sim/table.ts). */
interface Opening { ax: number; ay: number; bx: number; by: number; r: number }

export const OPENINGS: Opening[] = TABLE.pockets.map((p) => p.opening);

/** A circle around a pocket's opening (for the called-pocket ring). */
export function openingCircle(pocket: number): { x: number; y: number; r: number } {
  const o = OPENINGS[pocket];
  const half = Math.hypot(o.bx - o.ax, o.by - o.ay) / 2;
  return { x: (o.ax + o.bx) / 2, y: (o.ay + o.by) / 2, r: o.r + half };
}

/**
 * The hole as drawn, in the pocket's own frame (u into the pocket from the middle of the mouth, v across it):
 * its front edge is the physics capsule's, round, its middle on the drop line; it follows the cushion jaws to
 * the backs of the cushions, then goes straight on into the rail as wide as the jaws end, round at the back. So
 * the jaws run straight into the leather lip. The same for every pocket of a kind, so all four corners match.
 */
interface Hole {
  cx: number; cy: number; ux: number; uy: number;
  /** Between the jaws: a convex quad, counter-clockwise, in (u, v). */
  quad: Array<[number, number]>;
  /** On into the rail: u from drop to u1, |v| up to wb, back corners rounded by rb. */
  drop: number; u1: number; wb: number; rb: number;
  /** The capsule's front: its middle segment at u = cu, half as long as ch, radius r. */
  cu: number; ch: number; r: number;
  /** A point inside every part, to trace the outline from. */
  mid: number;
}

/** Signed distance to a box u0..u1 by |v| <= w, its front corners rounded by rn and its back ones by rb. */
function roundedBox(u: number, v: number, u0: number, u1: number, w: number, rn: number, rb: number): number {
  const uc = (u0 + u1) / 2, hu = (u1 - u0) / 2;
  const r = u > uc ? rb : rn;
  const qx = Math.abs(u - uc) - hu + r, qy = Math.abs(v) - w + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const HOLES: Hole[] = TABLE.pockets.map((p) => {
  const toUV = (x: number, y: number): [number, number] => {
    const dx = x - p.mx, dy = y - p.my;
    return [dx * p.ux + dy * p.uy, -dx * p.uy + dy * p.ux];
  };
  // Each jaw from its nose to where it meets the back of the cushion (as the cushions are built).
  const jaws = p.noses.map((n) => {
    const jaw = TABLE.segments.find((s) => s.kind === "jaw" && Math.abs(s.ax - n.x) < 1e-9 && Math.abs(s.ay - n.y) < 1e-9)!;
    const rail = TABLE.segments.find((s) => s.kind === "rail" &&
      ((Math.abs(s.ax - n.x) < 1e-9 && Math.abs(s.ay - n.y) < 1e-9) || (Math.abs(s.bx - n.x) < 1e-9 && Math.abs(s.by - n.y) < 1e-9)))!;
    const t = CUSHION_W / -(jaw.tx * rail.nx + jaw.ty * rail.ny);
    const [nu, nv] = toUV(n.x, n.y), [bu, bv] = toUV(n.x + jaw.tx * t, n.y + jaw.ty * t);
    const k = (p.drop - nu) / (bu - nu);
    return { near: [p.drop, nv + (bv - nv) * k] as [number, number], back: [bu, bv] as [number, number] };
  });
  const [lo, hi] = jaws[0].back[1] < jaws[1].back[1] ? jaws : [jaws[1], jaws[0]];
  const wb = Math.min(Math.abs(lo.back[1]), Math.abs(hi.back[1]));
  const o = p.opening;
  return {
    cx: p.mx, cy: p.my, ux: p.ux, uy: p.uy,
    quad: [lo.near, lo.back, hi.back, hi.near],
    // As deep as the physics capsule: at the corners that reaches just past where the cushions' backs meet, so
    // the lip is one piece round the back.
    drop: p.drop, u1: p.drop + 2 * o.r, wb, rb: wb * 0.9,
    cu: p.drop + o.r, ch: Math.hypot(o.bx - o.ax, o.by - o.ay) / 2, r: o.r,
    mid: (p.drop + lo.back[0]) / 2,
  };
});

/** Signed distance (near enough) from (x, y) to a hole's edge grown by g (negative inside). */
function holeDist(h: Hole, x: number, y: number, g: number): number {
  const dx = x - h.cx, dy = y - h.cy;
  const u = dx * h.ux + dy * h.uy, v = -dx * h.uy + dy * h.ux;
  // The quad: the farthest of its edges' lines.
  let dq = -Infinity;
  for (let i = 0; i < 4; i++) {
    const [au, av] = h.quad[i], [bu, bv] = h.quad[(i + 1) % 4];
    const eu = bu - au, ev = bv - av, l = Math.hypot(eu, ev);
    dq = Math.max(dq, ((u - au) * ev - (v - av) * eu) / l);
  }
  // The part in the rail: a rectangle rounded at the back.
  const dr = roundedBox(u, v, h.drop, h.u1, h.wb, 0, h.rb);
  // Both cut off at the front by the capsule's round front edge.
  const df = roundedBox(u, v, h.cu - h.r, 1, h.ch + h.r, h.r, 0);
  return Math.max(Math.min(dq, dr), df) - g;
}

/** A hole's edge grown by g, counter-clockwise, traced outward from a point inside it. */
function holePoints(h: Hole, g = 0, n = 240): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const at = (u: number, v: number) => new THREE.Vector2(h.cx + u * h.ux - v * h.uy, h.cy + u * h.uy + v * h.ux);
  const out = (u: number, v: number) => { const q = at(u, v); return holeDist(h, q.x, q.y, g) > 0; };
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, cu = Math.cos(a), cv = Math.sin(a);
    let hiT = 0.002;
    while (!out(h.mid + cu * hiT, cv * hiT)) hiT += 0.002;
    let loT = hiT - 0.002;
    for (let k = 0; k < 24; k++) { const m = (loT + hiT) / 2; if (out(h.mid + cu * m, cv * m)) hiT = m; else loT = m; }
    pts.push(at(h.mid + cu * hiT, cv * hiT));
  }
  return pts;
}

/** The wood's inner edge: the rectangle behind the cushions joined with the pockets' lips (counter-clockwise). */
function railInnerContour(): THREE.Vector2[] {
  const rx = HL + CUSHION_W, ry = HW + CUSHION_W;
  const inside = (x: number, y: number) => HOLES.some((h) => holeDist(h, x, y, RIM_W) < 0);
  const pts: THREE.Vector2[] = [];
  const N = 4096;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Exit distance from the rectangle, then on through any opening that holds that point.
    let t = Math.min(dx !== 0 ? rx / Math.abs(dx) : Infinity, dy !== 0 ? ry / Math.abs(dy) : Infinity);
    if (inside(dx * t, dy * t)) {
      let hi = t;
      while (inside(dx * hi, dy * hi)) hi += 0.004;
      let lo = hi - 0.004;
      for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (inside(dx * m, dy * m)) lo = m; else hi = m; }
      t = hi;
    }
    pts.push(new THREE.Vector2(dx * t, dy * t));
  }
  return pts;
}

/**
 * The run of a closed counter-clockwise outline inside the region f >= 0 (one contiguous run), with its ends
 * placed on the boundary.
 */
function runInside(poly: THREE.Vector2[], f: (p: THREE.Vector2) => number): THREE.Vector2[] {
  const n = poly.length;
  let s = poly.findIndex((p, i) => f(p) >= 0 && f(poly[(i - 1 + n) % n]) < 0);
  const out: THREE.Vector2[] = [];
  const cross = (a: THREE.Vector2, b: THREE.Vector2) => {
    const fa = f(a), fb = f(b);
    return a.clone().lerp(b, fa / (fa - fb));
  };
  out.push(cross(poly[(s - 1 + n) % n], poly[s]));
  for (; f(poly[s % n]) >= 0; s++) out.push(poly[s % n].clone());
  out.push(cross(poly[(s - 1) % n], poly[s % n]));
  return out;
}

function roundedRect(hx: number, hy: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hy);
  s.lineTo(hx - r, -hy); s.absarc(hx - r, -hy + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hy - r); s.absarc(hx - r, hy - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hy); s.absarc(-hx + r, hy - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hy + r); s.absarc(-hx + r, -hy + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

function cushionShape(seg: Segment): THREE.Shape {
  const jawAt = (x: number, y: number) =>
    TABLE.segments.find((s) => s.kind === "jaw" && Math.abs(s.ax - x) < 1e-9 && Math.abs(s.ay - y) < 1e-9)!;
  const out = (j: Segment) => {
    // Follow the jaw outward until it is CUSHION_W behind the nose line.
    const along = -(j.tx * seg.nx + j.ty * seg.ny);
    const t = CUSHION_W / along;
    return new THREE.Vector2(j.ax + j.tx * t, j.ay + j.ty * t);
  };
  const a = new THREE.Vector2(seg.ax, seg.ay), b = new THREE.Vector2(seg.bx, seg.by);
  const s = new THREE.Shape([a, b, out(jawAt(seg.bx, seg.by)), out(jawAt(seg.ax, seg.ay))]);
  return s;
}

export function makeTable(): TableView {
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2; // table z becomes world y (up); table y becomes world -z
  const shadowBalls = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, R, 0));

  // Cloth bed with the pocket holes.
  const bedShape = new THREE.Shape();
  const bx = HL + CUSHION_W + 0.06, by = HW + CUSHION_W + 0.06;
  bedShape.moveTo(-bx, -by); bedShape.lineTo(bx, -by); bedShape.lineTo(bx, by); bedShape.lineTo(-bx, by);
  for (const h of HOLES) bedShape.holes.push(new THREE.Path(holePoints(h)));
  const bedGeo = new THREE.ShapeGeometry(bedShape, 24);
  const clothTex = clothTexture();
  // UVs in metres: one weave tile per 12 cm.
  const uv = bedGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.12, uv.getY(i) / 0.12);
  const clothMat = new THREE.MeshStandardMaterial({ color: CLOTHS.green, roughness: 0.92, metalness: 0, map: clothTex });
  withBallShadows(clothMat, shadowBalls);
  const bed = new THREE.Mesh(bedGeo, clothMat);
  group.add(bed);

  // Cushions: cloth-covered rubber, a little lighter where the lamp catches the nose.
  const cushionMat = new THREE.MeshStandardMaterial({ color: CLOTHS.green, roughness: 0.85, map: clothTex });
  withBallShadows(cushionMat, shadowBalls, 0.8, true, 1, 0.9);
  for (const seg of TABLE.segments) {
    if (seg.kind !== "rail") continue;
    const geo = new THREE.ExtrudeGeometry(cushionShape(seg), {
      depth: CUSHION_H - 0.007, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.004, bevelSegments: 5,
    });
    // Undercut the nose, as real cushions are: the face slopes back below the contact height.
    const cp = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const d = (x - seg.ax) * seg.nx + (y - seg.ay) * seg.ny; // > -bevel near the nose
      if (d > -0.006 && z < 0.03) {
        const k = 0.011 * (1 - Math.max(0, z) / 0.03);
        cp.setXY(i, x - seg.nx * k, y - seg.ny * k);
      }
    }
    geo.computeVertexNormals();
    const u = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) / 0.12, u.getY(i) / 0.12);
    group.add(new THREE.Mesh(geo, cushionMat));
  }

  // Wood rails, lacquered.
  const X0 = HL + CUSHION_W + RAIL_W, Y0 = HW + CUSHION_W + RAIL_W;
  const rail = roundedRect(X0, Y0, 0.045);
  const inner = railInnerContour();
  rail.holes.push(new THREE.Path(inner.slice().reverse()));
  const railGeo = new THREE.ExtrudeGeometry(rail, {
    depth: WOOD_H - 0.008, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 4, curveSegments: 16,
  });
  // Grain runs along each rail, the four rails meeting in mitres at the corners.
  const ru = railGeo.attributes.uv as THREE.BufferAttribute, rp = railGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < ru.count; i++) {
    const x = rp.getX(i), y = rp.getY(i);
    const shortRail = Math.abs(x) - (HL + CUSHION_W) > Math.abs(y) - (HW + CUSHION_W);
    if (shortRail) ru.setXY(i, y * 0.8 + 0.37, x * 1.6);
    else ru.setXY(i, x * 0.8, y * 1.6);
  }
  const woodTex = woodTexture();
  // A big area on screen: a plain standard material, lamp falloff only (balls never shade the rails much).
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.5, metalness: 0 });
  woodMat.userData.env = 0.025;
  withBallShadows(woodMat, shadowBalls, 0.5, false);
  const railMesh = new THREE.Mesh(railGeo, woodMat);
  group.add(railMesh);

  // Pocket cups: black liners going down from each opening.
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, side: THREE.DoubleSide });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const h of HOLES) {
    const shape = new THREE.Shape(holePoints(h));
    const cup = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }), [hidden, cupMat]);
    cup.position.z = -0.14;
    group.add(cup);
    const bottom = new THREE.Mesh(new THREE.ShapeGeometry(shape), black);
    bottom.position.z = -0.135;
    group.add(bottom);
  }

  // Leather lips: where a hole cuts into the wood, a band of leather round it, just proud of the wood.
  const leather = new THREE.MeshStandardMaterial({ color: 0x8a5a38, roughness: 0.6, metalness: 0 });
  leather.userData.env = 0.04;
  withBallShadows(leather, shadowBalls, 0.5, false);
  const behindCushions = (p: THREE.Vector2) => Math.max(Math.abs(p.x) - (HL + CUSHION_W), Math.abs(p.y) - (HW + CUSHION_W));
  const lipShapes = HOLES.map((h) =>
    new THREE.Shape(runInside(holePoints(h, RIM_W), behindCushions).concat(runInside(holePoints(h), behindCushions).reverse())),
  );
  const LIP_BOTTOM = -0.012, LIP_BEVEL = 0.002;
  const lips = new THREE.Mesh(
    new THREE.ExtrudeGeometry(lipShapes, {
      depth: RIM_TOP - LIP_BOTTOM - 2 * LIP_BEVEL, bevelEnabled: true, bevelThickness: LIP_BEVEL, bevelSize: LIP_BEVEL,
      bevelSegments: 3, curveSegments: 8,
    }),
    leather,
  );
  lips.position.z = LIP_BOTTOM + LIP_BEVEL;
  group.add(lips);

  // Sights: small round inlays of mother-of-pearl.
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.25, clearcoat: 1, iridescence: 0.6 });
  pearl.userData.env = 1;
  const dGeo = new THREE.CircleGeometry(0.0052, 24);
  const mid = CUSHION_W + RAIL_W * 0.5;
  const sights: Array<[number, number]> = [];
  for (const k of [-3, -2, -1, 1, 2, 3]) for (const sy of [-1, 1]) sights.push([(k * TABLE_L) / 8, sy * (HW + mid)]);
  for (const k of [-1, 0, 1]) for (const sx of [-1, 1]) sights.push([sx * (HL + mid), (k * TABLE_W) / 4]);
  for (const [x, y] of sights) {
    const d = new THREE.Mesh(dGeo, pearl);
    d.position.set(x, y, WOOD_H + 0.0003);
    group.add(d);
  }

  // The floor, far below in the dark.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.85, map: woodTex }),
  );
  floor.position.z = FLOOR_Z;
  group.add(floor);
  // The body under the rails: an apron of the same wood, a little in from the rails' edge, and four legs.
  const apronMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9a8a80, roughness: 0.55 });
  apronMat.userData.env = 0.02;
  const AX = HL + CUSHION_W + RAIL_W - 0.005, AY = HW + CUSHION_W + RAIL_W - 0.005, APRON = 0.2;
  // A frame, open in the middle where the pocket cups hang; its top just under the cloth. Thin: the side
  // pockets' holes reach to 0.615 m from the middle, and the frame must not show in them.
  const T = 0.008;
  for (const [w, d, x, y] of [[AX * 2, T, 0, AY - T / 2], [AX * 2, T, 0, -AY + T / 2], [T, AY * 2, AX - T / 2, 0], [T, AY * 2, -AX + T / 2, 0]]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(w, d, APRON), apronMat);
    side.position.set(x, y, -0.006 - APRON / 2);
    group.add(side);
  }
  const legH = -FLOOR_Z - APRON - 0.006;
  const legGeo = new THREE.BoxGeometry(0.11, 0.11, legH);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, apronMat);
    leg.position.set(sx * (AX - 0.12), sy * (AY - 0.1), FLOOR_Z + legH / 2);
    group.add(leg);
  }

  return {
    group,
    shadowBalls,
    setCloth(c: Cloth) {
      clothMat.color.set(CLOTHS[c]);
      cushionMat.color.set(CLOTHS[c]).multiplyScalar(1.2);
    },
  };
}
