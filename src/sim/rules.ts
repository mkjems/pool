// 8-ball rules (WPA world-standardised rules as the base; only the 8 is called). Pure: judges a shot from the
// balls before and after and the simulation's events. See docs/Rules.md.

import { R } from "./constants";
import type { Ball, SimEvent } from "./physics";
import { FOOT_X } from "./table";

export type Group = "solids" | "stripes";
export type Player = 0 | 1;

export interface GameState {
  /** Whose shot it is. */
  turn: Player;
  /** groups[player], or null while the table is open. */
  groups: [Group, Group] | null;
  /** The next shot is the break. */
  breakShot: boolean;
  /** Where the shooter may place the cue ball before the next shot. */
  ballInHand: "none" | "kitchen" | "anywhere";
  winner: Player | null;
}

export interface Verdict {
  /** Why the shot was a foul, or null. */
  foul: string | null;
  /** The shooter keeps the table. */
  keepTurn: boolean;
  /** What to tell the players. */
  message: string;
  /** The game is over: this player won. */
  winner: Player | null;
  /** The 8 went down on the break and must be put back on the foot spot. */
  respot8: boolean;
  /** Illegal break: rack again, the other player breaks. */
  rerack: boolean;
}

export const groupOf = (id: number): Group | "eight" | "cue" => (id === 0 ? "cue" : id === 8 ? "eight" : id < 8 ? "solids" : "stripes");
const other = (p: Player): Player => (p === 0 ? 1 : 0);

export function newGame(breaker: Player = 0): GameState {
  return { turn: breaker, groups: null, breakShot: true, ballInHand: "kitchen", winner: null };
}

/** Balls of a group still on the table. */
export function remaining(balls: readonly Ball[], g: Group): number[] {
  return balls.filter((b) => b.on && groupOf(b.id) === g).map((b) => b.id);
}

/** The player has cleared their group and now plays the 8. */
export function onEight(state: GameState, balls: readonly Ball[], p: Player = state.turn): boolean {
  return !!state.groups && remaining(balls, state.groups[p]).length === 0;
}

/** Which ball the shooter must hit first: a group, the 8, or anything but the 8 (open table). */
export function target(state: GameState, balls: readonly Ball[]): Group | "eight" | "open" {
  if (!state.groups) return "open";
  return onEight(state, balls) ? "eight" : state.groups[state.turn];
}

/** Is it legal for the cue ball to hit this ball first? */
export function legalFirst(state: GameState, balls: readonly Ball[], id: number): boolean {
  if (state.breakShot) return true;
  const t = target(state, balls);
  if (t === "open") return id !== 8;
  return groupOf(id) === t;
}

export function judge(state: GameState, before: readonly Ball[], _after: readonly Ball[], events: readonly SimEvent[], called: number | null): Verdict {
  const p = state.turn, o = other(p);
  const pots = events.filter((e) => e.type === "pocket") as Extract<SimEvent, { type: "pocket" }>[];
  const scratch = pots.some((e) => e.a === 0);
  const potted = pots.filter((e) => e.a !== 0).map((e) => e.a);
  const firstEv = events.find((e) => e.type === "ball" && (e.a === 0 || e.b === 0)) as Extract<SimEvent, { type: "ball" }> | undefined;
  const first = firstEv ? (firstEv.a === 0 ? firstEv.b : firstEv.a) : -1;
  const cushionAfter = !!firstEv && events.some((e) => e.type === "cushion" && e.t >= firstEv.t);
  const wasOn8 = onEight(state, before);
  const eightDown = potted.includes(8);
  const v: Verdict = { foul: null, keepTurn: false, message: "", winner: null, respot8: false, rerack: false };

  if (state.breakShot) {
    const cushioned = new Set(events.filter((e) => e.type === "cushion" && e.a !== 0).map((e) => (e as { a: number }).a));
    if (scratch) v.foul = "Scratch on the break";
    else if (first < 0) v.foul = "Missed the rack";
    if (eightDown) v.respot8 = true;
    if (!v.foul && potted.length === 0 && cushioned.size < 4) {
      v.rerack = true;
      v.message = "Illegal break: fewer than four balls reached a cushion. The other player breaks.";
      return v;
    }
    if (v.foul) { v.message = `${v.foul}. Ball in hand behind the line.`; return v; }
    v.keepTurn = potted.length > 0;
    v.message = v.respot8 ? "The 8 went down on the break: it goes back on the spot." : v.keepTurn ? "Good break!" : "";
    return v;
  }

  // Fouls.
  if (scratch) v.foul = "Scratch";
  else if (first < 0) v.foul = "No ball hit";
  else if (!legalFirst(state, before, first)) {
    const t = target(state, before);
    v.foul = t === "open" ? "The 8 can't be hit first on an open table" : t === "eight" ? "Must hit the 8 first" : `Must hit ${t} first`;
  } else if (potted.length === 0 && !cushionAfter) v.foul = "No cushion after contact";

  // The 8.
  if (eightDown) {
    const pocket = pots.find((e) => e.a === 8)!.pocket;
    if (!wasOn8) { v.winner = o; v.message = "The 8 went down too early."; }
    else if (v.foul) { v.winner = o; v.message = `${v.foul} on the 8.`; }
    else if (called !== null && pocket !== called) { v.winner = o; v.message = "The 8 went into the wrong pocket."; }
    else { v.winner = p; v.message = "The 8 is down!"; }
    return v;
  }

  if (v.foul) { v.message = `Foul: ${v.foul.toLowerCase()}. Ball in hand.`; return v; }

  // Groups: the first ball potted on a legal shot after the break decides.
  let groups = state.groups;
  if (!groups) {
    const firstObj = potted.find((id) => id !== 8);
    if (firstObj !== undefined) {
      const g = groupOf(firstObj) as Group;
      groups = p === 0 ? [g, g === "solids" ? "stripes" : "solids"] : [g === "solids" ? "stripes" : "solids", g];
      v.message = `${g === "solids" ? "Solids" : "Stripes"} for you.`;
    }
  }
  v.keepTurn = !!groups && potted.some((id) => groupOf(id) === groups![p]);
  return v;
}

/** Apply a verdict: the state for the next shot. Mutates `balls` for a re-spotted 8. */
export function advanceGame(state: GameState, balls: Ball[], events: readonly SimEvent[], v: Verdict): GameState {
  const p = state.turn;
  const next: GameState = { ...state, breakShot: false, ballInHand: "none" };
  if (v.rerack) return newGame(other(p));
  if (v.winner !== null) { next.winner = v.winner; return next; }
  if (v.respot8) spot(balls, 8);
  if (!state.groups && !state.breakShot && !v.foul) {
    const pots = events.filter((e) => e.type === "pocket" && e.a !== 0 && e.a !== 8) as Extract<SimEvent, { type: "pocket" }>[];
    if (pots.length) {
      const g = groupOf(pots[0].a) as Group;
      const og: Group = g === "solids" ? "stripes" : "solids";
      next.groups = p === 0 ? [g, og] : [og, g];
    }
  }
  if (!v.keepTurn) next.turn = other(p);
  if (v.foul) next.ballInHand = state.breakShot ? "kitchen" : "anywhere";
  return next;
}

/** Put a ball back on the foot spot, or the nearest free place behind it toward the foot cushion. */
export function spot(balls: Ball[], id: number) {
  const b = balls.find((x) => x.id === id)!;
  b.on = true; b.vx = b.vy = b.wx = b.wy = b.wz = 0;
  b.y = 0;
  for (let x = FOOT_X; x < 0.99 - R; x += 0.002) {
    b.x = x;
    if (balls.every((o) => o === b || !o.on || (o.x - x) * (o.x - x) + o.y * o.y >= 4 * R * R)) return;
  }
}
