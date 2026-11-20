// The lamps over the table: three shades on a bar, hung from the dark ceiling. Only seen in a replay's views from
// the side; from the top view they would stand between the camera and the cloth, so they fade out as the camera
// comes to look down steeply.

import * as THREE from "three";
import { CUSHION_W, LAMPS, RAIL_W } from "./table";
import { TABLE_L, TABLE_W } from "../sim/constants";

const EDGE_X = TABLE_L / 2 + CUSHION_W + RAIL_W, EDGE_Y = TABLE_W / 2 + CUSHION_W + RAIL_W;
const OUT = 0.05, FADE = 0.35;

/** Lamp shades, in the table group (table coordinates). */
export class LampView {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];
  /** Points on the shades and the bar, to tell whether they lie over the table as the camera sees them. */
  private marks: THREE.Vector3[] = [];

  constructor(parent: THREE.Object3D) {
    // A shade: a shallow four-sided hood, open below, lacquered dark green outside and white inside.
    const lowW = 0.46, lowD = 0.2, topW = 0.3, topD = 0.1, h = 0.11;
    const hood = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 1.0, 1, 4, 1, true);
    hood.rotateY(Math.PI / 4);
    // Unit square frustum → the shade's sizes (cylinder axis y becomes table z after the rotation below).
    const pos = hood.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const top = pos.getY(i) > 0;
      pos.setXYZ(i, pos.getX(i) * (top ? topW : lowW), pos.getY(i) * h, pos.getZ(i) * (top ? topD : lowD));
    }
    hood.rotateX(Math.PI / 2);
    hood.computeVertexNormals();
    const outside = new THREE.MeshStandardMaterial({ color: 0x14261c, roughness: 0.35, metalness: 0.6, side: THREE.FrontSide });
    outside.userData.env = 0.6;
    const inside = new THREE.MeshStandardMaterial({ color: 0xf4eee2, roughness: 0.6, emissive: 0xfff1d8, emissiveIntensity: 0.35, side: THREE.BackSide });
    // The diffuser: what the eye sees of the bulbs, much brighter than anything on the table.
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.94, 0.82).multiplyScalar(6) });
    const cap = new THREE.MeshStandardMaterial({ color: 0x14261c, roughness: 0.35, metalness: 0.6 });
    cap.userData.env = 0.6;
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.3, metalness: 1 });
    brass.userData.env = 1;
    this.mats.push(outside, inside, glow, cap, brass);

    const capGeo = new THREE.BoxGeometry(topW, topD, 0.012);
    const diffuser = new THREE.PlaneGeometry(lowW * 0.96, lowD * 0.92);
    diffuser.rotateX(Math.PI); // facing down
    for (const l of LAMPS) {
      const z0 = l.z + 0.02; // the diffuser just above the light's point
      for (const m of [outside, inside]) {
        const s = new THREE.Mesh(hood, m);
        s.position.set(l.x, l.y, z0 + h / 2);
        this.group.add(s);
      }
      const c = new THREE.Mesh(capGeo, cap);
      c.position.set(l.x, l.y, z0 + h);
      this.group.add(c);
      const d = new THREE.Mesh(diffuser, glow);
      d.position.set(l.x, l.y, z0 + 0.01);
      this.group.add(d);
    }
    // The bar the shades hang from, and two rods up into the dark.
    const x0 = LAMPS[0].x, x1 = LAMPS[LAMPS.length - 1].x, zb = LAMPS[0].z + 0.02 + h + 0.03;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.5, 0.035, 0.035), cap);
    bar.position.set((x0 + x1) / 2, 0, zb);
    this.group.add(bar);
    for (const l of LAMPS) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, zb - (z0Of(l) + h), 8), brass);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(l.x, l.y, (zb + z0Of(l) + h) / 2);
      this.group.add(stem);
    }
    for (const x of [x0 - 0.1, x1 + 0.1]) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 3, 8), brass);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(x, 0, zb + 1.5);
      this.group.add(rod);
    }
    function z0Of(l: THREE.Vector3) { return l.z + 0.02; }
    for (const l of LAMPS) for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.marks.push(new THREE.Vector3(l.x + sx * lowW / 2, l.y + sy * lowD / 2, l.z + 0.02));
    this.marks.push(new THREE.Vector3(x0 - 0.25, 0, zb), new THREE.Vector3(x1 + 0.25, 0, zb));

    for (const m of this.mats) { m.transparent = true; m.opacity = 1; }
    this.group.visible = false;
    parent.add(this.group);
  }

  /**
   * Shown unless, seen from the camera (`eye`, table coordinates), a lamp lies over the table: then they would
   * hide the cloth (from the top view, or a camera above them). Each shade's corners and the bar's ends are
   * followed from the eye down to the cloth; the nearer any lands inside the table (`OUT` beyond the wood's
   * edge counts as inside, fading over `FADE`), the fainter they are.
   */
  update(eye: THREE.Vector3) {
    let clear = Infinity;
    for (const p of this.marks) {
      if (eye.z <= p.z + 0.02) continue; // looking up at it: it is against the dark ceiling
      const t = eye.z / (eye.z - p.z), x = eye.x + (p.x - eye.x) * t, y = eye.y + (p.y - eye.y) * t;
      clear = Math.min(clear, Math.max(Math.abs(x) - EDGE_X, Math.abs(y) - EDGE_Y));
    }
    const k = Math.max(0, Math.min(1, (clear - OUT) / FADE));
    this.group.visible = k > 0;
    for (const m of this.mats) {
      m.opacity = k;
      // Opaque when fully shown, so they sort and hide what is behind them properly.
      const t = k < 1;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
    }
  }
}
