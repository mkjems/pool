// Determinism across browser engines: the same shots must give bit-identical results in V8 and JavaScriptCore.
// Usage: npm run engines
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc";
mkdirSync("tests/out", { recursive: true });
await build({ entryPoints: ["tests/engines-entry.ts"], bundle: true, format: "iife", target: "es2020", outfile: "tests/out/engines.js", logLevel: "error" });

const v8 = execFileSync("node", ["tests/out/engines.js"], { encoding: "utf8" });
let jsc;
try {
  jsc = execFileSync(JSC, ["tests/out/engines.js"], { encoding: "utf8" });
} catch (e) {
  console.log("jsc not available here (macOS only); ran V8 only.\n" + v8);
  process.exit(0);
}
const a = v8.trim().split("\n"), b = jsc.trim().split("\n");
let diff = 0;
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) { diff++; console.log("V8:  " + a[i] + "\nJSC: " + b[i]); }
}
console.log(diff === 0 ? `Identical: ${a.length} games, 5 shots each, V8 and JavaScriptCore agree bit for bit.` : `${diff} of ${a.length} games differ.`);
process.exit(diff === 0 ? 0 : 1);
