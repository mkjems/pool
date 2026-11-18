// Browser tests: the game in a real (headless) Chromium, driven with real mouse and touch events where input
// matters, and through the ?test hook (window.__pool) to set up positions. Starts its own Vite server, with
// the friend-match relay in it.
//
//   npm run browser            all scenarios
//   npm run browser -- touch   only scenarios whose name contains "touch"

import { createServer } from "vite";
import { chromium } from "playwright";

const only = process.argv[2];
const GPU = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]; // without these: software WebGL, slow
const HEAD_X = -1.981 / 4;

const vite = await createServer({ server: { port: 5390, host: "127.0.0.1" }, logLevel: "error" });
await vite.listen();
const base = `${vite.resolvedUrls.local[0]}?test`;
const browser = await chromium.launch({ args: GPU });

let failed = 0;
const results = [];
function check(ok, what, detail = "") {
  if (!ok) throw new Error(`${what}${detail ? `: ${detail}` : ""}`);
}

/** A fresh page (its own storage, like another person's browser), with the game loaded. */
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !/WebSocket|GPU stall|GroupMarker/.test(m.text())) page.errors.push(m.text());
  });
  await page.goto(opts.url ?? base);
  await page.waitForFunction(() => window.__pool);
  return page;
}
const pool = (page, fn, arg) => page.evaluate(fn, arg);
const screen = (page, x, y) => pool(page, ([x, y]) => window.__pool.screen(x, y), [x, y]);
const waitState = (page, s, timeout = 20000) => page.waitForFunction((s) => window.__pool.state() === s, s, { timeout });
/** Until a shot has been played out and the table is still again. */
async function played(page, timeout = 30000) {
  await page.waitForFunction(() => window.__pool.state() !== "aim", null, { timeout: 5000 });
  await page.waitForFunction(() => ["aim", "over"].includes(window.__pool.state()), null, { timeout });
}
/** Touch through the browser's input pipeline (real touch events, pointerType "touch"). */
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  return {
    async tap(x, y) { await send("touchStart", x, y); await send("touchEnd"); },
    async drag(x0, y0, x1, y1, steps = 12) {
      await send("touchStart", x0, y0);
      for (let i = 1; i <= steps; i++) { await send("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(16); }
      await send("touchEnd");
    },
  };
}

async function scenario(name, fn) {
  if (only && !name.includes(only)) return;
  const pages = [];
  const t0 = Date.now();
  try {
    await fn(async (o) => { const p = await open(o); pages.push(p); return p; });
    const errs = pages.flatMap((p) => p.errors);
    check(errs.length === 0, "errors in the page", errs.join(" | "));
    results.push(`  ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failed++;
    results.push(`  FAIL  ${name}\n        ${String(e.message).split("\n")[0]}`);
  } finally {
    for (const p of pages) await p.context().close();
  }
  console.log(results[results.length - 1]);
}

// ------------------------------------------------------------------ scenarios

await scenario("menu buttons start each mode, and Menu comes back", async (open) => {
  const p = await open();
  await p.click("[data-mode=practice]");
  check(await p.isHidden("#menu"), "menu hidden in practice");
  check((await pool(p, () => window.__pool.state())) === "aim", "practice is ready to shoot");
  await p.click("#b-menu");
  check(await p.isVisible("#menu"), "Menu opens the menu");
  await p.click("[data-mode=cpu]");
  check((await p.textContent(".score .p[data-p='1'] .name")) === "Computer", "playing the computer shows its name");
});

await scenario("mouse: aim follows the pointer; press, drag, release shoots", async (open) => {
  const p = await open();
  await p.click("[data-mode=practice]");
  await pool(p, () => window.__pool.place([[0, -0.5, 0], [1, 0.3, 0.2]]));
  const t = await screen(p, 0.3, 0.2);
  await p.mouse.move(t.x, t.y, { steps: 5 });
  const a = await pool(p, () => window.__pool.aim());
  const want = { x: 0.8 / Math.hypot(0.8, 0.2), y: 0.2 / Math.hypot(0.8, 0.2) };
  check(Math.hypot(a.x - want.x, a.y - want.y) < 0.01, "aim points at the pointer", JSON.stringify(a));
  // Press on the aim point and drag: power is the distance, in any direction (here up and to the left, away
  // from the window's edge), and the aim stays put while dragging.
  await p.mouse.down();
  await p.mouse.move(t.x - 200, t.y - 160, { steps: 10 });
  const kept = await pool(p, () => window.__pool.aim());
  check(Math.hypot(kept.x - a.x, kept.y - a.y) < 1e-6, "the aim stays put while pulling back");
  const fill = await p.evaluate(() => parseFloat(document.querySelector("#power .fill").style.height));
  check(fill > 50, "dragging away from the window edge still gives power", `${fill}%`);
  await p.mouse.up();
  await played(p);
  const b1 = (await pool(p, () => window.__pool.balls()))[1];
  check(!b1.on || Math.hypot(b1.x - 0.3, b1.y - 0.2) > 0.05, "the shot hit ball 1");
});

await scenario("touch: a tap aims, the power bar shoots", async (open) => {
  const p = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await p.click("[data-mode=practice]");
  await pool(p, () => window.__pool.place([[0, -0.5, 0], [1, 0.4, -0.25]]));
  const t = await screen(p, 0.4, -0.25);
  const fingers = await touch(p);
  await fingers.tap(t.x, t.y);
  const a = await pool(p, () => window.__pool.aim());
  check(a.x > 0.9 && a.y < 0, "a tap aims at the tapped point", JSON.stringify(a));
  // On an upright phone the power bar runs across the top: pull it from the left.
  const bar = await p.locator("#power").boundingBox();
  check(bar.width > bar.height * 4 && bar.y < 160, "the power bar runs across the top", JSON.stringify(bar));
  const cdp = await p.context().newCDPSession(p);
  const at = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: bar.y + bar.height / 2 }] });
  await at("touchStart", bar.x + 4);
  for (let i = 1; i <= 10; i++) { await at("touchMove", bar.x + 4 + (bar.width * 0.6 * i) / 10); await p.waitForTimeout(16); }
  const fill = await p.evaluate(() => parseFloat(document.querySelector("#power .fill").style.width));
  check(fill > 50 && fill < 70, "the fill follows the finger", `${fill}%`);
  await at("touchEnd");
  await played(p);
  check((await pool(p, () => window.__pool.balls()))[0].x > -0.45, "the cue ball moved");
});

await scenario("ball in hand: drag the cue ball; behind the line on the break", async (open) => {
  const p = await open();
  await p.click("[data-mode=pass]"); // the break: ball in hand behind the head string
  const c = await pool(p, () => window.__pool.balls()[0]);
  const from = await screen(p, c.x, c.y), to = await screen(p, 0.2, 0.15);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await p.mouse.up();
  let now = await pool(p, () => window.__pool.balls()[0]);
  check(now.x <= HEAD_X + 1e-9 && Math.abs(now.y - 0.15) < 0.01, "kept behind the head string", JSON.stringify([now.x, now.y]));
  await pool(p, () => window.__pool.setGame({ breakShot: false, ballInHand: "anywhere" }));
  const from2 = await screen(p, now.x, now.y);
  await p.mouse.move(from2.x, from2.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 12 });
  await p.mouse.up();
  now = await pool(p, () => window.__pool.balls()[0]);
  check(Math.hypot(now.x - 0.2, now.y - 0.15) < 0.01, "after a foul it goes anywhere", JSON.stringify([now.x, now.y]));
});

await scenario("calling the 8 by tapping a pocket; potting it wins; Rematch", async (open) => {
  const p = await open();
  await p.click("[data-mode=pass]");
  // On the 8: 25 cm straight out from the top-right corner, the cue ball behind it.
  const P = { mx: 0.9905 - 0.0414, my: 0.49525 - 0.0414 };
  const u = Math.SQRT1_2;
  await pool(p, ([P, u]) => {
    window.__pool.place([[0, P.mx - u * 0.6, P.my - u * 0.6], [8, P.mx - u * 0.25, P.my - u * 0.25], [9, -0.6, -0.3]]);
    window.__pool.setGame({ groups: ["solids", "stripes"], breakShot: false, ballInHand: "none", turn: 0 });
    window.__pool.aimAt(P.mx - u * 0.25, P.my - u * 0.25);
  }, [P, u]);
  const pocket = await screen(p, 0.9905, 0.49525);
  await p.mouse.click(pocket.x, pocket.y);
  check((await pool(p, () => window.__pool.game().called)) === 3, "the tapped pocket is called");
  await pool(p, () => window.__pool.shoot(0.35));
  await played(p);
  await p.waitForSelector("#over:not([hidden])", { timeout: 5000 });
  check((await p.textContent("#over-title")) === "Player 1 wins", "the 8 in the called pocket wins", await p.textContent("#over-title"));
  await p.click("#b-rematch");
  const g = await pool(p, () => window.__pool.game());
  check(g.breakShot && g.winner === null && (await p.isHidden("#over")), "Rematch starts a new game");
  check(g.turn === 1, "the other player breaks the rematch");
});

await scenario("a foul gives the other player ball in hand", async (open) => {
  const p = await open();
  await p.click("[data-mode=pass]");
  await pool(p, () => {
    window.__pool.place([[0, -0.5, 0], [1, 0.5, 0.3], [9, 0.5, -0.3]]);
    window.__pool.setGame({ groups: ["solids", "stripes"], breakShot: false, ballInHand: "none", turn: 0 });
    window.__pool.aimAt(-0.5, 0.45); // straight at the side cushion: no ball hit
    window.__pool.shoot(0.2);
  });
  await played(p);
  const g = await pool(p, () => window.__pool.game());
  check(g.turn === 1 && g.ballInHand === "anywhere", "no ball hit: ball in hand for the other player", JSON.stringify(g));
});

await scenario("the computer plays its turn", async (open) => {
  const p = await open();
  await p.click("[data-mode=cpu]");
  await pool(p, () => window.__pool.start("cpu", 1)); // the computer breaks
  await played(p, 40000);
  const g = await pool(p, () => window.__pool.game());
  const said = await p.textContent("#toast");
  check(!g.breakShot || /Illegal break/.test(said), "the computer broke", `${JSON.stringify(g)} "${said}"`);
});

/** Two people: A hosts, B joins by typing the code. */
async function pair(open) {
  const a = await open(), b = await open();
  await a.fill("#name", "Anna");
  await a.press("#name", "Enter");
  await a.click("#b-online");
  await a.waitForFunction(() => document.querySelector("#invite-code").textContent.length === 4);
  const code = await a.textContent("#invite-code");
  await b.fill("#join-code", code.toLowerCase());
  await b.click("#b-join");
  for (const p of [a, b]) await p.waitForFunction(() => window.__pool.online().match && window.__pool.state() === "aim");
  return { a, b, code };
}
const snapshot = (p) => pool(p, () => ({ ...window.__pool.online(), turn: window.__pool.game().turn, balls: window.__pool.balls().map((b) => [b.on, b.x, b.y]) }));
async function agree(a, b, what) {
  // Still, and no shot of the friend's waiting to be played (a reloaded page replays the latest one).
  const settled = () => ["aim", "over"].includes(window.__pool.state()) && window.__pool.online().queued === 0;
  for (let k = 0; k < 2; k++) {
    for (const p of [a, b]) await p.waitForFunction(settled, null, { timeout: 30000 });
    await a.waitForTimeout(250);
  }
  const x = await snapshot(a), y = await snapshot(b);
  check(JSON.stringify(x.balls) === JSON.stringify(y.balls) && x.turn === y.turn && x.shotNo === y.shotNo, what, `shots ${x.shotNo}/${y.shotNo}`);
}

await scenario("friend match: join by code, same shots, live aim, reload, rematch, leave", async (open) => {
  const { a, b } = await pair(open);
  check((await snapshot(b)).names[0] === "Anna", "the guest sees the host's name");
  for (let i = 0; i < 4; i++) {
    const s = await snapshot(a);
    const [shooter, watcher] = s.turn === s.seat ? [a, b] : [b, a];
    await pool(shooter, (i) => {
      const bs = window.__pool.balls().filter((x) => x.on && x.id !== 0 && x.id !== 8);
      window.__pool.aimAt(bs[i % bs.length].x, bs[i % bs.length].y);
    }, i);
    await watcher.waitForTimeout(400);
    const [x, y] = [await pool(shooter, () => window.__pool.aim()), await pool(watcher, () => window.__pool.aim())];
    check(Math.hypot(x.x - y.x, x.y - y.y) < 0.02, "the watcher's cue follows the shooter's");
    await pool(shooter, (i) => window.__pool.shoot(i === 0 ? 1 : 0.5), i);
    await agree(a, b, `the same position after shot ${i + 1}`);
    if (i === 1) {
      await b.reload();
      await b.waitForFunction(() => window.__pool?.online().match && window.__pool.state() === "aim", null, { timeout: 20000 });
      await agree(a, b, "the same position after a reload");
    }
  }
  const m = (await snapshot(a)).match.id;
  await b.evaluate(() => document.querySelector("#b-rematch").click());
  await a.waitForFunction((m) => window.__pool.online().match.id !== m, m);
  await agree(a, b, "the same rack after a rematch");
  b.on("dialog", (d) => d.accept());
  await b.click("#b-menu");
  await a.waitForSelector("#over:not([hidden])", { timeout: 10000 });
  check((await a.textContent("#over-title")) === "Anna's friend left" || (await a.textContent("#over-title")).endsWith("left"), "the other is told");
});

await scenario("friend match: a dropped connection shows a banner until the friend is back", async (open) => {
  const { a, b } = await pair(open);
  await b.context().setOffline(true);
  await b.reload().catch(() => {});
  await a.waitForSelector("#net:not([hidden])", { timeout: 15000 });
  await b.context().setOffline(false);
  await b.reload();
  await a.waitForSelector("#net", { state: "hidden", timeout: 15000 });
});

await scenario("friend match: cancelling while waiting closes the room", async (open) => {
  const a = await open();
  await a.click("#b-online");
  await a.waitForFunction(() => document.querySelector("#invite-code").textContent.length === 4);
  const code = await a.textContent("#invite-code");
  await a.click("#b-invite-cancel");
  check(await a.isVisible("#menu"), "Cancel goes back to the menu");
  const b = await open();
  await b.fill("#join-code", code);
  await b.click("#b-join");
  await b.waitForFunction(() => /over|No game/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 });
  check(await b.isVisible("#menu"), "the friend is told the game is gone");
  await a.waitForTimeout(500);
  check((await pool(a, () => window.__pool.state())) === "menu", "the host isn't pulled into a match");
});

await scenario("friend match: both press Rematch at once and still play the same match", async (open) => {
  const { a, b } = await pair(open);
  const m = (await snapshot(a)).match.id;
  await Promise.all([a, b].map((p) => p.evaluate(() => document.querySelector("#b-rematch").click())));
  for (const p of [a, b]) await p.waitForFunction((m) => window.__pool.online().match.id !== m, m);
  await a.waitForTimeout(1000); // let both starts arrive
  const [x, y] = [await snapshot(a), await snapshot(b)];
  check(x.match.id === y.match.id, "both on the same match", `${x.match.id} / ${y.match.id}`);
  await agree(a, b, "the same rack");
});

await scenario("the menu stays open when opened just after clearing the table", async (open) => {
  const p = await open();
  await p.click("[data-mode=practice]");
  const u = Math.SQRT1_2, P = { x: 0.9905 - 0.0414, y: 0.49525 - 0.0414 };
  await pool(p, ([P, u]) => {
    window.__pool.place([[0, P.x - u * 0.5, P.y - u * 0.5], [1, P.x - u * 0.2, P.y - u * 0.2]]);
    window.__pool.aimAt(P.x - u * 0.2, P.y - u * 0.2);
    window.__pool.shoot(0.35);
  }, [P, u]);
  await p.waitForFunction(() => document.querySelector("#toast").textContent === "Table cleared!", null, { timeout: 15000 });
  await p.click("#b-menu");
  await p.waitForTimeout(2500); // past the practice table's automatic new rack
  check(await p.isVisible("#menu"), "the menu is still open");
});

await scenario("on phones, nothing covers the table", async (open) => {
  for (const [w, h] of [[390, 844], [375, 667], [844, 390], [667, 375]]) {
    const p = await open({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    await p.click("[data-mode=cpu]"); // the score shows too
    const X = 1.981 / 2 + 0.12, Y = 0.9905 / 2 + 0.12; // the rails' outer edges
    const corners = await Promise.all([[-X, -Y], [X, -Y], [X, Y], [-X, Y]].map(([x, y]) => screen(p, x, y)));
    const t = { l: Math.min(...corners.map((c) => c.x)), r: Math.max(...corners.map((c) => c.x)), t: Math.min(...corners.map((c) => c.y)), b: Math.max(...corners.map((c) => c.y)) };
    check(t.l >= 0 && t.t >= 0 && t.r <= w && t.b <= h, `the whole table is on a ${w}×${h} screen`, JSON.stringify(t));
    for (const sel of [".bar nav", ".brand", ".score", "#power", "#spin"]) {
      const r = await p.locator(sel).boundingBox();
      if (!r) continue;
      const overlap = r.x < t.r && r.x + r.width > t.l && r.y < t.b && r.y + r.height > t.t;
      check(!overlap, `${sel} stays off the table on a ${w}×${h} screen`, JSON.stringify(r));
    }
    await p.context().close();
  }
});

await scenario("menus fit or scroll on a phone held sideways", async (open) => {
  const p = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  await p.locator("#b-room").scrollIntoViewIfNeeded();
  const r = await p.locator("#b-room").boundingBox();
  check(r && r.y >= 0 && r.y + r.height <= 390, "the last menu button can be reached");
  await p.locator("#b-online").click();
  check(await p.isVisible("#invite"), "and it works");
});

console.log(failed ? `\n${failed} failed` : "\nAll passed");
await browser.close();
await vite.close();
process.exit(failed ? 1 : 0);
