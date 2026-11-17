// The table, built in the simulation's coordinates (x along, y across, z up, cloth at z = 0) inside a group
// that the scene turns upright.

import * as THREE from "three";
import { R, TABLE_L, TABLE_W } from "../sim/constants";
import { TABLE, type Segment } from "../sim/table";

export const CUSHION_W = 0.05; // nose to wood
export const RAIL_W = 0.07; // wood
export const CUSHION_H = 0.038;
export const WOOD_H = 0.046;
/** Top of the metal pocket caps. */
export const CAP_TOP = WOOD_H + 0.004;
const HL = TABLE_L / 2, HW = TABLE_W / 2;

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

function brushedTexture() {
  // Fine streaks along x: each row of pixels a little lighter or darker, with a faint grain inside the row.
  return noiseTexture(256, (g, img) => {
    const d = img.data;
    const rows = Array.from({ length: 256 }, () => Math.random());
    for (let i = 0; i < d.length; i += 4) {
      const p = i / 4, y = (p / 256) | 0;
      const v = 200 + (rows[y] - 0.5) * 60 + (Math.random() - 0.5) * 14;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/**
 * Adds the lamp shadows of every ball to a standard material, computed exactly per pixel, and the lamps' pools of
 * light. `direct` scales the overhead light's mirror reflection (seen straight from above it washes out metal).
 */
function withBallShadows(m: THREE.MeshStandardMaterial, balls: THREE.Vector4[], strength = 1, shadows = true, direct = 1) {
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
}`,
      )
      .replace("#include <aomap_fragment>", `reflectedLight.directSpecular *= ${direct.toFixed(3)};\n#include <aomap_fragment>`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\ngl_FragColor.rgb *= ${shadows ? "ballShadow(vTablePos) * " : ""}lampPool(vTablePos);`);
  };
  m.customProgramCacheKey = () => `pool-shadowed-${strength}-${shadows}-${direct}`;
}

/** A pocket's opening seen from above: a capsule from the hole's centre a little way out into the rail. */
interface Opening { ax: number; ay: number; bx: number; by: number; r: number }

export const OPENINGS: Opening[] = TABLE.pockets.map((p) => {
  // The near edge is the drop line of the physics: the ball rolls on cloth (the pocket's shelf) until its centre
  // passes the edge, which is where the physics lets it go, so it tips over the lip at that moment. A capsule
  // across the mouth, as wide as the mouth; the corners reach past the rail's inner corner, cutting into the cap.
  const r = p.kind === "corner" ? 0.06 : 0.047, half = p.kind === "corner" ? 0.01 : 0.02;
  const d = p.drop + r;
  const cx = p.mx + p.ux * d, cy = p.my + p.uy * d;
  return { ax: cx - p.uy * half, ay: cy + p.ux * half, bx: cx + p.uy * half, by: cy - p.ux * half, r };
});

/** A circle around a pocket's opening (for the called-pocket ring). */
export function openingCircle(pocket: number): { x: number; y: number; r: number } {
  const o = OPENINGS[pocket];
  const half = Math.hypot(o.bx - o.ax, o.by - o.ay) / 2;
  return { x: (o.ax + o.bx) / 2, y: (o.ay + o.by) / 2, r: o.r + half };
}

function insideOpening(o: Opening, x: number, y: number): boolean {
  const dx = o.bx - o.ax, dy = o.by - o.ay;
  const t = Math.max(0, Math.min(1, ((x - o.ax) * dx + (y - o.ay) * dy) / (dx * dx + dy * dy)));
  const ex = x - o.ax - dx * t, ey = y - o.ay - dy * t;
  return ex * ex + ey * ey < o.r * o.r;
}

function capsulePoints(o: Opening, n = 40): THREE.Vector2[] {
  const a = Math.atan2(o.by - o.ay, o.bx - o.ax);
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a - Math.PI / 2 + (i / n) * Math.PI;
    pts.push(new THREE.Vector2(o.bx + Math.cos(t) * o.r, o.by + Math.sin(t) * o.r));
  }
  for (let i = 0; i <= n; i++) {
    const t = a + Math.PI / 2 + (i / n) * Math.PI;
    pts.push(new THREE.Vector2(o.ax + Math.cos(t) * o.r, o.ay + Math.sin(t) * o.r));
  }
  return pts;
}

/** The wood's inner edge: the rectangle behind the cushions joined with the pocket openings (counter-clockwise). */
function railInnerContour(): THREE.Vector2[] {
  const rx = HL + CUSHION_W, ry = HW + CUSHION_W;
  const inside = (x: number, y: number) => OPENINGS.some((o) => insideOpening(o, x, y));
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
  for (const o of OPENINGS) bedShape.holes.push(new THREE.Path(capsulePoints(o)));
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
  withBallShadows(cushionMat, shadowBalls, 0.8);
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
  const rail = roundedRect(X0, Y0, 0.03);
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
  for (const o of OPENINGS) {
    const shape = new THREE.Shape(capsulePoints(o));
    const cup = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }), [hidden, cupMat]);
    cup.position.z = -0.14;
    group.add(cup);
    const bottom = new THREE.Mesh(new THREE.ShapeGeometry(shape), black);
    bottom.position.z = -0.135;
    group.add(bottom);
  }

  // Metal caps: an L round each corner and a plate over each side pocket, cut from the rail's own outline so the
  // pocket openings run through them. Their bevel reaches as far as the wood's, covering its edge.
  const brushed = brushedTexture();
  brushed.repeat.set(1.5, 4);
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xbabec4, metalness: 1, roughness: 0.36, map: brushed });
  metalMat.userData.env = 0.3;
  withBallShadows(metalMat, shadowBalls, 0.5, false, 0.12);
  // The outline in steps of a few millimetres, so every cap finds its stretch of it.
  const outer: THREE.Vector2[] = [];
  const corners = rail.getPoints(24);
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const k = Math.ceil(a.distanceTo(b) / 0.004);
    for (let j = 0; j < k; j++) outer.push(a.clone().lerp(b, j / k));
  }
  const capShapes: THREE.Shape[] = [];
  const ARM = 0.19, PLATE = 0.105;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const f = (p: THREE.Vector2) => Math.min(sx * p.x - (X0 - ARM), sy * p.y - (Y0 - ARM));
    capShapes.push(new THREE.Shape(runInside(inner, f).concat(runInside(outer, f).reverse())));
  }
  for (const sy of [-1, 1]) {
    const f = (p: THREE.Vector2) => Math.min(PLATE - Math.abs(p.x), sy * p.y);
    capShapes.push(new THREE.Shape(runInside(inner, f).concat(runInside(outer, f).reverse())));
  }
  const capGeo = new THREE.ExtrudeGeometry(capShapes, {
    depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 4, curveSegments: 8,
  });
  const caps = new THREE.Mesh(capGeo, metalMat);
  caps.position.z = CAP_TOP - 0.01;
  group.add(caps);

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
  floor.position.z = -0.78;
  group.add(floor);
  // A body under the rails so the table isn't hollow at the edges.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry((HL + CUSHION_W + RAIL_W) * 2 - 0.02, (HW + CUSHION_W + RAIL_W) * 2 - 0.02, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x1b0f08, roughness: 0.7 }),
  );
  body.position.z = -0.27;
  group.add(body);

  return {
    group,
    shadowBalls,
    setCloth(c: Cloth) {
      clothMat.color.set(CLOTHS[c]);
      cushionMat.color.set(CLOTHS[c]).multiplyScalar(1.2);
    },
  };
}
