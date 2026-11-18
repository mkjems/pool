// Prepares the recorded sounds for the game: `npm run sounds`.
//
// Reads the original recordings in sounds/source/ and writes the clips the game plays to src/audio/samples/:
// mono, starting a millisecond before the hit, ending where the sound has sunk into the recording's own background
// noise (with a fade, so the noise doesn't stop with a click), and all with the same peak. How loud each one plays
// is decided in the game by the impact speed (src/audio/sound.ts), not here.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("./source/", import.meta.url));
const OUT = fileURLToPath(new URL("../src/audio/samples/", import.meta.url));

/**
 * out: the game's name for the clip. from: where to start looking for the hit (s), to skip other sounds before it.
 * max: longest the clip may be (s).
 */
const CLIPS = [
  { src: "ball-against-ball-clack.wav", out: "ball-1", max: 0.25 },
  { src: "cue-tip-hitting-cue-ball-soft.wav", out: "cue-soft-1", max: 0.12 },
  { src: "cue-tip-hitting-cue-ball-medium.wav", out: "cue-medium-1", max: 0.1 },
  { src: "cue-tip-hitting-cue-ball-hard.wav", out: "cue-hard-1", max: 0.09 },
  // The recording has a small knock 0.12 s in and other sounds after 0.9 s; the drop itself is at 0.24 s.
  { src: "ball-dropping-into-the-pocket.wav", out: "pocket-1", from: 0.2, max: 0.45 },
];

const PEAK = 0.89; // -1 dB

function readWav(path) {
  const b = readFileSync(path);
  let o = 12, fmt, data;
  while (o < b.length - 8) {
    const id = b.toString("ascii", o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { format: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") data = b.subarray(o + 8, o + 8 + n);
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error(`${path}: not a WAV file`);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.ch));
  const read = (i) => {
    if (fmt.format === 3 && fmt.bits === 32) return data.readFloatLE(i);
    if (fmt.bits === 16) return data.readInt16LE(i) / 32768;
    if (fmt.bits === 24) return data.readIntLE(i, 3) / 8388608;
    if (fmt.bits === 32) return data.readInt32LE(i) / 2147483648;
    if (fmt.bits === 8) return (data[i] - 128) / 128;
    throw new Error(`${path}: ${fmt.bits}-bit samples not supported`);
  };
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += read((i * fmt.ch + c) * bytes);
    mono[i] = s / fmt.ch;
  }
  return { sr: fmt.sr, x: mono };
}

function writeWav(path, sr, x) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(path, b);
}

const db = (v) => (20 * Math.log10(v + 1e-12)).toFixed(1);

mkdirSync(OUT, { recursive: true });
for (const c of CLIPS) {
  const { sr, x } = readWav(SRC + c.src);
  // Remove any DC offset.
  const mean = x.reduce((s, v) => s + v, 0) / x.length;
  for (let i = 0; i < x.length; i++) x[i] -= mean;

  // Loudness in 5 ms windows; the background noise is the quietest fifth of the recording.
  const win = Math.round(sr * 0.005), env = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += x[j] * x[j];
    env.push(Math.sqrt(s / win));
  }
  const noise = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.2)];

  const from = Math.round((c.from ?? 0) * sr);
  let peak = 0, at = from;
  for (let i = from; i < Math.min(x.length, from + Math.round(sr * 0.2)); i++) if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); at = i; }
  let onset = from;
  while (onset < at && Math.abs(x[onset]) < peak * 0.1) onset++;
  const start = Math.max(0, onset - Math.round(sr * 0.001));

  // The end: where the sound, averaged over 15 ms, is within 6 dB of the noise, or the longest allowed.
  let end = Math.min(x.length, start + Math.round(c.max * sr));
  for (let w = Math.ceil(at / win); w + 3 <= env.length; w++) {
    if ((env[w] + env[w + 1] + env[w + 2]) / 3 < noise * 2) { end = Math.min(end, (w + 3) * win); break; }
  }

  const n = end - start, y = new Float32Array(n);
  const fadeIn = Math.max(1, onset - start), fadeOut = Math.max(Math.round(sr * 0.01), Math.round((end - at) * 0.5));
  for (let i = 0; i < n; i++) {
    let g = Math.min(1, i / fadeIn);
    const k = n - i;
    if (k < fadeOut) g *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fadeOut);
    y[i] = x[start + i] * g * (PEAK / peak);
  }
  writeWav(`${OUT}${c.out}.wav`, sr, y);
  console.log(`${c.out.padEnd(13)} from ${c.src}: ${(start / sr).toFixed(3)}-${(end / sr).toFixed(3)} s (${((n / sr) * 1000).toFixed(0)} ms), ` +
    `peak ${db(peak)} dB, noise ${db(noise)} dB (${db(peak / noise)} dB below), ${sr} Hz, ${((44 + n * 2) / 1024).toFixed(1)} KB`);
}
