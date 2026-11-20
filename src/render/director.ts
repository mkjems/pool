// The camera director. The camera rests in the fitted top view (view.home); for a replay the director can cut to
// a camera placed for the moment (low behind the cue ball, beyond a pocket), glide from one placement to another,
// and bring it back home. Placements are in table coordinates (x along, y across, z up).

import * as THREE from "three";
import type { Pose, View } from "./scene";

const smooth = (t: number) => t * t * (3 - 2 * t);

export function pose(eye: THREE.Vector3, look: THREE.Vector3, fov = 40): Pose {
  return { eye: eye.clone(), look: look.clone(), up: new THREE.Vector3(0, 0, 1), fov, shiftX: 0, shiftY: 0 };
}

/**
 * The vertical field of view (degrees) a camera at `eye` looking along `dir` (unit) needs to hold every point,
 * with `up` as the screen's up (any vector not along `dir`), on a screen `aspect` wide; a little room round them.
 */
export function fovFor(eye: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3, points: THREE.Vector3[], aspect: number) {
  const right = dir.clone().cross(up).normalize(), u = right.clone().cross(dir);
  let need = 0;
  for (const p of points) {
    const v = p.clone().sub(eye), ahead = Math.max(0.05, v.dot(dir));
    need = Math.max(need, Math.abs(v.dot(u)) / ahead, Math.abs(v.dot(right)) / ahead / aspect);
  }
  return THREE.MathUtils.radToDeg(2 * Math.atan(need * 1.08 + 0.01));
}

function copyPose(p: Pose): Pose {
  return { eye: p.eye.clone(), look: p.look.clone(), up: p.up.clone(), fov: p.fov, shiftX: p.shiftX, shiftY: p.shiftY };
}

export class Director {
  /** The pose shown now. */
  private now: Pose;
  /**
   * A move in progress: from, to (null: home, which may change size as the window does), time, length. `table`:
   * a rise home that keeps these points (the table's corners) in the picture all the way.
   */
  private move: { from: Pose; to: Pose | null; t: number; len: number; arc: number; table?: THREE.Vector3[] } | null = null;

  constructor(private view: View) {
    this.now = copyPose(view.home);
  }

  /** The camera is away from the top view (or on its way back). */
  get active() { return this.view.free; }

  /** Where the camera is now (table coordinates). */
  get eye() { return this.view.free ? this.now.eye : this.view.home.eye; }

  /** Straight to a placement. */
  cut(p: Pose) {
    this.view.free = true;
    this.move = null;
    this.now = copyPose(p);
    this.view.place(this.now);
  }

  /** Glide from where the camera is to a placement, over `seconds`. `arc` lifts the path in the middle (metres). */
  glide(p: Pose, seconds: number, arc = 0) {
    if (!this.view.free) this.now = copyPose(this.view.home);
    this.view.free = true;
    this.move = { from: copyPose(this.now), to: copyPose(p), t: 0, len: seconds, arc };
  }

  /** Back to the top view over `seconds` (0: at once). */
  home(seconds = 0) {
    if (!this.view.free) return;
    if (seconds <= 0) { this.move = null; this.view.free = false; this.view.place(this.view.home); return; }
    this.move = { from: copyPose(this.now), to: null, t: 0, len: seconds, arc: 0 };
  }

  /**
   * Back to the top view over `seconds`, in one eased movement: the camera climbs from where it stands to the
   * top view, turning from what it looked at onto the table (`table`: its corners) and opening out toward the
   * table's sides as it goes, so the table grows to fill the picture and settles as the top view.
   */
  rise(seconds: number, table: THREE.Vector3[]) {
    if (!this.view.free) return;
    this.move = { from: copyPose(this.now), to: null, t: 0, len: seconds, arc: 0, table };
  }

  private riseStep(m: NonNullable<Director["move"]>) {
    // One easing for everything (smootherstep: still at both ends, no stages).
    const T = Math.min(1, m.t / m.len), s = T * T * T * (T * (6 * T - 15) + 10);
    const home = this.view.home, a = m.from, n = this.now, aspect = this.view.camera.aspect, table = m.table!;
    // A crane shot: the eye climbs to the top view's while what it looks at slides across the cloth, from where
    // the last camera looked to the table's middle (where the top view looks).
    n.eye.lerpVectors(a.eye, home.eye, s);
    const aDir = a.look.clone().sub(a.eye).normalize();
    // Where the last camera's line of sight meets the cloth (not too far off, for a camera looking level).
    const focus = a.eye.clone().addScaledVector(aDir, Math.min(6, a.eye.z / Math.max(0.1, -aDir.z))).lerp(home.look, s);
    const dir = focus.sub(n.eye).normalize();
    const up = a.up.clone().lerp(home.up, s);
    up.addScaledVector(dir, -up.dot(dir));
    if (up.lengthSq() < 1e-6) up.copy(home.up);
    up.normalize();
    // The lens opens toward the one that holds the whole table from here, scaled so that from the top it is the
    // top view's own lens: the table's sides come in as the camera climbs.
    const homeDir = home.look.clone().sub(home.eye).normalize();
    const fit = fovFor(n.eye, dir, up, table, aspect) * home.fov / fovFor(home.eye, homeDir, home.up, table, aspect);
    n.fov = a.fov + (fit - a.fov) * s;
    n.look.copy(n.eye).add(dir);
    n.up.copy(up);
    n.shiftX = a.shiftX + (home.shiftX - a.shiftX) * s;
    n.shiftY = a.shiftY + (home.shiftY - a.shiftY) * s;
  }

  /** How far along a rise home is (0 to 1), or null when not rising. */
  get rising() { return this.move?.table ? Math.min(1, this.move.t / this.move.len) : null; }

  /** On a move: done by now? */
  get moving() { return this.move !== null; }

  update(dt: number) {
    const m = this.move;
    if (!m) return;
    m.t += dt;
    if (m.table) {
      if (m.t >= m.len) { this.move = null; this.view.free = false; this.view.place(this.view.home); return; }
      this.riseStep(m);
      this.view.place(this.now);
      return;
    }
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
