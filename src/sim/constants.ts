// Physical constants of the table and balls, in SI units (metres, kilograms, seconds).
// Starting values are from published measurements (see docs/Plan.md, Physics); tuned by playing.
//
// DETERMINISM: everything under src/sim may use only + - * / and Math.sqrt (plus min, max, abs, floor).
// Never Math.sin, cos, atan2, hypot, exp or pow: they differ in the last bit between browser engines.

/** Ball radius: 57.15 mm balls. */
export const R = 0.028575;
/** Ball mass. */
export const MASS = 0.17;
/** Gravity. */
export const G = 9.81;

/** Playing surface between the cushion noses: a 7-foot table. x runs along the length, y across. */
export const TABLE_L = 1.981;
export const TABLE_W = 0.9905;

/** Sliding friction, ball on cloth. */
export const MU_SLIDE = 0.2;
/** Rolling resistance, ball on cloth. */
export const MU_ROLL = 0.0105;
/** Angular deceleration of spin about the vertical axis (rad/s²). */
export const SPIN_DECEL = 10.9;

/** Ball-to-ball restitution. */
export const E_BALL = 0.95;
/** Ball-to-ball friction at sliding speed v: 0.01 + 0.108 * f(1.088 v), f a rational stand-in for exp(-x). */
export function muBall(v: number): number {
  const x = 1.088 * v;
  return 0.00995 + 0.108 / (1 + x + 0.5 * x * x);
}

/** Cushion nose height above the cloth is 64% of the ball diameter, so it touches the ball above its centre. */
export const CUSHION_SIN = 0.28; // (h - R) / R
export const CUSHION_COS = Math.sqrt(1 - CUSHION_SIN * CUSHION_SIN);
/** Ball-to-cushion friction. */
export const MU_CUSHION = 0.2;
/** Cushion restitution at normal approach speed vn: lively when soft, deader when hard. */
export function eCushion(vn: number): number {
  return 0.93 - (0.26 * vn) / (vn + 2.2);
}

/**
 * Pockets. Past the drop line a ball is over the hole and falls freely; it is down once it has dropped this far
 * (its centre then can't come back over the lip). Before that, the back of the pocket can throw it back out.
 */
export const LIP_DROP = 0.5 * R;
/** Restitution of the back of the pocket (the facing under the rail, behind the liner). */
export const POCKET_E = 0.5;

/** Below these the ball counts as still. */
export const EPS_V = 1e-4; // m/s
export const EPS_W = 0.05; // rad/s, spin about the vertical axis

/** The fixed simulation step. Contacts are found exactly within a step, so this only sets path accuracy. */
export const DT = 1 / 400;

/** Fastest shot the cue can play, cue-ball speed in m/s (a hard break is 8-10). */
export const MAX_SPEED = 9.5;
/** Largest tip offset from the ball's centre, as a fraction of R, before a miscue. */
export const MAX_TIP = 0.55;
/** Squirt: the cue ball leaves this many radians off the aim line per unit of side offset (in R). */
export const SQUIRT = 0.045;
