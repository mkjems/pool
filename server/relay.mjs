// The relay for friend matches (docs/Plan.md, Friend matches). Both browsers hold the whole game and play every
// shot on their own physics; the relay only pairs them by a code and passes messages between them. It keeps a
// room's start and its latest shot, so that a player who reloads or drops out can rejoin and catch up. It never
// runs a game, stores nothing on disk, and forgets rooms nobody has used for half an hour.
//
//   attachRelay(httpServer)   adds the relay on /ws to a Node HTTP server (the game's server, or Vite in dev)
//
// A room: code, seats[2] (socket, or null while away), keys[2] (to rejoin), names[2], v (the game's version),
// start (the current match: {id, seed, breaker}), last (its latest shot), seen (last activity).
//
// Messages are JSON, { t: type, ... }:
//   from a player  host {name, v} · join {code, name, v} · rejoin {code, seat, key, v} · name {name} · bye
//                  start {id, seed, breaker} · shot {id, n, ...} · aim {...} (passed on, not kept) · ping
//   to a player    room {code, seat, key, names} · joined {names} · names {names} · catchup {code, seat, names,
//                  start, last} · start/shot/aim (the other's) · left {seat} · back {seat} · gone {seat} (left
//                  for good) · reload (the other runs a newer version) · error {message} · pong

import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, so a code can be read aloud
const IDLE_MS = 30 * 60 * 1000;
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 20);

export function attachRelay(server, { delay = 0 } = {}) {
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  // Only /ws is ours: other upgrades (Vite's hot reload) are left alone.
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://x").pathname !== "/ws") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Tests can delay every message, keeping each socket's messages in order, as on a real connection.
  const send = (ws, msg) => {
    if (!ws || ws.readyState !== 1) return;
    if (!delay) return ws.send(JSON.stringify(msg));
    const at = Math.max(ws.due || 0, Date.now() + delay);
    ws.due = at;
    setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }, at - Date.now());
  };
  const newCode = () => {
    for (;;) {
      const c = [...randomBytes(4)].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
      if (!rooms.has(c)) return c;
    }
  };
  const key = () => randomBytes(8).toString("hex");

  wss.on("connection", (ws) => {
    let room = null, seat = -1;
    const other = () => room && room.seats[1 - seat];
    /** Versions differ: the older side reloads (it comes back with the newer code and rejoins). */
    const versionOk = (r, v) => {
      if (v === r.v) return true;
      if (v < r.v) { send(ws, { t: "reload" }); return false; }
      r.v = v;
      for (const s of r.seats) send(s, { t: "reload" });
      return true;
    };

    ws.on("message", (data) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (!m || typeof m.t !== "string") return;
      if (room) room.seen = Date.now();

      if (m.t === "ping") send(ws, { t: "pong" });
      else if (m.t === "host" && !room) {
        const code = newCode();
        room = { code, seats: [ws, null], keys: [key(), key()], names: [clean(m.name), ""], v: Number(m.v) || 0, guest: false, start: null, last: null, seen: Date.now() };
        rooms.set(code, room); seat = 0;
        send(ws, { t: "room", code, seat, key: room.keys[0], names: room.names });
      } else if (m.t === "join" && !room) {
        const r = rooms.get(String(m.code ?? "").toUpperCase());
        if (!r) return send(ws, { t: "error", message: "No game with that code. Ask your friend for a new link." });
        if (r.closed) return send(ws, { t: "error", message: "That game is over. Ask your friend for a new link." });
        if (r.guest) return send(ws, { t: "error", message: "That game already has two players." });
        if (!versionOk(r, Number(m.v) || 0)) return;
        room = r; seat = 1; r.guest = true; r.seats[1] = ws; r.names[1] = clean(m.name);
        send(ws, { t: "room", code: r.code, seat, key: r.keys[1], names: r.names });
        send(r.seats[0], { t: "joined", names: r.names });
      } else if (m.t === "rejoin" && !room) {
        const r = rooms.get(String(m.code ?? "").toUpperCase()), s = m.seat === 1 ? 1 : 0;
        if (!r || r.keys[s] !== m.key) return send(ws, { t: "error", message: "That game is over.", over: true });
        if (!versionOk(r, Number(m.v) || 0)) return;
        if (r.seats[s] && r.seats[s] !== ws) r.seats[s].close();
        room = r; seat = s; r.seats[s] = ws;
        send(ws, { t: "catchup", code: r.code, seat, names: r.names, start: r.start, last: r.last, present: !!r.seats[1 - s] });
        send(r.seats[1 - s], { t: "back", seat });
      } else if (!room) {
        return;
      } else if (m.t === "name") {
        room.names[seat] = clean(m.name);
        for (const s of room.seats) send(s, { t: "names", names: room.names });
      } else if (m.t === "start") {
        room.start = { id: String(m.id), seed: Number(m.seed) | 0, breaker: m.breaker === 1 ? 1 : 0 };
        room.last = null;
        send(other(), { t: "start", ...room.start });
      } else if (m.t === "shot") {
        if (!room.start || m.id !== room.start.id) return; // a late shot from an earlier match
        room.last = m;
        send(other(), m);
      } else if (m.t === "aim") {
        send(other(), m);
      } else if (m.t === "bye") {
        room.seats[seat] = null;
        room.keys[seat] = key(); // the seat can't be taken back
        room.closed = true;
        send(other(), { t: "gone", seat });
        if (!room.seats.some(Boolean)) rooms.delete(room.code);
        room = null;
      }
    });

    ws.on("close", () => {
      if (!room || room.seats[seat] !== ws) return;
      room.seats[seat] = null;
      send(other(), { t: "left", seat });
    });
  });

  // Rooms nobody has used for half an hour are forgotten.
  const sweep = setInterval(() => {
    for (const [code, r] of rooms) if (Date.now() - r.seen > IDLE_MS && !r.seats.some(Boolean)) rooms.delete(code);
  }, 60 * 1000);
  sweep.unref();

  return {
    rooms,
    close() { clearInterval(sweep); for (const c of wss.clients) c.terminate(); wss.close(); },
  };
}
