// Runs the computer opponent off the main thread, so the table keeps moving while it thinks.
import { decide, type Level } from "./ai";
import type { Ball } from "../sim/physics";
import type { GameState } from "../sim/rules";

interface Ask { id: number; state: GameState; balls: Ball[]; level: Level; seed: number }

self.onmessage = (e: MessageEvent<Ask>) => {
  const { id, state, balls, level, seed } = e.data;
  postMessage({ id, decision: decide(state, balls, level, seed) });
};
