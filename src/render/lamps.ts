// The lamps over the table: three shades on a bar, hung from the dark ceiling. Only seen from a low camera (a
// replay's, at most 0.85 m up); from the top view they would stand between the camera and the cloth, so they
// fade out as the camera rises past them.

import * as THREE from "three";
import { LAMPS } from "./table";

/** Lamp shades, in the table group (table coordinates). */
export class LampView {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];

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

    for (const m of this.mats) { m.transparent = true; m.opacity = 1; }
    this.group.visible = false;
    parent.add(this.group);
  }

  /** Shown fully with the camera below `low` (metres above the cloth), gone above `high`. */
  update(cameraZ: number, low = 0.9, high = 1.25) {
    const k = Math.max(0, Math.min(1, (high - cameraZ) / (high - low)));
    this.group.visible = k > 0;
    for (const m of this.mats) {
      m.opacity = k;
      // Opaque when fully shown, so they sort and hide what is behind them properly.
      const t = k < 1;
      if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
    }
  }
}
