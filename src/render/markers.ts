// Helpers drawn on the table: the pocket called for the 8, and a ring round the cue ball in hand.

import * as THREE from "three";
import { R } from "../sim/constants";
import { RIM_TOP, openingCircle } from "./table";

export class Markers {
  private call: THREE.Mesh;
  private callMat: THREE.MeshBasicMaterial;
  private hand: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    this.callMat = new THREE.MeshBasicMaterial({ color: 0xf0b54a, transparent: true, opacity: 0.9, depthWrite: false });
    this.call = new THREE.Mesh(new THREE.RingGeometry(1.02, 1.14, 64), this.callMat);
    this.call.renderOrder = 4;
    this.call.visible = false;
    parent.add(this.call);
    this.hand = new THREE.Mesh(new THREE.RingGeometry(R * 1.35, R * 1.5, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    this.hand.renderOrder = 4;
    this.hand.visible = false;
    parent.add(this.hand);
  }

  /** Highlight the called pocket (or none), pulsing gently. */
  setCall(pocket: number | null, time: number) {
    this.call.visible = pocket !== null;
    if (pocket === null) return;
    const c = openingCircle(pocket);
    this.call.position.set(c.x, c.y, RIM_TOP + 0.002);
    this.call.scale.setScalar(c.r);
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
