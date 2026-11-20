// Pool: the frame loop, input, and the game around the table: practice, two players on one device, the
// computer, or a friend online (src/net/net.ts).

import "./style.css";
import * as THREE from "three";
import { DT, G, MAX_SPEED, MAX_TIP, R, TABLE_L, TABLE_W } from "./sim/constants";
import { cueTilt } from "./sim/cue";
import { Sim, cloneBalls, fingerprint, type Ball, type Shot, type SimEvent } from "./sim/physics";
import { ball, rack8, rng } from "./sim/rack";
import { HEAD_X, TABLE } from "./sim/table";
import { advanceGame, groupOf, judge, legalFirst, newGame, onEight, remaining, target, type GameState, type Player } from "./sim/rules";
import { makeView, applyEnvironment } from "./render/scene";
import { Director, pose } from "./render/director";
import { planCine, cineRate, type Cine } from "./render/cinema";
import { LampView } from "./render/lamps";
import { makeTable, CLOTHS, type Cloth } from "./render/table";
import { makeBalls, spin as turnBall, ballColor, isStripe } from "./render/balls";
import { Fall } from "./render/pocketfall";
import { CueView, GuideView, type GuidePath } from "./render/cue";
import { Markers } from "./render/markers";
import { Sound, VOLUMES, type Volume } from "./audio/sound";
import type { Decision, Level } from "./ai/ai";
import { Link, savedSeat, type AimMsg, type FromRelay, type ShotMsg, type Start } from "./net/net";

type State = "menu" | "aim" | "stroke" | "run" | "over" | "replay";
type Mode = "practice" | "pass" | "cpu" | "online";
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
const director = new Director(view);
const lamps = new LampView(table.group);
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
/** The shot as it was struck: the position, the shot and how the balls were turned, for its replay. */
let struck: { before: Ball[]; shot: Shot; turns: THREE.Quaternion[] } | null = null;
/** A shot played out: where from, the shot, how the balls were turned, and what happened (to pace the replay). */
interface Played { before: Ball[]; shot: Shot; turns: THREE.Quaternion[]; events: SimEvent[] }
/** The last shot, to watch again. A new game forgets it. */
let lastPlayed: Played | null = null;
/**
 * Watching it: the cue drawn back ("lead"), the stroke, the balls running, a moment's hold at the end. In slow
 * motion until what matters is over (the last ball down, or a little after the first contact), then faster.
 * `from`: the state to go back to; `after`: how the balls were turned before it. `cine`: seen from low (the
 * winning shot), with its own camera script and pace (src/render/cinema.ts).
 */
interface Replaying { p: Played; from: State; phase: "lead" | "stroke" | "run" | "hold"; t: number; rate: number; slowUntil: number; after: THREE.Quaternion[]; cine: Cine | null }
let replaying: Replaying | null = null;
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
document.documentElement.style.setProperty("--cloth", CLOTHS[cloth]); // the menu cards wear the same cloth

const shotSpeed = (p: number) => MAX_SPEED * Math.pow(p, 1.6);
const powerFor = (speed: number) => Math.pow(Math.min(1, speed / MAX_SPEED), 1 / 1.6);
let names = ["Player 1", "Player 2"];
/** Rules apply (not practice). */
const ruled = () => mode !== "practice";
/** The computer is to play: the human may only watch. */
const cpuTurn = () => mode === "cpu" && game.turn === 1 && game.winner === null;
/** The other side is to play (the computer, or the friend online): this browser's player only watches. */
const watching = () => game.winner === null && ((mode === "cpu" && game.turn === 1) || (mode === "online" && game.turn !== seat));

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
// ------------------------------------------------------------------ friend matches (online)

let link: Link | null = null;
/** This browser's player: 0 hosted the match, 1 joined it. */
let seat: Player = 0;
let match: Start | null = null;
/** Shots played in this match; the friend's shots arrive numbered. */
let shotNo = 0;
let friendHere = false;
/** The friend's shots, played in turn once the table is still. */
const remoteShots: ShotMsg[] = [];
let remoteAim: AimMsg | null = null;
let aimSent = { at: -1, key: "" };
let myLastShot: ShotMsg | null = null;
let myName = store.get("name") ?? "";

function netBanner(msg: string | null) {
  const b = $("#net");
  b.textContent = msg ?? "";
  b.hidden = !msg;
}
const friendName = () => names[1 - seat];
const awayBanner = () => netBanner(match && !friendHere ? `${friendName()} is away. Waiting for them to come back…` : null);

function setOnlineNames(n: [string, string]) {
  names = seat === 0 ? ["You", n[1] || "Your friend"] : [n[0] || "Your friend", "You"];
  document.querySelectorAll<HTMLElement>(".score .name").forEach((el, i) => { el.textContent = names[i]; });
}

function connect(l: Link) {
  link?.end();
  link = l;
  l.onMessage = onNet;
  l.onStatus = (s) => { if (s === "down") netBanner("Connection lost. Reconnecting…"); else if (s === "open") awayBanner(); };
}

function showInvite(text: string, code: string | null) {
  // Whatever was on the table stops (the computer must not play on behind the card).
  endReplay();
  state = "menu";
  cpu = null;
  guide.hide();
  $("#menu").hidden = true;
  $("#online").hidden = true;
  $("#invite").hidden = false;
  $("#invite-text").textContent = text;
  $("#invite-share").hidden = !code;
  if (!code) return;
  const url = `${location.origin}${location.pathname}#${code}`;
  $<HTMLInputElement>("#invite-link").value = url;
  $("#invite-code").textContent = code;
  $("#b-share").hidden = !("share" in navigator);
}

function hostMatch() {
  sound.unlock();
  seat = 0; match = null; friendHere = false;
  connect(Link.host(myName));
  showInvite("Setting up the game…", null);
}

function joinMatch(code: string) {
  seat = 1; match = null; friendHere = false;
  connect(Link.join(code, myName));
  showInvite("Joining your friend's game…", null);
}

function leaveOnline() {
  link?.bye();
  link = null;
  match = null;
  friendHere = false;
  history.replaceState(null, "", location.pathname + location.search);
  netBanner(null);
}

/**
 * A new match (the first, or a rematch). Its rack seed and breaker go to the relay, which sends every start to
 * both players; each begins a match only when the relay's start arrives. So if both press Rematch at once, both
 * end on the same match: the one the relay passed on last.
 */
function newMatch(first: Player) {
  if (!link || link.status !== "open") { toast("Reconnecting. Try again in a moment."); return; }
  link.send({ t: "start", id: Math.random().toString(36).slice(2, 10), seed: (Math.random() * 1e9) | 0, breaker: first });
}

function beginMatch(m: Start) {
  match = m;
  shotNo = 0;
  remoteShots.length = 0;
  remoteAim = null;
  myLastShot = null;
  $("#invite").hidden = true;
  startGame("online", m.breaker, m.seed);
  awayBanner();
}

function onNet(m: FromRelay) {
  switch (m.t) {
    case "room":
      seat = m.seat;
      setOnlineNames(m.names);
      history.replaceState(null, "", `#${m.code}`); // a reload rejoins
      if (seat === 0) showInvite("Send your friend this link. The game starts when they open it.", m.code);
      else showInvite(`Joined ${friendName()}'s game. Starting…`, null);
      break;
    case "joined":
      setOnlineNames(m.names);
      friendHere = true;
      toast(`${friendName()} joined`);
      newMatch(0);
      break;
    case "names":
      setOnlineNames(m.names);
      break;
    case "catchup":
      // Back after a dropout or a reload: carry on from the match's latest shot.
      seat = m.seat;
      setOnlineNames(m.names);
      friendHere = m.present;
      if (!m.start) { if (seat === 0) showInvite("Send your friend this link. The game starts when they open it.", m.code); break; }
      if (!match || match.id !== m.start.id) beginMatch(m.start);
      if (m.last && m.last.id === match!.id && m.last.n > shotNo) remoteShots.push(m.last);
      // A shot of ours that never reached the relay goes again.
      if (myLastShot && myLastShot.id === match!.id && (!m.last || m.last.n < myLastShot.n)) link?.send(myLastShot);
      awayBanner();
      break;
    case "start":
      if (m.by !== seat) friendHere = true;
      beginMatch(m);
      break;
    case "shot":
      if (match && m.id === match.id && m.n > shotNo && !remoteShots.some((r) => r.n === m.n)) remoteShots.push(m);
      break;
    case "aim":
      remoteAim = m;
      break;
    case "left":
      friendHere = false;
      awayBanner();
      break;
    case "back":
      friendHere = true;
      awayBanner();
      toast(`${friendName()} is back`);
      break;
    case "gone":
      friendHere = false;
      link?.end();
      link = null;
      netBanner(null);
      endReplay();
      if (state !== "menu") { state = "over"; showOver(`${friendName()} left`, "The match is over.", false); }
      break;
    case "error":
      link = null;
      match = null;
      netBanner(null);
      history.replaceState(null, "", location.pathname + location.search);
      showMenu();
      toast(m.message);
      break;
  }
}

/** Every frame of a friend match: play the friend's shots, follow their cue, send ours. */
function online(dt: number) {
  if (state === "aim" && remoteShots.length) {
    remoteShots.sort((a, b) => a.n - b.n);
    playRemote(remoteShots.shift()!);
    return;
  }
  if (state !== "aim" || !link) return;
  if (watching()) {
    const a = remoteAim;
    if (!a) return;
    // Follow the friend's cue smoothly between their updates.
    const k = 1 - Math.exp(-dt * 16);
    const from = Math.atan2(aim.y, aim.x);
    let to = Math.atan2(a.y, a.x);
    while (to - from > Math.PI) to -= 2 * Math.PI;
    while (to - from < -Math.PI) to += 2 * Math.PI;
    const ang = from + (to - from) * k;
    aim.set(Math.cos(ang), Math.sin(ang));
    power += (a.p - power) * k;
    setPowerUI(power);
    if (tip.side !== a.s || tip.height !== a.h) { tip = { side: a.s, height: a.h }; updateSpinUI(); }
    if (inHand() !== "none") { balls[0].x += (a.cx - balls[0].x) * k; balls[0].y += (a.cy - balls[0].y) * k; }
    called = a.c;
    return;
  }
  // Our cue, some twelve times a second while it moves.
  if (clock - aimSent.at < 0.08) return;
  const msg: AimMsg = { t: "aim", x: aim.x, y: aim.y, p: power, s: tip.side, h: tip.height, cx: balls[0].x, cy: balls[0].y, c: called };
  const key = [msg.x, msg.y, msg.p, msg.s, msg.h, msg.cx, msg.cy].map((v) => v.toFixed(4)).join() + msg.c;
  if (key === aimSent.key) return;
  link.send(msg);
  aimSent = { at: clock, key };
}

/** The friend's shot: from their exact position and game, on our own physics. */
function playRemote(m: ShotMsg) {
  // Positions should already agree; if not, it is a determinism bug: say so, and take the shooter's.
  const mine = cloneBalls(balls);
  if (m.game.ballInHand !== "none") mine[0] = { ...m.balls[0] }; // the cue ball was being placed
  // (Only when this browser played every shot before it: catching up after a reload starts from the rack.)
  if (m.n === shotNo + 1 && (fingerprint(mine) !== fingerprint(m.balls) || JSON.stringify({ ...game }) !== JSON.stringify(m.game))) {
    const diff = m.balls.filter((b, i) => JSON.stringify(b) !== JSON.stringify(mine[i])).map((b) => `${b.id}: ${JSON.stringify(mine[b.id])} vs ${JSON.stringify(b)}`);
    console.warn(`Friend match: before shot ${m.n} the position differed from the shooter's (theirs is taken). ${diff.join("; ")} game ${JSON.stringify(game)} vs ${JSON.stringify(m.game)}`);
  }
  balls = cloneBalls(m.balls);
  game = { ...m.game };
  called = m.called;
  shotNo = m.n;
  remoteAim = null;
  resetViews();
  aim.set(m.shot.dx, m.shot.dy);
  tip = { side: m.shot.side, height: m.shot.height };
  updateSpinUI();
  power = 0; setPowerUI(0);
  updateScore();
  shootExact(m.shot);
}

/** Where the cue ball may be put before this shot. */
const inHand = () => (mode === "practice" ? "anywhere" : game.ballInHand);

function resetViews() {
  for (const v of ballViews) { v.fall = null; v.mesh.visible = true; }
}

/** Something the game does a moment after a shot (re-rack, the game-over card). Going to the menu or starting
 * another game cancels it. */
let laterTimer = 0;
function later(fn: () => void, ms: number) {
  clearTimeout(laterTimer);
  laterTimer = window.setTimeout(() => { laterTimer = 0; fn(); }, ms);
}
function cancelLater() {
  clearTimeout(laterTimer);
  laterTimer = 0;
}

function startGame(m: Mode, first: Player = 0, seed = (Math.random() * 1e9) | 0) {
  endReplay();
  lastPlayed = null;
  cancelLater();
  mode = m;
  cpu = null;
  if (mode !== "online") names = mode === "cpu" ? ["You", "Computer"] : ["Player 1", "Player 2"];
  document.querySelectorAll<HTMLElement>(".score .name").forEach((el, i) => { el.textContent = names[i]; });
  breaker = first;
  game = newGame(first);
  balls = rack8(seed);
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
  fitView(); // the score takes room on a phone
  guideDirty = true;
  if (mode === "online") toast(game.turn === seat ? "Your break" : `${names[game.turn]} breaks`);
  else if (ruled()) toast(mode === "cpu" ? (game.turn === 0 ? "Your break" : "The computer breaks") : `${names[game.turn]} breaks`);
  if (!store.get("hinted")) {
    store.set("hinted", "1");
    setTimeout(() => toast(matchMedia("(pointer: coarse)").matches
      ? `Drag to aim. Pull the power bar ${powerAcross ? "across" : "down"} and let go to shoot.`
      : "Point to aim. Press, drag away and let go to shoot."), 2700);
  }
}

function shoot(p: number) {
  if (state !== "aim" || p < 0.015 || watching()) return;
  if (ruled() && onEight(game, balls) && called === null) { toast("Tap a pocket to call the 8"); return; }
  // The tilt goes with the shot, so a friend's game plays it exactly as drawn here.
  const shot = { dx: aim.x, dy: aim.y, speed: shotSpeed(p), side: tip.side, height: tip.height,
    tilt: cueTilt(balls, aim.x, aim.y, tip.side, tip.height) };
  if (mode === "online") {
    // Sent before it is played, with the exact position and game it is played from.
    if (!link || link.status !== "open") { toast("Reconnecting. Shoot when you're back online."); return; }
    shotNo++;
    myLastShot = { t: "shot", id: match!.id, n: shotNo, balls: cloneBalls(balls), game: { ...game }, called, shot };
    link.send(myLastShot);
  }
  shootExact(shot);
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
    case "cue": if (e.miscue && state !== "replay") toast("Miscue"); break;
    case "pocket": {
      // The fall into the pocket, drawn from the ball's motion as it dropped. It starts at e.t; playHeard sets
      // how far along that is on screen.
      const b = s.balls[e.a];
      ballViews[e.a].fall = new Fall(e.pocket, b.x, b.y, e.vx, e.vy, e.wx, e.wy, e.wz, e.air);
      newFalls.push({ fall: ballViews[e.a].fall!, t: e.t });
      updateScore();
      break;
    }
  }
}

/**
 * Sound each event at its own moment: the frame ran the physics up to sim.t, and the balls on screen are drawn at
 * `shown`; an event at e.t is heard (e.t - shown) from now, plus a small lead so none falls in the past.
 * `rate`: simulated seconds per real second (below 1 in a slow-motion replay).
 */
function playHeard(shown: number, rate = 1) {
  for (const { e, x, down } of heard) {
    const d = 0.03 + (e.t - shown) / rate;
    if (e.type === "ball") sound.ball(e.speed, x, d);
    else if (e.type === "cushion") sound.cushion(e.speed, x, d);
    else if (e.type === "cue") sound.cue(e.speed, e.miscue, d);
    else if (e.type === "rattle") sound.rattle(e.speed, x, d);
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
  Object.assign(c, { on: true, air: -1, x: HEAD_X - 0.12, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 });
  // Seeded, so both browsers of a friend match put it in the same place.
  const r = rng(shotNo * 31 + 7);
  for (let k = 0; k < 200 && !free(c.x, c.y); k++) { c.x = HEAD_X - 0.05 - r() * 0.3; c.y = (r() - 0.5) * 0.8; }
  ballViews[0].fall = null; ballViews[0].mesh.visible = true;
}

function endOfShot() {
  const events = sim!.events;
  if (struck) lastPlayed = { ...struck, events };
  balls = sim!.balls;
  sim = null;
  tip = { side: 0, height: 0 };
  updateSpinUI();
  guideDirty = true;
  state = "aim";

  if (mode === "practice") {
    if (!balls[0].on) { toast("Scratch: drag the cue ball to place it"); respawnCue(); }
    if (balls.slice(1).every((b) => !b.on)) { toast("Table cleared!"); later(() => startGame("practice"), 1600); }
    return;
  }

  const shooter = game.turn;
  const v = judge(game, shotBefore, balls, events, onEight(game, shotBefore) ? called : null);
  if (mode === "cpu") v.message = v.message.replace("for you", shooter === 0 ? "for you" : "for the computer");
  if (mode === "online") v.message = v.message.replace("for you", shooter === seat ? "for you" : `for ${names[shooter]}`);
  game = advanceGame(game, balls, events, v);
  called = null; calledByUser = false;
  if (v.rerack) {
    toast(v.message);
    // Online both browsers re-rack alike: the seed follows from the match.
    const seed = match ? (match.seed + shotNo * 7919) | 0 : undefined;
    later(() => startGame(mode, game.turn, seed), 1800);
    return;
  }
  if (game.winner !== null) {
    state = "over";
    updateScore();
    const mine = mode === "cpu" ? game.winner === 0 : mode === "online" && game.winner === seat;
    const title = mine ? "You win!" : mode === "cpu" ? "The computer wins" : `${names[game.winner]} wins`;
    // Won by sinking the 8: the shot again, from low, before the card (it stands behind the replay).
    const won = game.winner === shooter && events.some((e) => e.type === "pocket" && e.a === 8);
    later(() => { showOver(title, v.message, true); if (won) startReplay(true); }, won ? 700 : 900);
    return;
  }
  if (!balls[0].on) respawnCue();
  if (v.respot8) ballViews[8].mesh.visible = true;
  const me: Player = mode === "online" ? seat : 0;
  const other = names[1 - me];
  const turnMsg = mode === "cpu" || mode === "online"
    ? (game.turn === me ? (shooter === me ? "Shoot again" : "Your turn") : (shooter === me ? `${mode === "cpu" ? "Computer" : other}'s turn` : `${mode === "cpu" ? "Computer" : other} again`))
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

/**
 * Each player's group, the balls still to pot in colour and the potted ones faded, then the 8 once it is theirs.
 * While the table is open, the balls potted so far stand between the players. Called again as each ball drops.
 */
function updateScore() {
  if (!ruled() || state === "replay") return;
  const cur = sim ? sim.balls : balls;
  for (const el of document.querySelectorAll<HTMLElement>(".score .p")) {
    const p = Number(el.dataset.p) as Player;
    el.classList.toggle("turn", game.turn === p && game.winner === null);
    const tray = el.querySelector<HTMLElement>(".tray")!;
    tray.innerHTML = "";
    if (!game.groups) { tray.textContent = game.breakShot && game.turn === p ? "break" : "open"; continue; }
    const g = game.groups[p];
    for (let id = 1; id <= 15; id++) if (groupOf(id) === g) tray.appendChild(miniBall(id, !cur[id].on));
    if (remaining(cur, g).length === 0) tray.appendChild(miniBall(8, !cur[8].on));
  }
  const potted = $("#potted");
  potted.innerHTML = "";
  if (!game.groups) for (const b of cur) if (b.id !== 0 && !b.on) potted.appendChild(miniBall(b.id));
  potted.hidden = potted.childElementCount === 0;
}

/** Stripes: a coloured band between white caps; solids: all colour. Flat, always facing you. */
function flatBall(id: number) {
  const c = ballColor(id);
  return isStripe(id) ? `linear-gradient(#f6f2e8 0 25%, ${c} 25% 75%, #f6f2e8 75%)` : c;
}

/** A ball in the scoreboard; `gone`: potted, drawn faded. */
function miniBall(id: number, gone = false): HTMLElement {
  const s = document.createElement("span");
  s.className = gone ? "mini gone" : "mini";
  s.style.background = flatBall(id);
  s.title = gone ? `${id}, potted` : String(id);
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
/** The power bar runs across under the table on a phone held upright (fitView sets it), down the side elsewhere. */
let powerAcross = false;
function setPowerUI(p: number) {
  fill$.style.height = powerAcross ? "" : `${p * 100}%`;
  knob$.style.top = powerAcross ? "" : `${p * 100}%`;
  fill$.style.width = powerAcross ? `${p * 100}%` : "";
  knob$.style.left = powerAcross ? `${p * 100}%` : "";
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
  if (state === "replay") { endReplay(); return; }
  if (state !== "aim" || watching()) return;
  canvas.setPointerCapture(e.pointerId);
  // The right button opens the spin pad (a press during a pull cancels it, in pointermove: a second button
  // pressed while one is down arrives there, not here).
  if (e.pointerType === "mouse" && e.button === 2) { spinPad.hidden = false; return; }
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
  if (state !== "aim" || watching()) return;
  if (dragging) {
    const p = view.toTable(e.clientX, e.clientY - (e.pointerType === "mouse" ? 0 : 36)); // above the finger
    if (p) placeCueAt(p);
    return;
  }
  if (e.pointerType === "mouse") {
    if (mouseDown && e.button === 2) { mouseDown = null; power = 0; setPowerUI(0); guideDirty = true; return; } // right button: no shot
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
canvas.addEventListener("wheel", (e) => { if (state === "aim" && !watching()) { e.preventDefault(); rotateAim(-Math.sign(e.deltaY) * (e.shiftKey ? 0.0175 : 0.00175)); } }, { passive: false });

// Power slider: pull down (or across, on an upright phone), release to shoot; back to the start cancels.
power$.addEventListener("pointerdown", (e) => {
  if (state !== "aim" || watching()) return;
  sound.unlock();
  power$.setPointerCapture(e.pointerId);
  const set = (x: number, y: number) => {
    const r = power$.getBoundingClientRect();
    power = Math.max(0, Math.min(1, powerAcross ? (x - r.left) / r.width : (y - r.top) / r.height));
    setPowerUI(power);
    guideDirty = true;
  };
  set(e.clientX, e.clientY);
  const move = (ev: PointerEvent) => set(ev.clientX, ev.clientY);
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
spinPad.addEventListener("contextmenu", (e) => e.preventDefault()); // a second right-click closes it, no browser menu
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
function showMenu() {
  // Connected to a friend (playing, or still waiting for them): the menu leaves the match.
  if (link) {
    if (mode === "online" && match && game.winner === null && !confirm(`Leave the match with ${names[1 - seat]}?`)) return;
    leaveOnline();
  }
  endReplay();
  cancelLater();
  state = "menu"; $("#menu").hidden = false; $("#over").hidden = true; $("#invite").hidden = true; $("#online").hidden = true; guide.hide();
}
function showOver(title: string, why: string, rematch: boolean) {
  $("#over-title").textContent = title;
  $("#over-why").textContent = why;
  $("#b-rematch").hidden = !rematch;
  $("#b-over-replay").hidden = !lastPlayed;
  $("#over").hidden = false;
}
$("#b-menu").addEventListener("click", showMenu);
$("#b-over-menu").addEventListener("click", showMenu);
$("#b-rematch").addEventListener("click", () => {
  if (mode !== "online") { startGame(mode, breaker === 0 ? 1 : 0); return; }
  if (!friendHere) { toast(`${names[1 - seat]} isn't here right now`); return; }
  newMatch(breaker === 0 ? 1 : 0);
});

// Friend matches: their own card (name, invite, join by code), then the invite card.
const nameInput = $<HTMLInputElement>("#name");
nameInput.value = myName;
nameInput.addEventListener("change", () => {
  myName = nameInput.value.trim().slice(0, 20);
  store.set("name", myName);
  link?.send({ t: "name", name: myName });
});
$("#b-online").addEventListener("click", () => { $("#menu").hidden = true; $("#online").hidden = false; });
$("#b-online-back").addEventListener("click", showMenu);
$("#b-invite").addEventListener("click", hostMatch);
const joinInput = $<HTMLInputElement>("#join-code");
const joinTyped = () => {
  const code = joinInput.value.trim().toUpperCase();
  if (/^[A-HJ-NP-Z2-9]{4}$/.test(code)) { sound.unlock(); joinMatch(code); } else toast("A code is four letters and digits");
};
$("#b-join").addEventListener("click", joinTyped);
joinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinTyped(); });
$("#b-copy").addEventListener("click", async () => {
  const url = $<HTMLInputElement>("#invite-link").value;
  try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { $<HTMLInputElement>("#invite-link").select(); }
});
$("#b-share").addEventListener("click", () => {
  void navigator.share?.({ title: "Pool", text: "Play a game of pool with me", url: $<HTMLInputElement>("#invite-link").value }).catch(() => {});
});
$("#b-invite-cancel").addEventListener("click", () => { leaveOnline(); mode = "practice"; showMenu(); });
// Opened from a friend's link (pool.mkjems.dk/#KX7Q): join, or rejoin our seat after a reload.
{
  const code = location.hash.slice(1).toUpperCase();
  if (/^[A-HJ-NP-Z2-9]{4}$/.test(code)) {
    const saved = savedSeat();
    if (saved && saved.code === code) { seat = saved.seat; connect(Link.rejoin(saved)); showInvite("Reconnecting to your game…", null); }
    else joinMatch(code);
  }
}

const guideBtn = $("#b-guide"), soundBtn = $("#b-sound"), labelsBtn = $("#b-labels");
function setGuide(l: GuideLevel) { guideLevel = l; store.set("guide", l); guideBtn.textContent = `Guide: ${l}`; guideDirty = true; }
setGuide(guideLevel);
function cycleCloth() {
  const keys = Object.keys(CLOTHS) as Cloth[];
  cloth = keys[(keys.indexOf(cloth) + 1) % keys.length];
  table.setCloth(cloth);
  document.documentElement.style.setProperty("--cloth", CLOTHS[cloth]);
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
  roomBtn.classList.toggle("on", on);
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
  else if (k === "escape") { power = 0; setPowerUI(0); mouseDown = null; spinPad.hidden = true; endReplay(); }
  else if (k === "r" && !e.repeat) replayBtn.click();
  else if (watching()) return;
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
/**
 * Fit the table to the screen. On small screens, first measure how far each control reaches in from the edge it
 * stands at (its CSS --hud-edge), so the table takes the rest and nothing covers it.
 */
function fitView() {
  // An upright phone has height to spare and little width: the power bar goes across, under the table, just
  // above the score and the spin button.
  powerAcross = innerWidth < 560 && innerHeight > innerWidth;
  power$.classList.toggle("across", powerAcross);
  if (powerAcross) {
    const row = [$("#score"), $("#spin")].filter((el) => !el.hidden).map((el) => el.getBoundingClientRect().top);
    power$.style.top = `${Math.min(innerHeight, ...row) - 8 - power$.offsetHeight}px`;
  } else power$.style.top = "";
  setPowerUI(power);
  // Big screens: the score stands centred at the top, unless the buttons reach it; then at the top right.
  const score = $("#score");
  score.classList.remove("aside");
  if (Math.min(innerWidth, innerHeight) > 560 && !score.hidden && score.getBoundingClientRect().left < $(".bar nav").getBoundingClientRect().right + 16) {
    score.classList.add("aside");
  }
  if (Math.min(innerWidth, innerHeight) < 560) {
    const ins = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const el of document.querySelectorAll<HTMLElement>(".bar, .score, .power, .spin")) {
      const edge = getComputedStyle(el).getPropertyValue("--hud-edge").trim() as keyof typeof ins;
      const r = el.getBoundingClientRect();
      if (!(edge in ins) || el.hidden || r.width === 0) continue;
      const reach = edge === "top" ? r.bottom : edge === "bottom" ? innerHeight - r.top : edge === "left" ? r.right : innerWidth - r.left;
      ins[edge] = Math.max(ins[edge], reach + 4);
    }
    view.insets = ins;
  } else view.insets = null;
  view.resize();
  guideDirty = true;
}
window.addEventListener("resize", fitView);
// The score grows as balls are potted (on a phone held upright, a row more): keep the controls clear of it.
let scoreSize = "";
new ResizeObserver(() => {
  const r = $("#score").getBoundingClientRect(), size = `${Math.round(r.width)}x${Math.round(r.height)}`;
  if (size !== scoreSize) { scoreSize = size; fitView(); }
}).observe($("#score"));
fitView();

let toastTimer = 0;
/** A message that came during a replay, shown when it ends (the badge stands where toasts do). */
let heldToast: string | null = null;
function toast(msg: string) {
  if (state === "replay") { heldToast = msg; return; }
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
}

// ------------------------------------------------------------------ replay

const REPLAY_SLOW = 0.35;
const replayBtn = $<HTMLButtonElement>("#b-replay");
const replayBadge = $("#replay-badge"), replaySpeed = $("#replay-badge .speed"), replayVeil = $("#replay-veil");
/** How slow the replay is now, 1 at its slowest, 0 at normal speed: the badge, the darkened edges, the pitch. */
function showSlowness(rate: number) {
  const k = Math.max(0, Math.min(1, (1 - rate) / (1 - REPLAY_SLOW)));
  replaySpeed.textContent = k > 0.5 ? "in slow motion" : "at normal speed";
  replayBadge.classList.toggle("slow", k > 0.5);
  replayVeil.style.opacity = String(k);
  sound.pitch = 1 - 0.38 * k;
}

/** Not while someone else is to shoot, nor while the game is about to move on (re-rack, game-over card). */
function canReplay() {
  return !!lastPlayed && !laterTimer && (state === "over" || (state === "aim" && !watching()));
}

/** Simulated seconds of slow motion: up to the last ball down, or the first contact, and a little after. */
function slowPart(events: readonly SimEvent[]) {
  let pot = -1, contact = -1;
  for (const e of events) {
    if (e.type === "pocket") pot = e.t;
    else if (e.type === "ball" && contact < 0) contact = e.t;
  }
  return Math.min(3, pot >= 0 ? pot + 0.6 : contact >= 0 ? contact + 0.8 : 0.8);
}

/** `low`: seen from low (the winning shot), when a ball went down; otherwise from the top. */
function startReplay(low = false) {
  if (!canReplay()) return;
  const p = lastPlayed!;
  sound.unlock();
  const cine = low
    ? planCine(p.before, p.shot, p.shot.tilt ?? cueTilt(p.before, p.shot.dx, p.shot.dy, p.shot.side, p.shot.height), view.camera.aspect)
    : null;
  replaying = { p, from: state, phase: "lead", t: 0, rate: REPLAY_SLOW, slowUntil: slowPart(p.events), after: ballViews.map((v) => v.mesh.quaternion.clone()), cine };
  if (cine) {
    director.cut(cine.beats[0].pose);
    director.glide(cine.beats[0].push, 3);
    document.body.classList.add("cinema");
  }
  state = "replay";
  sim = new Sim(p.before);
  sim.onEvent = onEvent;
  acc = 0;
  for (const b of sim.balls) { prevX[b.id] = b.x; prevY[b.id] = b.y; }
  ballViews.forEach((v, i) => v.mesh.quaternion.copy(p.turns[i]));
  resetViews();
  power = 0; setPowerUI(0); mouseDown = null; touch = null; dragging = false;
  spinPad.hidden = true;
  $("#over").hidden = true;
  $("#toast").classList.remove("show");
  showSlowness(REPLAY_SLOW);
  replayBadge.hidden = false;
  replayBtn.classList.add("on");
}

/** Back to the table as it is. The replay ends where the shot did, so nothing jumps (but a re-placed cue ball). */
function endReplay() {
  const r = replaying;
  if (!r) return;
  replaying = null;
  sim = null;
  director.home();
  document.body.classList.remove("cinema");
  heard.length = 0;
  newFalls.length = 0;
  resetViews();
  ballViews.forEach((v, i) => v.mesh.quaternion.copy(r.after[i]));
  state = r.from;
  if (state === "over") $("#over").hidden = false;
  replayBadge.hidden = true;
  showSlowness(1);
  if (heldToast) { toast(heldToast); heldToast = null; }
  replayBtn.classList.remove("on");
  guideDirty = true;
}

function runReplay(dt: number) {
  const r = replaying!;
  r.t += dt;
  if (r.phase === "lead") {
    if (r.t >= 0.75) { r.phase = "stroke"; r.t = 0; }
  } else if (r.phase === "stroke") {
    if (r.t * REPLAY_SLOW >= 0.07) { sim!.strike(r.p.shot); r.phase = "run"; r.t = 0; }
  } else if (r.phase === "run") {
    const c = r.cine, t = sim!.t;
    if (c) {
      r.rate = cineRate(c, t, REPLAY_SLOW);
      showSlowness(r.rate);
      // The next camera, when its moment comes.
      while (c.next < c.beats.length && t >= c.beats[c.next].from) {
        const b = c.beats[c.next++];
        if (b.cut) director.cut(b.pose);
        director.glide(b.push, 3);
      }
      // The last ball is down: up into the top view while the others roll out at normal speed.
      if (!c.rising && t > c.riseAt) { c.rising = true; director.home(2.6); }
    } else if (t > r.slowUntil && r.rate < 1) {
      // Past the part that matters: back to normal speed over half a second, for the balls rolling out.
      r.rate = Math.min(1, r.rate + dt * 1.3);
      showSlowness(r.rate);
    }
    runSim(dt * r.rate, r.rate);
    if (!sim!.moving() && !ballViews.some((v) => v.fall) && (!c || (c.rising && !director.moving))) { r.phase = "hold"; r.t = 0; }
  } else if (r.t >= 0.6) endReplay();
}

replayBtn.addEventListener("click", () => (state === "replay" ? endReplay() : startReplay()));
$("#b-over-replay").addEventListener("click", () => startReplay());
$("#replay-badge .hint").textContent = matchMedia("(pointer: coarse)").matches ? "tap to skip" : "click to skip";

// ------------------------------------------------------------------ frame loop

/** Run the physics `simDt` further, in its fixed steps; the balls turn, the sounds are scheduled. */
function runSim(simDt: number, rate = 1) {
  const s = sim!;
  acc += simDt;
  let n = 0;
  while (acc >= DT && n < 80) {
    for (const b of s.balls) { prevX[b.id] = b.x; prevY[b.id] = b.y; }
    s.step();
    for (const b of s.balls) if (b.on) turnBall(ballViews[b.id].mesh, b.wx, b.wy, b.wz, DT);
    acc -= DT;
    n++;
  }
  playHeard(s.t - DT + acc, rate);
}

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

  if (mode === "online") online(dt);

  if (state === "stroke" && pendingShot) {
    // The cue swings forward from where it was pulled to, then strikes.
    strokeT += dt;
    if (strokeT >= 0.07) {
      struck = { before: cloneBalls(balls), shot: pendingShot, turns: ballViews.map((v) => v.mesh.quaternion.clone()) };
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
    runSim(dt);
    // The shot ends when everything is still and every potted ball has dropped out of sight.
    if (!sim.moving() && !ballViews.some((v) => v.fall)) endOfShot();
  }
  // Simulated time this frame: slower in a replay.
  const simDt = replaying ? dt * replaying.rate : dt;
  if (replaying) runReplay(dt);

  const cur = sim ? sim.balls : balls;
  const alpha = sim ? Math.min(1, acc / DT) : 1;
  for (const b of cur) {
    const v = ballViews[b.id];
    if (b.on) {
      if (!v.fall) v.mesh.visible = true;
      // Between the last two physics steps: smooth motion at any frame rate, one step (2.5 ms) behind.
      const x = sim ? prevX[b.id] + (b.x - prevX[b.id]) * alpha : b.x;
      const y = sim ? prevY[b.id] + (b.y - prevY[b.id]) * alpha : b.y;
      // Over a pocket's hole the ball is falling (it may still be thrown back out).
      const z = b.air >= 0 ? R - 0.5 * G * b.air * b.air : R;
      v.mesh.position.set(x, y, z);
      table.shadowBalls[b.id].set(x, y, z, 1);
    } else if (v.fall) {
      // Into the pocket (src/render/pocketfall.ts).
      const f = v.fall;
      if (!f.fresh) f.target += simDt;
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
  if (aiming && guideDirty && !watching()) computeGuide();
  if (!aiming || watching()) guide.hide();
  // Which balls are yours: soft rings, only while asking for help (Space or the Numbers button).
  if (aiming && labels && ruled() && !game.breakShot) {
    const t = target(game, balls);
    markers.setRings(balls.filter((b) => b.on && b.id !== 0 && (t === "open" ? b.id !== 8 : groupOf(b.id) === t)));
  } else markers.setRings([]);
  markers.setCall(aiming && ruled() && onEight(game, balls) ? called : null, clock);
  markers.setHand(balls[0].x, balls[0].y, aiming && ruled() && !watching() && inHand() !== "none", clock);
  updateLabels(cur);

  if (replaying) {
    // The replay's cue: drawn back, then the stroke, from where the shot was played.
    const r = replaying, s = r.p.shot;
    const back = r.phase === "lead" ? easeInOut(Math.min(1, r.t / 0.45)) : r.phase === "stroke" ? Math.max(0, 1 - (r.t * REPLAY_SLOW) / 0.07) : 0;
    cue.set(r.p.before, s.dx, s.dy, 0.03 + back * (0.02 + (s.speed / MAX_SPEED) * 0.25), s.side, s.height, r.phase === "lead" || r.phase === "stroke");
  } else {
    const pull = state === "stroke"
      ? 0.03 + Math.max(0, 1 - strokeT / 0.07) * (0.02 + (pendingShot ? pendingShot.speed / MAX_SPEED : 0) * 0.25)
      : 0.03 + power * 0.25;
    const cueShown = (aiming || state === "stroke") && balls[0].on && !dragging;
    cue.set(balls, aim.x, aim.y, pull, tip.side, tip.height, cueShown);
  }
  const canWatch = canReplay() || state === "replay";
  if (replayBtn.disabled === canWatch) {
    replayBtn.disabled = !canWatch;
    // Just offered (a shot has played out): the button glows for a moment, so it is found.
    replayBtn.classList.remove("fresh");
    if (canWatch && state !== "replay") { void replayBtn.offsetWidth; replayBtn.classList.add("fresh"); }
  }

  director.update(dt);
  lamps.update(director.eye);
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
    online: () => ({ seat, shotNo, match, friendHere, status: link?.status ?? null, names, queued: remoteShots.length }),
    timeScale: (k: number) => { timeScale = k; },
    replay: (low = false) => startReplay(low),
    replayPhase: () => replaying?.phase ?? null,
    /** The low replay's plan: when each camera comes, the slow stretches, the rise. */
    cine: () => replaying?.cine ? { beats: replaying.cine.beats.map((b) => b.from), slow: replaying.cine.slow, riseAt: replaying.cine.riseAt } : null,
    /** The camera is away from the top view (the director has it). */
    camAway: () => director.active,
    /** Put the camera somewhere (table coordinates), or back home with no arguments. */
    cam: (eye?: number[], look?: number[], fov?: number) => {
      if (!eye || !look) director.home();
      else director.cut(pose(new THREE.Vector3(...eye), new THREE.Vector3(...look), fov));
    },
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
