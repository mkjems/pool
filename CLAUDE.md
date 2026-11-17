# Pool

8-ball pool for mkjems.dk (`pool.mkjems.dk`): real physics, a 3D table seen from above, against the computer
or a friend. The plan, decisions and progress are in [docs/Plan.md](docs/Plan.md); keep it up to date as work
is done (tick steps, move **Current phase**, add short notes under steps).

## Working on the project

- `npm run dev`: the game on http://localhost:5173 (also on the local network, for trying it on a phone).
- `npm test`: physics reference shots (Vitest). `npm run engines`: the same 200 shots in V8 and in Safari's
  JavaScriptCore, compared bit for bit (macOS only). `npm run bench`: how fast a break simulates.
  Run all three after changing anything under `src/sim`.
- `npm run build`: typecheck and build into `dist/`.
- `?test` in the address exposes `window.__pool` (rack, aim, shoot, place balls) for browser tests and screenshots.

## Layout

- `src/sim/`: physics (and later rules). No DOM. **Deterministic**: only `+ - * /` and `Math.sqrt`, never
  `Math.sin/cos/atan2/hypot/exp/pow` or `Math.random` (see `constants.ts`). Send directions as x/y, not angles.
- `src/render/`: three.js. Table built in simulation coordinates (x along, y across, z up) inside a group
  turned upright. Ball patterns are computed in the shader; lamp shadows of the balls are computed per pixel.
- `src/audio/`: synthetic sounds (Web Audio) until real recordings replace them.
- `src/main.ts`: the frame loop, input and the practice table.

## Rules of thumb

- Looks and sound may use any maths and `Math.random`; the simulation may not.
- Readability of stripes and solids is a goal: keep the narrow stripe band and the separated palette.
- Commit locally; ask before pushing or creating the GitHub repository.
