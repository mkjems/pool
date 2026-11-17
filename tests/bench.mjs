import { build } from "esbuild";
import { execFileSync } from "node:child_process";
await build({ entryPoints: ["tests/bench-entry.ts"], bundle: true, format: "esm", platform: "node", outfile: "tests/out/bench.mjs", logLevel: "error" });
console.log(execFileSync("node", ["tests/out/bench.mjs"], { encoding: "utf8" }).trim());
