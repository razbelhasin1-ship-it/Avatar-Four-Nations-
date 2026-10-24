import { registerLoop, registerSound, type RecipeOpts } from '../registry';
import {
  babble,
  chance,
  filt,
  gain,
  glide,
  noise,
  noiseAHR,
  noiseHit,
  osc,
  perc,
  rand,
  randi,
  shaper,
  swell,
  thump,
  VOICE_TYPES,
  VOWELS,
  type AC,
} from '../synth';
import { eventPump } from './util';

/**
 * Voices: NPC talk babble per voice type (formant synthesis — not words, but
 * voice-like syllables with intonation), short grunts, and companion /
 * creature vocalisations for the companions module.
 */

// ---------------------------------------------------------------------------
// NPC babble
// ---------------------------------------------------------------------------

export const VOICE_IDS = Object.keys(VOICE_TYPES);

function speak(ac: AC, out: AudioNode, t: number, o: RecipeOpts, type: string, syl: number, question: boolean): number {
  const base = VOICE_TYPES[type] ?? VOICE_TYPES.male;
  const spec = { ...base, f0: base.f0 * o.pitch, formant: base.formant * Math.pow(o.pitch, 0.25) };
  return babble(ac, out, t, spec, syl, o.noise, 0.32 * o.volume, question);
}

for (const type of VOICE_IDS) {
  registerSound(`voice.${type}`, (ac, out, t, o) => speak(ac, out, t, o, type, randi(4, 7), false), {
    duration: 1.4,
    maxVoices: 2,
    cooldown: 0.1,
    range: 30,
    desc: `talk babble, ${type} voice (a phrase)`,
  });
  registerSound(`voice.${type}.short`, (ac, out, t, o) => speak(ac, out, t, o, type, randi(2, 3), false), {
    duration: 0.75,
    maxVoices: 2,
    cooldown: 0.1,
    range: 30,
    desc: `short babble, ${type} voice (greeting / acknowledgement)`,
  });
  registerSound(`voice.${type}.ask`, (ac, out, t, o) => speak(ac, out, t, o, type, randi(3, 6), true), {
    duration: 1.3,
    maxVoices: 2,
    cooldown: 0.1,
    range: 30,
    desc: `questioning babble (rising), ${type} voice`,
  });
}

function grunt(ac: AC, out: AudioNode, t: number, o: RecipeOpts, f0: number, vowel: [number, number, number], dur: number, drop: number, peak: number, rough: number): void {
  const s = osc(ac, 'sawtooth', f0, t, dur + 0.05);
  glide(s.frequency, t, f0 * 1.15, f0 * drop, dur);
  const env = swell(ac, t, Math.min(0.04, dur * 0.2), dur * 0.2, dur * 0.6, peak);
  let src: AudioNode = s;
  if (rough > 0) {
    const vca = gain(ac, 1 - rough * 0.5);
    const am = osc(ac, 'sine', rand(26, 34), t, dur + 0.05);
    const ag = gain(ac, rough * 0.5);
    am.connect(ag).connect(vca.gain);
    s.connect(vca);
    src = vca;
  }
  const lp = filt(ac, 'lowpass', 3000, 0.7);
  env.connect(lp).connect(out);
  [2.4, 3, 1.5].forEach((g, k) => {
    const bp = filt(ac, 'bandpass', vowel[k], k ? 9 : 6);
    const gg = gain(ac, g);
    src.connect(bp).connect(gg).connect(env);
  });
  noiseAHR(ac, out, o.noise, t, 'bandpass', vowel[1], 2, 0.02, dur * 0.3, dur * 0.5, peak * 0.15);
}

registerSound(
  'voice.effort',
  (ac, out, t, o) => {
    grunt(ac, out, t, o, 135 * o.pitch, VOWELS.uh, 0.18, 0.85, 0.3 * o.volume, 0.1);
    return 0.25;
  },
  { duration: 0.4, maxVoices: 2, cooldown: 0.3, desc: 'exertion grunt ("hup!") — pitch 1 male, ~1.7 female' },
);

registerSound(
  'voice.hurt',
  (ac, out, t, o) => {
    grunt(ac, out, t, o, 150 * o.pitch, VOWELS.a, 0.32, 0.7, 0.32 * o.volume, 0.3);
    return 0.4;
  },
  { duration: 0.55, maxVoices: 2, cooldown: 0.5, desc: 'pain grunt ("agh") — pitch 1 male, ~1.7 female' },
);

registerSound(
  'voice.crowd.cheer',
  (ac, out, t, o) => {
    for (let i = 0; i < 7; i++) {
      const type = ['male', 'female', 'child', 'gruff'][i % 4];
      const base = VOICE_TYPES[type];
      const spec = { ...base, f0: base.f0 * rand(1.1, 1.4) * o.pitch, rate: 6 };
      babble(ac, out, t + rand(0, 0.25), spec, randi(2, 4), o.noise, 0.09 * o.volume, true);
    }
    noiseAHR(ac, out, o.noise, t, 'bandpass', 1200, 0.6, 0.15, 0.4, 0.6, 0.06 * o.volume);
    return 1.3;
  },
  { duration: 1.6, maxVoices: 2, desc: 'small crowd cheer (arena, festival)' },
);

// ---------------------------------------------------------------------------
// Creatures & companions
// ---------------------------------------------------------------------------

/** Formant-filtered tonal call with a pitch contour (shared by many creatures). */
function call(
  ac: AC,
  out: AudioNode,
  t: number,
  o: RecipeOpts,
  c: { wave: OscillatorType; f: ReadonlyArray<readonly [number, number]>; dur: number; vowels: [number, number, number][]; fscale: number; peak: number; rough?: number; roughRate?: number; drive?: number; breath?: number; sub?: number; lp?: number },
): void {
  const p = o.pitch;
  const s = osc(ac, c.wave, c.f[0][1] * p, t, c.dur + 0.05);
  s.frequency.setValueAtTime(c.f[0][1] * p, t + c.f[0][0]);
  for (let i = 1; i < c.f.length; i++) s.frequency.exponentialRampToValueAtTime(Math.max(10, c.f[i][1] * p), t + c.f[i][0]);
  let src: AudioNode = s;
  if (c.rough) {
    const vca = gain(ac, 1 - c.rough * 0.5);
    const am = osc(ac, 'square', c.roughRate ?? 30, t, c.dur + 0.05);
    const ag = gain(ac, c.rough * 0.5);
    am.connect(ag).connect(vca.gain);
    s.connect(vca);
    src = vca;
  }
  if (c.drive) {
    const sh = shaper(ac, 'tanh', c.drive);
    src.connect(sh);
    src = sh;
  }
  const env = swell(ac, t, Math.min(0.08, c.dur * 0.25), c.dur * 0.35, c.dur * 0.4, c.peak * o.volume);
  const lp = filt(ac, 'lowpass', c.lp ?? 4000, 0.7);
  env.connect(lp).connect(out);
  const bands: BiquadFilterNode[] = [];
  [2.6, 3, 1.6].forEach((g, k) => {
    const bp = filt(ac, 'bandpass', c.vowels[0][k] * c.fscale, k ? 8 : 5);
    const gg = gain(ac, g);
    src.connect(bp).connect(gg).connect(env);
    bands.push(bp);
  });
  // Move through the vowel sequence.
  c.vowels.forEach((v, i) => {
    if (i === 0) return;
    const tt = t + (c.dur * i) / c.vowels.length;
    bands.forEach((b, k) => b.frequency.setTargetAtTime(v[k] * c.fscale, tt, 0.08));
  });
  if (c.sub) {
    const sub = osc(ac, 'sine', (c.f[0][1] * p) / 2, t, c.dur + 0.05);
    for (let i = 1; i < c.f.length; i++) sub.frequency.exponentialRampToValueAtTime(Math.max(10, (c.f[i][1] * p) / 2), t + c.f[i][0]);
    const sg = swell(ac, t, Math.min(0.1, c.dur * 0.3), c.dur * 0.3, c.dur * 0.4, c.sub * c.peak * o.volume);
    sub.connect(sg).connect(out);
  }
  if (c.breath) noiseAHR(ac, out, o.noise, t, 'bandpass', 700 * p, 0.8, c.dur * 0.25, c.dur * 0.35, c.dur * 0.4, c.breath * c.peak * o.volume);
}

registerSound(
  'creature.skybison.groan',
  (ac, out, t, o) => {
    call(ac, out, t, o, { wave: 'sawtooth', f: [[0, 52], [0.8, 70], [1.6, 60], [2.2, 46]], dur: 2.2, vowels: [VOWELS.u, VOWELS.o, VOWELS.a, VOWELS.u], fscale: 0.55, peak: 0.42, sub: 0.9, breath: 0.6, lp: 1300 });
    return 2.3;
  },
  { duration: 2.6, maxVoices: 2, cooldown: 0.8, reverb: 0.3, range: 160, desc: 'sky bison deep, friendly groan' },
);

registerSound(
  'creature.skybison.huff',
  (ac, out, t, o) => {
    const f = noiseAHR(ac, out, o.noise, t, 'bandpass', 500 * o.pitch, 1.2, 0.08, 0.15, 0.4, 0.3 * o.volume);
    f.frequency.exponentialRampToValueAtTime(280 * o.pitch, t + 0.6);
    thump(ac, out, t, 60 * o.pitch, 40 * o.pitch, 0.3, 0.2 * o.volume);
    return 0.65;
  },
  { duration: 0.9, maxVoices: 2, cooldown: 0.5, desc: 'sky bison breath huff (mounting, idle)' },
);

registerSound(
  'creature.dragon.roar',
  (ac, out, t, o) => {
    call(ac, out, t, o, { wave: 'sawtooth', f: [[0, 105], [0.4, 150], [1.2, 125], [1.9, 75]], dur: 1.9, vowels: [VOWELS.o, VOWELS.a, VOWELS.a, VOWELS.uh], fscale: 0.75, peak: 0.42, rough: 0.6, roughRate: 32, drive: 0.5, sub: 0.6, lp: 3500 });
    const h = noiseAHR(ac, out, o.noise, t + 0.1, 'bandpass', 1500 * o.pitch, 0.8, 0.3, 0.8, 0.7, 0.14 * o.volume);
    h.frequency.exponentialRampToValueAtTime(700 * o.pitch, t + 1.8);
    thump(ac, out, t, 70 * o.pitch, 35 * o.pitch, 0.6, 0.35 * o.volume);
    return 2.0;
  },
  { duration: 2.3, maxVoices: 2, cooldown: 1, reverb: 0.3, range: 260, desc: 'dragon roar (growling, fiery)' },
);

registerSound(
  'creature.dragon.rumble',
  (ac, out, t, o) => {
    call(ac, out, t, o, { wave: 'sawtooth', f: [[0, 44], [0.9, 50], [1.8, 40]], dur: 1.8, vowels: [VOWELS.u, VOWELS.o], fscale: 0.5, peak: 0.4, rough: 0.8, roughRate: 16, sub: 1, lp: 700 });
    noiseAHR(ac, out, o.brown, t, 'lowpass', 200 * o.pitch, 0.7, 0.4, 0.8, 0.6, 0.3 * o.volume);
    return 1.85;
  },
  { duration: 2.2, maxVoices: 2, cooldown: 0.8, range: 120, desc: 'dragon low purr / rumble (content, idle)' },
);

registerSound(
  'creature.polarbeardog.bark',
  (ac, out, t, o) => {
    const n = chance(0.5) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.28;
      noiseHit(ac, out, o.noise, tt, 'bandpass', 900 * o.pitch, 1.2, 0.002, 0.05, 0.25 * o.volume);
      call(ac, out, tt, o, { wave: 'sawtooth', f: [[0, 230], [0.08, 210], [0.22, 125]], dur: 0.24, vowels: [VOWELS.o, VOWELS.a], fscale: 0.85, peak: 0.42, rough: 0.35, roughRate: 40, drive: 0.3, sub: 0.4, lp: 3000 });
    }
    return 0.3 + (n - 1) * 0.28;
  },
  { duration: 0.75, maxVoices: 2, cooldown: 0.3, range: 120, desc: 'polar bear dog bark (one or two woofs)' },
);

registerSound(
  'creature.polarbeardog.growl',
  (ac, out, t, o) => {
    call(ac, out, t, o, { wave: 'sawtooth', f: [[0, 72], [0.6, 82], [1.3, 68]], dur: 1.3, vowels: [VOWELS.uh, VOWELS.o, VOWELS.uh], fscale: 0.7, peak: 0.42, rough: 0.8, roughRate: 26, drive: 0.4, sub: 0.5, lp: 1800 });
    return 1.35;
  },
  { duration: 1.6, maxVoices: 2, cooldown: 0.6, range: 80, desc: 'polar bear dog warning growl' },
);

registerSound(
  'creature.badgermole.snort',
  (ac, out, t, o) => {
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.22;
      const f = noiseAHR(ac, out, o.noise, tt, 'bandpass', 700 * o.pitch, 3, 0.01, 0.04, 0.12, 0.32 * o.volume);
      f.frequency.exponentialRampToValueAtTime(420 * o.pitch, tt + 0.15);
      const nas = filt(ac, 'peaking', 1200 * o.pitch, 3, 8);
      const g = osc(ac, 'sawtooth', 92 * o.pitch, tt, 0.15);
      const ge = perc(ac, tt, 0.01, 0.12, 0.08 * o.volume);
      g.connect(nas).connect(ge).connect(out);
    }
    // Sniff (inhale).
    const s = noise(ac, o.white, t + 0.5, 0.25);
    const sf = filt(ac, 'bandpass', 1500 * o.pitch, 2);
    sf.frequency.exponentialRampToValueAtTime(3000 * o.pitch, t + 0.72);
    const sg = swell(ac, t + 0.5, 0.15, 0, 0.08, 0.08 * o.volume);
    s.connect(sf).connect(sg).connect(out);
    return 0.8;
  },
  { duration: 1.0, maxVoices: 2, cooldown: 0.5, range: 70, desc: 'badgermole snorts and sniff' },
);

registerSound(
  'creature.ostrichhorse.squawk',
  (ac, out, t, o) => {
    const p = o.pitch;
    const s = osc(ac, 'sawtooth', 520 * p, t, 0.5);
    s.frequency.setValueAtTime(520 * p, t);
    s.frequency.exponentialRampToValueAtTime(760 * p, t + 0.12);
    s.frequency.exponentialRampToValueAtTime(430 * p, t + 0.42);
    const mod = osc(ac, 'sine', 70, t, 0.5);
    const mg = gain(ac, 120 * p);
    mod.connect(mg).connect(s.frequency);
    const env = swell(ac, t, 0.03, 0.15, 0.25, 0.22 * o.volume);
    const lp = filt(ac, 'lowpass', 5000, 0.7);
    env.connect(lp).connect(out);
    [VOWELS.a[0] * 1.5, VOWELS.a[1] * 1.5, VOWELS.a[2] * 1.4].forEach((f, k) => {
      const bp = filt(ac, 'bandpass', f, 6);
      const g = gain(ac, [2, 2.5, 1.5][k]);
      s.connect(bp).connect(g).connect(env);
    });
    return 0.48;
  },
  { duration: 0.75, maxVoices: 2, cooldown: 0.3, range: 90, desc: 'ostrich horse squawk' },
);

registerSound(
  'creature.lemur.chirp',
  (ac, out, t, o) => {
    const n = randi(2, 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand(0.09, 0.13);
      const f0 = rand(1400, 1800) * o.pitch;
      for (const [type, mul, pk] of [['sine', 1, 0.16], ['triangle', 2, 0.04]] as const) {
        const s = osc(ac, type, f0 * mul, tt, 0.08);
        s.frequency.setValueAtTime(f0 * mul, tt);
        s.frequency.exponentialRampToValueAtTime(f0 * mul * rand(1.8, 2.2), tt + 0.045);
        const g = perc(ac, tt, 0.003, 0.05, pk * o.volume);
        s.connect(g).connect(out);
      }
    }
    return 0.45;
  },
  { duration: 0.65, maxVoices: 2, cooldown: 0.25, range: 50, desc: 'flying lemur chirps (curious, playful)' },
);

registerSound(
  'creature.turtleduck.quack',
  (ac, out, t, o) => {
    const n = chance(0.5) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.17;
      const s = osc(ac, 'square', 330 * o.pitch, tt, 0.12);
      glide(s.frequency, tt, 340 * o.pitch, 250 * o.pitch, 0.1);
      const env = perc(ac, tt, 0.006, 0.1, 0.2 * o.volume);
      const lp = filt(ac, 'lowpass', 4500, 0.7);
      env.connect(lp).connect(out);
      for (const [f, q, g] of [[1100, 4, 2], [2400, 6, 1.2]] as const) {
        const bp = filt(ac, 'bandpass', f * o.pitch, q);
        const gg = gain(ac, g);
        s.connect(bp).connect(gg).connect(env);
      }
    }
    return 0.15 + (n - 1) * 0.17 + 0.05;
  },
  { duration: 0.6, maxVoices: 3, cooldown: 0.2, range: 40, desc: 'turtle-duck quack (small, nasal)' },
);

function flap(ac: AC, out: AudioNode, o: { noise: AudioBuffer }, t: number, size: number, vol: number, pitch: number): void {
  const dur = 0.16 + 0.22 * size;
  const src = noise(ac, o.noise, t, dur + 0.05);
  const f = filt(ac, 'lowpass', (700 - 300 * size) * pitch, 1.2);
  f.frequency.setValueAtTime((900 - 400 * size) * pitch, t);
  f.frequency.exponentialRampToValueAtTime((240 - 100 * size) * pitch, t + dur);
  const g = swell(ac, t, dur * 0.3, 0, dur * 0.7, (0.35 + 0.25 * size) * vol);
  src.connect(f).connect(g).connect(out);
  const fl = noise(ac, o.noise, t, dur * 0.6);
  const ff = filt(ac, 'bandpass', 1800 * pitch, 1);
  const fg = perc(ac, t + dur * 0.15, 0.01, dur * 0.4, 0.05 * vol);
  fl.connect(ff).connect(fg).connect(out);
}

registerSound(
  'creature.wings.flap',
  (ac, out, t, o) => {
    flap(ac, out, o, t, 0.2, o.volume, o.pitch);
    return 0.3;
  },
  { duration: 0.5, maxVoices: 4, cooldown: 0.08, desc: 'single wing flap (lemur, birds, small creatures)' },
);

registerSound(
  'creature.wings.flap_large',
  (ac, out, t, o) => {
    flap(ac, out, o, t, 1, o.volume, o.pitch);
    thump(ac, out, t + 0.1, 60 * o.pitch, 40 * o.pitch, 0.2, 0.2 * o.volume);
    return 0.5;
  },
  { duration: 0.7, maxVoices: 3, cooldown: 0.15, range: 120, desc: 'large wing beat (dragon, eel-hound… any big flyer)' },
);

// Wildlife calls referenced by src/data/creatures.ts.

registerSound(
  'creature.otterpenguin.honk',
  (ac, out, t, o) => {
    const n = chance(0.6) ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.2;
      call(ac, out, tt, o, { wave: 'square', f: [[0, 380], [0.05, 430], [0.16, 300]], dur: 0.17, vowels: [VOWELS.a, VOWELS.o], fscale: 1.25, peak: 0.24, lp: 4200 });
    }
    return 0.2 + (n - 1) * 0.2;
  },
  { duration: 0.7, maxVoices: 3, cooldown: 0.25, range: 60, desc: 'otter-penguin honk (bright, nasal, one or two)' },
);

registerSound(
  'creature.hogmonkey.squeal',
  (ac, out, t, o) => {
    call(ac, out, t, o, { wave: 'sawtooth', f: [[0, 520], [0.12, 900], [0.35, 640], [0.5, 380]], dur: 0.5, vowels: [VOWELS.i, VOWELS.e, VOWELS.uh], fscale: 1.35, peak: 0.22, rough: 0.3, roughRate: 45, lp: 5200 });
    noiseHit(ac, out, o.noise, t, 'bandpass', 800 * o.pitch, 1.5, 0.004, 0.06, 0.12 * o.volume);
    return 0.55;
  },
  { duration: 0.8, maxVoices: 2, cooldown: 0.3, range: 60, desc: 'hog-monkey squeal (snort + rising squeal)' },
);

registerSound(
  'creature.elephantkoi.splash',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 80 * p, 38 * p, 0.35, 0.4 * v);
    const sv = noiseAHR(ac, out, o.noise, t, 'bandpass', 1500 * p, 0.7, 0.004, 0.05, 0.6, 0.32 * v);
    sv.frequency.exponentialRampToValueAtTime(500 * p, t + 0.6);
    const fz = noiseAHR(ac, out, o.white, t + 0.02, 'highpass', 3000 * p, 0.6, 0.01, 0.05, 0.5, 0.08 * v);
    fz.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.5);
    for (let i = 0; i < 10; i++) {
      const tt = t + 0.08 + Math.random() * 0.8;
      const s = osc(ac, 'sine', rand(600, 1700) * p, tt, 0.08);
      glide(s.frequency, tt, rand(600, 1700) * p, rand(1500, 3200) * p, 0.05);
      const g = perc(ac, tt, 0.002, 0.05, rand(0.02, 0.05) * v);
      s.connect(g).connect(out);
    }
    return 1.0;
  },
  { duration: 1.3, maxVoices: 2, cooldown: 0.4, range: 90, desc: 'elephant koi breaching splash' },
);

registerSound(
  'creature.catowl.hoot',
  (ac, out, t, o) => {
    for (let i = 0; i < 2; i++) {
      const tt = t + i * 0.42;
      call(ac, out, tt, o, { wave: 'triangle', f: [[0, 340], [0.08, 380], [0.3, 300]], dur: 0.32, vowels: [VOWELS.u, VOWELS.o], fscale: 0.9, peak: 0.26, breath: 0.25, lp: 1800 });
    }
    // A short cat-like trill to close.
    call(ac, out, t + 0.9, o, { wave: 'sawtooth', f: [[0, 600], [0.12, 760], [0.25, 520]], dur: 0.25, vowels: [VOWELS.e, VOWELS.a], fscale: 1.2, peak: 0.12, rough: 0.5, roughRate: 28, lp: 3800 });
    return 1.2;
  },
  { duration: 1.5, maxVoices: 2, cooldown: 0.6, range: 90, desc: 'cat-owl hoots with a purring trill' },
);

registerSound(
  'creature.armadillolizard.hiss',
  (ac, out, t, o) => {
    const p = o.pitch;
    const h = noiseAHR(ac, out, o.white, t, 'bandpass', 4200 * p, 1.2, 0.04, 0.35, 0.35, 0.22 * o.volume);
    h.frequency.exponentialRampToValueAtTime(3000 * p, t + 0.7);
    // Scales rattling.
    for (let i = 0; i < 9; i++) {
      const tt = t + 0.05 + i * 0.045;
      noiseHit(ac, out, o.white, tt, 'bandpass', rand(2000, 3500) * p, 3, 0.001, 0.015, 0.05 * o.volume);
    }
    return 0.75;
  },
  { duration: 1.0, maxVoices: 2, cooldown: 0.4, range: 50, desc: 'armadillo-lizard hiss with rattling scales' },
);

registerLoop(
  'loop.wings',
  (ac, out, o) => {
    const g = gain(ac, 1);
    g.connect(out);
    let rate = 2.5;
    let size = 0.6;
    const pump = eventPump(ac, (t0, t1) => {
      let t = t0;
      while (t < t1) {
        flap(ac, g, o, t, size, 0.8, 1);
        t += 1 / rate + rand(-0.03, 0.03);
      }
    }, 0.6);
    return {
      stop() {
        pump.stop();
      },
      setParam(name: string, v: number) {
        if (name === 'rate') rate = 1 + Math.max(0, Math.min(1, v)) * 5;
        if (name === 'size') size = Math.max(0, Math.min(1, v));
      },
    };
  },
  { desc: 'continuous wing beats while flying', params: ['rate', 'size'] },
);

