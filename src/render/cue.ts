// The cue stick and the aim guide (paths drawn on the cloth).

import * as THREE from "three";
import { R } from "../sim/constants";
import { CUE_GAP, cueAxis, cueTilt } from "../sim/cue";
import type { Ball } from "../sim/physics";

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

  /**
   * Place the cue behind the cue ball (balls[0]), aiming (dx, dy), pulled back `pull` metres, tip at
   * (side, height). It is raised as the shot will be (src/sim/cue.ts): enough to clear the rails and the balls.
   */
  set(balls: readonly Ball[], dx: number, dy: number, pull: number, side: number, height: number, visible: boolean) {
    this.group.visible = this.shadow.visible = visible;
    if (!visible) return;
    const back = CUE_GAP + pull;
    const tilt = cueTilt(balls, dx, dy, side, height);
    const a = cueAxis(balls[0].x, balls[0].y, dx, dy, side, height, tilt);
    const elevation = Math.asin(tilt);
    this.group.position.set(a.qx - a.fx * back, a.qy - a.fy * back, a.qz - a.fz * back);
    this.group.rotation.set(0, elevation, Math.atan2(dy, dx), "ZYX");
    const ch = Math.cos(elevation);
    const mid = (back + 0.7) * ch;
    this.shadow.position.set(a.qx - dx * mid + 0.012, a.qy - dy * mid - 0.012, 0.001);
    this.shadow.rotation.set(0, 0, Math.atan2(dy, dx));
    this.shadow.scale.x = ch;
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
