// Helpers drawn on the cloth: a soft ring under each ball you may hit, and the pocket called for the 8.

import * as THREE from "three";
import { R } from "../sim/constants";
import { TABLE } from "../sim/table";
import { WOOD_H } from "./table";

export class Markers {
  private rings: THREE.Mesh[] = [];
  private call: THREE.Mesh;
  private callMat: THREE.MeshBasicMaterial;
  private hand: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,236,190,0)");
    grd.addColorStop(0.62, "rgba(255,236,190,0.9)");
    grd.addColorStop(0.72, "rgba(255,236,190,0.55)");
    grd.addColorStop(1, "rgba(255,236,190,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const geo = new THREE.PlaneGeometry(R * 3.4, R * 3.4);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = 0.0012;
      m.renderOrder = 1;
      m.visible = false;
      parent.add(m);
      this.rings.push(m);
    }
    this.callMat = new THREE.MeshBasicMaterial({ color: 0xf0b54a, transparent: true, opacity: 0.9, depthWrite: false });
    this.call = new THREE.Mesh(new THREE.RingGeometry(0.068, 0.078, 64), this.callMat);
    this.call.renderOrder = 4;
    this.call.visible = false;
    parent.add(this.call);
    this.hand = new THREE.Mesh(new THREE.RingGeometry(R * 1.35, R * 1.5, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    this.hand.renderOrder = 4;
    this.hand.visible = false;
    parent.add(this.hand);
  }

  /** Rings under these balls (id -> x, y), none for the rest. */
  setRings(list: Array<{ id: number; x: number; y: number }>) {
    for (const r of this.rings) r.visible = false;
    for (const b of list) {
      const r = this.rings[b.id];
      r.visible = true;
      r.position.x = b.x; r.position.y = b.y;
    }
  }

  /** Highlight the called pocket (or none), pulsing gently. */
  setCall(pocket: number | null, time: number) {
    this.call.visible = pocket !== null;
    if (pocket === null) return;
    const p = TABLE.pockets[pocket];
    this.call.position.set(p.hx, p.hy, WOOD_H + 0.003);
    this.callMat.opacity = 0.65 + 0.3 * Math.sin(time * 4);
  }

  /** A ring around the cue ball when it can be picked up and moved. */
  setHand(x: number, y: number, visible: boolean, time: number) {
    this.hand.visible = visible;
    if (!visible) return;
    this.hand.position.set(x, y, R * 2 + 0.001);
    const s = 1 + 0.06 * Math.sin(time * 3);
    this.hand.scale.set(s, s, 1);
  }
}
