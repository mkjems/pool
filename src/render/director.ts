// The camera director. The camera rests in the fitted top view (view.home); for a replay the director can cut to
// a camera placed for the moment (low behind the cue ball, beyond a pocket), glide from one placement to another,
// and bring it back home. Placements are in table coordinates (x along, y across, z up).

import * as THREE from "three";
import type { Pose, View } from "./scene";

const smooth = (t: number) => t * t * (3 - 2 * t);

export function pose(eye: THREE.Vector3, look: THREE.Vector3, fov = 40): Pose {
  return { eye: eye.clone(), look: look.clone(), up: new THREE.Vector3(0, 0, 1), fov, shiftX: 0, shiftY: 0 };
}

function copyPose(p: Pose): Pose {
  return { eye: p.eye.clone(), look: p.look.clone(), up: p.up.clone(), fov: p.fov, shiftX: p.shiftX, shiftY: p.shiftY };
}

export class Director {
  /** The pose shown now. */
  private now: Pose;
  /** A move in progress: from, to (null: home, which may change size as the window does), time, length. */
  private move: { from: Pose; to: Pose | null; t: number; len: number; arc: number } | null = null;

  constructor(private view: View) {
    this.now = copyPose(view.home);
  }

  /** The camera is away from the top view (or on its way back). */
  get active() { return this.view.free; }

  /** Height of the camera above the cloth now. */
  get height() { return this.view.free ? this.now.eye.z : this.view.home.eye.z; }

  /**
   * A placement's field of view is for a landscape screen; on a narrower one it opens up (most of the way to the
   * same width), or a phone held upright would see a sliver.
   */
  private fit(p: Pose): Pose {
    const q = copyPose(p), a = this.view.camera.aspect;
    if (a < 1.4) {
      const t = Math.tan(THREE.MathUtils.degToRad(p.fov / 2)) * Math.min(2, Math.pow(1.4 / a, 0.6));
      q.fov = THREE.MathUtils.radToDeg(2 * Math.atan(t));
    }
    return q;
  }

  /** Straight to a placement. */
  cut(p: Pose) {
    this.view.free = true;
    this.move = null;
    this.now = this.fit(p);
    this.view.place(this.now);
  }

  /** Glide from where the camera is to a placement, over `seconds`. `arc` lifts the path in the middle (metres). */
  glide(p: Pose, seconds: number, arc = 0) {
    if (!this.view.free) this.now = copyPose(this.view.home);
    this.view.free = true;
    this.move = { from: copyPose(this.now), to: this.fit(p), t: 0, len: seconds, arc };
  }

  /** Back to the top view over `seconds` (0: at once). */
  home(seconds = 0) {
    if (!this.view.free) return;
    if (seconds <= 0) { this.move = null; this.view.free = false; this.view.place(this.view.home); return; }
    this.move = { from: copyPose(this.now), to: null, t: 0, len: seconds, arc: 0 };
  }

  /** On a move: done by now? */
  get moving() { return this.move !== null; }

  update(dt: number) {
    const m = this.move;
    if (!m) return;
    m.t += dt;
    const k = smooth(Math.min(1, m.t / m.len));
    const to = m.to ?? this.view.home;
    const a = m.from, n = this.now;
    n.eye.lerpVectors(a.eye, to.eye, k);
    n.eye.z += m.arc * 4 * k * (1 - k);
    n.look.lerpVectors(a.look, to.look, k);
    n.fov = a.fov + (to.fov - a.fov) * k;
    n.shiftX = a.shiftX + (to.shiftX - a.shiftX) * k;
    n.shiftY = a.shiftY + (to.shiftY - a.shiftY) * k;
    // Up turns from one to the other; kept off the line of sight, where lookAt would be undefined.
    n.up.lerpVectors(a.up, to.up, k);
    const sight = n.look.clone().sub(n.eye).normalize();
    n.up.addScaledVector(sight, -n.up.dot(sight));
    if (n.up.lengthSq() < 1e-6) n.up.copy(to.up);
    n.up.normalize();
    if (m.t >= m.len) {
      this.move = null;
      if (!m.to) { this.view.free = false; this.view.place(this.view.home); return; }
    }
    this.view.place(n);
  }
}
