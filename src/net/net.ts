// Friend matches, the browser's side of the connection (docs/Plan.md, Friend matches; the relay is
// server/relay.mjs). It keeps one WebSocket open, reconnects with growing pauses when it drops, and rejoins its
// seat with the key the relay gave it, also after a reload (the seat is remembered in the browser).

import type { Ball, Shot } from "../sim/physics";
import type { GameState, Player } from "../sim/rules";

export interface Start { id: string; seed: number; breaker: Player }
/** A shot: the shooter's exact position and game before it, and the shot. Both browsers play it. */
export interface ShotMsg { t: "shot"; id: string; n: number; balls: Ball[]; game: GameState; called: number | null; shot: Shot }
/** The shooter's cue while aiming: direction, pull-back, tip, cue-ball position, the pocket called. */
export interface AimMsg { t: "aim"; x: number; y: number; p: number; s: number; h: number; cx: number; cy: number; c: number | null }

/** The player in turn watches the last shot again, and the friend with them; `skip`: they stopped watching it. */
export interface ReplayMsg { t: "replay"; id: string; n: number; low: boolean }
export interface SkipMsg { t: "skip"; id: string; n: number }

export type FromRelay =
  | { t: "room"; code: string; seat: Player; key: string; names: [string, string] }
  | { t: "joined"; names: [string, string] }
  | { t: "names"; names: [string, string] }
  | { t: "catchup"; code: string; seat: Player; names: [string, string]; start: Start | null; last: ShotMsg | null; present: boolean }
  | ({ t: "start"; by: Player } & Start)
  | ShotMsg
  | AimMsg
  | ReplayMsg
  | SkipMsg
  | { t: "left" | "back" | "gone"; seat: Player }
  | { t: "reload" }
  | { t: "error"; message: string; over?: boolean }
  | { t: "pong" };

export type LinkStatus = "connecting" | "open" | "down";

interface Seat { code: string; seat: Player; key: string }
const SAVED = "pool.match";

export function savedSeat(): Seat | null {
  try { return JSON.parse(localStorage.getItem(SAVED) ?? "null"); } catch { return null; }
}
function saveSeat(s: Seat | null) {
  try { if (s) localStorage.setItem(SAVED, JSON.stringify(s)); else localStorage.removeItem(SAVED); } catch { /* private mode */ }
}

export class Link {
  seat: Seat | null = null;
  status: LinkStatus = "connecting";
  onMessage: (m: FromRelay) => void = () => {};
  onStatus: (s: LinkStatus) => void = () => {};
  private ws: WebSocket | null = null;
  /** What to say when (re)connected: host, join, or rejoin. */
  private hello: object;
  private retry = 0;
  private timer = 0;
  private lastPong = 0;
  private ended = false;

  private constructor(hello: object) {
    this.hello = hello;
    this.connect();
    const ping = window.setInterval(() => {
      if (this.ended) { clearInterval(ping); return; }
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      // No answer for a while: the connection is dead even if the browser hasn't noticed.
      if (performance.now() - this.lastPong > 25000) { this.ws.close(); return; }
      this.send({ t: "ping" });
    }, 10000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !this.ended && this.ws?.readyState !== WebSocket.OPEN) { this.retry = 0; this.reconnectSoon(0); }
    });
  }

  static host(name: string) { return new Link({ t: "host", name, v: __BUILD__ }); }
  static join(code: string, name: string) { return new Link({ t: "join", code, name, v: __BUILD__ }); }
  static rejoin(s: Seat) { const l = new Link({ t: "rejoin", ...s, v: __BUILD__ }); l.seat = s; return l; }

  send(m: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Leave the match for good. */
  bye() {
    this.send({ t: "bye" });
    this.end();
  }

  /** Stop without telling the relay (the match is over for us, or the page reloads). */
  end() {
    this.ended = true;
    clearTimeout(this.timer);
    saveSeat(null);
    this.ws?.close();
  }

  private connect() {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    this.ws = ws;
    this.setStatus("connecting");
    ws.onopen = () => {
      this.retry = 0;
      this.lastPong = performance.now();
      this.setStatus("open");
      ws.send(JSON.stringify(this.seat ? { t: "rejoin", ...this.seat, v: __BUILD__ } : this.hello));
    };
    ws.onmessage = (ev) => {
      let m: FromRelay;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.lastPong = performance.now();
      if (m.t === "pong") return;
      if (m.t === "room") { this.seat = { code: m.code, seat: m.seat, key: m.key }; saveSeat(this.seat); }
      if (m.t === "reload") { location.reload(); return; } // the seat is saved: the page rejoins with the new version
      if (m.t === "error") this.ended = true;
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus("down");
      if (!this.ended) this.reconnectSoon(Math.min(10000, 800 * 2 ** this.retry++));
    };
  }

  private reconnectSoon(ms: number) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { if (!this.ended && this.ws?.readyState !== WebSocket.OPEN) this.connect(); }, ms);
  }

  private setStatus(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }
}
