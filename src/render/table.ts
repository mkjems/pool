// The table, built in the simulation's coordinates (x along, y across, z up, cloth at z = 0) inside a group
// that the scene turns upright.

import * as THREE from "three";
import { R, TABLE_L, TABLE_W } from "../sim/constants";
import { TABLE, type Segment } from "../sim/table";

export const CUSHION_W = 0.05; // nose to wood
export const RAIL_W = 0.115; // wood
export const CUSHION_H = 0.038;
export const WOOD_H = 0.046;
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
      d[i] = 128 * k; d[i + 1] = 46 * k; d[i + 2] = 18 * k; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/** Adds the lamp shadows of every ball to a standard material, computed exactly per pixel. */
function withBallShadows(m: THREE.MeshStandardMaterial, balls: THREE.Vector4[], strength = 1) {
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
  return mix(0.5, 1.1, clamp(s / 1.9, 0.0, 1.0));
}
float ballShadow(vec3 p) {
  float sh = 1.0;
  for (int i = 0; i < 16; i++) {
    vec4 b = uBalls[i];
    if (b.w < 0.5) continue;
    float h = p.z;
    vec2 d0 = p.xy - b.xy;
    if (dot(d0, d0) > 0.04) continue;
    // Contact shadow right under the ball.
    float r0 = length(d0);
    sh *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, ${(R * 1.05).toFixed(5)}, r0)) * step(h, 0.002);
    for (int k = 0; k < 3; k++) {
      vec3 L = uLamps[k];
      float s = (L.z - h) / (L.z - b.z);
      if (s <= 0.0) continue;
      vec2 c = L.xy + (b.xy - L.xy) * s;
      float rr = ${R.toFixed(5)} * s;
      float pen = ${(R * 0.9).toFixed(5)} + (b.z - h) * 0.45;
      float dd = length(p.xy - c);
      sh *= 1.0 - ${(0.27 * strength).toFixed(3)} * (1.0 - smoothstep(rr - pen * 0.6, rr + pen, dd));
    }
  }
  return sh;
}`,
      )
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb *= ballShadow(vTablePos) * lampPool(vTablePos);");
  };
  m.customProgramCacheKey = () => "pool-shadowed-" + strength;
}

/** The wood's inner edge: the rectangle behind the cushions joined with the pocket holes. */
function railInnerContour(): THREE.Vector2[] {
  const rx = HL + CUSHION_W, ry = HW + CUSHION_W;
  const holes = TABLE.pockets.map((p) => ({ x: p.hx, y: p.hy, r: p.hr + 0.006 }));
  const pts: THREE.Vector2[] = [];
  const N = 1440;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Exit distance from the rectangle.
    let t = Math.min(dx !== 0 ? rx / Math.abs(dx) : Infinity, dy !== 0 ? ry / Math.abs(dy) : Infinity);
    for (const h of holes) {
      const b = dx * h.x + dy * h.y;
      const c = h.x * h.x + h.y * h.y - h.r * h.r;
      const disc = b * b - c;
      if (disc <= 0) continue;
      const near = b - Math.sqrt(disc), far = b + Math.sqrt(disc);
      if (near <= t && far > t) t = far;
    }
    pts.push(new THREE.Vector2(dx * t, dy * t));
  }
  return pts;
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
  for (const p of TABLE.pockets) {
    const h = new THREE.Path();
    h.absarc(p.hx, p.hy, p.hr, 0, Math.PI * 2, true);
    bedShape.holes.push(h);
  }
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
  const rail = roundedRect(HL + CUSHION_W + RAIL_W, HW + CUSHION_W + RAIL_W, 0.035);
  rail.holes.push(new THREE.Path(railInnerContour().reverse()));
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
  const woodMat = new THREE.MeshPhysicalMaterial({
    map: woodTex, roughness: 0.55, clearcoat: 0.55, clearcoatRoughness: 0.18, metalness: 0,
  });
  woodMat.userData.env = 0.12;
  withBallShadows(woodMat, shadowBalls, 0.5);
  const railMesh = new THREE.Mesh(railGeo, woodMat);
  group.add(railMesh);

  // Pocket cups and leather rims.
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, side: THREE.DoubleSide });
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0x2b1a10, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  rimMat.userData.env = 0.4;
  for (const p of TABLE.pockets) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(p.hr, p.hr * 0.85, 0.14, 40, 1, true), cupMat);
    cup.rotation.x = Math.PI / 2;
    cup.position.set(p.hx, p.hy, -0.07);
    group.add(cup);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.hr * 0.85, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    bottom.position.set(p.hx, p.hy, -0.14);
    group.add(bottom);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(p.hr + 0.004, 0.0045, 10, 48), rimMat);
    rim.position.set(p.hx, p.hy, WOOD_H - 0.002);
    rim.scale.z = 0.6;
    group.add(rim);
  }

  // Diamond sights, inlaid mother-of-pearl.
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.25, clearcoat: 1, iridescence: 0.6 });
  pearl.userData.env = 1;
  const dGeo = new THREE.CircleGeometry(0.0065, 4);
  const mid = CUSHION_W + RAIL_W * 0.5;
  const sights: Array<[number, number, boolean]> = [];
  for (const k of [-3, -2, -1, 1, 2, 3]) for (const sy of [-1, 1]) sights.push([(k * TABLE_L) / 8, sy * (HW + mid), false]);
  for (const k of [-1, 0, 1]) for (const sx of [-1, 1]) sights.push([sx * (HL + mid), (k * TABLE_W) / 4, true]);
  for (const [x, y, vertical] of sights) {
    const d = new THREE.Mesh(dGeo, pearl);
    d.position.set(x, y, WOOD_H + 0.0003);
    d.scale.set(vertical ? 0.7 : 1.4, vertical ? 1.4 : 0.7, 1);
    group.add(d);
  }

  // The floor, far below in the dark.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x241d19, roughness: 0.85, map: woodTex }),
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
      cushionMat.color.set(CLOTHS[c]).multiplyScalar(1.06);
    },
  };
}
