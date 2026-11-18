// The cue stick and the aim guide (paths drawn on the cloth).

import * as THREE from "three";
import { R, TABLE_L, TABLE_W } from "../sim/constants";
import { CUSHION_H, CUSHION_W, RAIL_W, RIM_TOP } from "./table";

// Radians the butt is raised: at least this, more when the cue ball is near a cushion so the cue clears the
// cushion and the wood (as a player raises the butt there), up to the most a player would.
const ELEVATION = 0.12, MAX_ELEVATION = 0.7;
const CLEAR = 0.004; // air between the cue and the rail
const TIP_R = 0.0064, BUTT_R = 0.0145, LENGTH = 1.5;

/** Height of the cushion or wood at a point on the table, 0 on the cloth and beyond the table. */
function railHeight(x: number, y: number): number {
  const out = Math.max(Math.abs(x) - TABLE_L / 2, Math.abs(y) - TABLE_W / 2);
  if (out <= 0) return 0;
  if (out <= CUSHION_W) return CUSHION_H;
  return out <= CUSHION_W + RAIL_W ? RIM_TOP : 0;
}

interface Part { len: number; r0: number; r1: number; mat: THREE.Material }

export class CueView {
  group = new THREE.Group();
  private stick = new THREE.Group();
  private shadow: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    const m = (o: THREE.MeshPhysicalMaterialParameters) => {
      const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15, ...o });
      mat.userData.env = 0.6;
      return mat;
    };
    const parts: Part[] = [
      { len: 0.012, r0: 0.0064, r1: 0.0064, mat: m({ color: 0x2a5fa8, roughness: 0.9, clearcoat: 0 }) }, // tip, chalked
      { len: 0.022, r0: 0.0064, r1: 0.0065, mat: m({ color: 0xf3efe4 }) }, // ferrule
      { len: 0.68, r0: 0.0065, r1: 0.0098, mat: m({ color: 0xd9bf8c }) }, // maple shaft
      { len: 0.012, r0: 0.0102, r1: 0.0102, mat: m({ color: 0xc9cdd2, metalness: 1, roughness: 0.25 }) }, // joint
      { len: 0.33, r0: 0.0102, r1: 0.0122, mat: m({ color: 0x3a1a0c }) }, // forearm
      { len: 0.012, r0: 0.0123, r1: 0.0123, mat: m({ color: 0xc9cdd2, metalness: 1, roughness: 0.25 }) },
      { len: 0.26, r0: 0.0124, r1: 0.0128, mat: m({ color: 0x111111, roughness: 0.8, clearcoat: 0 }) }, // wrap
      { len: 0.16, r0: 0.0129, r1: 0.0145, mat: m({ color: 0x3a1a0c }) }, // butt
      { len: 0.012, r0: 0.0145, r1: 0.014, mat: m({ color: 0x0c0c0c, roughness: 0.9, clearcoat: 0 }) }, // bumper
    ];
    let at = 0;
    for (const p of parts) {
      const g = new THREE.CylinderGeometry(p.r0, p.r1, p.len, 28, 1);
      g.rotateZ(-Math.PI / 2); // along +x, top (tip side) at +x
      const mesh = new THREE.Mesh(g, p.mat);
      mesh.position.x = -(at + p.len / 2);
      at += p.len;
      this.stick.add(mesh);
    }
    this.group.add(this.stick);

    // A soft shadow on the cloth, cast from the middle lamp straight above.
    const c = document.createElement("canvas");
    c.width = 256; c.height = 32;
    const g = c.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 32);
    grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(0.5, "rgba(0,0,0,1)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 256, 32);
    const tex = new THREE.CanvasTexture(c);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.05),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.3, depthWrite: false, color: 0x000000 }),
    );
    this.shadow.renderOrder = 1;
    parent.add(this.shadow);
    parent.add(this.group);
  }

  /** Place the cue behind the ball at (x, y), aiming (dx, dy), pulled back `pull` metres, tip at (side, height). */
  set(x: number, y: number, dx: number, dy: number, pull: number, side: number, height: number, visible: boolean) {
    this.group.visible = this.shadow.visible = visible;
    if (!visible) return;
    const rx = dy, ry = -dx; // right of the aim
    const back = 0.012 + pull;
    // Tip at the struck point on the ball's back, then pulled back along the cue's own axis.
    const cx = x - dx * R * 0.9 + rx * side * R;
    const cy = y - dy * R * 0.9 + ry * side * R;
    const cz = R + height * R;
    // Walk back under the cue: wherever it passes over the cushion or the wood, raise it enough to clear them.
    let tan = Math.tan(ELEVATION);
    for (let t = back; t < back + LENGTH; t += 0.005) {
      const h = railHeight(cx - dx * t, cy - dy * t);
      if (h === 0) continue;
      const r = TIP_R + (BUTT_R - TIP_R) * ((t - back) / LENGTH);
      tan = Math.max(tan, (h + r + CLEAR - cz) / t);
    }
    const elevation = Math.min(MAX_ELEVATION, Math.atan(tan));
    const ch = Math.cos(elevation), sh = Math.sin(elevation);
    this.group.position.set(cx - dx * back * ch, cy - dy * back * ch, cz + back * sh);
    this.group.rotation.set(0, elevation, Math.atan2(dy, dx), "ZYX");
    const mid = back + 0.7;
    this.shadow.position.set(cx - dx * mid * ch + 0.012, cy - dy * mid * ch - 0.012, 0.001);
    this.shadow.rotation.set(0, 0, Math.atan2(dy, dx));
  }
}

export interface GuidePath {
  points: THREE.Vector2[];
  color: THREE.ColorRepresentation;
  width: number;
  opacity: number;
}

export class GuideView {
  group = new THREE.Group();
  private ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D) {
    parent.add(this.group);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(R - 0.0016, R, 64), this.ghostMat);
    this.ghost.renderOrder = 3;
    parent.add(this.ghost);
  }

  set(paths: GuidePath[], ghost: THREE.Vector2 | null, ghostColor: THREE.ColorRepresentation = 0xffffff) {
    for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose();
    this.group.clear();
    for (const p of paths) {
      if (p.points.length < 2) continue;
      this.group.add(ribbon(p));
    }
    this.ghost.visible = !!ghost;
    if (ghost) {
      this.ghost.position.set(ghost.x, ghost.y, R * 2 + 0.002);
      this.ghostMat.color.set(ghostColor);
    }
  }

  hide() { this.set([], null); }
}

const ribbonMats = new Map<string, THREE.MeshBasicMaterial>();

function ribbon(p: GuidePath): THREE.Mesh {
  const pts = p.points;
  const pos: number[] = [];
  const idx: number[] = [];
  const hw = p.width / 2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    // Fade out toward the end of the path.
    pos.push(pts[i].x + nx * hw, pts[i].y + ny * hw, 0.0016, pts[i].x - nx * hw, pts[i].y - ny * hw, 0.0016);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const key = `${p.color}-${p.opacity}`;
  let m = ribbonMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: p.opacity, depthWrite: false });
    ribbonMats.set(key, m);
  }
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 2;
  return mesh;
}
