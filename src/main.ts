// Pool: the frame loop, input, and the game around the table (practice, or two players on one device).

import "./style.css";
import * as THREE from "three";
import { DT, MAX_SPEED, MAX_TIP, R, TABLE_L, TABLE_W } from "./sim/constants";
import { Sim, type Ball, type Shot, type SimEvent } from "./sim/physics";
import { ball, rack8 } from "./sim/rack";
import { HEAD_X, TABLE } from "./sim/table";
import { advanceGame, groupOf, judge, legalFirst, newGame, onEight, remaining, target, type GameState, type Player } from "./sim/rules";
import { makeView, applyEnvironment } from "./render/scene";
import { makeTable, CLOTHS, type Cloth } from "./render/table";
import { makeBalls, spin as turnBall, ballColor, isStripe } from "./render/balls";
import { Fall } from "./render/pocketfall";
import { CueView, GuideView, type GuidePath } from "./render/cue";
import { Markers } from "./render/markers";
import { Sound, VOLUMES, type Volume } from "./audio/sound";
import type { Decision, Level } from "./ai/ai";

type State = "menu" | "aim" | "stroke" | "run" | "over";
type Mode = "practice" | "pass" | "cpu";
type GuideLevel = "full" | "short" | "off";

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const canvas = $<HTMLCanvasElement>("#c");
const view = makeView(canvas);
const table = makeTable();
view.scene.add(table.group);
const ballViews = makeBalls(table.group);
const cue = new CueView(table.group);
const guide = new GuideView(table.group);
const markers = new Markers(table.group);
const sound = new Sound();
applyEnvironment(view);

const store = {
  get(k: string) { try { return localStorage.getItem("pool." + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem("pool." + k, v); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ state

let mode: Mode = "practice";
let game: GameState = newGame(0);
let balls: Ball[] = rack8((Math.random() * 1e9) | 0);
let shotBefore: Ball[] = [];
let sim: Sim | null = null;
let state: State = "menu";
const aim = new THREE.Vector2(1, 0);
let power = 0; // 0-1 while pulling back
let tip = { side: 0, height: 0 };
let guideLevel: GuideLevel = (store.get("guide") as GuideLevel) ?? "full";
let cloth: Cloth = (store.get("cloth") as Cloth) ?? "green";
let strokeT = 0;
let pendingShot: Shot | null = null;
let acc = 0;
let guideDirty = true;
let guideFirst = -1; // the ball the guide says gets hit first
let called: number | null = null; // pocket called for the 8
let calledByUser = false;
let labels = false;
let clock = 0;
let breaker: Player = 0;
// Ball positions one physics step back, to draw smoothly between steps (a frame holds 6.67 steps at 60 Hz).
const prevX = new Float64Array(16), prevY = new Float64Array(16);
// Frame times, to lower the resolution if the device can't keep up.
const frameTimes: number[] = [];
table.setCloth(cloth);

const shotSpeed = (p: number) => MAX_SPEED * Math.pow(p, 1.6);
const powerFor = (speed: number) => Math.pow(Math.min(1, speed / MAX_SPEED), 1 / 1.6);
let names = ["Player 1", "Player 2"];
/** Rules apply (not practice). */
const ruled = () => mode !== "practice";
/** The computer is to play: the human may only watch. */
const cpuTurn = () => mode === "cpu" && game.turn === 1 && game.winner === null;

// ------------------------------------------------------------------ the computer opponent

let level: Level = (store.get("level") as Level) ?? "medium";
const worker = new Worker(new URL("./ai/worker.ts", import.meta.url), { type: "module" });
let askId = 0;
interface CpuTurn { phase: "think" | "place" | "aim" | "pull" | "hold"; t: number; d: Decision | null; fromAim: number; toAim: number; fromX: number; fromY: number }
let cpu: CpuTurn | null = null;
worker.onmessage = (e: MessageEvent<{ id: number; decision: Decision }>) => {
  if (!cpu || e.data.id !== askId) return;
  cpu.d = e.data.decision;
};

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** The computer's turn, step by step: think, place the cue ball, turn the cue onto the shot, pull back, play. */
function runCpu(dt: number) {
  if (state !== "aim" || !cpuTurn()) { cpu = null; return; }
  if (!cpu) {
    cpu = { phase: "think", t: 0, d: null, fromAim: 0, toAim: 0, fromX: 0, fromY: 0 };
    askId++;
    worker.postMessage({ id: askId, state: game, balls, level, seed: (Math.random() * 1e9) | 0 });
    guide.hide();
  }
  cpu.t += dt;
  const d = cpu.d;
  if (cpu.phase === "think") {
    if (!d || cpu.t < 0.7) return;
    called = d.called; calledByUser = true;
    cpu.fromX = balls[0].x; cpu.fromY = balls[0].y;
    cpu.phase = d.place ? "place" : "aim";
    cpu.t = 0;
    cpu.fromAim = Math.atan2(aim.y, aim.x);
    let to = Math.atan2(d.planned.dy, d.planned.dx);
    while (to - cpu.fromAim > Math.PI) to -= 2 * Math.PI;
    while (to - cpu.fromAim < -Math.PI) to += 2 * Math.PI;
    cpu.toAim = to;
  }
  if (!d) return;
  if (cpu.phase === "place") {
    const k = easeInOut(Math.min(1, cpu.t / 0.6));
    balls[0].x = cpu.fromX + (d.place!.x - cpu.fromX) * k;
    balls[0].y = cpu.fromY + (d.place!.y - cpu.fromY) * k;
    if (k >= 1) { cpu.phase = "aim"; cpu.t = 0; }
  } else if (cpu.phase === "aim") {
    // Sweep onto the line, settle with a last small correction, as a player does.
    const dur = 0.5 + Math.min(0.6, Math.abs(cpu.toAim - cpu.fromAim) * 0.4);
    const k = Math.min(1, cpu.t / dur);
    const a = cpu.fromAim + (cpu.toAim - cpu.fromAim) * easeInOut(k) + Math.sin(k * Math.PI) * 0.01;
    aim.set(Math.cos(a), Math.sin(a));
    tip = { side: d.planned.side * k, height: d.planned.height * k };
    updateSpinUI();
    if (k >= 1) { aim.set(d.planned.dx, d.planned.dy); cpu.phase = "pull"; cpu.t = 0; }
  } else if (cpu.phase === "pull") {
    // Two practice strokes, then the backswing.
    const target = powerFor(d.planned.speed);
    const k = cpu.t / 1.1;
    power = k < 0.6 ? target * 0.35 * (0.5 - 0.5 * Math.cos(k / 0.6 * 4 * Math.PI)) : target * easeInOut(Math.min(1, (k - 0.6) / 0.4));
    setPowerUI(power);
    if (k >= 1) { cpu.phase = "hold"; cpu.t = 0; }
  } else if (cpu.phase === "hold" && cpu.t > 0.12) {
    power = 0; setPowerUI(0);
    const played = d.played;
    cpu = null;
    shootExact(played);
  }
}
/** Where the cue ball may be put before this shot. */
const inHand = () => (mode === "practice" ? "anywhere" : game.ballInHand);

function resetViews() {
  for (const v of ballViews) { v.fall = null; v.mesh.visible = true; }
}

function startGame(m: Mode, first: Player = 0) {
  mode = m;
  cpu = null;
  names = mode === "cpu" ? ["You", "Computer"] : ["Player 1", "Player 2"];
  document.querySelectorAll<HTMLElement>(".score .name").forEach((el, i) => { el.textContent = names[i]; });
  breaker = first;
  game = newGame(first);
  balls = rack8((Math.random() * 1e9) | 0);
  sim = null;
  state = "aim";
  aim.set(1, 0);
  tip = { side: 0, height: 0 };
  called = null; calledByUser = false;
  resetViews();
  updateSpinUI();
  $("#menu").hidden = true;
  $("#over").hidden = true;
  $("#score").hidden = !ruled();
  updateScore();
  guideDirty = true;
  if (ruled()) toast(mode === "cpu" ? (game.turn === 0 ? "Your break" : "The computer breaks") : `${names[game.turn]} breaks`);
  if (!store.get("hinted")) {
    store.set("hinted", "1");
    setTimeout(() => toast(matchMedia("(pointer: coarse)").matches
      ? "Drag to aim. Pull the power bar down and let go to shoot."
      : "Point to aim. Press, drag away and let go to shoot."), 2700);
  }
}

function shoot(p: number) {
  if (state !== "aim" || p < 0.015 || cpuTurn()) return;
  if (ruled() && onEight(game, balls) && called === null) { toast("Tap a pocket to call the 8"); return; }
  shootExact({ dx: aim.x, dy: aim.y, speed: shotSpeed(p), side: tip.side, height: tip.height });
}

function shootExact(shot: Shot) {
  sound.unlock();
  shotBefore = balls.map((b) => ({ ...b }));
  pendingShot = shot;
  state = "stroke";
  strokeT = 0;
  guide.hide();
}

/** Events of this frame, to be heard at the moment they happened in the simulation (see playHeard). */
const heard: Array<{ e: SimEvent; x: number; down: number }> = [];
/** Falls into pockets that began this frame, with their simulation time. */
const newFalls: Array<{ fall: Fall; t: number }> = [];

function onEvent(e: SimEvent) {
  const s = sim!;
  heard.push({ e, x: e.type === "pocket" ? TABLE.pockets[e.pocket].hx : s.balls[e.a].x, down: s.balls.filter((b) => !b.on).length - 1 });
  switch (e.type) {
    case "cue": if (e.miscue) toast("Miscue"); break;
    case "pocket": {
      // The fall into the pocket, drawn from the ball's motion as it dropped. It starts at e.t; playHeard sets
      // how far along that is on screen.
      const b = s.balls[e.a];
      ballViews[e.a].fall = new Fall(e.pocket, b.x, b.y, e.vx, e.vy, e.wx, e.wy, e.wz);
      newFalls.push({ fall: ballViews[e.a].fall!, t: e.t });
      break;
    }
  }
}

/**
 * Sound each event at its own moment: the frame ran the physics up to sim.t, and the balls on screen are drawn at
 * `shown`; an event at e.t is heard (e.t - shown) from now, plus a small lead so none falls in the past.
 */
function playHeard(shown: number) {
  for (const { e, x, down } of heard) {
    const d = 0.03 + e.t - shown;
    if (e.type === "ball") sound.ball(e.speed, x, d);
    else if (e.type === "cushion") sound.cushion(e.speed, x, d);
    else if (e.type === "cue") sound.cue(e.speed, e.miscue, d);
    else sound.pocket(e.speed, x, down, d);
  }
  heard.length = 0;
  // Falls: the screen shows the moment `shown`, so a fall that began at t is (shown - t) along (maybe a little
  // less than nothing: then the ball is still drawn rolling in).
  for (const { fall, t } of newFalls) { fall.target = shown - t; fall.fresh = true; }
  newFalls.length = 0;
}

function respawnCue() {
  const c = balls[0];
  Object.assign(c, { on: true, x: HEAD_X - 0.12, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 });
  for (let k = 0; k < 200 && !free(c.x, c.y); k++) { c.x = HEAD_X - 0.05 - Math.random() * 0.3; c.y = (Math.random() - 0.5) * 0.8; }
  ballViews[0].fall = null; ballViews[0].mesh.visible = true;
}

function endOfShot() {
  const events = sim!.events;
  balls = sim!.balls;
  sim = null;
  tip = { side: 0, height: 0 };
  updateSpinUI();
  guideDirty = true;
  state = "aim";

  if (mode === "practice") {
    if (!balls[0].on) { toast("Scratch: drag the cue ball to place it"); respawnCue(); }
    if (balls.slice(1).every((b) => !b.on)) { toast("Table cleared!"); setTimeout(() => startGame("practice"), 1600); }
    return;
  }

  const shooter = game.turn;
  const v = judge(game, shotBefore, balls, events, onEight(game, shotBefore) ? called : null);
  if (mode === "cpu") v.message = v.message.replace("for you", shooter === 0 ? "for you" : "for the computer");
  game = advanceGame(game, balls, events, v);
  called = null; calledByUser = false;
  if (v.rerack) {
    toast(v.message);
    setTimeout(() => startGame(mode, game.turn), 1800);
    return;
  }
  if (game.winner !== null) {
    state = "over";
    updateScore();
    $("#over-title").textContent = mode === "cpu" ? (game.winner === 0 ? "You win!" : "The computer wins") : `${names[game.winner]} wins`;
    $("#over-why").textContent = v.message;
    setTimeout(() => { $("#over").hidden = false; }, 900);
    return;
  }
  if (!balls[0].on) respawnCue();
  if (v.respot8) ballViews[8].mesh.visible = true;
  const turnMsg = mode === "cpu"
    ? (game.turn === 0 ? (shooter === 0 ? "Shoot again" : "Your turn") : (shooter === 1 ? "Computer again" : "Computer's turn"))
    : game.turn === shooter ? `${names[shooter]} again` : `${names[game.turn]} to play`;
  toast(v.message ? `${v.message} ${turnMsg}.` : `${turnMsg}.`);
  updateScore();
}

function free(x: number, y: number) {
  return balls.every((o) => o.id === 0 || !o.on || (o.x - x) ** 2 + (o.y - y) ** 2 >= 4 * R * R);
}

/** Move the cue ball (ball in hand) as close to p as the rules and the other balls allow. */
function placeCueAt(p: THREE.Vector2) {
  const b = balls[0];
  const maxX = inHand() === "kitchen" ? HEAD_X : TABLE_L / 2 - R;
  const x = Math.min(maxX, Math.max(-TABLE_L / 2 + R, p.x));
  const y = Math.max(-TABLE_W / 2 + R, Math.min(TABLE_W / 2 - R, p.y));
  if (free(x, y)) { b.x = x; b.y = y; guideDirty = true; }
}

// ------------------------------------------------------------------ the scoreboard

function updateScore() {
  if (!ruled()) return;
  for (const el of document.querySelectorAll<HTMLElement>(".score .p")) {
    const p = Number(el.dataset.p) as Player;
    el.classList.toggle("turn", game.turn === p && game.winner === null);
    const tray = el.querySelector<HTMLElement>(".tray")!;
    tray.innerHTML = "";
    if (!game.groups) { tray.textContent = game.breakShot && game.turn === p ? "break" : "open"; continue; }
    const left = remaining(balls, game.groups[p]);
    if (left.length === 0) { tray.appendChild(miniBall(8)); continue; }
    for (const id of left) tray.appendChild(miniBall(id));
  }
}

/** Stripes: a coloured band between white caps; solids: all colour. Flat, always facing you. */
function flatBall(id: number) {
  const c = ballColor(id);
  return isStripe(id) ? `linear-gradient(#f6f2e8 0 25%, ${c} 25% 75%, #f6f2e8 75%)` : c;
}

function miniBall(id: number): HTMLElement {
  const s = document.createElement("span");
  s.className = "mini";
  s.style.background = flatBall(id);
  s.title = String(id);
  return s;
}

// ------------------------------------------------------------------ number labels

const labelEls: HTMLElement[] = [];
for (let id = 1; id <= 15; id++) {
  const el = document.createElement("div");
  el.className = "label";
  el.style.background = flatBall(id);
  el.innerHTML = `<span>${id}</span>`;
  el.hidden = true;
  $("#labels").appendChild(el);
  labelEls[id] = el;
}
function updateLabels(cur: readonly Ball[]) {
  for (let id = 1; id <= 15; id++) {
    const b = cur[id], el = labelEls[id];
    el.hidden = !labels || !b.on;
    if (el.hidden) continue;
    const p = view.toScreen(b.x, b.y, R * 2);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }
}

// ------------------------------------------------------------------ aim guide

function computeGuide() {
  guideDirty = false;
  guideFirst = -1;
  if (state !== "aim") { guide.hide(); return; }
  const s = new Sim(balls);
  const p = power > 0.015 ? power : 0.42;
  s.strike({ dx: aim.x, dy: aim.y, speed: shotSpeed(p), side: tip.side, height: tip.height });
  s.events = [];
  const cuePath: THREE.Vector2[] = [new THREE.Vector2(balls[0].x, balls[0].y)];
  let objPath: THREE.Vector2[] = [];
  let first = -1;
  let ghost: THREE.Vector2 | null = null;
  let cueAfter = 0, objCushions = 0, cueCushions = 0, objLen = 0;
  let eightPocket = -1;
  const full = guideLevel === "full";
  const maxCueAfter = full ? 0.45 : 0.1;
  const maxObj = full ? 1.6 : 0.3;
  for (let i = 0; i < 4000 && s.moving(); i++) {
    const before = s.events.length;
    s.step();
    for (const e of s.events.slice(before)) {
      if (e.type === "ball" && first < 0 && (e.a === 0 || e.b === 0)) {
        first = e.a === 0 ? e.b : e.a;
        ghost = new THREE.Vector2(s.balls[0].x, s.balls[0].y);
        objPath = [new THREE.Vector2(s.balls[first].x, s.balls[first].y)];
      }
      if (e.type === "cushion" && e.a === 0) cueCushions++;
      if (e.type === "cushion" && e.a === first) objCushions++;
      if (e.type === "pocket" && e.a === 8 && eightPocket < 0) eightPocket = e.pocket;
    }
    const c = s.balls[0];
    const lastC = cuePath[cuePath.length - 1];
    const cueDone = cueAfter >= maxCueAfter || cueCushions > (full ? 1 : 0) || !c.on;
    if (!cueDone) {
      const d = Math.hypot(c.x - lastC.x, c.y - lastC.y);
      if (d > 0.004) { cuePath.push(new THREE.Vector2(c.x, c.y)); if (first >= 0) cueAfter += d; }
    }
    let objDone = first < 0;
    if (first >= 0) {
      const o = s.balls[first];
      const lastO = objPath[objPath.length - 1];
      if (o.on && objLen < maxObj && objCushions < (full ? 2 : 1)) {
        const d = Math.hypot(o.x - lastO.x, o.y - lastO.y);
        if (d > 0.004) { objPath.push(new THREE.Vector2(o.x, o.y)); objLen += d; }
      } else {
        if (!o.on && objLen < maxObj) {
          const pk = s.events.find((e) => e.type === "pocket" && e.a === first);
          if (pk && pk.type === "pocket") objPath.push(new THREE.Vector2(TABLE.pockets[pk.pocket].hx, TABLE.pockets[pk.pocket].hy));
        }
        objLen = maxObj;
        objDone = true;
      }
    }
    if (cueDone && objDone && (first >= 0 || cueCushions > 0)) break;
  }
  guideFirst = first;
  // Calling the 8: suggest the pocket the guide sends it to.
  if (ruled() && onEight(game, balls) && !calledByUser && eightPocket >= 0) called = eightPocket;

  const wrong = ruled() && first >= 0 && !legalFirst(game, balls, first);
  const ghostColor = wrong ? 0xff5a4a : 0xffffff;
  if (guideLevel === "off") { guide.set([], ghost, ghostColor); return; }
  const paths: GuidePath[] = [{ points: cuePath, color: 0xffffff, width: 0.0035, opacity: 0.55 }];
  if (objPath.length > 1 && !wrong) paths.push({ points: objPath, color: 0xffe7a3, width: 0.0045, opacity: 0.75 });
  guide.set(paths, ghost, ghostColor);
}

// ------------------------------------------------------------------ input

const power$ = $("#power"), fill$ = $("#power .fill"), knob$ = $("#power .knob");
function setPowerUI(p: number) {
  fill$.style.height = `${p * 100}%`;
  knob$.style.top = `${p * 100}%`;
}

let mouseDown: { x: number; y: number } | null = null;
let touch: { x: number; y: number; t: number; moved: number } | null = null;
let dragging = false; // moving the cue ball (ball in hand)
let fine = false;

function cueScreen() { return view.toScreen(balls[0].x, balls[0].y); }

function aimAt(px: number, py: number) {
  const p = view.toTable(px, py);
  if (!p) return;
  const d = p.sub(new THREE.Vector2(balls[0].x, balls[0].y));
  if (d.lengthSq() < 1e-6) return;
  aim.copy(d.normalize());
  guideDirty = true;
}

function rotateAim(rad: number) {
  aim.rotateAround(new THREE.Vector2(), rad);
  aim.normalize();
  guideDirty = true;
}

/** +1 if a counter-clockwise turn on the table is counter-clockwise on screen too. */
function screenHandedness() {
  const c = cueScreen();
  const a = view.toScreen(balls[0].x + 0.1, balls[0].y).sub(c), b = view.toScreen(balls[0].x, balls[0].y + 0.1).sub(c);
  return a.x * b.y - a.y * b.x < 0 ? 1 : -1; // screen y points down
}

/** A pocket near this screen point, for calling the 8. */
function pocketNear(px: number, py: number): number {
  const s = view.scale();
  for (const p of TABLE.pockets) {
    const q = view.toScreen(p.hx, p.hy, 0);
    if (Math.hypot(q.x - px, q.y - py) < Math.max(26, p.hr * s * 1.3)) return p.id;
  }
  return -1;
}

canvas.addEventListener("pointerdown", (e) => {
  sound.haptics = e.pointerType === "touch";
  sound.unlock();
  if (state !== "aim" || cpuTurn()) return;
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === "mouse" && e.button === 2) { power = 0; setPowerUI(0); mouseDown = null; return; }
  if (ruled() && onEight(game, balls)) {
    const pk = pocketNear(e.clientX, e.clientY);
    if (pk >= 0) { called = pk; calledByUser = true; toast("8 called"); return; }
  }
  // Ball in hand: grab the cue ball if the press is on it.
  if (inHand() !== "none") {
    const c = cueScreen();
    const grab = Math.max(e.pointerType === "mouse" ? 14 : 28, R * view.scale() * 1.6);
    if (Math.hypot(c.x - e.clientX, c.y - e.clientY) < grab) { dragging = true; return; }
  }
  if (e.pointerType === "mouse") mouseDown = { x: e.clientX, y: e.clientY };
  else touch = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
});

canvas.addEventListener("pointermove", (e) => {
  if (state !== "aim" || cpuTurn()) return;
  if (dragging) {
    const p = view.toTable(e.clientX, e.clientY - (e.pointerType === "mouse" ? 0 : 36)); // above the finger
    if (p) placeCueAt(p);
    return;
  }
  if (e.pointerType === "mouse") {
    if (mouseDown) {
      // Power: how far the mouse has moved from where it was pressed, in any direction, so there is always room.
      // Back near the press point means no shot.
      const pulled = Math.hypot(e.clientX - mouseDown.x, e.clientY - mouseDown.y) - 6;
      power = Math.max(0, Math.min(1, pulled / (0.24 * Math.min(innerWidth, innerHeight))));
      setPowerUI(power);
      guideDirty = true;
    } else if (fine || e.shiftKey) {
      // Fine aim: a tenth of the pointer's sweep around the cue ball.
      const c = cueScreen();
      const a0 = Math.atan2(e.clientY - e.movementY - c.y, e.clientX - e.movementX - c.x);
      const a1 = Math.atan2(e.clientY - c.y, e.clientX - c.x);
      let da = a1 - a0;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      rotateAim(-da * 0.1 * screenHandedness());
    } else aimAt(e.clientX, e.clientY);
  } else if (touch) {
    // Relative aim: the finger's movement across the aim line turns it; slow movement turns finer.
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    const now = performance.now();
    const speed = Math.hypot(dx, dy) / Math.max(1, now - touch.t); // px per ms
    const gain = Math.max(0.12, Math.min(1, speed / 1.2));
    const c = cueScreen();
    const ahead = view.toScreen(balls[0].x + aim.x * 0.1, balls[0].y + aim.y * 0.1).sub(c).normalize();
    const across = dx * -ahead.y + dy * ahead.x;
    rotateAim(-across * gain * 0.0035 * screenHandedness());
    touch.moved += Math.hypot(dx, dy);
    touch.x = e.clientX; touch.y = e.clientY; touch.t = now;
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (dragging) { dragging = false; return; }
  if (e.pointerType === "mouse") {
    if (mouseDown) { mouseDown = null; const p = power; power = 0; setPowerUI(0); shoot(p); }
  } else if (touch) {
    if (touch.moved < 6) aimAt(e.clientX, e.clientY); // a tap aims straight at that point
    touch = null;
  }
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => { if (state === "aim" && !cpuTurn()) { e.preventDefault(); rotateAim(-Math.sign(e.deltaY) * (e.shiftKey ? 0.0175 : 0.00175)); } }, { passive: false });

// Power slider: pull down, release to shoot; back to the top cancels.
power$.addEventListener("pointerdown", (e) => {
  if (state !== "aim" || cpuTurn()) return;
  sound.unlock();
  power$.setPointerCapture(e.pointerId);
  const set = (y: number) => {
    const r = power$.getBoundingClientRect();
    power = Math.max(0, Math.min(1, (y - r.top) / r.height));
    setPowerUI(power);
    guideDirty = true;
  };
  set(e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientY);
  const up = () => {
    power$.removeEventListener("pointermove", move);
    power$.removeEventListener("pointerup", up);
    power$.removeEventListener("pointercancel", up);
    const p = power; power = 0; setPowerUI(0); shoot(p);
  };
  power$.addEventListener("pointermove", move);
  power$.addEventListener("pointerup", up);
  power$.addEventListener("pointercancel", up);
});

// Spin.
const spinBtn = $("#spin"), spinPad = $("#spin-pad"), pad = $("#spin-pad .pad");
function updateSpinUI() {
  for (const dot of [spinBtn.querySelector<HTMLElement>(".dot")!, pad.querySelector<HTMLElement>(".dot")!]) {
    dot.style.left = `${50 + tip.side * 50}%`;
    dot.style.top = `${50 - tip.height * 50}%`;
  }
}
function setTip(side: number, height: number) {
  const l = Math.hypot(side, height), max = MAX_TIP * 0.98;
  if (l > max) { side *= max / l; height *= max / l; }
  tip = { side, height };
  updateSpinUI();
  guideDirty = true;
}
spinBtn.addEventListener("click", () => { spinPad.hidden = false; });
$("#spin-done").addEventListener("click", () => { spinPad.hidden = true; });
$("#spin-reset").addEventListener("click", () => setTip(0, 0));
spinPad.addEventListener("pointerdown", (e) => { if (e.target === spinPad) spinPad.hidden = true; });
pad.addEventListener("pointerdown", (e) => {
  pad.setPointerCapture(e.pointerId);
  const set = (ev: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    setTip(((ev.clientX - r.left) / r.width - 0.5) * 2, -((ev.clientY - r.top) / r.height - 0.5) * 2);
  };
  set(e);
  pad.onpointermove = (ev) => { if (ev.buttons) set(ev); };
});

// Menus, buttons and keys.
function setLevel(l: Level) {
  level = l;
  store.set("level", l);
  for (const b of document.querySelectorAll<HTMLButtonElement>("#menu [data-level]")) b.setAttribute("aria-checked", String(b.dataset.level === l));
}
setLevel(level);
for (const b of document.querySelectorAll<HTMLButtonElement>("#menu [data-level]")) b.addEventListener("click", () => setLevel(b.dataset.level as Level));
for (const b of document.querySelectorAll<HTMLButtonElement>("#menu [data-mode]")) {
  b.addEventListener("click", () => { sound.unlock(); startGame(b.dataset.mode as Mode); });
}
function showMenu() { state = "menu"; $("#menu").hidden = false; $("#over").hidden = true; guide.hide(); }
$("#b-menu").addEventListener("click", showMenu);
$("#b-over-menu").addEventListener("click", showMenu);
$("#b-rematch").addEventListener("click", () => startGame(mode, breaker === 0 ? 1 : 0));

const guideBtn = $("#b-guide"), soundBtn = $("#b-sound"), labelsBtn = $("#b-labels");
function setGuide(l: GuideLevel) { guideLevel = l; store.set("guide", l); guideBtn.textContent = `Guide: ${l}`; guideDirty = true; }
setGuide(guideLevel);
function cycleCloth() {
  const keys = Object.keys(CLOTHS) as Cloth[];
  cloth = keys[(keys.indexOf(cloth) + 1) % keys.length];
  table.setCloth(cloth);
  store.set("cloth", cloth);
  toast(`Cloth: ${cloth}`);
}
let lastVolume: Volume = "high";
function setVolume(v: Volume) {
  sound.setVolume(v);
  if (v !== "off") lastVolume = v;
  soundBtn.textContent = `Sound: ${v}`;
  store.set("volume", v);
}
/** The button steps down through the volumes and round again; M mutes and unmutes. */
function cycleVolume() {
  sound.unlock();
  setVolume(VOLUMES[(VOLUMES.indexOf(sound.volume) + VOLUMES.length - 1) % VOLUMES.length]);
}
function toggleSound() {
  sound.unlock();
  setVolume(sound.volume === "off" ? lastVolume : "off");
}
{
  const saved = store.get("volume") as Volume | null;
  setVolume(saved && VOLUMES.includes(saved) ? saved : store.get("muted") === "1" ? "off" : "high");
}
const roomBtn = $("#b-room");
function setRoom(on: boolean) {
  sound.setRoomTone(on);
  roomBtn.textContent = `Room sound: ${on ? "on" : "off"}`;
  roomBtn.setAttribute("aria-pressed", String(on));
  store.set("room", on ? "1" : "0");
}
setRoom(store.get("room") === "1");
roomBtn.addEventListener("click", () => { sound.unlock(); setRoom(!sound.roomTone); });
guideBtn.addEventListener("click", () => setGuide(guideLevel === "full" ? "short" : guideLevel === "short" ? "off" : "full"));
$("#b-cloth").addEventListener("click", cycleCloth);
soundBtn.addEventListener("click", cycleVolume);
labelsBtn.addEventListener("click", () => { labels = !labels; labelsBtn.classList.toggle("on", labels); });

window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") fine = true;
  if (e.key === " ") { labels = true; e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  if (k === "g") guideBtn.click();
  else if (k === "c") cycleCloth();
  else if (k === "m") toggleSound();
  else if (k === "escape") { power = 0; setPowerUI(0); mouseDown = null; spinPad.hidden = true; }
  else if (cpuTurn()) return;
  else if (state === "aim" && (k === "arrowleft" || k === "arrowright")) rotateAim((k === "arrowleft" ? 1 : -1) * (e.shiftKey ? 0.0175 : 0.00175));
  else if (k === "w") setTip(tip.side, tip.height + 0.1);
  else if (k === "s") setTip(tip.side, tip.height - 0.1);
  else if (k === "a") setTip(tip.side - 0.1, tip.height);
  else if (k === "d") setTip(tip.side + 0.1, tip.height);
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") fine = false;
  if (e.key === " ") labels = labelsBtn.classList.contains("on");
});
window.addEventListener("resize", () => { view.resize(); guideDirty = true; });

let toastTimer = 0;
function toast(msg: string) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
}

// ------------------------------------------------------------------ frame loop

/** Too slow for a minute's worth of frames? Draw at a lower resolution (never below half). */
function adaptQuality(raw: number) {
  if (raw > 0.1 || document.hidden) return; // tab switch or a hiccup
  frameTimes.push(raw);
  if (frameTimes.length < 60) return;
  const sorted = [...frameTimes].sort((a, b) => a - b);
  frameTimes.length = 0;
  const median = sorted[30];
  if (median > 0.021 && view.quality > 0.5) {
    view.quality = Math.max(0.5, view.quality * 0.8);
    view.resize();
  }
}

let last = performance.now();
/** Slow motion for tests and screenshots (?test: __pool.timeScale); at 0, time moves only by __pool.step. */
let timeScale = 1, manualTime = 0;
function frame(now: number) {
  const raw = (now - last) / 1000;
  let dt = Math.min(0.05, raw) * timeScale;
  if (timeScale === 0 && manualTime > 0) { dt = Math.min(manualTime, 1 / 60); manualTime -= dt; }
  last = now;
  adaptQuality(raw);
  clock += dt;

  if (state === "stroke" && pendingShot) {
    // The cue swings forward from where it was pulled to, then strikes.
    strokeT += dt;
    if (strokeT >= 0.07) {
      sim = new Sim(balls);
      sim.onEvent = onEvent;
      sim.strike(pendingShot);
      pendingShot = null;
      state = "run";
      acc = 0;
      for (const b of sim.balls) { prevX[b.id] = b.x; prevY[b.id] = b.y; }
    }
  }
  if (state === "run" && sim) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 80) {
      for (const b of sim.balls) { prevX[b.id] = b.x; prevY[b.id] = b.y; }
      sim.step();
      for (const b of sim.balls) if (b.on) turnBall(ballViews[b.id].mesh, b.wx, b.wy, b.wz, DT);
      acc -= DT;
      n++;
    }
    playHeard(sim.t - DT + acc);
    // The shot ends when everything is still and every potted ball has dropped out of sight.
    if (!sim.moving() && !ballViews.some((v) => v.fall)) endOfShot();
  }

  const cur = sim ? sim.balls : balls;
  const alpha = sim ? Math.min(1, acc / DT) : 1;
  for (const b of cur) {
    const v = ballViews[b.id];
    if (b.on) {
      if (!v.fall) v.mesh.visible = true;
      // Between the last two physics steps: smooth motion at any frame rate, one step (2.5 ms) behind.
      const x = sim ? prevX[b.id] + (b.x - prevX[b.id]) * alpha : b.x;
      const y = sim ? prevY[b.id] + (b.y - prevY[b.id]) * alpha : b.y;
      v.mesh.position.set(x, y, R);
      table.shadowBalls[b.id].set(x, y, R, 1);
    } else if (v.fall) {
      // Into the pocket (src/render/pocketfall.ts).
      const f = v.fall;
      if (!f.fresh) f.target += dt;
      f.fresh = false;
      if (f.target < 0) {
        v.mesh.position.set(f.p.x + f.v.x * f.target, f.p.y + f.v.y * f.target, R);
      } else {
        v.mesh.position.copy(f.update(v.mesh));
      }
      const z = v.mesh.position.z;
      table.shadowBalls[b.id].set(v.mesh.position.x, v.mesh.position.y, z, z > 0 ? 1 : 0);
      if (f.done) { v.fall = null; v.mesh.visible = false; }
    } else {
      v.mesh.visible = false;
      table.shadowBalls[b.id].w = 0;
    }
  }

  runCpu(dt);
  const aiming = state === "aim";
  if (aiming && guideDirty && !cpuTurn()) computeGuide();
  if (!aiming || cpuTurn()) guide.hide();
  // Which balls are yours: soft rings, only while asking for help (Space or the Numbers button).
  if (aiming && labels && ruled() && !game.breakShot) {
    const t = target(game, balls);
    markers.setRings(balls.filter((b) => b.on && b.id !== 0 && (t === "open" ? b.id !== 8 : groupOf(b.id) === t)));
  } else markers.setRings([]);
  markers.setCall(aiming && ruled() && onEight(game, balls) ? called : null, clock);
  markers.setHand(balls[0].x, balls[0].y, aiming && ruled() && !cpuTurn() && inHand() !== "none", clock);
  updateLabels(cur);

  const pull = state === "stroke"
    ? 0.03 + Math.max(0, 1 - strokeT / 0.07) * (0.02 + (pendingShot ? pendingShot.speed / MAX_SPEED : 0) * 0.25)
    : 0.03 + power * 0.25;
  cue.set(balls[0].x, balls[0].y, aim.x, aim.y, pull, tip.side, tip.height, (aiming || state === "stroke") && balls[0].on && !dragging);

  view.renderer.render(view.scene, view.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for the browser tests and screenshots: ?test
if (new URLSearchParams(location.search).has("test")) {
  (window as unknown as Record<string, unknown>).__pool = {
    state: () => state,
    game: () => ({ ...game, guideFirst, called }),
    balls: () => (sim ? sim.balls : balls).map((b) => ({ ...b })),
    start: (m: Mode, first: Player = 0) => startGame(m, first),
    setLevel,
    aimAt: (x: number, y: number) => { aim.copy(new THREE.Vector2(x - balls[0].x, y - balls[0].y).normalize()); guideDirty = true; },
    setTip,
    shoot: (p: number) => shoot(p),
    labels: (on: boolean) => { labels = on; },
    quality: () => view.quality,
    timeScale: (k: number) => { timeScale = k; },
    step: (seconds: number) => { manualTime += seconds; },
    falls: () => ballViews.filter((v) => v.fall).map((v) => ({ id: v.id, target: v.fall!.target, z: v.fall!.p.z, done: v.fall!.done })),
    /** Render now and return a square crop around a screen point (CSS px), as a PNG data URL. */
    snap: (cx: number, cy: number, size: number) => {
      view.renderer.render(view.scene, view.camera);
      const src = view.renderer.domElement, k = src.width / window.innerWidth;
      const c = document.createElement("canvas");
      c.width = c.height = Math.round(size * k);
      c.getContext("2d")!.drawImage(src, (cx - size / 2) * k, (cy - size / 2) * k, size * k, size * k, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    },
    screen: (x: number, y: number) => { const p = view.toScreen(x, y); return { x: p.x, y: p.y }; },
    aim: () => ({ x: aim.x, y: aim.y }),
    rack: (s: number) => { balls = rack8(s); resetViews(); guideDirty = true; },
    setGame: (g: Partial<GameState>) => { game = { ...game, ...g }; updateScore(); guideDirty = true; },
    place: (list: Array<[number, number, number]>) => {
      balls = Array.from({ length: 16 }, (_, id) => { const b = ball(id, 0, 0); b.on = false; return b; });
      for (const [id, x, y] of list) Object.assign(balls[id], { on: true, x, y });
      resetViews();
      updateScore();
      guideDirty = true;
    },
  };
}
