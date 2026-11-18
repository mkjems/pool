# Pool: the plan

A plan for an 8-ball pool game at `pool.mkjems.dk`, the sixth game on mkjems.dk. Written 16 November 2026.
The goal: a pool game that looks, sounds and plays better on the table than
[8ballpool.com/game](https://8ballpool.com/game), against the computer or against a friend, on desktop and phone.

**Current phase:** 7, friend matches: working locally (17 November), not yet tried by the user, not deployed.
See [Next session](#next-session). Phases 0-4 are playable: `npm run dev` offers the computer (easy, medium, hard),
two players on one device, and practice. Phases 2 and 3 still wait on your feel on a real phone.

## Next session

Handoff written 17 November 2026, end of the first working session. Start here.

**State.** Everything is committed on `main` (local only: no GitHub repository, nothing pushed, nothing deployed;
ask before creating the repository or pushing). 32 tests pass (`npm test`), V8 and JavaScriptCore agree
(`npm run engines`), `npm run selfplay` finishes every game. 60 fps at 2× on the user's Mac.

**Done since the handoff, to judge:** slimmer rails with metal caps (item 1 below). Rails 0.07 m of wood
(was 0.115); brushed-steel L caps on the corners and plates over the side pockets; round pocket openings cut
into the caps, with the cushion jaws pointing into them; round pearl sights; cushions a little brighter than the
bed. 60 fps at 2560 × 1300 × 2 (headless Chromium). The user: "the new table is great, the caps are great",
asked for the caps slightly darker (done: `metalMat` colour `0xbabec4`). Green cloth stays the default.
**18 November: the caps are gone again.** The user found their cut-outs uneven (they were cut from the rail's
outline, so each corner's two sides differed) and too fussy, and sent a drawing: a plain wooden frame, each hole
square across between the jaws with small rounded corners and round at the back, a leather lip where it cuts into
the wood. Done that way (`HOLES` in `src/render/table.ts`); all four corners and both sides now match.
Then (same day) the user asked for the leather to be flush with the cushion and allowed wider wood: the hole
now follows the cushion jaws to the backs of the cushions and goes straight on into the rail, so each jaw runs
into the lip's inner edge; rails 0.085 m of wood (was 0.07), so the side holes have their full depth. The
front edge of each hole is round, never straight (the user: "that is not how pool tables look").

**Asked for:**

1. ~~**Slimmer rails, with the details of a real table** (17 November).~~ Done, see above. The user sent a photo of a coin-op style
   table seen from straight above. What it shows, compared with ours:
   - The wood rails are much narrower: about a sixth of the cloth's width each side including the cushion,
     where ours (`RAIL_W` 0.115 m + `CUSHION_W` 0.05 m in `src/render/table.ts`) look massive. Try `RAIL_W`
     about 0.07 m; the camera fit in `src/render/scene.ts` follows from it.
   - **Metal pocket caps**: brushed silver/chrome L-shaped caps wrapping each corner of the rail, and a
     rectangular plate over each side pocket, with the black pocket opening cut into them. Ours has plain wood
     with a thin leather torus.
   - Pocket openings: black, rounded, with the cushion jaws showing as cloth-covered points into them.
   - Sights: small round white dots, several along each rail, instead of our diamonds.
   - Cushions read as a distinct strip of cloth, lit a little brighter than the bed, with a crisp nose line.
   - Cloth in the photo is tournament teal/blue-green. We have that as an option (Cloth button); green stays
     the default unless the user says otherwise.
   Keep it original (our own design, not a copy of any product), and keep the frame time: check 60 fps at 2×
   after the change (the measuring snippet is in the commit "Smooth: 60 fps" and below).
2. ~~The power bar overlaps the right cushion on a phone held upright.~~ Done 18 November: on phones the
   table fits the space the controls leave free, with air around it (see phase 2).

**What the user has said so far** (the game should keep these):
- Smoothness matters most. It was unplayable at 20 fps; keep 60 fps at 2×.
- No permanent helpers on the table: rings under the balls were rejected. Rings now show only with the
  number labels (Space / Numbers).
- Shadows must blend with the cloth, never black halos (now three lamp shadows, light and crisp, plus a
  gentle contact shadow).
- Aiming with the mouse must work near the window edges: power is the drag distance in any direction.
- Wants "air" around the table on big screens.
- Sounds: no table to record on; recordings the user finds replace the synthetic ones event by event
  (18 November: ball click, cue tip, pocket drop).
  No rolling sound: the noise-based one sounded like a sea breeze.
- Improvement ideas: try them and keep what works.
- Green cloth is the default (teal stays an option on the Cloth button). Slim plain wooden rails, no metal
  caps (18 November: "unnecessarily complicated"); pockets as in the user's drawing, with a leather lip.
- 18 November: friend matches work for the user in two browsers. **Get the basics working first, before new
  features** (no emotes, shot clock or other extras until the user asks).

**Sound, done 17 November, to judge by ear:** every sound rebuilt (`src/audio/sound.ts`), each event heard at
its own moment in the simulation, a volume button, room sound in the menu, vibration on Android. See phase 5.

**Pocket drops, done 17 November, to judge:** a potted ball now falls in 3D (`src/render/pocketfall.ts`), see
phase 6. The user found the old slide-and-shrink "very bad" and asked for realism.

**Pocket rejections, done 17 November** (the user loved the drops and asked for this): a ball hit too hard
into a pocket can be thrown back out by the back of the pocket. In the physics, so the rules and the computer
know. See phase 1.

**Friend matches, built 17 November evening (phase 7), to pick up first.** The user stopped for the night;
nothing is pushed or deployed. What works, tested: `server/relay.mjs` (rooms by 4-character code, seats with
rejoin keys, keeps the match's start and latest shot; in Vite dev and preview through a plugin in
`vite.config.ts`, in production through `server/server.mjs`, `npm run serve`), `src/net/net.ts` (reconnects,
rejoins, keep-alive, remembers the seat for reloads), and the online mode in `src/main.ts`: menu (name, "Play a
friend online", join by code), invite card (link, copy, share), live aiming, shots carrying the shooter's exact
position and game, re-rack and cue respawn seeded alike, "away" banner, leave, rematch. `tests/relay.test.ts`;
two-browser runs through the dev server (pair, 6 shots identical on both sides, reload mid-match, rematch,
dropout banner, leave) all passed. 18 November: the user played two browsers against each other, fine. Then
deploying (phase 8, ask first: GitHub repository, Dockerfile, the VPS).

**Bug hunt and browser tests, 18 November** (the user chose this from: bug hunt, phone play, putting it online,
polish). `npm run browser` (`tests/browser.mjs`): 13 scenarios with real mouse and touch input and two-player
matches through the relay. Bugs found and fixed, each with a scenario that fails without the fix: pressing
Rematch at the same moment on both sides put the two browsers on different matches (now the relay sends every
start to both, and a browser begins a match only on the relay's start); the delayed re-rack, practice re-rack
and game-over card fired after the player had gone to the menu (now cancelled). The rules engine read against
docs/Rules.md: no faults. The computer's break: 3% illegal, 5.5% scratches, 38% pot (200 racks).

**Next steps, in order unless the user says otherwise:** ask the user what's next among the basics left
(phone play, putting it online unlisted); the sounds are
"fine for now" (they will look for recordings later); then the cinematic break and replay (phase 6), friend matches
(phase 7), and the homepage (phase 8). Smaller open items: the loupe for touch aiming, the readability
measurement of stripes from many angles, browser tests with real mouse and touch events (the labels layer once
swallowed all input and the code-driven tests did not notice; done 18 November: `npm run browser`),
characters for the computer, and banks and
kicks in its planning.

**How to check the look and speed.** Run the dev server, open `http://localhost:5173/?test` in the Playwright
browser, and drive it through `window.__pool` (`start('cpu' | 'pass' | 'practice')`, `place([[id, x, y], ...])`,
`setGame({...})`, `aimAt(x, y)`, `screen(x, y)`, `shoot(power)`, `labels(true)`, `quality()`). Use real
`page.mouse` events when testing input. Frame time: count 60 `requestAnimationFrame` intervals and take the
median; the user's window is about 2560 × 1300 CSS pixels at device pixel ratio 2. If the Playwright
browser is locked by another session, a Node script importing `playwright` (it is in the npx cache) and
launching headless Chromium works too: WebGL renders, and the frame timing matched. Launch it with
`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, or it renders in software at seconds per frame. For
frame-by-frame looks at fast things: `__pool.timeScale(0)` freezes the game, `__pool.step(seconds)` advances
it, `__pool.snap(x, y, size)` renders and returns a crop as a PNG data URL (much faster than a screenshot),
`__pool.falls()` lists balls falling into pockets.

How to keep this plan up to date:

- Tick a step (`- [ ]` → `- [x]`) in the same commit as the work, once its tests pass.
- A phase is done when its **Exit** condition holds, not when its boxes are ticked. Then move **Current phase** on.
- Under a step, add a short indented line for anything learned that the next session needs.
- When reality changes the plan, change the plan.

## Is it possible?

Yes, for everything that happens on the table: visuals, physics, sound, the computer opponent and friend
matches. In those areas the reference game is beatable, because it is a simplified 2D game built for a huge
audience and for selling coins.

No, for what surrounds their table: millions of players to be matched with at any hour, tournaments, leagues,
a shop. That needs accounts, anti-cheat and a company. This plan does not try, and treats its absence as a
feature: no ads, no login, no coins.

What I can and can't judge myself: I can look at screenshots and run tests, so visuals, physics correctness and
network sync can be checked without you. I can't hear, and I can't feel how aiming works under a thumb. Sound
and touch controls need your ears and hands, and the phases are ordered so you can try both early.

## The reference game

What I saw on 16 November 2026 was the start screen only: a choice between "Login with Miniclip ID" and "Play as
Guest", an advertising banner on each side of the game, and a cookie banner. The rest of this section is from
general knowledge of the game, not checked in this session:

- A flat top-down table. Balls are drawn as rolling sprites, small on a phone.
- Simplified physics. Follow, draw and sidespin exist, but the finer effects of real pool do not (see
  [Physics](#physics)).
- An aim line, a power bar, a spin picker. Matches cost coins; cues are bought and upgraded.
- Playing a friend needs accounts on both sides.

We take the genre, which belongs to nobody: 8-ball and its rules. We don't take their name, look, art or
sounds. The game gets its own visual identity.

## Goals

1. **Looks real.** A 3D-rendered table under lamp light, balls that are real rolling spheres with reflections
   and soft shadows, 60 frames a second on a phone.
2. **Plays real.** Physics close to a real table: spin does what it does in real life.
3. **Feels good in the hand.** Precise aiming with a mouse and with a thumb.
4. **Sounds real.** Every collision sounds like its speed.
5. **Fills the screen.** As large as the window allows on desktop, upright on a phone held upright.
6. **Two ways to play:** against the computer, and against a friend through an invite link. No accounts.
7. **Instant.** Playing within two seconds of opening the link. No ads, no sign-up, like the other games.

Not goals: a public lobby with strangers, rankings, a currency, a shop, accounts.

## Decisions

Recommendations until you confirm them. Each can be changed in phase 0 at no cost.

- **Real 3D, seen from above.** The table and balls are a 3D scene (three.js on WebGL 2) viewed from straight
  above through a long lens, so it plays like a top-down game but the balls are spheres whose numbers and
  stripes truly roll, with real highlights and shadows. The camera can drop to a low angle for the break, the
  winning shot and replays. WebGL 2 rather than WebGPU: it runs on every phone, and a scene of 16 balls
  doesn't need more.
- **Our own physics, no physics library.** General engines (Rapier, cannon-es, Box2D) don't model sliding
  against rolling, cloth friction or cushions the way pool needs, and aren't identical across browsers. Pool
  physics is well described in the literature and is small: spheres on a plane.
- **The physics is deterministic.** The same position and the same shot give exactly the same result in every
  browser. One property pays for four features: friend matches send only the shot, replays are a few bytes, a
  shot can be shared as a link, and the computer plans with the very physics you play on.
- **A 7-foot table** (playing surface 1.98 × 0.99 m, balls 57.15 mm). On a 9-foot table a ball is about 14
  points wide on a phone; on a 7-foot table about 19, a third larger. Smaller tables are also more tactical:
  more clusters, more safety play. A 9-foot "match table" can be an option later.
- **TypeScript, Vite, modules.** Not one file like Frontlines: the physics has to run in the page, in a Web
  Worker (for the computer opponent) and in Node (for tests), so it must be a module of its own.
- **One small Node server**, serving the files and relaying friend matches over WebSocket, as in Frontlines
  (`~/Code/frontlines/server/relay.mjs`). Pairing by link and 4-character code: `pool.mkjems.dk/#KX7Q`.
- **Everything visual is generated or CC0.** Ball textures, cloth and table geometry are made in code, so they
  stay sharp at any size and need no artist. Wood and the reflected room can come from CC0 libraries (Poly Haven).
- **Menus and score display are plain HTML over the canvas**, not drawn in 3D: sharp text, accessible, easy
  to restyle.

## Telling stripes from solids

You noticed this is hard in the reference game. The causes, and what we do about each:

| Cause | Fix |
| --- | --- |
| Balls are small, so a stripe is a few pixels | Bigger balls (7-foot table, table fills the screen), rendered at the screen's full resolution with proper filtering so stripes don't shimmer or blur. |
| A striped ball seen with its band facing up looks almost fully coloured | Narrower band than on real balls (about 40% of the ball rather than 55%), so a clear white cap shows from every angle. Checked by rendering each ball from many angles and measuring the white share. |
| A solid's white number spot can pass for a stripe's white | Small number spots on solids; stripes get a bright, slightly warm white that reads differently from a highlight. |
| Similar colours: 3 red against 7 maroon, 4 purple against 8 black | A palette chosen for separation on screen, as television ball sets do (lighter 7, pinker 4). A colour-blind set as an option. |
| The real question is "which are mine?" | Your balls get a soft ring of light on the cloth while you aim (can be switched off). |
| | The ghost ball at the end of the aim line turns red when the first ball you would hit isn't yours. |
| | A tray per player shows the balls left as flat icons, always facing you. Hovering or tapping one lights up that ball on the table. |
| | Hold a key (Space) or a button and every ball shows a flat label: full colour for solids, white with a band for stripes. |

The first four make the balls themselves readable; the last four mean you never have to read them. Both, because
realism and readability pull in opposite directions on a small screen.

## How to be better

Ideas beyond "the same, but prettier". Marked **v1** if they belong in the first release.

Play:

- **Aim guides as a skill setting (v1).** Full: the object ball's path to the pocket and the cue ball's path
  after contact, spin included. Short: stubs, as in most pool games. Off. Each player picks their own, which
  also makes a fair match between a beginner and a good player.
- **Honest physics you can learn from (v1).** Draw, follow and sidespin behave as on a real table, and the
  guide shows the true result, so the game teaches real pool.
- **Retry any shot** in practice: take the shot back and try it again with more spin. No other feature
  teaches as much.
- **Coach.** After a miss, show what would have gone in. A hint button shows the shot the computer would play
  and why.
- **Shot of the day.** One position a day, the same for everyone: clear the table in as few shots as you can,
  share the result. Determinism makes it fair, and it needs no server.
- **Trick shots and drills:** set positions with a goal.
- **Handicaps for friends:** ball in hand after every miss, a guide for one player only, a head start.
- **Other games on the same table:** 9-ball first.

Show:

- **Instant replay** of the last shot, slow motion, from a low camera. Automatic on the winning shot.
- **Share a shot as a link.** The position and the shot fit in about a hundred characters; whoever opens the
  link sees the shot played.
- **Cinematic break:** the camera starts low behind the cue ball and rises as the rack explodes.
- **A table that ages:** chalk marks on the cloth, a faint break spot, left by play.
- **Your table:** cloth colour, wood, ball set. Free choices, or earned by play, never bought.

Comfort:

- **Portrait and landscape (v1).** Held upright, the table stands upright and fills the phone.
- **Pass-and-play (v1):** two players on one device.
- **Works offline** against the computer once loaded, installable on the home screen.
- **No clock** by default. A shot clock is an option for friends who want one.
- **Play by post:** a friend match you play one shot at a time over days. Needs the server to store games.
- **Left-handed layout, reduced motion, colour-blind balls.**

Opponents:

- **Computer players with character (v1 in simple form):** named opponents who differ in accuracy and in
  style (attacking, cautious, fond of bank shots), who visibly aim and feather the cue before shooting, and
  who miss the way people miss.
- **The computer never cheats (v1):** same physics, same inputs, no hidden knowledge.

## The table on screen

The playing surface is 2:1. The camera frames the table to fill the window:

| Screen | Table | Ball diameter |
| --- | --- | --- |
| Phone, landscape (844 × 390 points) | lying, height-limited | about 19 points |
| Phone, portrait (390 × 844) | standing, width-limited, controls below | about 19 points |
| Laptop (1440 × 900) | lying | about 37 points |
| Large monitor | lying, grows with the window | 50 and up |

- On small screens the camera crops in to cushions and pockets and lets the wooden rail run off-screen; on
  large screens the whole table and some floor show.
- Rendered at the device's pixel ratio. If frames slow down, resolution drops first, then effects.
- Score, ball trays and buttons sit over the rail or beside the table, never over the playing surface.

## Controls

A fingertip covers three balls, so nothing on a phone requires touching a ball.

- **Mouse:** the cue follows the pointer. Wheel or arrow keys turn the aim in fine steps. Press and drag away
  in any direction for power (the distance counts, not the direction: first tried along the cue's line, which
  gave no power when pulling toward yourself, and ran into the window edge; changed 17 November), release to
  shoot, back to the press point to cancel. Spin: click the cue-ball picture or use WASD.
- **Touch:** drag anywhere to turn the aim; the drag is relative, and slower dragging turns finer. A fine-tune
  strip along the edge. A power slider under the thumb: pull and release. A large spin picker opens on tap. A
  loupe shows the point of contact enlarged while aiming.
- **Ball in hand:** drag the cue ball; on touch it sits above the finger.
- **Calling the 8:** tap a pocket.

## Visuals

- **Balls:** spheres with a glossy clear coat reflecting the lamps and the room. Textures (colours, stripes,
  numbers) are drawn in code at load. Rotation comes from the physics, so spin is visible.
- **Shadows:** computed exactly in the cloth's shader from the ball positions (a sphere over a plane has a
  closed formula). Soft, sharp at every size, cheap on phones, no shadow maps.
- **Cloth:** fine weave, slight variation, pools of light from three lamps fading towards the rails.
- **Table:** wooden rails with inlaid sights, cloth-covered cushions, pockets with a leather lip. Geometry
  made in code.
- **Cue:** a 3D cue with its shadow, a stroke animation, a puff of chalk.
- **Finish:** filmic tone mapping, a little glow on highlights, a dark room around the table.
- **Quality levels** picked by measured frame time.

## Physics

A real pool ball is always in one of four states: sliding, rolling, spinning in place, or still. Most of what
makes pool pool comes from the sliding state and from friction between ball and cloth, ball and ball, ball and
cushion. What we model, and the effects that follow from it without being scripted:

| Modelled | What you get |
| --- | --- |
| Sliding and rolling friction, full 3D spin | Follow, draw and stop shots; a cue ball that curves after a cut shot; rolling balls leaving contact at about 30°, stunned ones at 90° |
| Friction between balls | Throw: the object ball pushed slightly off line by a cut or by sidespin; spin passed from ball to ball |
| Cushions with friction, speed-dependent bounce | Sidespin that widens or narrows a rebound; banks that shorten when hit hard |
| The cue tip striking off-centre | Spin from where you hit; miscues near the edge; squirt (the cue ball leaving slightly off the aim line with sidespin) |
| Pocket jaws as geometry | Balls that rattle in the jaws and hang on the lip |
| Later: a raised cue | Swerve, masse and jump shots |

Squirt and throw make aiming harder than in the reference game. The guide shows the true path with these
effects included, so they deepen the game without making it unfair.

How it's built:

- A fixed small time step (start at 1/500 s, to be measured), with the exact moment of each contact found
  inside a step, so the cut angle is right.
- One interface, `shoot(position, shot)`, giving a stream of positions, a list of events (ball hit ball,
  cushion, pocket) and the final position. The screen, the sounds, the rules, the computer opponent and the
  network all work from that.
- Starting values from published measurements (ball 170 g; sliding friction about 0.2; rolling resistance about
  0.01; ball-to-ball bounce about 0.95; cushion bounce 0.6–0.9 by speed; ball-to-ball friction 0.03–0.08),
  then tuned against known reference shots and by hand.

Rules for determinism, learned in Frontlines (`~/Code/frontlines/docs/multiplayer.md`):

- The simulation uses only `+ − × ÷` and `Math.sqrt`, never `Math.sin`, `cos`, `atan2`, `hypot`, `exp` or
  `pow`, which differ in the last bit between Chrome and Safari. Curves that need them (friction against
  speed) become tables or fractions.
- A shot is sent as numbers already computed (direction as x and y, not as an angle).
- How a ball is turned is for the eye only and kept out of the simulation, so drawing can use any maths.
- A test runs the same shots in Node (Chrome's engine) and in `jsc` (Safari's) and compares every bit.

## Rules

8-ball by the world-standardised rules (WPA) as the base, written out in `docs/Rules.md` in phase 3: legal
break, open table until the first called group, fouls give ball in hand, the 8 last into a called pocket.
Recommended simplification: only the 8 needs a called pocket. Full call-shot can be an option.

## Computer opponent

- **Finds shots:** for each of its balls and each pocket, the direct shot, then banks, kicks and combinations.
- **Tries them in its head:** each candidate is played many times on the real physics with small random
  errors in aim, speed and spin. That gives the chance of potting and the position afterwards.
- **Chooses** by chance of success times the quality of what's left, looking one shot ahead. With nothing
  good on, it plays safe.
- **Difficulty** is the size of its errors, how far it looks ahead and which shots it knows. No rubber-banding.
- Runs in a Web Worker so the picture never stutters.
- Computer against computer, thousands of games, is also the test that the rules never get stuck.

## Friend matches

- "Play a friend" gives a link and a code. The friend opens it and the game starts. An optional name, kept
  in the browser.
- **While aiming**, the cue's position is sent some 10–15 times a second, so you watch your friend aim live.
- **A shot** is one small message: direction, speed, spin, cue angle. Both browsers play it on their own
  physics. At rest they compare a checksum; if it ever differs, the shooter's position is taken and the
  mismatch logged, because it means a determinism bug.
- **Dropouts:** both browsers hold the whole game, so after a lost connection, a reload or a server restart
  they rejoin by the same code and carry on.
- **Versions:** both must run the same physics. The handshake compares versions and asks the older to reload.
- Rematch, a few emotes, and optionally a shot clock.
- The server holds rooms in memory, stores nothing and never runs a game. No cheating protection: these are
  matches between friends.

## Sound

- Recorded samples, several per event, chosen and pitched by impact: ball on ball from a tick to a crack,
  cushion, pocket drop and the ball running down the return, cue tip (soft, hard, miscue), chalk, the break.
- Volume and brightness follow the impulse the physics reports; position on the table pans left to right.
- A faint rolling sound for fast balls, a short room reverb, optional room tone. No music by default.
- **Synthetic first.** The first sounds are made in code with Web Audio (no table to record on, answered 17
  November). Real CC0 recordings that you find replace them later, event by event.
- Vibration on shots and pots where the phone allows it.
- You judge the sounds. I can wire, level and vary them, but not hear them.

## Code layout

```text
src/sim/      physics and rules. No DOM, deterministic. Runs in page, worker and Node.
src/ai/       the computer opponent (in a Web Worker)
src/render/   three.js scene, materials, shaders, cameras
src/input/    mouse, touch, keyboard
src/audio/    Web Audio
src/net/      friend matches, client side
src/ui/       menus and score display (HTML)
server/       static files and the WebSocket relay
tests/        physics, rules, determinism, bot matches, browser tests
docs/         this plan; later Rules.md, Physics.md
```

Dependencies: `three` in the browser, `ws` on the server. Budget: under 500 KB of code compressed; sounds
and the room reflection load after the table is on screen.

Tests, in the manner of Frontlines:

- **Physics:** reference shots with known answers (the 30° rule, the 90° rule, stop shot, energy never grows).
- **Determinism:** Node against `jsc`, bit for bit.
- **Rules:** every foul and every way a game ends.
- **Self-play:** computer against computer for thousands of games: no stuck games, sensible win rates per level.
- **Matches:** two bots through a local relay with lag, dropouts and reloads.
- **Browser:** Playwright loads the game, plays a shot, takes screenshots at phone and desktop sizes.

## Deployment and homepage

The usual recipe (`~/Code/infrastructure/docs/deploy-new-app.md`):

| Value | Pool |
| --- | --- |
| Domain | `pool.mkjems.dk` |
| GHCR image | `ghcr.io/mkjems/pool` |
| VPS directory | `/opt/pool` |
| Host port | `127.0.0.1:8087` (next free after 8086; check with `ss -ltnp`) |
| Branch | `main` |

- Infrastructure repository: DNS record, Caddy site block (Caddy passes WebSockets through as it is),
  `/opt/pool`, the access log, the route table.
- This repository: Dockerfile (Node 22, as Frontlines), `deploy.yml` that runs the tests first, the secrets.
- GoatCounter script in `index.html`.

Homepage (`~/Code/Homepage`), in phase 8:

- A new first entry in `src/projects.ts`: slug `pool`, genre "Pool", players "vs. computer or a friend".
- A screenshot at 1440 × 900, saved as `public/screens/pool.jpg` (1200 × 750).
- "Five" becomes "six" in `src/App.tsx`, in `index.html` (description and `og:description`) and in
  `README.md`; add the URL to `public/sitemap.xml`.

## Phases

Sizes are relative: S, M, L.

### Phase 0: decisions and two experiments (S)

- [x] Answer the [open questions](#open-questions).
- [x] `git init`, Vite, TypeScript, Vitest, a `CLAUDE.md` with the working rules. (GitHub repository `mkjems/pool`
      not created yet: ask first.)
- [ ] Experiment A: a bare 3D table with 16 balls, opened on your phone and your desktop. Measure frame
      rate. Judge ball size and whether stripes read.
      Grew into the practice table. Ball diameter on screen: about 30 px at 1440 × 900, 18 px on a phone
      held upright (390 × 844), 17 px held sideways. Still open: frame rate and readability on your phone.
- [x] Experiment B: one ball sliding into rolling and one collision, run in Node and in `jsc`, compared bit
      for bit.
      Went further: the whole physics, 40 breaks plus 160 random shots with spin, identical in V8 and
      JavaScriptCore (`npm run engines`). A break simulates in 2.5 ms on a laptop (`npm run bench`) and pots
      1.1 balls on average at 8.5 m/s, as real breaks do.

**Exit:** the decisions above are confirmed or changed, with numbers from both experiments.

### Phase 1: physics (L)

- [x] Ball motion: sliding, rolling, spinning, still.
      Integrated exactly per state between contacts; the step (1/400 s) only matters for finding contacts.
- [x] Ball against ball with friction. Ball against cushion. Pocket jaws and drops.
      Reverse english barely changes a cushion angle (friction saturates); running english works. Tune by feel.
      Pocket rejections (17 November): past the drop line (the near edge of `opening` in `src/sim/table.ts`)
      a ball is over the hole (`air` >= 0): no friction, falling ½ G air². Down once it has dropped LIP_DROP
      (half a radius, ~54 ms). Before that the back of the opening bounces it, with the cushion's contact
      model and POCKET_E 0.5 (the facing's grip takes out the topspin, which otherwise drove every rejected
      ball straight back in), and if it gets back over the lip it is on the cloth again. A "rattle" event;
      the rules count it as reaching a rail. Rolling balls straight in: corners throw them out at ~8 m/s, at
      20° from ~6 m/s; the shallower side pockets from ~4-5 m/s. Breaks pot 1.0 balls on average (was 1.1).
- [x] The cue strike: speed, spin, squirt, miscue.
- [x] `shoot()` with its event list. Reference-shot tests. Determinism test.
      As `Sim.strike()` and `Sim.step()`/`run()`. Tests: stun, 90° rule, throw, 30° rule, draw, follow,
      cushions, side spin, pots, energy, determinism (`tests/physics.test.ts`).
- [ ] ~~A plain 2D debug view to watch shots.~~ Not needed: the 3D table came early and shows the shots.

**Exit:** the reference shots pass, Node and `jsc` agree, a full break runs in a few milliseconds.

### Phase 2: the table on screen, and shooting (L)

- [x] 3D table, balls, cue, exact shadows, camera fitting any window, portrait and landscape.
- [ ] Mouse and touch controls, power, spin picker, loupe, aim guide.
      Done except the loupe. The guide plays the shot on the real physics.
      18 November, phones (the user asked for air around the table, room for the menus and power bar): each
      control says in CSS which screen edge it takes room from (`--hud-edge`); `fitView` in `src/main.ts`
      measures how far each reaches in, and the camera fits the table into the rest, centred there by a lens
      shift (`setViewOffset`, still looking straight down). Upright: buttons on one row at the top, score at the
      bottom, power bar and spin on the right. Sideways: buttons and score in a column on the left. Desktop
      unchanged. Then, at the user's suggestion: on an upright phone the power bar runs across (pull it from
      the left; `powerAcross`), and the spin button joins the score at the bottom, so the table has the full
      width again (a ball ~19 px on a 390 px screen) and nothing covers it. The user tried it on the phone and
      wants the bar **under the table**, just above the score (not across the top): done.
      Also fixed: the hidden ball-number labels were showing in the top-left corner (`display: flex` beat
      `hidden`).
- [ ] Readable balls: band width, palette, the measurement from many angles.
      Band and palette done (patterns drawn in the shader, sharp at any size); measurement not yet.
- [ ] Deploy to `pool.mkjems.dk`, not linked from anywhere, so it can be tried on real phones.

**Exit:** you can knock balls around on your phone and your desktop, and aiming feels precise on both.

### Phase 3: the game of 8-ball (M)

- [x] `docs/Rules.md`, the rules engine, its tests.
      `src/sim/rules.ts`, pure and deterministic like the physics, so the computer and the network can use it.
- [x] Score display, ball trays, "which are mine" markers, hold-to-label, messages for fouls.
      Rings under your balls are shown only with the labels: permanent rings were not liked (17 November).
      Labels: hold Space, or the Numbers button on touch. The ghost ball turns red for an illegal first hit.
- [x] Ball in hand, calling the 8, pass-and-play, rematch.
      Ball in hand: drag the cue ball (it sits above the finger on touch). The 8's pocket is called from
      the guide; tap a pocket to change it.

**Exit:** two people can play a whole correct game on one device.

### Phase 4: the computer opponent (M–L)

- [x] Shot search, Monte Carlo evaluation, safety play, in a worker.
      `src/ai/ai.ts`, `src/ai/worker.ts`. Straight pots from every reachable ghost-ball position, in several
      speeds and spins; each tried 5-9 times with the level's errors on the real physics and judged by the real
      rules (pot and position, or what it leaves the opponent). Ball in hand: straight-in spots behind the
      easiest pots. Safeties when fewer than 4 pots: thin and full hits on legal balls. Thinks ~0.1 s on average.
      Not yet: banks, kicks and combinations on purpose (only when they happen to come out of the trials).
- [ ] Difficulty levels and characters. The visible aiming.
      Levels and visible aiming done (it places the ball, sweeps the cue on, two practice strokes, backswing).
      Aim error: easy 0.9°, medium 0.37°, hard 0.14°. Characters not yet.
- [x] Self-play test and balance report.
      `npm run selfplay -- hard medium 20`. 17 November: medium beat easy 5-1, hard beat medium 5-3, easy
      games take ~28 shots, every game finished. Hard could be stronger: it looks only one shot ahead.

**Exit:** you lose to the top level and beat the lowest, and the self-play test finishes thousands of games.

### Phase 5: sound (M)

- [ ] Find or record samples. Wire events to sounds by impulse and position.
      Synthetic sounds are wired by impulse and position; samples later, if the user finds good ones.
      17 November, rebuilt: each impact is computed as a waveform from its physics, a contact pulse as long as
      the contact (Hertz for resin on resin, ~0.3 ms, shorter when harder; ~1 ms for the leather tip; ~3.5 ms
      for rubber) followed by the ringing of what was struck. The pocket plays the drop, then the ball running
      down a coin-op return and knocking into the balls already there.
      Timing: events are queued during a frame and each is scheduled at its own simulation time (`playHeard`
      in `src/main.ts`), 30 ms ahead, so a break's clatter isn't bunched into 16 ms frames.
      Levels: no compressor (its make-up gain treated clicks and thumps unequally); hits within 6 ms share one
      hit's loudness and are spread by up to 1.5 ms, as a real rack's are; a soft clipper above 0.6 catches
      the rest. Measured by rendering offline in Chromium (peaks: hard ball click 0.74, hard cue 0.54,
      hard cushion 0.41, pocket 0.33, a full break 0.84). Bodies of cushion and pocket sounds sit at 180-420 Hz
      so phone speakers play them.
      18 November, first recordings from the user: ball on ball (one), cue tip soft, medium and hard, the drop
      into a pocket. Originals in `sounds/source/`; `npm run sounds` (`sounds/build.mjs`) trims each to a
      millisecond before the hit, ends it where it sinks into the recording's background noise (with a fade),
      makes it mono and sets every peak to 0.89, into `src/audio/samples/` (`name-N.wav`, N the take: more
      takes are picked at random). WAV, not AAC: about 40 KB in all, exact timing (AAC adds ~46 ms of
      silence at the start) and every browser decodes it (checked in Chromium, WebKit and Firefox). Played
      by speed: loudness as the synthetic ones, the cue picks soft, medium or hard (under 2.2, 5.5 m/s, over),
      the single ball click is made duller for soft hits (low-pass 3 kHz × 7^v), pitch varies ±3-5%. Hardest
      hits peak where the synthetic ones did. Still synthetic: cushion, rattle, miscue. The synthetic run
      down the return (and its clack at the end) is off while the pocket recording plays: "very annoying"
      (18 November); it waits for a recording. The user likes the other synthetic sounds; the cushion made a little
      darker, then darker again ("still too bright"): contact 3.5 → 5 ms, the 1 kHz ring and the 3.9 kHz click
      removed, noise quieter and low-passed at 600 Hz instead of 2000. Then 20% quieter and pitched down to 0.85; its settings
      are now in `CUSHION` at the top of `src/audio/sound.ts`, for the user to tune by ear; the user settled on
      volume 0.7, pitch 0.75. Source of the recordings: "a free open licence sound library" (the user,
      18 November); which library and each sound's licence still to note before going online (credits
      needed if any are CC-BY).
- [x] Rolling sound, reverb, room tone, vibration, volume settings.
      Rolling: removed (17 November). Filtered noise (a low rumble and a cloth hiss following the balls' speed)
      "sounds like a sea breeze": the user asked for it off. A better try would need something other than
      noise, or a recording. Room: early reflections
      and a 0.9 s tail darker as it decays. Room sound (the air of a hall) is off by default, in the menu.
      Volume: the Sound button steps high, medium, low, off; M mutes and unmutes. Vibration on the strike and
      on pots after touch input (Android; iPhones have no vibration API).

**Exit:** you say it sounds like a pool table.

### Phase 6: look and polish (M–L)

- [ ] Materials, lighting, room reflection, finish. Quality levels.
      17 November: first version ran at 20 fps on a 2× screen (three area lights and shadows over 9 million
      pixels). Now one directional light, the lamp pools painted in the cloth shader, lamp reflections from the
      environment map only on the balls: 60 fps at 2×. Resolution drops by itself if frames get slow.
      Balls are drawn between the last two physics steps, so their motion is even at any frame rate.
      Rails and caps (17 November): flat metal seen from straight above mirrors the overhead light and goes
      white: its direct reflection is scaled down in the shader (`direct`). The caps were removed on 18
      November. The holes as drawn (`HOLES` in `src/render/table.ts`): a rectangle in each pocket's own frame,
      straight across between the jaws with small rounded corners, round at the back; bed and cups are cut by
      it, the wood by it grown by the leather lip (`RIM_W`). Its front edge is the physics capsule's round one
      (its middle on the drop line), between the jaws it follows them, behind the cushions it is as wide as the jaws end, and it is as
      deep as the capsule (at the corners that must reach past where the cushion backs meet, or the lip breaks
      in two). Behind the cushions the capsule is wider than the drawn hole; the fall's leaning facing under the
      rail covers that.
      Pocket drops (17 November): the physics hands over the ball's position, velocity and spin (new fields on
      the pocket event) and `Fall` plays it out in 3D at 2000 steps a second with gravity, restitution and
      friction with spin: the lip of the bed, the jaws, and the facing under the rail, which leans in over
      the hole so a fast ball riding up it is turned down (vertical, the topspin carried fast balls up and
      out onto the table). The ball darkens with depth below the cloth (ball shader). The openings' near edge
      is the physics' drop line, so a ball rolls on the pocket's cloth shelf and tips over the lip exactly
      when the physics lets it go. A shot ends only when every fall is over. Measured: slow balls tip in and
      vanish in ~0.28 s, medium ones tap the back and drop in ~0.2 s, fast ones are driven down in ~0.11 s.
- [ ] Cinematic break, replay of the last shot, the winning shot.
- [ ] Start screen, settings, the game's own name and identity.

**Exit:** side by side with the reference game in screenshots, ours is clearly the better looking.

### Phase 7: friend matches (M)

- [x] The relay, invite link and code, handshake with version check.
      `server/relay.mjs`. Versions: the build time (`__BUILD__`); the older browser reloads and rejoins.
- [x] Live aiming, shots, checksum, rejoin after a dropout.
      Each shot carries the shooter's exact balls and game before it, so the two can never drift apart; the
      watcher warns in the console if its own position differed (a determinism bug). Tested locally only.
- [ ] Bot matches through a rough connection. Emotes, optional shot clock.

**Exit:** you play a whole match against someone on another network, including a dropped connection.

### Phase 8: on the homepage (S)

- [ ] Screenshot, `projects.ts`, the texts, the sitemap. Share image and description for the game itself.

**Exit:** the game is the first entry on mkjems.dk.

### Phase 9: more, in the order you choose

Retry any shot, coach and hints, share a shot as a link, shot of the day, trick shots and drills, 9-ball,
table choices, play by post, masse and jump shots.

## Risks

- **Feel.** Physics can be correct and still feel wrong: cloth too fast, cushions dead. Tuning takes rounds of
  you playing and me adjusting, which is why a playable table comes in phase 2, not at the end.
- **Touch aiming.** The hardest design problem here. Phase 2 may need several attempts.
- **Sound sources.** Good CC0 recordings of pool balls are scarce. Recording a real table for half an hour
  may be the quickest route.
- **Determinism between browsers.** Solved once in Frontlines, but this simulation has more maths. Experiment
  B tests it before anything is built on it. The fallback (the shooter's result wins) keeps matches working
  even if a difference slips through.
- **The computer's thinking time on slow phones.** Fewer trials on slow devices; measured in phase 4.

## Answers

Given on 17 November 2026:

1. Name and address: **Pool**, at `pool.mkjems.dk`.
2. The room: **dark**, lamp-lit table. Cloth colour still to be picked from screenshots.
3. **Realism** wherever possible.
4. **Only the 8 is called.**
5. Sounds: no table to record on. **Synthetic sounds first**; free recordings from the net may replace them later.
6. Table: **7-foot**.
7. Improvement ideas: **try them and keep what works.** Nothing beyond the v1 marks is fixed.
