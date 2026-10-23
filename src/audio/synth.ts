import { karplusStrong, makeBuffer, shaperCurve } from './dsp';

/**
 * Recipe toolkit: click-free envelopes, filtered noise, oscillators, FM
 * operators, Karplus–Strong plucks, grain trains (many tiny noise grains on a
 * single node chain), formant voices and small utilities.
 *
 * Every helper takes a BaseAudioContext so the same recipes render in the live
 * AudioContext and in an OfflineAudioContext (verification).
 *
 * Envelope rule: every gain envelope starts at exactly 0 and ends at exactly 0
 * (linear attack, exponential decay to -60 dB, 5 ms linear tail) so voices never
 * click, and sources are stopped only after their envelope has closed.
 */

export type AC = BaseAudioContext;

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randi = (a: number, b: number): number => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p: number): boolean => Math.random() < p;
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const semis = (n: number): number => Math.pow(2, n / 12);
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const fin = (v: number, d: number): number => (Number.isFinite(v) ? v : d);

/** Constant gain node. */
export function gain(ac: AC, v = 1): GainNode {
  const g = ac.createGain();
  g.gain.value = fin(v, 0);
  return g;
}

/** Biquad filter. */
export function filt(ac: AC, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(fin(freq, 1000), 10, 22000);
  f.Q.value = fin(q, 0.707);
  if (gainDb) f.gain.value = gainDb;
  return f;
}

/** Schedule a percussive envelope on a param: 0 → peak (linear) → -60 dB (exp) → 0. Returns end time. */
export function percParam(p: AudioParam, t: number, attack: number, decay: number, peak: number): number {
  const a = Math.max(0.001, fin(attack, 0.001));
  const d = Math.max(0.005, fin(decay, 0.05));
  const pk = Math.max(1e-5, fin(peak, 0));
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  p.exponentialRampToValueAtTime(pk * 0.001, t + a + d);
  p.linearRampToValueAtTime(0, t + a + d + 0.005);
  return t + a + d + 0.005;
}

/** Schedule attack-hold-release on a param (0 → peak → hold → -60 dB → 0). Returns end time. */
export function ahrParam(p: AudioParam, t: number, attack: number, hold: number, release: number, peak: number, curve: 'exp' | 'lin' = 'exp'): number {
  const a = Math.max(0.001, fin(attack, 0.001));
  const h = Math.max(0, fin(hold, 0));
  const r = Math.max(0.005, fin(release, 0.05));
  const pk = Math.max(1e-5, fin(peak, 0));
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + a);
  if (h > 0) p.setValueAtTime(pk, t + a + h);
  if (curve === 'lin') p.linearRampToValueAtTime(0, t + a + h + r);
  else {
    p.exponentialRampToValueAtTime(pk * 0.001, t + a + h + r);
    p.linearRampToValueAtTime(0, t + a + h + r + 0.005);
  }
  return t + a + h + r + 0.005;
}

/** Percussive gain envelope node. */
export function perc(ac: AC, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = ac.createGain();
  g.gain.value = 0;
  percParam(g.gain, t, attack, decay, peak);
  return g;
}

/** Attack-hold-release gain envelope node. */
export function ahr(ac: AC, t: number, attack: number, hold: number, release: number, peak: number, curve: 'exp' | 'lin' = 'exp'): GainNode {
  const g = ac.createGain();
  g.gain.value = 0;
  ahrParam(g.gain, t, attack, hold, release, peak, curve);
  return g;
}

/**
 * Swell: 0 → peak along a smooth (sine-ish) curve with `points` breakpoints,
 * hold, then release. Good for rising roars, wind gusts and power-ups.
 */
export function swell(ac: AC, t: number, rise: number, hold: number, release: number, peak: number): GainNode {
  const g = ac.createGain();
  g.gain.value = 0;
  const p = g.gain;
  const pk = Math.max(1e-5, fin(peak, 0));
  const n = 6;
  p.setValueAtTime(0, t);
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    p.linearRampToValueAtTime(pk * (0.5 - 0.5 * Math.cos(Math.PI * k)), t + rise * k);
  }
  if (hold > 0) p.setValueAtTime(pk, t + rise + hold);
  p.exponentialRampToValueAtTime(pk * 0.001, t + rise + hold + Math.max(0.01, release));
  p.linearRampToValueAtTime(0, t + rise + hold + Math.max(0.01, release) + 0.005);
  return g;
}

/** Looping noise source started at t with a random offset, stopped at t + dur. */
export function noise(ac: AC, buf: AudioBuffer, t: number, dur: number, rate = 1): AudioBufferSourceNode {
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = clamp(fin(rate, 1), 0.05, 16);
  s.start(t, Math.random() * Math.max(0.01, buf.duration - 0.05));
  s.stop(t + Math.max(0.01, dur) + 0.02);
  return s;
}

/** Oscillator started at t, stopped at t + dur. */
export function osc(ac: AC, type: OscillatorType, freq: number, t: number, dur: number, detune = 0): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = clamp(fin(freq, 440), 0.01, 20000);
  if (detune) o.detune.value = detune;
  o.start(t);
  o.stop(t + Math.max(0.01, dur) + 0.02);
  return o;
}

/** Exponential frequency glide on a param (guards non-positive targets). */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(0.01, fin(from, 100)), t);
  p.exponentialRampToValueAtTime(Math.max(0.01, fin(to, 100)), t + Math.max(0.005, dur));
}

/** Sequence of exponential glides: points = [[time offset, value], ...]. */
export function curve(p: AudioParam, t: number, points: ReadonlyArray<readonly [number, number]>): void {
  let first = true;
  for (const [dt, v] of points) {
    const val = Math.max(0.01, fin(v, 100));
    if (first) {
      p.setValueAtTime(val, t + dt);
      first = false;
    } else p.exponentialRampToValueAtTime(val, t + Math.max(0.001, dt));
  }
}

/**
 * FM operator pair: sine modulator (freq · ratio) → carrier frequency.
 * The modulation index decays from `index` to `indexEnd` over `dur`.
 * Returns the carrier (connect it to an envelope).
 */
export function fm(ac: AC, t: number, dur: number, freq: number, ratio: number, index: number, indexEnd = index * 0.1, type: OscillatorType = 'sine'): OscillatorNode {
  const car = osc(ac, type, freq, t, dur);
  const mod = osc(ac, 'sine', freq * ratio, t, dur);
  const mg = ac.createGain();
  const i0 = Math.max(0.01, freq * ratio * index);
  const i1 = Math.max(0.01, freq * ratio * indexEnd);
  mg.gain.setValueAtTime(i0, t);
  mg.gain.exponentialRampToValueAtTime(i1, t + Math.max(0.01, dur));
  mod.connect(mg).connect(car.frequency);
  return car;
}

/** WaveShaper distortion node. */
export function shaper(ac: AC, kind: 'tanh' | 'hard' | 'fold' | 'asym', amount: number): WaveShaperNode {
  const w = ac.createWaveShaper();
  // Float32Array<ArrayBuffer> copy keeps TS lib typings happy across versions.
  w.curve = new Float32Array(shaperCurve(kind, amount));
  w.oversample = 'none';
  return w;
}

/** Stereo panner (non-positional sounds only). */
export function panner(ac: AC, pan: number): StereoPannerNode | GainNode {
  if (typeof (ac as AudioContext).createStereoPanner !== 'function') return gain(ac, 1);
  const p = ac.createStereoPanner();
  p.pan.value = clamp(fin(pan, 0), -1, 1);
  return p;
}

/** Connect a scaled copy of `node` into `dest` (reverb sends). */
export function send(ac: AC, node: AudioNode, dest: AudioNode, amount: number): void {
  if (!(amount > 0)) return;
  const g = gain(ac, amount);
  node.connect(g).connect(dest);
}

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------

/** Filtered noise burst with a percussive envelope. Returns the filter for extra automation. */
export function noiseHit(ac: AC, out: AudioNode, buf: AudioBuffer, t: number, type: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak: number): BiquadFilterNode {
  const src = noise(ac, buf, t, attack + decay + 0.02);
  const f = filt(ac, type, freq, q);
  const g = perc(ac, t, attack, decay, peak);
  src.connect(f).connect(g).connect(out);
  return f;
}

/** Filtered noise with attack-hold-release envelope. */
export function noiseAHR(ac: AC, out: AudioNode, buf: AudioBuffer, t: number, type: BiquadFilterType, freq: number, q: number, a: number, h: number, r: number, peak: number): BiquadFilterNode {
  const src = noise(ac, buf, t, a + h + r + 0.02);
  const f = filt(ac, type, freq, q);
  const g = ahr(ac, t, a, h, r, peak);
  src.connect(f).connect(g).connect(out);
  return f;
}

export interface NoiseVoice {
  filter: BiquadFilterNode;
  /** Post-envelope node — connect reverb sends here (never pre-envelope). */
  env: GainNode;
}

/** Filtered noise with an AHR envelope; returns filter + envelope (for sends). */
export function noiseVoice(ac: AC, out: AudioNode, buf: AudioBuffer, t: number, type: BiquadFilterType, freq: number, q: number, a: number, h: number, r: number, peak: number): NoiseVoice {
  const src = noise(ac, buf, t, a + h + r + 0.02);
  const filter = filt(ac, type, freq, q);
  const env = ahr(ac, t, a, h, r, peak);
  src.connect(filter).connect(env).connect(out);
  return { filter, env };
}

/** Pitched thump: sine dropping from f0 to f1 (kick-drum style body). */
export function thump(ac: AC, out: AudioNode, t: number, f0: number, f1: number, decay: number, peak: number, drop = 0.06): void {
  const o = osc(ac, 'sine', f0, t, decay + 0.03);
  glide(o.frequency, t, f0, f1, Math.min(decay, drop + decay * 0.4));
  const g = perc(ac, t, 0.002, decay, peak);
  o.connect(g).connect(out);
}

/** Tonal ping (sine/triangle) with a percussive envelope and optional pitch bend. */
export function ping(ac: AC, out: AudioNode, t: number, freq: number, decay: number, peak: number, type: OscillatorType = 'sine', bendTo?: number, attack = 0.002): OscillatorNode {
  const o = osc(ac, type, freq, t, attack + decay + 0.02);
  if (bendTo) glide(o.frequency, t, freq, bendTo, decay * 0.6);
  const g = perc(ac, t, attack, decay, peak);
  o.connect(g).connect(out);
  return o;
}

export interface GrainOpts {
  /** Grain centre frequencies are picked in [fLo, fHi] (log-uniform). */
  fLo: number;
  fHi: number;
  q: number;
  /** Grain length (s). */
  dur: number;
  /** Peak per grain (randomised 50..100 %). */
  peak: number;
  type?: BiquadFilterType;
  /** Weight grains toward the start (1 = uniform, 2 = front-loaded). */
  front?: number;
  /** Peak decay across the train (0 = flat, 1 = last grain silent). */
  fade?: number;
}

/**
 * Grain train: `n` short filtered-noise grains within `span` seconds, all on a
 * single source → filter → gain chain (cheap: 3 nodes for any n). Used for
 * crunch (snow, gravel), crackle (fire), rustle (grass) and debris.
 */
export function grains(ac: AC, out: AudioNode, buf: AudioBuffer, t: number, span: number, n: number, o: GrainOpts): void {
  if (n <= 0) return;
  const times: number[] = [];
  const front = o.front ?? 1;
  for (let i = 0; i < n; i++) times.push(t + span * Math.pow(Math.random(), front));
  times.sort((a, b) => a - b);
  const src = noise(ac, buf, t, span + o.dur + 0.05);
  const f = filt(ac, o.type ?? 'bandpass', o.fLo, o.q);
  const g = ac.createGain();
  g.gain.value = 0;
  const lo = Math.log(Math.max(20, o.fLo));
  const hi = Math.log(Math.max(o.fLo + 1, o.fHi));
  let lastEnd = t;
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < times.length; i++) {
    const ts = Math.max(times[i], lastEnd + 0.0005);
    const next = i + 1 < times.length ? times[i + 1] : ts + o.dur;
    const d = Math.max(0.002, Math.min(o.dur * rand(0.6, 1.3), next - ts));
    const k = 1 - (o.fade ?? 0) * (i / Math.max(1, times.length - 1));
    const pk = Math.max(1e-4, o.peak * rand(0.45, 1) * k);
    f.frequency.setValueAtTime(Math.exp(lo + (hi - lo) * Math.random()), ts);
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(pk, ts + Math.min(0.0015, d * 0.25));
    g.gain.exponentialRampToValueAtTime(pk * 0.01, ts + d);
    g.gain.linearRampToValueAtTime(0, ts + d + 0.0008);
    lastEnd = ts + d + 0.0008;
  }
  src.connect(f).connect(g).connect(out);
}

/** Droplet "plink": short sine whose pitch rises quickly (bubble resonance). */
export function droplet(ac: AC, out: AudioNode, t: number, freq: number, peak: number, dur = 0.05): void {
  const o = osc(ac, 'sine', freq, t, dur + 0.02);
  glide(o.frequency, t, freq, freq * rand(1.6, 2.6), dur);
  const g = perc(ac, t, 0.002, dur, peak);
  o.connect(g).connect(out);
}

/** Many droplets scattered over `span`. */
export function droplets(ac: AC, out: AudioNode, t: number, span: number, n: number, fLo: number, fHi: number, peak: number): void {
  for (let i = 0; i < n; i++) droplet(ac, out, t + Math.random() * span, rand(fLo, fHi), peak * rand(0.4, 1), rand(0.03, 0.07));
}

// ---------------------------------------------------------------------------
// Karplus–Strong plucks (cached buffers per context)
// ---------------------------------------------------------------------------

const ksCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** Cached KS buffer for (freq, decay, brightness). */
export function pluckBuffer(ac: AC, freq: number, decay: number, bright: number, pickPos = 0.13): AudioBuffer {
  let m = ksCache.get(ac);
  if (!m) {
    m = new Map();
    ksCache.set(ac, m);
  }
  // Quantise to keep the cache small; playbackRate corrects residual detune.
  const fq = Math.round(Math.log2(Math.max(20, freq)) * 48) / 48;
  const key = `${fq}|${Math.round(decay * 10)}|${Math.round(bright * 10)}|${Math.round(pickPos * 20)}`;
  let b = m.get(key);
  if (!b) {
    const f = Math.pow(2, fq);
    const secs = Math.min(4, decay * 1.1 + 0.05);
    // Generate at a moderate rate (cheap) — the browser resamples on playback.
    const sr = Math.min(ac.sampleRate, 32000);
    b = makeBuffer(ac, karplusStrong(sr, f, secs, { decay, bright, pick: pickPos, seed: Math.floor(Math.random() * 1e9) }), sr);
    m.set(key, b);
    if (m.size > 160) m.delete(m.keys().next().value as string);
  }
  return b;
}

/**
 * Plucked string note (Karplus–Strong). `bend` slides into the note from
 * `bend` semitones away (guzheng ornament). Returns the duration.
 */
export function pluck(ac: AC, out: AudioNode, t: number, freq: number, o: { decay?: number; bright?: number; vol?: number; bend?: number; pick?: number; dur?: number } = {}): number {
  const decay = o.decay ?? 1.6;
  const buf = pluckBuffer(ac, freq, decay, o.bright ?? 0.6, o.pick ?? 0.13);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const fq = Math.pow(2, Math.round(Math.log2(Math.max(20, freq)) * 48) / 48);
  const rate = freq / fq;
  if (o.bend) {
    src.playbackRate.setValueAtTime(rate * semis(o.bend), t);
    src.playbackRate.exponentialRampToValueAtTime(rate, t + 0.09);
  } else src.playbackRate.value = rate;
  const dur = Math.min(buf.duration / rate, o.dur ?? Infinity);
  const g = ac.createGain();
  const v = Math.max(1e-4, o.vol ?? 0.5);
  g.gain.setValueAtTime(v, t);
  // Gentle damping at the end (or when cut short by dur).
  g.gain.setValueAtTime(v, t + Math.max(0.01, dur - 0.04));
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
  return dur;
}

// ---------------------------------------------------------------------------
// Bells (FM) and chimes
// ---------------------------------------------------------------------------

/** FM bell: inharmonic modulator ratio, decaying index. */
export function bell(ac: AC, out: AudioNode, t: number, freq: number, decay: number, peak: number, ratio = 3.5, index = 2.2): void {
  const car = fm(ac, t, decay + 0.05, freq, ratio, index, index * 0.08);
  const g = perc(ac, t, 0.002, decay, peak);
  car.connect(g).connect(out);
  // Hum partial (an octave below, quiet, longer) for warmth.
  const hum = osc(ac, 'sine', freq * 0.5, t, decay * 1.2 + 0.05);
  const hg = perc(ac, t, 0.01, decay * 1.2, peak * 0.25);
  hum.connect(hg).connect(out);
}

/** Small tuned chime: three inharmonic partials with staggered decays. */
export function chime(ac: AC, out: AudioNode, t: number, freq: number, decay: number, peak: number): void {
  const partials: Array<[number, number, number]> = [
    [1, 1, 1],
    [2.76, 0.45, 0.6],
    [5.4, 0.22, 0.35],
    [8.93, 0.1, 0.2],
  ];
  for (const [r, a, d] of partials) {
    const o = osc(ac, 'sine', freq * r * rand(0.998, 1.002), t, decay * d + 0.03);
    const g = perc(ac, t, 0.001, decay * d, peak * a);
    o.connect(g).connect(out);
  }
}

// ---------------------------------------------------------------------------
// Formant voices
// ---------------------------------------------------------------------------

/** Adult male vowel formants (F1, F2, F3) Hz. */
export const VOWELS: Record<string, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 2950],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  ae: [660, 1720, 2410],
  uh: [520, 1190, 2390],
};

export interface VoiceSpec {
  /** Fundamental (Hz). */
  f0: number;
  /** Formant scale (male 1, female ~1.17, child ~1.3). */
  formant: number;
  /** Syllables per second. */
  rate: number;
  /** Pitch variation in semitones. */
  range: number;
  /** Breathiness 0..1 (noise mixed into the source). */
  breath: number;
  /** Roughness 0..1 (growl / creak via AM). */
  rough: number;
  /** Source waveform. */
  wave: OscillatorType;
  /** Output brightness (lowpass Hz). */
  bright: number;
  /** Vibrato/tremolo depth (elders, spirits). */
  tremolo?: number;
}

/**
 * Formant babble: a sawtooth/pulse "glottis" through three parallel band-pass
 * formant filters whose frequencies move per syllable, syllable amplitude
 * envelopes, consonant noise bursts and phrase intonation (declination, rising
 * questions). Returns the duration.
 */
export function babble(ac: AC, out: AudioNode, t: number, v: VoiceSpec, syllables: number, buf: AudioBuffer, peak: number, question = false): number {
  const n = Math.max(1, Math.min(14, Math.round(syllables)));
  const sylDur = 1 / Math.max(2, v.rate);
  const total = n * sylDur + 0.12;
  const src = osc(ac, v.wave, v.f0, t, total + 0.05);
  const pre = gain(ac, 1);
  src.connect(pre);
  if (v.breath > 0) {
    const nz = noise(ac, buf, t, total + 0.05);
    const nf = filt(ac, 'highpass', 900, 0.5);
    const ng = gain(ac, v.breath * 0.9);
    nz.connect(nf).connect(ng).connect(pre);
  }
  let srcOut: AudioNode = pre;
  if (v.rough > 0) {
    const am = osc(ac, 'sine', rand(24, 34), t, total + 0.05);
    const amg = gain(ac, v.rough * 0.5);
    const vca = gain(ac, 1 - v.rough * 0.5);
    am.connect(amg).connect(vca.gain);
    pre.connect(vca);
    srcOut = vca;
  }
  const env = ac.createGain();
  env.gain.value = 0;
  const lp = filt(ac, 'lowpass', v.bright, 0.7);
  env.connect(lp).connect(out);
  const fs: BiquadFilterNode[] = [];
  const fGains = [1, 0.7, 0.35];
  for (let k = 0; k < 3; k++) {
    const f = filt(ac, 'bandpass', 500, k === 0 ? 6 : 9);
    const g = gain(ac, fGains[k] * (k === 0 ? 2.2 : 3));
    srcOut.connect(f).connect(g).connect(env);
    fs.push(f);
  }
  // Pitch contour: declination + per-syllable steps + question rise.
  const vowels = Object.keys(VOWELS);
  let semi = rand(-1, 1) * v.range * 0.3;
  src.frequency.setValueAtTime(v.f0 * semis(semi), t);
  if (v.tremolo) {
    const trem = osc(ac, 'sine', rand(5, 7), t, total + 0.05);
    const tg = gain(ac, v.f0 * v.tremolo * 0.03);
    trem.connect(tg).connect(src.frequency);
  }
  env.gain.setValueAtTime(0, t);
  let ts = t + 0.01;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const d = sylDur * rand(0.75, 1.25);
    const vw = VOWELS[pick(vowels)];
    for (let k = 0; k < 3; k++) fs[k].frequency.setTargetAtTime(vw[k] * v.formant * rand(0.95, 1.05), ts, 0.015);
    // Intonation.
    const decl = -1.5 * (i / Math.max(1, n - 1));
    semi = clamp(semi + rand(-1, 1) * v.range * 0.5, -v.range, v.range);
    let target = semi + decl;
    if (last && question) target = semi + v.range * 0.9;
    src.frequency.setTargetAtTime(v.f0 * semis(target), ts, 0.03);
    // Consonant onset (plosive click or fricative hiss) on most syllables.
    if (i > 0 || chance(0.6)) {
      const cons = Math.random();
      if (cons < 0.45) noiseHit(ac, out, buf, ts, 'bandpass', rand(1500, 4000), 1.2, 0.001, 0.018, peak * 0.35);
      else if (cons < 0.7) noiseHit(ac, out, buf, ts, 'highpass', rand(3500, 6000), 0.8, 0.012, 0.05, peak * 0.18);
    }
    // Syllable envelope (stress on first + random accents).
    const stress = i === 0 || chance(0.25) ? 1 : rand(0.6, 0.85);
    const pk = Math.max(1e-4, peak * stress);
    const a = Math.min(0.03, d * 0.25);
    env.gain.setValueAtTime(0, ts);
    env.gain.linearRampToValueAtTime(pk, ts + a);
    env.gain.linearRampToValueAtTime(pk * 0.85, ts + d * 0.6);
    env.gain.linearRampToValueAtTime(0, ts + d * (last ? 0.98 : 0.9));
    ts += d;
  }
  return ts - t + 0.05;
}

export const VOICE_TYPES: Record<string, VoiceSpec> = {
  male: { f0: 118, formant: 1, rate: 8, range: 3, breath: 0.08, rough: 0, wave: 'sawtooth', bright: 3200 },
  female: { f0: 212, formant: 1.17, rate: 8.5, range: 4, breath: 0.12, rough: 0, wave: 'sawtooth', bright: 4200 },
  child: { f0: 300, formant: 1.32, rate: 9.5, range: 5, breath: 0.1, rough: 0, wave: 'sawtooth', bright: 5200 },
  elder_m: { f0: 102, formant: 0.97, rate: 6.5, range: 2.5, breath: 0.22, rough: 0.12, wave: 'sawtooth', bright: 2600, tremolo: 0.6 },
  elder_f: { f0: 185, formant: 1.12, rate: 7, range: 3, breath: 0.25, rough: 0.08, wave: 'sawtooth', bright: 3400, tremolo: 0.7 },
  gruff: { f0: 92, formant: 0.94, rate: 7.5, range: 2, breath: 0.15, rough: 0.35, wave: 'sawtooth', bright: 2400 },
  monk: { f0: 112, formant: 0.98, rate: 6, range: 1.6, breath: 0.18, rough: 0, wave: 'triangle', bright: 2600 },
  noble: { f0: 128, formant: 1.03, rate: 7, range: 4, breath: 0.05, rough: 0, wave: 'sawtooth', bright: 3600 },
  spirit: { f0: 250, formant: 1.2, rate: 5, range: 6, breath: 0.4, rough: 0, wave: 'triangle', bright: 5000, tremolo: 1.2 },
};
