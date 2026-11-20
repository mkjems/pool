// Highlights: which shots are worth replaying by themselves (docs/Plan.md, Replays, step 2b). Pure and
// deterministic like the rules (only + - * / and Math.sqrt), so both browsers in a friend match pick the same
// shots without telling each other.
//
// A shot counts only if it went well for the shooter: no foul, not the break, and a ball of theirs went down
// (any ball but the 8 on an open table; the 8 when it wins). What makes it special is worked out by playing the
// shot again and looking at where the balls were at each collision:
//
//   bank         the ball went down after a cushion, after the collision that sent it (jaws don't count)
//   kick         the cue ball met a cushion before it touched any ball
//   combination  the ball was sent down by another object ball
//   carom        the cue ball touched another ball first, then sent this one down
//   balls        two or more of the shooter's balls down in one shot
//   long         a direct pot over a long way: cue ball to the contact, plus the ball to its pocket
//   cut          a direct pot cut thin
//
// Each weighs something; a shot weighing at least HIGHLIGHT is replayed.

import { Sim, type Ball, type Shot, type SimEvent } from "./physics";
import { groupOf, type GameState, type Verdict } from "./rules";
import { TABLE } from "./table";

export type HighlightKind = "bank" | "kick" | "combination" | "carom" | "balls" | "long" | "cut";

export interface Highlight {
  /** What makes it special, heaviest first, with weights. */
  kinds: { kind: HighlightKind; weight: number }[];
  /** All the weights together; a replay from HIGHLIGHT up. */
  score: number;
  /** The winning shot (always replayed). */
  win: boolean;
  /** For the replay's badge: "Bank shot", "Combination · 2 balls". */
  label: string;
  /** The shooter's balls that went down. */
  balls: number[];
}

/** A shot weighing this much is replayed. */
export const HIGHLIGHT = 1;

/** A collision this hard is what sent a ball (m/s); a ball on its way that touches another this hard was disturbed. */
const SENT = 0.15;
const TOUCH = 0.1;
/** A cushion hit this hard counts (m/s into it). */
const CUSHION = 0.15;
/** A cushion this near the pocket the ball fell in is its jaw or the rail beside it, not a bank. */
const NEAR_POCKET = 0.2; // m
/** A kick: the cue ball runs at least this far from the cushion to the ball. */
const KICK_RUN = 0.3; // m
/** Long pot: no weight up to LONG_FROM metres of travel, full weight from LONG_FULL. */
const LONG_FROM = 1.3, LONG_FULL = 2.1;
/** Thin cut: the cosine of the cut angle; no weight from 55°, full weight at 80°. */
const CUT_FROM = 0.574, CUT_FULL = 0.174;

interface V { x: number; y: number; vx: number; vy: number }
/** An event, with the balls in it as they were just before (`pre`) and just after (`post`). */
interface Moment { e: SimEvent; pre: V[]; post: V[] }
type BallMoment = Moment & { e: Extract<SimEvent, { type: "ball" }> };

const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
const speed2 = (v: V) => v.vx * v.vx + v.vy * v.vy;

/** Play the shot again, keeping each event with the balls in it just before and after. */
function replay(before: readonly Ball[], shot: Shot): Moment[] {
  const sim = new Sim(before);
  // The last known motion of every ball: refreshed each step, and after each event for the balls in it.
  const last: V[] = sim.balls.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy }));
  const now = (b: Ball): V => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy });
  const moments: Moment[] = [];
  sim.onEvent = (e) => {
    const ids = e.type === "ball" ? [e.a, e.b] : [e.a];
    const post = ids.map((id) => now(sim.balls[id]));
    moments.push({ e, pre: ids.map((id, i) => ({ ...post[i], vx: last[id].vx, vy: last[id].vy })), post });
    ids.forEach((id, i) => (last[id] = post[i]));
  };
  sim.strike(shot);
  while (sim.moving() && sim.t < 60) {
    for (let i = 0; i < last.length; i++) last[i] = now(sim.balls[i]);
    sim.step();
  }
  return moments;
}

/** The side of a ball event that is ball `id`: 0 or 1. */
const sideOf = (m: BallMoment, id: number) => (m.e.a === id ? 0 : 1);
const touches = (m: Moment, id: number) => m.e.type === "ball" && (m.e.a === id || m.e.b === id);

/**
 * How ball `id` came to be where it was at moment `until`: the collision that sent it (the last one, more than a
 * touch, in which the other ball came in faster), and whether its way from there was clean (no other ball
 * touched it on the way). Followed back to the cue ball through every ball that sent another.
 */
interface Chain {
  /** Where `id` was sent: index into the moments. */
  sent: number;
  /** Object balls between the cue ball and `id` (0: the cue ball sent it). */
  depth: number;
  /** The cue ball touched one other ball first, then went on into the chain. */
  carom: boolean;
  /** Every ball in the chain went straight from being sent to sending the next. */
  clean: boolean;
}

function chain(moments: Moment[], id: number, until: number, guard = 0): Chain | null {
  if (id === 0 || guard > 6) return null;
  let sent = -1;
  for (let i = until - 1; i >= 0; i--) {
    const m = moments[i];
    if (!touches(m, id)) continue;
    const bm = m as BallMoment, me = sideOf(bm, id);
    if (bm.e.speed >= SENT && speed2(bm.pre[1 - me]) > speed2(bm.pre[me])) { sent = i; break; }
  }
  if (sent < 0) return null;
  let clean = true;
  for (let i = sent + 1; i < until; i++) if (touches(moments[i], id) && moments[i].e.speed >= TOUCH) clean = false;
  const bm = moments[sent] as BallMoment;
  const by = bm.e.a === id ? bm.e.b : bm.e.a;
  if (by !== 0) {
    const up = chain(moments, by, sent, guard + 1);
    if (!up) return { sent, depth: 1, carom: false, clean: false };
    return { sent, depth: up.depth + 1, carom: up.carom, clean: clean && up.clean };
  }
  // The cue ball: straight from the cue, or after touching exactly one other ball (a carom).
  let before = 0;
  for (let i = 0; i < sent; i++) if (touches(moments[i], 0) && moments[i].e.speed >= TOUCH) before++;
  return { sent, depth: 0, carom: before === 1, clean: clean && before <= 1 };
}

/**
 * Is this shot a highlight? `state` and `before` as the shot was played, `v` its verdict. Null when it is not the
 * shooter's success at all; otherwise the weights (the caller replays when `win` or `score >= HIGHLIGHT`).
 */
export function highlight(state: GameState, before: readonly Ball[], shot: Shot, v: Verdict): Highlight | null {
  if (state.breakShot || v.foul || v.rerack) return null;
  const p = state.turn;
  const win = v.winner === p;
  if (v.winner !== null && !win) return null;

  const mine = (id: number) =>
    id === 8 ? win : id !== 0 && (state.groups ? groupOf(id) === state.groups[p] : true);
  if (!v.keepTurn && !win && state.groups) return null; // nothing of theirs went down
  const moments = replay(before, shot);
  const pots = moments.filter((m) => m.e.type === "pocket" && mine(m.e.a));
  if (pots.length === 0) return null;

  // Kick: cushions the cue ball met before its first contact.
  const firstIdx = moments.findIndex((m) => touches(m, 0));
  let kickRails = 0;
  if (firstIdx >= 0) {
    // Only cushions with a real way on to the ball: not the cue ball brushing the rail beside it.
    const at = (moments[firstIdx] as BallMoment).post[sideOf(moments[firstIdx] as BallMoment, 0)];
    for (let i = 0; i < firstIdx; i++) {
      const m = moments[i];
      if (m.e.type === "cushion" && m.e.a === 0 && m.e.speed >= CUSHION && dist(m.post[0].x, m.post[0].y, at.x, at.y) >= KICK_RUN) kickRails++;
    }
  }

  // Each ball down on its own; the best one speaks for the shot. Only a clean chain from the cue ball counts:
  // a ball that tumbles out of a cluster, or kisses another on its way, is luck rather than a shot.
  let best: { kind: HighlightKind; weight: number }[] = [];
  let bestScore = 0;
  for (const pot of pots) {
    const id = pot.e.a, potAt = moments.indexOf(pot);
    const c = chain(moments, id, potAt);
    if (!c || !c.clean) continue;
    const pocket = TABLE.pockets[(pot.e as Extract<SimEvent, { type: "pocket" }>).pocket];
    const kinds: { kind: HighlightKind; weight: number }[] = [];
    let rails = 0;
    for (let i = c.sent + 1; i < potAt; i++) {
      const m = moments[i];
      if (m.e.type !== "cushion" || m.e.a !== id || m.e.speed < CUSHION) continue;
      if (dist(m.post[0].x, m.post[0].y, pocket.mx, pocket.my) > NEAR_POCKET) rails++;
    }
    if (rails > 0) kinds.push({ kind: "bank", weight: rails > 1 ? 1.5 : 1 });
    if (kickRails > 0) kinds.push({ kind: "kick", weight: kickRails > 1 ? 1.5 : 1 });
    if (c.depth > 0) kinds.push({ kind: "combination", weight: 0.5 + 0.5 * c.depth });
    if (c.carom) kinds.push({ kind: "carom", weight: 1 });
    if (rails === 0 && kickRails === 0 && c.depth === 0 && !c.carom) {
      // A direct pot: how far the cue ball and the ball went, and how thin the cut was.
      const sent = moments[c.sent] as BallMoment, me = sideOf(sent, id);
      const cueIn = sent.pre[1 - me], ball = sent.post[me], start = before[0];
      const travel = dist(start.x, start.y, cueIn.x, cueIn.y) + dist(ball.x, ball.y, pot.post[0].x, pot.post[0].y);
      const long = clamp01((travel - LONG_FROM) / (LONG_FULL - LONG_FROM));
      if (long > 0) kinds.push({ kind: "long", weight: long });
      const li = Math.sqrt(speed2(cueIn)), lb = Math.sqrt(speed2(ball));
      if (li > 0 && lb > 0) {
        const cos = (cueIn.vx * ball.vx + cueIn.vy * ball.vy) / (li * lb);
        const cut = clamp01((CUT_FROM - cos) / (CUT_FROM - CUT_FULL));
        if (cut > 0) kinds.push({ kind: "cut", weight: cut * 0.8 });
      }
    }
    const score = kinds.reduce((s, k) => s + k.weight, 0);
    if (score > bestScore) { bestScore = score; best = kinds; }
  }

  const kinds = best.slice();
  if (pots.length > 1) kinds.push({ kind: "balls", weight: pots.length > 2 ? 0.5 + 0.5 * (pots.length - 2) : 0.6 });
  kinds.sort((a, b) => b.weight - a.weight);
  const score = kinds.reduce((s, k) => s + k.weight, 0);
  return { kinds, score, win, label: label(kinds, pots.length), balls: pots.map((m) => m.e.a) };
}

const NAMES: Record<HighlightKind, string> = {
  bank: "Bank shot", kick: "Kick shot", combination: "Combination", carom: "Carom", balls: "", long: "Long pot", cut: "Thin cut",
};

/** The two heaviest reasons, for the badge: "Bank shot · 2 balls". Empty when nothing stands out. */
function label(kinds: { kind: HighlightKind; weight: number }[], down: number): string {
  return kinds
    .filter((k) => k.weight >= 0.3)
    .slice(0, 2)
    .map((k) => (k.kind === "balls" ? `${down} balls` : k.kind === "bank" && k.weight > 1 ? "Double bank" : k.kind === "kick" && k.weight > 1 ? "Two-rail kick" : NAMES[k.kind]))
    .join(" · ");
}
