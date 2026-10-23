import { aliasSound, registerLoop, registerSound, type RecipeOpts } from '../registry';
import {
  droplets,
  filt,
  gain,
  glide,
  grains,
  noise,
  noiseAHR,
  noiseHit,
  noiseVoice,
  osc,
  panner,
  ping,
  rand,
  send,
  shaper,
  swell,
  thump,
  VOWELS,
  type AC,
} from '../synth';
import { crackle } from './elements';
import { lfo, loopNoise, stopAll } from './util';

/**
 * Avatar State, Elements Sphere and ultimate impacts (ids for the avatar module).
 */

/** Formant "choir" chord with a swell envelope. */
function choirChord(ac: AC, out: AudioNode, t: number, freqs: number[], rise: number, hold: number, release: number, peak: number): GainNode {
  const env = swell(ac, t, rise, hold, release, peak);
  env.connect(out);
  const mix = gain(ac, 1);
  [3, 2.2, 1].forEach((g, k) => {
    const bp = filt(ac, 'bandpass', VOWELS.a[k], 7);
    const gg = gain(ac, g);
    mix.connect(bp).connect(gg).connect(env);
  });
  const dur = rise + hold + release + 0.1;
  for (const f of freqs) {
    for (const d of [-8, 7]) {
      const o = osc(ac, 'sawtooth', f, t, dur, d);
      o.connect(mix);
    }
  }
  return env;
}

registerSound(
  'avatar.surge',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Rising sub.
    const sub = osc(ac, 'sine', 38 * p, t, 2.6);
    glide(sub.frequency, t, 36 * p, 74 * p, 1.0);
    const sg = swell(ac, t, 0.9, 0.5, 1.1, 0.45 * v);
    sub.connect(sg).connect(out);
    // Choir chord blooming.
    const ch = choirChord(ac, out, t + 0.1, [110 * p, 165 * p, 220 * p], 0.9, 0.6, 1.0, 0.12 * v);
    send(ac, ch, o.reverb, 0.6);
    // Wind rush.
    const w = noise(ac, o.noise, t, 1.6);
    const wf = filt(ac, 'bandpass', 300 * p, 0.8);
    wf.frequency.exponentialRampToValueAtTime(2600 * p, t + 1.0);
    wf.frequency.exponentialRampToValueAtTime(900 * p, t + 1.6);
    const wg = swell(ac, t, 0.95, 0.05, 0.6, 0.32 * v);
    w.connect(wf).connect(wg).connect(out);
    // Shimmer.
    for (const f of [1760, 2640, 3520]) {
      const s = osc(ac, 'sine', f * p, t + 0.6, 1.9);
      const tr = gain(ac, 0.6);
      const tl = osc(ac, 'sine', rand(6, 9), t + 0.6, 1.9);
      const tg = gain(ac, 0.4);
      tl.connect(tg).connect(tr.gain);
      const g = swell(ac, t + 0.6, 0.5, 0.4, 0.9, 0.025 * v);
      s.connect(tr).connect(g).connect(out);
    }
    // Impact at the peak.
    thump(ac, out, t + 1.0, 72 * p, 30 * p, 0.8, 0.5 * v, 0.15);
    const im = noiseVoice(ac, out, o.noise, t + 1.0, 'lowpass', 2400 * p, 0.7, 0.003, 0, 0.5, 0.3 * v);
    send(ac, im.env, o.reverb, 0.5);
    return 2.6;
  },
  { duration: 3.0, maxVoices: 1, cooldown: 0.5, priority: 3, reverb: 0.2, range: 200, desc: 'Avatar State transformation surge' },
);
aliasSound('avatar_surge', 'avatar.surge');

registerSound(
  'avatar.release',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const w = noise(ac, o.noise, t, 1.3);
    const wf = filt(ac, 'bandpass', 2400 * p, 0.8);
    wf.frequency.exponentialRampToValueAtTime(260 * p, t + 1.2);
    const wg = swell(ac, t, 0.1, 0.2, 0.9, 0.22 * v);
    w.connect(wf).connect(wg).connect(out);
    choirChord(ac, out, t, [220 * p, 330 * p], 0.05, 0.3, 0.9, 0.08 * v);
    thump(ac, out, t + 0.05, 60 * p, 35 * p, 0.4, 0.25 * v);
    return 1.35;
  },
  { duration: 1.7, maxVoices: 1, cooldown: 0.5, priority: 3, desc: 'Avatar State ends (power settles)' },
);

registerLoop(
  'loop.avatar.hum',
  (ac, out, o) => {
    const g = gain(ac, 1);
    g.connect(out);
    const nodes: AudioScheduledSourceNode[] = [];
    const lp = filt(ac, 'lowpass', 520, 0.8);
    nodes.push(lfo(ac, 0.11, 180, lp.frequency));
    const dg = gain(ac, 0.11);
    lp.connect(dg).connect(g);
    for (const [f, d] of [[55, -5], [55, 6], [82.5, 3], [110, -4]] as const) {
      const s = ac.createOscillator();
      s.type = 'sawtooth';
      s.frequency.value = f;
      s.detune.value = d;
      s.connect(lp);
      s.start();
      nodes.push(s);
    }
    // Shimmer partials with slow tremolo.
    const sh = gain(ac, 0.012);
    sh.connect(g);
    for (const f of [1760, 2200, 2640]) {
      const s = ac.createOscillator();
      s.frequency.value = f;
      const tr = gain(ac, 0.5);
      nodes.push(lfo(ac, rand(0.3, 0.7), 0.5, tr.gain));
      s.connect(tr).connect(sh);
      s.start();
      nodes.push(s);
    }
    // Breath of wind under it all.
    const n = loopNoise(ac, o.noise);
    const nf = filt(ac, 'bandpass', 700, 0.7);
    nodes.push(lfo(ac, 0.07, 250, nf.frequency));
    const ng = gain(ac, 0.06);
    n.connect(nf).connect(ng).connect(g);
    nodes.push(n);
    return {
      stop(t: number) {
        stopAll(nodes, t);
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') {
          const k = Math.max(0, Math.min(1.5, v));
          lp.frequency.setTargetAtTime(380 + 500 * k, ac.currentTime, 0.3);
          sh.gain.setTargetAtTime(0.006 + 0.02 * k, ac.currentTime, 0.3);
        }
      },
    };
  },
  { desc: 'sustained Avatar State hum (drone + shimmer + breath)', params: ['intensity'] },
);

/** Elemental textures: air / water / earth / fire noise layers. */
function elementLayer(ac: AC, out: AudioNode, o: { noise: AudioBuffer; white: AudioBuffer; brown: AudioBuffer }, el: 0 | 1 | 2 | 3, t: number, dur: number, peak: number, pan: [number, number]): void {
  const p = panner(ac, pan[0]);
  if ('pan' in p) {
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + dur);
  }
  p.connect(out);
  if (el === 0) {
    const s = noise(ac, o.noise, t, dur);
    const f = filt(ac, 'bandpass', 900, 1);
    f.frequency.exponentialRampToValueAtTime(2800, t + dur * 0.6);
    const g = swell(ac, t, dur * 0.4, dur * 0.2, dur * 0.4, peak);
    s.connect(f).connect(g).connect(p);
  } else if (el === 1) {
    const s = noise(ac, o.noise, t, dur);
    const f = filt(ac, 'bandpass', 700, 2);
    const am = gain(ac, 0.7);
    const l = osc(ac, 'triangle', 26, t, dur);
    const lg = gain(ac, 0.3);
    l.connect(lg).connect(am.gain);
    const g = swell(ac, t, dur * 0.4, dur * 0.2, dur * 0.4, peak);
    s.connect(f).connect(am).connect(g).connect(p);
    droplets(ac, p, t + dur * 0.3, dur * 0.6, 6, 700, 1800, peak * 0.2);
  } else if (el === 2) {
    noiseAHR(ac, p, o.brown, t, 'lowpass', 200, 0.8, dur * 0.4, dur * 0.2, dur * 0.4, peak * 1.3);
    grains(ac, p, o.white, t, dur, 14, { fLo: 900, fHi: 3000, q: 2, dur: 0.012, peak: peak * 0.3 });
  } else {
    const s = noise(ac, o.noise, t, dur);
    const f = filt(ac, 'lowpass', 1100, 1);
    const sh = shaper(ac, 'asym', 0.5);
    const g = swell(ac, t, dur * 0.4, dur * 0.2, dur * 0.4, peak);
    s.connect(f).connect(sh).connect(g).connect(p);
  }
}

registerSound(
  'avatar.sphere.activate',
  (ac, out, t, o) => {
    const v = o.volume;
    const pans: Array<[number, number]> = [[-1, 0.4], [0.9, -0.3], [-0.6, 0.7], [0.7, -0.8]];
    for (let i = 0; i < 4; i++) elementLayer(ac, out, o, i as 0 | 1 | 2 | 3, t + i * 0.4, 1.3, 0.22 * v, pans[i]);
    const ch = choirChord(ac, out, t + 1.7, [147 * o.pitch, 220 * o.pitch, 294 * o.pitch], 0.5, 0.4, 0.9, 0.1 * v);
    send(ac, ch, o.reverb, 0.6);
    for (let i = 0; i < 5; i++) ping(ac, out, t + 1.8 + i * 0.09, [1175, 1480, 1760, 2349, 2960][i] * o.pitch, 1.0, 0.04 * v);
    thump(ac, out, t + 1.7, 65 * o.pitch, 30 * o.pitch, 0.7, 0.4 * v);
    return 3.2;
  },
  { duration: 3.6, maxVoices: 1, cooldown: 0.5, priority: 3, range: 200, desc: 'Elements Sphere activation (all four elements converge)' },
);

registerSound(
  'avatar.sphere.release',
  (ac, out, t, o) => {
    const v = o.volume;
    for (let i = 0; i < 4; i++) elementLayer(ac, out, o, i as 0 | 1 | 2 | 3, t + i * 0.08, 1.1, 0.14 * v, [0, i % 2 ? 1 : -1]);
    thump(ac, out, t + 0.3, 60 * o.pitch, 30 * o.pitch, 0.6, 0.35 * v);
    return 1.5;
  },
  { duration: 1.8, maxVoices: 1, cooldown: 0.5, priority: 3, desc: 'Elements Sphere dissipates' },
);

registerLoop(
  'loop.avatar.sphere',
  (ac, out, o) => {
    const g = gain(ac, 1);
    g.connect(out);
    const nodes: AudioScheduledSourceNode[] = [];
    const layer = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, lvl: number, rot: number, phase: number, drive = false) => {
      const s = loopNoise(ac, buf);
      const fl = filt(ac, type, f, q);
      const lg = gain(ac, lvl);
      const pn = panner(ac, 0);
      let head: AudioNode = fl;
      if (drive) {
        const sh = shaper(ac, 'asym', 0.4);
        fl.connect(sh);
        head = sh;
      }
      s.connect(fl);
      head.connect(lg).connect(pn).connect(g);
      if ('pan' in pn) {
        const r = ac.createOscillator();
        r.frequency.value = rot;
        const rg = gain(ac, 0.8);
        r.connect(rg).connect(pn.pan);
        r.start(ac.currentTime + phase / rot);
        nodes.push(r);
      }
      nodes.push(s);
      return fl;
    };
    const airF = layer(o.noise, 'bandpass', 1800, 1, 0.1, 0.25, 0);
    nodes.push(lfo(ac, 0.4, 600, airF.frequency));
    layer(o.noise, 'bandpass', 700, 2, 0.12, 0.25, 0.25);
    layer(o.brown, 'lowpass', 180, 0.8, 0.3, 0.25, 0.5);
    layer(o.noise, 'lowpass', 900, 1, 0.12, 0.25, 0.75, true);
    // Chord drone.
    const dl = filt(ac, 'lowpass', 700, 0.7);
    const dg = gain(ac, 0.06);
    dl.connect(dg).connect(g);
    for (const f of [73.4, 110, 146.8]) {
      for (const d of [-5, 5]) {
        const s = ac.createOscillator();
        s.type = 'sawtooth';
        s.frequency.value = f;
        s.detune.value = d;
        s.connect(dl);
        s.start();
        nodes.push(s);
      }
    }
    return {
      stop(t: number) {
        stopAll(nodes, t);
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') g.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.3);
      },
    };
  },
  { desc: 'Elements Sphere sustained loop (four elements orbiting + chord drone)', params: ['intensity'] },
);

// ---------------------------------------------------------------------------
// Ultimates (impacts for the avatar module)
// ---------------------------------------------------------------------------

function howl(ac: AC, out: AudioNode, o: RecipeOpts, t: number, dur: number, peak: number): void {
  const s = noise(ac, o.white, t, dur);
  const f = filt(ac, 'bandpass', 620 * o.pitch, 11);
  f.frequency.setValueAtTime(600 * o.pitch, t);
  f.frequency.linearRampToValueAtTime(950 * o.pitch, t + dur * 0.4);
  f.frequency.linearRampToValueAtTime(700 * o.pitch, t + dur);
  const g = swell(ac, t, dur * 0.35, dur * 0.3, dur * 0.35, peak);
  s.connect(f).connect(g).connect(out);
}

function hurricane(ac: AC, out: AudioNode, o: RecipeOpts, t: number, k: number): void {
  const v = o.volume * k;
  for (const [f, q, pk, rate] of [[300, 0.8, 0.3, 5], [900, 1, 0.22, 7], [2500, 1.2, 0.1, 9]] as const) {
    const s = noise(ac, o.noise, t, 3.2);
    const fl = filt(ac, 'bandpass', f * o.pitch, q);
    const l = osc(ac, 'sine', rate, t, 3.2);
    const lg = gain(ac, f * 0.35 * o.pitch);
    l.connect(lg).connect(fl.frequency);
    const g = swell(ac, t, 1.1, 1.0, 1.0, pk * v);
    s.connect(fl).connect(g).connect(out);
  }
  howl(ac, out, o, t + 0.2, 2.8, 0.1 * v);
  noiseAHR(ac, out, o.brown, t, 'lowpass', 150 * o.pitch, 0.8, 1, 1, 1, 0.3 * v);
}

registerSound(
  'ult.hurricane',
  (ac, out, t, o) => {
    hurricane(ac, out, o, t, 1);
    return 3.2;
  },
  { duration: 3.6, maxVoices: 1, priority: 3, range: 300, desc: 'ultimate: hurricane (howling vortex roar)' },
);

function tsunami(ac: AC, out: AudioNode, o: RecipeOpts, t: number, k: number): void {
  const v = o.volume * k;
  const p = o.pitch;
  const rise = noiseVoice(ac, out, o.brown, t, 'lowpass', 200 * p, 0.8, 1.5, 0.1, 0.6, 0.45 * v);
  rise.filter.frequency.exponentialRampToValueAtTime(1500 * p, t + 1.5);
  noiseAHR(ac, out, o.noise, t, 'bandpass', 800 * p, 0.7, 1.4, 0.1, 0.5, 0.18 * v);
  const tc = t + 1.6;
  thump(ac, out, tc, 62 * p, 25 * p, 0.9, 0.55 * v, 0.2);
  const crash = noiseVoice(ac, out, o.white, tc, 'lowpass', 6000 * p, 0.7, 0.005, 0.1, 1.5, 0.35 * v);
  crash.filter.frequency.exponentialRampToValueAtTime(400 * p, tc + 1.5);
  send(ac, crash.env, o.reverb, 0.5);
  noiseAHR(ac, out, o.noise, tc + 0.1, 'bandpass', 1200 * p, 0.7, 0.2, 0.6, 1.2, 0.18 * v);
  noiseAHR(ac, out, o.white, tc + 0.2, 'highpass', 4000 * p, 0.7, 0.3, 0.4, 1.0, 0.06 * v);
  droplets(ac, out, tc + 0.1, 1.6, 26, 600 * p, 2200 * p, 0.05 * v);
}

registerSound(
  'ult.tsunami',
  (ac, out, t, o) => {
    tsunami(ac, out, o, t, 1);
    return 3.6;
  },
  { duration: 4.0, maxVoices: 1, priority: 3, range: 300, desc: 'ultimate: tsunami (rising roar, crash, foaming wash)' },
);

function earthquake(ac: AC, out: AudioNode, o: RecipeOpts, t: number, k: number): void {
  const v = o.volume * k;
  const p = o.pitch;
  thump(ac, out, t, 80 * p, 28 * p, 0.8, 0.6 * v, 0.2);
  const s = osc(ac, 'sine', 32 * p, t, 3.3);
  const jit = gain(ac, 0.6);
  const l = osc(ac, 'square', 9, t, 3.3);
  const lg = gain(ac, 0.4);
  l.connect(lg).connect(jit.gain);
  const sg = swell(ac, t, 0.3, 1.8, 1.1, 0.4 * v);
  s.connect(jit).connect(sg).connect(out);
  noiseAHR(ac, out, o.brown, t, 'lowpass', 150 * p, 0.8, 0.3, 1.8, 1.1, 0.45 * v);
  for (let i = 0; i < 7; i++) {
    const tt = t + 0.3 + Math.random() * 2.4;
    noiseHit(ac, out, o.white, tt, 'bandpass', rand(900, 2000) * p, 0.9, 0.001, 0.05, rand(0.12, 0.25) * v);
    thump(ac, out, tt, 110 * p, 60 * p, 0.12, 0.15 * v);
  }
  grains(ac, out, o.white, t + 0.2, 2.8, 50, { fLo: 1200 * p, fHi: 5000 * p, q: 1.6, dur: 0.01, peak: 0.1 * v });
}

registerSound(
  'ult.earthquake',
  (ac, out, t, o) => {
    earthquake(ac, out, o, t, 1);
    return 3.4;
  },
  { duration: 3.8, maxVoices: 1, priority: 3, range: 300, desc: 'ultimate: earthquake (sub rumble, cracking ground, debris)' },
);

function fireTornado(ac: AC, out: AudioNode, o: RecipeOpts, t: number, k: number): void {
  const v = o.volume * k;
  const p = o.pitch;
  const s = noise(ac, o.noise, t, 3.4);
  const s2 = noise(ac, o.brown, t, 3.4);
  const mix = gain(ac, 1);
  s.connect(mix);
  s2.connect(mix);
  const lp = filt(ac, 'lowpass', 1100 * p, 1);
  const bp = filt(ac, 'bandpass', 700 * p, 1.4);
  const l = osc(ac, 'sine', 6, t, 3.4);
  const lg = gain(ac, 450 * p);
  l.connect(lg).connect(bp.frequency);
  const sh = shaper(ac, 'asym', 0.55);
  const g = swell(ac, t, 1, 1.2, 1.1, 0.42 * v);
  mix.connect(lp).connect(bp).connect(sh).connect(g).connect(out);
  for (let i = 0; i < 5; i++) {
    const tt = t + 0.3 + i * 0.5;
    const w = noiseHit(ac, out, o.noise, tt, 'lowpass', 2800 * p, 0.8, 0.08, 0.3, 0.14 * v);
    w.frequency.exponentialRampToValueAtTime(600 * p, tt + 0.38);
  }
  crackle(ac, out, o, t + 0.2, 3.0, 40, 0.1 * v);
  noiseAHR(ac, out, o.brown, t, 'lowpass', 120 * p, 0.8, 1, 1.2, 1.1, 0.3 * v);
}

registerSound(
  'ult.firetornado',
  (ac, out, t, o) => {
    fireTornado(ac, out, o, t, 1);
    return 3.4;
  },
  { duration: 3.8, maxVoices: 1, priority: 3, range: 300, desc: 'ultimate: fire tornado (roaring, rotating flames)' },
);

registerSound(
  'ult.cataclysm',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Opening boom.
    thump(ac, out, t, 90 * p, 24 * p, 1.4, 0.55 * v, 0.25);
    const b = noiseVoice(ac, out, o.white, t, 'lowpass', 5000 * p, 0.7, 0.003, 0.05, 1.2, 0.3 * v);
    b.filter.frequency.exponentialRampToValueAtTime(200 * p, t + 1.2);
    send(ac, b.env, o.reverb, 0.7);
    earthquake(ac, out, o, t + 0.3, 0.55);
    hurricane(ac, out, o, t + 0.5, 0.5);
    fireTornado(ac, out, o, t + 0.7, 0.45);
    tsunami(ac, out, o, t + 0.4, 0.45);
    choirChord(ac, out, t + 1.4, [73.4 * p, 110 * p, 146.8 * p, 220 * p], 0.8, 0.8, 1.2, 0.07 * v);
    return 4.3;
  },
  { duration: 4.8, maxVoices: 1, priority: 3, range: 400, desc: 'ultimate: cataclysm (all four elements at once)' },
);

