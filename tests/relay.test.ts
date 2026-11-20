// The friend-match relay (server/relay.mjs): pairing, passing on, catching up after a dropout, versions.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error: plain JavaScript module
import { start } from "../server/server.mjs";

type Msg = Record<string, unknown> & { t: string };
let server: { port: number; close(): Promise<void> };

beforeAll(async () => { server = await start({ port: 0 }); });
afterAll(async () => { await server.close(); });

/** A test client: sends JSON, and waits for the next message of a type. */
async function client() {
  const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
  const inbox: Msg[] = [];
  const waiters: Array<() => void> = [];
  ws.on("message", (d) => { inbox.push(JSON.parse(String(d))); waiters.splice(0).forEach((w) => w()); });
  await new Promise((ok) => ws.on("open", ok));
  return {
    send: (m: Msg) => ws.send(JSON.stringify(m)),
    async next(t: string, ms = 2000): Promise<Msg> {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return inbox.splice(i, 1)[0];
        if (Date.now() > end) throw new Error(`no ${t}; got ${JSON.stringify(inbox)}`);
        await new Promise<void>((ok) => { waiters.push(ok); setTimeout(ok, 50); });
      }
    },
    has: (t: string) => inbox.some((m) => m.t === t),
    close: () => new Promise<void>((ok) => { ws.on("close", () => ok()); ws.close(); }),
  };
}

async function pair(v = 1) {
  const a = await client();
  a.send({ t: "host", name: "Anna", v });
  const room = await a.next("room");
  const b = await client();
  b.send({ t: "join", code: String(room.code).toLowerCase(), name: "Bo", v });
  const joined = await b.next("room");
  await a.next("joined");
  return { a, b, code: String(room.code), keys: [room.key, joined.key] as string[] };
}

describe("friend-match relay", () => {
  it("pairs by code and passes the match on", async () => {
    const { a, b, code } = await pair();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    a.send({ t: "start", id: "m1", seed: 42, breaker: 0 });
    expect(await b.next("start")).toMatchObject({ id: "m1", seed: 42, breaker: 0, by: 0 });
    expect(await a.next("start")).toMatchObject({ id: "m1", by: 0 }); // the sender gets it too: both begin on it
    a.send({ t: "aim", x: 1, y: 0 });
    expect(await b.next("aim")).toMatchObject({ x: 1 });
    a.send({ t: "replay", id: "m1", n: 0, low: true });
    expect(await b.next("replay")).toMatchObject({ n: 0, low: true });
    a.send({ t: "skip", id: "m1", n: 0 });
    expect(await b.next("skip")).toMatchObject({ n: 0 });
    b.send({ t: "shot", id: "m1", n: 1, shot: { speed: 3 } });
    expect(await a.next("shot")).toMatchObject({ n: 1 });
    b.send({ t: "name", name: "  Bodil  " });
    expect((await a.next("names")).names).toEqual(["Anna", "Bodil"]);
    await a.close(); await b.close();
  });

  it("turns away unknown codes and a third player", async () => {
    const c = await client();
    c.send({ t: "join", code: "ZZZZ", v: 1 });
    expect((await c.next("error")).message).toMatch(/No game/);
    const { a, b, code } = await pair();
    const d = await client();
    d.send({ t: "join", code, v: 1 });
    expect((await d.next("error")).message).toMatch(/two players/);
    await Promise.all([a.close(), b.close(), c.close(), d.close()]);
  });

  it("lets a player who dropped out rejoin and catch up", async () => {
    const { a, b, code, keys } = await pair();
    a.send({ t: "start", id: "m2", seed: 7, breaker: 1 });
    await b.next("start");
    b.send({ t: "shot", id: "m2", n: 1, shot: { speed: 8 } });
    await a.next("shot");
    await b.close();
    expect((await a.next("left")).seat).toBe(1);
    // Meanwhile a shot from an older match is ignored, and a new one is kept for the absent player.
    a.send({ t: "shot", id: "old", n: 9 });
    a.send({ t: "shot", id: "m2", n: 2, shot: { speed: 2 } });
    const b2 = await client();
    b2.send({ t: "rejoin", code, seat: 1, key: keys[1], v: 1 });
    const c = await b2.next("catchup");
    expect(c).toMatchObject({ seat: 1, names: ["Anna", "Bo"], start: { id: "m2", seed: 7, breaker: 1 }, present: true });
    expect(c.last).toMatchObject({ id: "m2", n: 2 });
    expect((await a.next("back")).seat).toBe(1);
    // A wrong key gets nothing.
    const x = await client();
    x.send({ t: "rejoin", code, seat: 0, key: "nope", v: 1 });
    expect(await x.next("error")).toMatchObject({ over: true });
    await Promise.all([a.close(), b2.close(), x.close()]);
  });

  it("makes the older version reload", async () => {
    const a = await client();
    a.send({ t: "host", v: 100 });
    const { code } = await a.next("room");
    const old = await client();
    old.send({ t: "join", code, v: 99 });
    await old.next("reload");
    const newer = await client();
    newer.send({ t: "join", code, v: 101 });
    await a.next("reload");
    await newer.next("room");
    await Promise.all([a.close(), old.close(), newer.close()]);
  });

  it("tells the other player when one leaves for good", async () => {
    const { a, b, code, keys } = await pair();
    b.send({ t: "bye" });
    expect((await a.next("gone")).seat).toBe(1);
    const b2 = await client();
    b2.send({ t: "rejoin", code, seat: 1, key: keys[1], v: 1 });
    expect(await b2.next("error")).toMatchObject({ over: true });
    await Promise.all([a.close(), b.close(), b2.close()]);
  });
});
