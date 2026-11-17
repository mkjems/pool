// Synthetic sounds, made in code with Web Audio until real recordings replace them (docs/Plan.md, Sound).
//
// Each impact is computed as a short waveform from what happens physically: a contact pulse (its length set by
// how hard and how soft the two things are: Hertz contact for ball on ball, rubber for cushions, leather for the
// tip) followed by the ringing of whatever was struck. Loudness follows the impact speed the physics reports;
// position on the table pans left to right. Every sound can be scheduled a little ahead (`delay`), so the
// clatter of a break keeps the exact timing of the simulation rather than the screen's frames.

import { TABLE_L } from "../sim/constants";

/** Volume steps for the Sound button: off, low, medium, high. */
export const VOLUMES = ["off", "low", "medium", "high"] as const;
export type Volume = (typeof VOLUMES)[number];
const GAIN: Record<Volume, number> = { off: 0, low: 0.3, medium: 0.6, high: 1 };

interface Mode { f: number; a: number; d: number }
interface Impact {
  /** Contact pulse: duration (s) and amplitude. */
  pulse: number; amp: number;
  /** Ringing after the contact: frequency (Hz), amplitude, decay time constant (s). */
  modes: Mode[];
  /** Filtered noise: amplitude, decay (s), one-pole low-pass cutoff (Hz). */
  noise?: { a: number; d: number; lp: number };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Sound {
  private ctx: BaseAudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private rollLow!: GainNode;
  private rollHigh!: GainNode;
  private rollLp!: BiquadFilterNode;
  private rollPan!: StereoPannerNode;
  private room!: GainNode;
  private recent: number[] = [];
  volume: Volume = "high";
  roomTone = false;
  /** Vibrate on the strike and on pots (only where the device can, and only after touch input). */
  haptics = false;

  /** Audio can only start after a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.attach(new AC());
  }

  /** Builds the sound graph on any context (an OfflineAudioContext in tests). */
  attach(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = GAIN[this.volume];
    // No compressor (its make-up gain and attack treat clicks and thumps unequally, so levels stop meaning
    // anything): the crowding rule in allow() keeps pile-ups down, and a soft clipper rounds off whatever is left
    // above 0.6 so nothing ever clips.
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / 1024 - 1) * 2, ax = Math.abs(x);
      curve[i] = Math.sign(x) * (ax < 0.6 ? ax : 0.6 + 0.4 * Math.tanh((ax - 0.6) / 0.4));
    }
    clip.curve = curve;
    clip.oversample = "2x";
    this.master.connect(clip).connect(ctx.destination);

    const sr = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, sr * 2, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // The room: a pool hall, medium size, soft furnishings. A few early reflections, then a tail whose highs
    // die faster than its lows.
    const len = Math.floor(sr * 0.9);
    const ir = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const k = 0.5 * Math.exp(-t * 9); // low-pass gets darker over time
        lp += (1 - Math.exp(-2 * Math.PI * (2500 * k + 500) / sr)) * (Math.random() * 2 - 1 - lp);
        ch[i] = lp * Math.exp(-t / 0.13) * (t < 0.012 ? t / 0.012 : 1);
      }
      for (const [ms, g] of [[7, 0.5], [11, 0.35], [17, 0.3], [23, 0.22], [31, 0.15]]) {
        ch[Math.floor(((ms + c * 1.7) / 1000) * sr)] += g * (c ? 0.9 : 1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.22;
    this.wet.connect(conv).connect(this.master);

    // Rolling: a low rumble through the slate and a quieter rustle of cloth, both following the balls' speed.
    this.rollPan = ctx.createStereoPanner();
    this.rollPan.connect(this.master);
    const loop = (filter: BiquadFilterNode) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(filter).connect(g).connect(this.rollPan);
      src.start(0, Math.random());
      return g;
    };
    this.rollLp = ctx.createBiquadFilter();
    this.rollLp.type = "lowpass"; this.rollLp.frequency.value = 140; this.rollLp.Q.value = 0.9;
    this.rollLow = loop(this.rollLp);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.rollHigh = loop(bp);

    // Room tone: the air of a quiet hall, very low. Off unless asked for.
    const rsrc = ctx.createBufferSource();
    rsrc.buffer = this.noise; rsrc.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass"; rlp.frequency.value = 260; rlp.Q.value = 0.5;
    this.room = ctx.createGain();
    this.room.gain.value = this.roomTone ? 0.05 : 0;
    rsrc.connect(rlp).connect(this.room).connect(this.master);
    rsrc.start();
  }

  setVolume(v: Volume) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(GAIN[v], this.ctx.currentTime, 0.02);
  }

  setRoomTone(on: boolean) {
    this.roomTone = on;
    if (this.ctx) this.room.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.3);
  }

  private buzz(ms: number) {
    if (this.haptics && this.volume !== "off" && "vibrate" in navigator) navigator.vibrate(ms);
  }

  /**
   * How loud a new sound may be, 0 to 1. Hits within a few milliseconds of each other (the rack at the break) share
   * the loudness of one crack instead of adding up; past a dozen in 30 ms only the loud ones play.
   */
  private allow(at: number, level: number): number {
    this.recent = this.recent.filter((t) => Math.abs(at - t) < 0.03);
    const close = this.recent.filter((t) => Math.abs(at - t) < 0.006).length;
    if (this.recent.length > 12 && level < 0.4) return 0;
    this.recent.push(at);
    return 1 / (1 + close);
  }

  /** Crowded hits are spread over a millisecond or so, as a real rack's are, so they don't add up in phase. */
  private spread(at: number) {
    return this.recent.filter((t) => Math.abs(at - t) < 0.006).length > 1 ? at + Math.random() * 0.0015 : at;
  }

  /** A short waveform for one impact, computed sample by sample. */
  private render(spec: Impact, length: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.floor(length * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    // The contact pulse: one cycle of a sine as long as the contact (the pressure wave of the sudden push).
    const pn = Math.max(2, Math.floor(spec.pulse * sr));
    for (let i = 0; i < pn && i < n; i++) out[i] += spec.amp * Math.sin((2 * Math.PI * i) / pn) * Math.sin((Math.PI * i) / pn);
    // Ringing, starting as the contact ends.
    for (const m of spec.modes) {
      const w = (2 * Math.PI * m.f) / sr, k = Math.exp(-1 / (m.d * sr)), ph = Math.random() * 6.283;
      let e = m.a;
      for (let i = 0; i < n; i++) {
        const rise = i < pn ? i / pn : 1;
        out[i] += e * rise * Math.sin(w * i + ph);
        e *= k;
      }
    }
    if (spec.noise) {
      const { a, d, lp } = spec.noise;
      const c = 1 - Math.exp((-2 * Math.PI * lp) / sr), k = Math.exp(-1 / (d * sr));
      let y = 0, e = a;
      for (let i = 0; i < n; i++) {
        y += c * (Math.random() * 2 - 1 - y);
        out[i] += y * e * 2.2;
        e *= k;
      }
    }
    return buf;
  }

  /** Levels of each kind of sound, set by rendering them offline and comparing peaks (see docs/Plan.md, Sound). */
  private static LEVEL = { ball: 0.5, cushion: 0.45, cue: 0.45, pocket: 0.5 };

  private play(buf: AudioBuffer, at: number, pan: number, level: number, wet = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g0 = ctx.createGain();
    g0.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    src.connect(g0).connect(p);
    p.connect(this.master);
    if (wet > 0) {
      const g = ctx.createGain();
      g.gain.value = wet;
      p.connect(g).connect(this.wet);
    }
    src.start(at);
  }

  private when(delay: number) { return this.ctx!.currentTime + Math.max(0, delay); }
  private pan(x: number) { return (x / (TABLE_L / 2)) * 0.6; }

  /** Two balls click. speed: approach speed (m/s); x: where along the table; delay: seconds from now. */
  ball(speed: number, x: number, delay = 0) {
    if (!this.ctx || speed < 0.02) return;
    const at = this.when(delay);
    let v = Math.min(1, Math.pow(speed / 6, 0.7));
    v *= this.allow(at, v);
    if (v === 0) return;
    // Hertz contact between two resin balls: about a quarter of a millisecond, a little shorter when harder.
    const tau = 0.00028 * Math.pow(Math.max(speed, 0.05) / 2, -0.2);
    const p = rand(0.95, 1.05);
    const buf = this.render({
      pulse: tau, amp: 1.1 * v,
      modes: [
        { f: 3900 * p, a: 0.3 * v, d: 0.006 + 0.004 * v },
        { f: 6300 * p, a: 0.12 * v, d: 0.004 },
        { f: 2400 * p, a: 0.12 * v, d: 0.009 },
      ],
      noise: { a: 0.15 * v, d: 0.003, lp: 5000 },
    }, 0.06);
    this.play(buf, this.spread(at), this.pan(x), Sound.LEVEL.ball);
  }

  /** A ball hits a cushion. */
  cushion(speed: number, x: number, delay = 0) {
    if (!this.ctx || speed < 0.04) return;
    const at = this.when(delay);
    let v = Math.min(1, Math.pow(speed / 4, 0.8));
    v *= this.allow(at, v);
    if (v === 0) return;
    // Rubber gives: a few milliseconds of contact, a soft thump. The wooden rail rings under it, and the ball
    // itself gives a faint click where it meets the cloth on the nose.
    const tau = 0.0035 * Math.pow(Math.max(speed, 0.1), -0.15);
    const p = rand(0.94, 1.06);
    const buf = this.render({
      pulse: tau, amp: 1.0 * v,
      modes: [
        { f: 185 * p, a: 0.3 * v, d: 0.045 },
        { f: 420 * p, a: 0.26 * v, d: 0.03 },
        { f: 1050 * p, a: 0.1 * v, d: 0.015 },
        { f: 3900 * p, a: 0.06 * v * v, d: 0.003 },
      ],
      noise: { a: 0.1 * v, d: 0.012, lp: 2000 },
    }, 0.25);
    this.play(buf, at, this.pan(x), Sound.LEVEL.cushion);
  }

  /** The cue tip strikes the cue ball. */
  cue(speed: number, miscue: boolean, delay = 0) {
    if (!this.ctx) return;
    const v = Math.min(1, Math.pow(speed / 8, 0.6));
    const at = this.when(delay);
    this.allow(at, 1); // counts toward the crowding of the break
    // Leather on resin: about a millisecond, a duller "tok" than ball on ball. Then the shaft rings, and on hard
    // shots the ball's own click comes through.
    const tau = 0.0011 * Math.pow(Math.max(speed, 0.3) / 3, -0.25);
    const buf = this.render({
      pulse: tau, amp: 0.9 * v + 0.15,
      modes: [
        { f: rand(690, 730), a: 0.14 * v + 0.03, d: 0.03 },
        { f: rand(1680, 1760), a: 0.14 * v + 0.03, d: 0.018 },
        { f: 3900, a: 0.16 * v * v, d: 0.004 },
      ],
      noise: miscue ? { a: 0.25, d: 0.05, lp: 5000 } : { a: 0.05 * v, d: 0.004, lp: 3000 },
    }, 0.12);
    this.play(buf, at, 0, Sound.LEVEL.cue);
    this.buzz(miscue ? 40 : Math.round(8 + 22 * v));
  }

  /**
   * A ball drops into a pocket, and on a coin-op table runs down the return to the end of the table, where it
   * knocks into the balls already there. down: how many balls were in the return before this one.
   */
  pocket(speed: number, x: number, down = 0, delay = 0) {
    if (!this.ctx) return;
    const v = Math.min(1, 0.4 + speed / 3);
    const at = this.when(delay);
    // The drop: onto the hard rubber at the bottom of the pocket, with a rattle off the back if it came fast.
    const drop = this.render({
      pulse: 0.0016, amp: 0.45 * v,
      modes: [
        { f: rand(170, 190), a: 0.2 * v, d: 0.05 },
        { f: rand(400, 440), a: 0.12 * v, d: 0.03 },
        { f: rand(1050, 1200), a: 0.05 * v, d: 0.012 },
      ],
      noise: { a: 0.08 * v, d: 0.02, lp: 1400 },
    }, 0.3);
    this.play(drop, at, this.pan(x), Sound.LEVEL.pocket, 0.8);
    if (speed > 1.2) {
      const rattle = this.render({ pulse: 0.0004, amp: 0.25 * v, modes: [{ f: rand(3000, 3600), a: 0.08, d: 0.006 }] }, 0.04);
      this.play(rattle, at + rand(0.02, 0.04), this.pan(x), Sound.LEVEL.pocket);
    }
    this.buzz(25);

    // The run down the return: a hollow rumble that grows as the ball speeds up, then the clack at the end.
    const run = rand(0.55, 0.8) + Math.abs(x) * 0.15;
    this.play(this.returnRun(run), at + 0.12, this.pan(x) * 0.5, Sound.LEVEL.pocket, 0.9);
    const endAt = at + 0.12 + run;
    const end = Math.min(down, 3);
    if (down > 0) {
      // Resin on resin, muffled by the distance under the table; a second, quieter tap as the row settles.
      for (let i = 0; i < 1 + (end > 1 ? 1 : 0); i++) {
        const k = i ? 0.35 : 1;
        const clack = this.render({
          pulse: 0.0003, amp: 0.38 * k,
          modes: [{ f: rand(3800, 4300), a: 0.08 * k, d: 0.008 }, { f: rand(1300, 1500), a: 0.06 * k, d: 0.012 }],
          noise: { a: 0.04 * k, d: 0.004, lp: 3500 },
        }, 0.06);
        this.play(clack, endAt + i * rand(0.05, 0.08), 0.15, Sound.LEVEL.pocket, 1.3);
      }
    } else {
      const thud = this.render({ pulse: 0.003, amp: 0.3, modes: [{ f: rand(130, 150), a: 0.15, d: 0.05 }] }, 0.2);
      this.play(thud, endAt, 0.15, Sound.LEVEL.pocket, 1.3);
    }
  }

  /** A ball running down the wooden return under the table: rumble with the bumps of the ball turning. */
  private returnRun(length: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const n = Math.floor(length * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    let a = 0, b = 0;
    const ca = 1 - Math.exp((-2 * Math.PI * 380) / sr), cb = 1 - Math.exp((-2 * Math.PI * 140) / sr);
    const wob = rand(9, 13), wob2 = rand(17, 23);
    for (let i = 0; i < n; i++) {
      const t = i / sr, u = t / length;
      const r = Math.random() * 2 - 1;
      a += ca * (r - a); // the rumble
      b += cb * (a - b); // the hollow box under the table: a second low-pass for the body
      const env = Math.min(1, u * 4) * Math.min(1, (1 - u) * 12) * (0.6 + 0.4 * u);
      const turn = 0.75 + 0.25 * Math.sin(2 * Math.PI * wob * t * (1 + u)) * Math.sin(2 * Math.PI * wob2 * t);
      out[i] = (a * 0.9 + b * 2.0) * env * turn * 0.3;
    }
    return buf;
  }

  /** Every frame: total and speed-weighted position of the rolling balls. */
  rolling(sumSpeed: number, x = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(6, sumSpeed);
    this.rollLow.gain.setTargetAtTime(Math.min(0.22, s * 0.04), t, 0.06);
    this.rollHigh.gain.setTargetAtTime(Math.min(0.06, s * 0.01), t, 0.06);
    this.rollLp.frequency.setTargetAtTime(160 + 60 * Math.min(s, 3), t, 0.1);
    this.rollPan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, this.pan(x))), t, 0.1);
  }
}
