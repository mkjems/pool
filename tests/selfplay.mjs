// Usage: npm run selfplay -- [levelA] [levelB] [games]
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
await build({ entryPoints: ["tests/selfplay-entry.ts"], bundle: true, format: "esm", platform: "node", outfile: "tests/out/selfplay.mjs", logLevel: "error" });
console.log(execFileSync("node", ["tests/out/selfplay.mjs", ...process.argv.slice(2)], { encoding: "utf8" }).trim());
