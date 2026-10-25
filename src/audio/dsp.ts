/**
 * Low-level DSP building blocks shared by the engine, recipes, music and the
 * offline verifier. The array generators are pure (no WebAudio) so they can be
 * unit-tested in node.
 */

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NoiseColor = 'pink' | 'white' | 'brown';

/**
 * Fill a noise array. 'pink' reproduces the original engine buffer (light
 * pinking, ~0.2 peak scale); 'white' is uniform ±0.5; 'brown' is leaky
 * integrated white noise normalised to ~±0.9 peak.
 */
export function makeNoiseArray(len: number, color: NoiseColor, rnd: () => number = Math.random): Float32Array {
  const d = new Float32Array(len);
  if (color === 'white') {
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * 0.5;
    return d;
  }
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return d;
  }
  // brown: leaky integrator + DC removal, normalised, with a seamless loop seam.
  const fade = Math.min(2048, len >> 3);
  const raw = new Float32Array(len + fade);
  let y = 0;
  for (let i = 0; i < raw.length; i++) {
    y = 0.995 * y + (rnd() * 2 - 1) * 0.06;
    raw[i] = y;
  }
  const looped = seamlessLoop(raw, fade);
  let mean = 0;
  for (let i = 0; i < len; i++) mean += looped[i];
  mean /= len;
  let peak = 1e-9;
  for (let i = 0; i < len; i++) {
    d[i] = looped[i] - mean;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = 0.9 / peak;
  for (let i = 0; i < len; i++) d[i] *= k;
  return d;
}

/**
 * Return a copy of `x` (length - fade) that loops without a seam: its head is a
 * crossfade from x's tail into x's head, so out[last] → out[0] is continuous.
 */
export function seamlessLoop(x: Float32Array, fade: number): Float32Array {
  const n = x.length;
  if (fade <= 0 || fade * 2 >= n) return x.slice();
  const out = new Float32Array(n - fade);
  for (let i = 0; i < out.length; i++) {
    if (i < fade) {
      const k = i / fade;
      out[i] = x[i] * k + x[n - fade + i] * (1 - k);
    } else out[i] = x[i];
  }
  return out;
}

export interface KSOptions {
  /** Seconds for the string to decay by 60 dB. */
  decay: number;
  /** 0 (dark, felt) .. 1 (bright, metal plectrum). */
  bright: number;
  /** Pluck position 0..0.5 (0 = none). Adds the hollow comb character. */
  pick?: number;
  /** Seed for a reproducible excitation. */
  seed?: number;
  /** Peak normalisation target. */
  peak?: number;
}

/**
 * Karplus–Strong plucked string with first-order allpass fractional-delay
 * tuning (Jaffe & Smith). Returns `seconds` of audio at `sr`.
 */
export function karplusStrong(sr: number, freq: number, seconds: number, o: KSOptions): Float32Array {
  const len = Math.max(1, Math.floor(sr * seconds));
  const out = new Float32Array(len);
  const f = Math.max(20, Math.min(sr / 4, freq));
  // Loop filter: y = (1-S)·x[n] + S·x[n-1] (delay S samples). Brighter strings use smaller S.
  const S = 0.5 - 0.42 * Math.max(0, Math.min(1, o.bright));
  const P = sr / f;
  const N = Math.max(2, Math.floor(P - S - 0.0001));
  const frac = Math.max(0.0001, P - S - N);
  const C = (1 - frac) / (1 + frac);
  const rho = Math.pow(0.001, 1 / Math.max(0.05, o.decay * f));
  const rnd = mulberry32(o.seed ?? 1234567);
  // Excitation: noise burst low-passed by brightness, optional pick comb.
  const buf = new Float32Array(N);
  const lp = 0.15 + 0.85 * Math.max(0, Math.min(1, o.bright));
  let s = 0;
  for (let i = 0; i < N; i++) {
    s += lp * ((rnd() * 2 - 1) - s);
    buf[i] = s;
  }
  if (o.pick && o.pick > 0) {
    const k = Math.max(1, Math.round(o.pick * N));
    const tmp = buf.slice();
    for (let i = 0; i < N; i++) buf[i] = tmp[i] - (i >= k ? tmp[i - k] : 0) * 0.9;
  }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;
  let idx = 0;
  let prev = 0;
  let apX = 0, apY = 0;
  for (let n = 0; n < len; n++) {
    const cur = buf[idx];
    // loop filter + loss
    const lpv = rho * ((1 - S) * cur + S * prev);
    prev = cur;
    // allpass fractional delay
    const ap = C * lpv + apX - C * apY;
    apX = lpv;
    apY = ap;
    buf[idx] = ap;
    out[n] = cur;
    idx++;
    if (idx >= N) idx = 0;
  }
  // Normalise and fade the tail to zero (no click if the buffer is cut).
  let peak = 1e-9;
  for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(out[n]));
  const g = (o.peak ?? 0.9) / peak;
  const fade = Math.min(len, Math.floor(sr * 0.03));
  for (let n = 0; n < len; n++) {
    let v = out[n] * g;
    if (n >= len - fade) v *= (len - n) / fade;
    if (n < 16) v *= n / 16;
    out[n] = v;
  }
  return out;
}

/** Estimate the fundamental of a signal by autocorrelation (tests/diagnostics). */
export function estimatePitch(d: Float32Array, sr: number, fMin = 50, fMax = 2000, start = 0, len = 4096): number {
  const n = Math.min(len, d.length - start);
  const minLag = Math.floor(sr / fMax);
  const maxLag = Math.min(n - 1, Math.ceil(sr / fMin));
  let bestLag = -1;
  let best = -Infinity;
  const corr = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += d[start + i] * d[start + i + lag];
    corr[lag] = c;
  }
  // First strong peak (avoids octave errors).
  let globalMax = 0;
  for (let lag = minLag; lag <= maxLag; lag++) globalMax = Math.max(globalMax, corr[lag]);
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > 0.8 * globalMax) {
      bestLag = lag;
      best = corr[lag];
      break;
    }
  }
  if (bestLag < 0 || best <= 0) return 0;
  // Parabolic interpolation.
  const a = corr[bestLag - 1], b = corr[bestLag], c = corr[bestLag + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  return sr / (bestLag + shift);
}

export interface SignalStats {
  peak: number;
  rms: number;
  nan: number;
  clipped: number;
  dc: number;
  /** Seconds until the last sample above -60 dB re peak. */
  effective: number;
  /** Absolute value of the first and last samples (click check). */
  first: number;
  last: number;
  /** Largest sample-to-sample jump (click indicator). */
  maxStep: number;
}

/** Analyse rendered channels (used by the offline verifier and unit tests). */
export function analyse(channels: Float32Array[], sr: number): SignalStats {
  let peak = 0, sum = 0, nan = 0, clipped = 0, dcSum = 0, maxStep = 0;
  let count = 0;
  for (const d of channels) {
    let prev = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        nan++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a > 1.0) clipped++;
      sum += v * v;
      dcSum += v;
      const step = Math.abs(v - prev);
      if (step > maxStep) maxStep = step;
      prev = v;
      count++;
    }
  }
  const thr = peak * 0.001;
  let lastIdx = 0;
  for (const d of channels) {
    for (let i = d.length - 1; i >= 0; i--) {
      if (Math.abs(d[i]) > thr) {
        lastIdx = Math.max(lastIdx, i);
        break;
      }
    }
  }
  const first = Math.max(...channels.map((d) => Math.abs(d[0] ?? 0)));
  const last = Math.max(...channels.map((d) => Math.abs(d[d.length - 1] ?? 0)));
  return {
    peak,
    rms: Math.sqrt(sum / Math.max(1, count)),
    nan,
    clipped,
    dc: dcSum / Math.max(1, count),
    effective: lastIdx / sr,
    first,
    last,
    maxStep,
  };
}

/** Waveshaper curves (cached by key). */
const curveCache = new Map<string, Float32Array>();
export function shaperCurve(kind: 'tanh' | 'hard' | 'fold' | 'asym', amount: number): Float32Array {
  const a = Math.round(Math.max(0, Math.min(1, amount)) * 20) / 20;
  const key = kind + a;
  let c = curveCache.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const drive = 1 + a * 24;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case 'hard':
        y = Math.max(-1, Math.min(1, x * drive)) * 0.9;
        break;
      case 'fold':
        y = Math.sin(x * (1 + a * 5) * Math.PI * 0.5) * 0.9;
        break;
      case 'asym':
        y = Math.tanh(x * drive + 0.3 * a) - Math.tanh(0.3 * a);
        y *= 0.9 / Math.tanh(drive);
        break;
      default:
        y = Math.tanh(x * drive) / Math.tanh(drive);
    }
    c[i] = y;
  }
  curveCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// WebAudio resources
// ---------------------------------------------------------------------------

export interface AudioResources {
  noise: AudioBuffer;
  white: AudioBuffer;
  brown: AudioBuffer;
}

export function makeBuffer(ac: BaseAudioContext, data: Float32Array, sampleRate = ac.sampleRate): AudioBuffer {
  const buf = ac.createBuffer(1, data.length, sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

export function makeResources(ac: BaseAudioContext): AudioResources {
  const len = Math.floor(ac.sampleRate * 2);
  return {
    noise: makeBuffer(ac, makeNoiseArray(len, 'pink')),
    white: makeBuffer(ac, makeNoiseArray(len, 'white')),
    brown: makeBuffer(ac, makeNoiseArray(len, 'brown')),
  };
}

export interface ReverbParams {
  /** RT60 seconds. */
  decay: number;
  /** Damping low-pass cutoff (Hz) inside the feedback loop. */
  damping: number;
  /** Output (wet) level. */
  mix: number;
}

export interface Reverb {
  readonly input: GainNode;
  readonly output: GainNode;
  set(p: Partial<ReverbParams>, time?: number): void;
  readonly params: ReverbParams;
  disconnect(): void;
}

/** Comb lengths (s): roughly co-prime in samples so their resonances do not line up. */
const FDN_TIMES = [0.0297, 0.0353, 0.0411, 0.0467, 0.0527, 0.0601];
/** Output weight per comb (alternating sign decorrelates them). */
const COMB_OUT = 0.42;
/**
 * Resonance of the damping low-passes inside the loop. WebAudio lowpass Q is in dB:
 * -6 dB = a linear Q of 0.5, which never boosts any frequency (|H| <= 1). A positive
 * value (the old 0.5 dB = linear Q 1.06) peaks ~1.2x just below the cutoff, which pushed
 * long reverbs (music hall, caves, temples) past unity loop gain: a tone that grew until
 * it was a full-scale screech.
 */
export const FDN_DAMP_Q_DB = -6;
/** Ceiling on any line's feedback gain, whatever the decay (stability margin). */
export const FDN_MAX_LOOP_GAIN = 0.97;

/** Feedback gain of a delay line `time` seconds long for an RT60 of `decay` seconds. */
export function fdnLoopGain(time: number, decay: number): number {
  return Math.min(FDN_MAX_LOOP_GAIN, Math.pow(10, (-3 * time) / Math.max(0.1, decay)));
}

/** |H| at `f` Hz of a WebAudio lowpass BiquadFilterNode (spec formulas, Q in dB). */
export function lowpassMagnitude(f: number, cutoff: number, qDb: number, sampleRate: number): number {
  const w0 = (2 * Math.PI * Math.min(cutoff, sampleRate / 2 - 1)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const c = Math.cos(w0);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = (1 - c) / 2;
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const w = (2 * Math.PI * f) / sampleRate;
  const re = (k0: number, k1: number, k2: number) => k0 + k1 * Math.cos(w) + k2 * Math.cos(2 * w);
  const im = (k1: number, k2: number) => -(k1 * Math.sin(w) + k2 * Math.sin(2 * w));
  return Math.hypot(re(b0, b1, b2), im(b1, b2)) / Math.hypot(re(a0, a1, a2), im(a1, a2));
}

/**
 * Worst-case gain once around any comb loop (any line, any frequency). Each loop is
 * independent, so the reverb is stable when this stays below 1.
 */
export function fdnWorstLoopGain(p: Pick<ReverbParams, 'decay' | 'damping'>, size = 1, sampleRate = 48000): number {
  let worst = 0;
  for (const t0 of FDN_TIMES) {
    const g = fdnLoopGain(t0 * size, p.decay);
    for (let f = 20; f < sampleRate / 2; f *= 1.02) worst = Math.max(worst, g * lowpassMagnitude(f, p.damping, FDN_DAMP_Q_DB, sampleRate));
  }
  return worst;
}

/**
 * Reverb without convolution: pre-delay → allpass diffusion → 6 parallel damped
 * comb filters (Schroeder/Moorer), plus early reflections. Fixed node count (~35),
 * created once per bus group.
 *
 * The combs are deliberately independent loops. An earlier version cross-coupled four
 * lines through a Hadamard matrix, which is stable on paper, but Chrome renders delay
 * cycles that share nodes with extra render-quantum delay on some paths and not others;
 * that breaks the matrix's orthogonality and the network gained energy until it was a
 * full-scale screech (music hall after ~15 s, caves, temples). A single self-loop with
 * gain below 1 stays stable however the browser schedules it.
 */
export function createReverb(ac: BaseAudioContext, init: Partial<ReverbParams> = {}, size = 1): Reverb {
  const params: ReverbParams = { decay: init.decay ?? 1.6, damping: init.damping ?? 5200, mix: init.mix ?? 0.25 };
  const input = ac.createGain();
  const output = ac.createGain();
  output.gain.value = params.mix;
  const pre = ac.createDelay(0.2);
  pre.delayTime.value = 0.011 * size;
  const ap1 = ac.createBiquadFilter();
  ap1.type = 'allpass';
  ap1.frequency.value = 820;
  ap1.Q.value = 0.6;
  const ap2 = ac.createBiquadFilter();
  ap2.type = 'allpass';
  ap2.frequency.value = 2400;
  ap2.Q.value = 0.6;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 110;
  input.connect(hp).connect(pre).connect(ap1).connect(ap2);
  const damps: BiquadFilterNode[] = [];
  const feedbacks: GainNode[] = [];
  const times = FDN_TIMES.map((t) => t * size);
  const loopGain = (i: number) => fdnLoopGain(times[i], params.decay);
  for (let i = 0; i < times.length; i++) {
    // s = input + g · lowpass(delayed s): one independent comb per line.
    const s = ac.createGain();
    s.gain.value = 1;
    const d = ac.createDelay(1);
    d.delayTime.value = times[i];
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = params.damping;
    lp.Q.value = FDN_DAMP_Q_DB;
    const fb = ac.createGain();
    fb.gain.value = loopGain(i);
    ap2.connect(s);
    s.connect(d).connect(lp).connect(fb).connect(s);
    const og = ac.createGain();
    og.gain.value = i % 2 ? -COMB_OUT : COMB_OUT;
    lp.connect(og).connect(output);
    damps.push(lp);
    feedbacks.push(fb);
  }
  // Early reflections.
  for (const [dt, g] of [[0.0071, 0.32], [0.0133, 0.24], [0.0197, 0.18]] as const) {
    const tap = ac.createDelay(0.1);
    tap.delayTime.value = dt * size;
    const tg = ac.createGain();
    tg.gain.value = g;
    pre.connect(tap).connect(tg).connect(output);
  }
  const set = (p: Partial<ReverbParams>, time = ac.currentTime): void => {
    if (p.decay !== undefined && Number.isFinite(p.decay)) params.decay = Math.max(0.2, Math.min(8, p.decay));
    if (p.damping !== undefined && Number.isFinite(p.damping)) params.damping = Math.max(500, Math.min(16000, p.damping));
    if (p.mix !== undefined && Number.isFinite(p.mix)) params.mix = Math.max(0, Math.min(1.5, p.mix));
    for (let i = 0; i < times.length; i++) {
      damps[i].frequency.setTargetAtTime(params.damping, time, 0.3);
      feedbacks[i].gain.setTargetAtTime(loopGain(i), time, 0.3);
    }
    output.gain.setTargetAtTime(params.mix, time, 0.3);
  };
  return {
    input,
    output,
    params,
    set,
    disconnect() {
      try {
        input.disconnect();
        output.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
}
