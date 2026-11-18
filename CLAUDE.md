# Pool

8-ball pool for mkjems.dk (`pool.mkjems.dk`): real physics, a 3D table seen from above, against the computer
or a friend. The plan, decisions and progress are in [docs/Plan.md](docs/Plan.md); keep it up to date as work
is done (tick steps, move **Current phase**, add short notes under steps).
**New session: read the plan's [Next session](docs/Plan.md#next-session) section first.**

## Working on the project

- `npm run dev`: the game on http://localhost:5173 (also on the local network, for trying it on a phone).
- `npm test`: physics reference shots (Vitest). `npm run engines`: the same 200 shots in V8 and in Safari's
  JavaScriptCore, compared bit for bit (macOS only). `npm run bench`: how fast a break simulates.
  Run all three after changing anything under `src/sim`. `npm run selfplay -- hard medium 20`: computer against
  computer (levels, games), for balance and to check every game finishes.
- `npm run browser`: the game in headless Chromium with real mouse and touch input: menus, shooting, ball in
  hand, calling the 8, fouls, the computer, friend matches (two players through the relay). About two minutes;
  `npm run browser -- touch` runs only scenarios whose name contains "touch". Run it after changing `src/main.ts`,
  `src/net/` or `server/`.
- `npm run serve`: build, then the production server (game and friend-match relay) on port 8080.
- `npm run build`: typecheck and build into `dist/`.
- `?test` in the address exposes `window.__pool` (rack, aim, shoot, place balls) for browser tests and screenshots.

## Layout

- `src/sim/`: physics and rules. No DOM. **Deterministic**: only `+ - * /` and `Math.sqrt`, never
  `Math.sin/cos/atan2/hypot/exp/pow` or `Math.random` (see `constants.ts`). Send directions as x/y, not angles.
- `src/render/`: three.js. Table built in simulation coordinates (x along, y across, z up) inside a group
  turned upright. Ball patterns are computed in the shader; lamp shadows of the balls are computed per pixel.
- `src/ai/`: the computer opponent, pure (runs in a Web Worker in the game, in Node for tests).
- `src/audio/`: synthetic sounds (Web Audio) until real recordings replace them.
- `src/main.ts`: the frame loop, input, menus, the game modes (computer, two players, practice, a friend
  online), scoreboard.
- `src/net/net.ts` and `server/relay.mjs`: friend matches. The relay also runs inside `npm run dev`.
- `src/sim/rules.ts`: 8-ball rules (pure, like the physics); written out for players in `docs/Rules.md`.

## Rules of thumb

- Looks and sound may use any maths and `Math.random`; the simulation may not.
- Readability of stripes and solids is a goal: keep the narrow stripe band and the separated palette.
- Commit locally; ask before pushing or creating the GitHub repository.
