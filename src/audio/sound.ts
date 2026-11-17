// Synthetic sounds, made in code with Web Audio until real recordings replace them (docs/Plan.md, Sound).
// Every sound is scaled by the impact speed the physics reports, and panned by where it happened.

import { TABLE_L } from "../sim/constants";

export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private rollGain!: GainNode;
  private recent: number[] = [];
  muted = false;

  /** Audio can only start after a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4;
    this.out.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // A small room: a short decaying-noise reverb.
    const ir = ctx.createBuffer(2, ctx.sampleRate * 0.7, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.16;
    this.wet.connect(conv).connect(this.out);

    // Rolling: low rumble whose level follows the balls' speed.
    const roll = ctx.createBufferSource();
    roll.buffer = this.noise; roll.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 180;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    roll.connect(lp).connect(this.rollGain).connect(this.out);
    roll.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.out.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  /** Too many sounds at once (a break) blur into noise: keep the loudest few. */
  private allow(level: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    this.recent = this.recent.filter((t) => now - t < 0.04);
    if (this.recent.length > 6 && level < 0.5) return false;
    this.recent.push(now);
    return true;
  }

  private chain(pan: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    p.connect(this.out);
    p.connect(this.wet);
    return p;
  }

  private burst(dest: AudioNode, t: number, type: BiquadFilterType, freq: number, q: number, gain: number, decay: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, decay + 0.02);
  }

  private tone(dest: AudioNode, t: number, freq: number, gain: number, decay: number, type: OscillatorType = "sine", bend = 1) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  private pan(x: number) { return (x / (TABLE_L / 2)) * 0.7; }

  /** Two balls click. speed: approach speed, m/s. */
  ball(speed: number, x: number) {
    const v = Math.min(1, Math.pow(speed / 5, 0.75));
    if (!this.allow(v) || v < 0.01) return;
    const t = this.ctx!.currentTime;
    const d = this.chain(this.pan(x));
    const pitch = 0.92 + Math.random() * 0.16;
    // Phenolic resin: a hard, bright click with a short ring; harder hits are brighter.
    this.burst(d, t, "bandpass", (2600 + 2400 * v) * pitch, 2.2, 0.9 * v, 0.018 + 0.01 * v);
    this.tone(d, t, 3900 * pitch, 0.32 * v, 0.03 + 0.03 * v, "sine", 0.97);
    this.tone(d, t, 6100 * pitch, 0.14 * v, 0.02, "sine");
    this.tone(d, t, 1250 * pitch, 0.12 * v, 0.02, "triangle");
  }

  /** A ball hits a cushion. */
  cushion(speed: number, x: number) {
    const v = Math.min(1, Math.pow(speed / 4, 0.8));
    if (!this.allow(v) || v < 0.02) return;
    const t = this.ctx!.currentTime;
    const d = this.chain(this.pan(x));
    this.burst(d, t, "lowpass", 380 + 500 * v, 0.8, 0.9 * v, 0.07);
    this.tone(d, t, 125 + 40 * v, 0.55 * v, 0.11, "sine", 0.8);
    this.burst(d, t, "bandpass", 2000, 1.5, 0.08 * v, 0.015); // the cloth slap
  }

  /** A ball drops into a pocket and runs down the return. */
  pocket(speed: number, x: number) {
    const v = Math.min(1, 0.35 + speed / 3);
    const t = this.ctx!.currentTime;
    const d = this.chain(this.pan(x));
    this.burst(d, t, "lowpass", 300, 0.7, 0.8 * v, 0.12);
    this.tone(d, t, 92, 0.7 * v, 0.16, "sine", 0.7);
    this.burst(d, t, "bandpass", 900, 2, 0.15 * v, 0.03);
    // Settling against the balls already down there.
    const n = 2 + Math.floor(Math.random() * 3);
    let at = t + 0.16 + Math.random() * 0.08;
    for (let i = 0; i < n; i++) {
      const g = (0.25 * v) / (i + 1.5);
      this.burst(d, at, "bandpass", 1500 + Math.random() * 600, 3, g, 0.02);
      this.tone(d, at, 2100 + Math.random() * 300, g * 0.5, 0.025);
      at += 0.06 + Math.random() * 0.09;
    }
  }

  /** The cue tip strikes the cue ball. */
  cue(speed: number, miscue: boolean) {
    const v = Math.min(1, Math.pow(speed / 7, 0.6));
    if (!this.allow(1)) return;
    const t = this.ctx!.currentTime;
    const d = this.chain(0);
    // Leather tip on resin: a duller "tock" than ball on ball.
    this.burst(d, t, "bandpass", 1500 + 900 * v, 1.4, 0.75 * v + 0.1, 0.022);
    this.tone(d, t, 700 + 250 * v, 0.3 * v + 0.05, 0.04, "sine", 0.9);
    if (miscue) this.burst(d, t + 0.004, "highpass", 3000, 0.7, 0.4, 0.06);
  }

  /** Total speed of rolling balls, called every frame. */
  rolling(sumSpeed: number) {
    if (!this.ctx) return;
    const level = Math.min(0.25, sumSpeed * 0.035);
    this.rollGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }
}
