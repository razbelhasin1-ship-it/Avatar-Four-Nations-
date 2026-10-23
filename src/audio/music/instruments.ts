import type { AudioResources } from '../dsp';
import { ahr, bell, chime, filt, gain, glide, noise, noiseHit, osc, perc, ping, pluck, rand, semis, thump, VOWELS } from '../synth';
import type { Ornament } from './theory';

/**
 * Synthesised instruments for the music director. Each is a function that
 * schedules one note at time t. They are culturally flavoured stand-ins:
 *  guzheng/pipa/oud — Karplus–Strong plucked strings (+ bends, tremolo),
 *  dizi/xiao       — flutes (sine + breath noise + delayed vibrato, dizi buzz),
 *  erhu            — bowed two-string fiddle (saw → body resonances, portamento),
 *  bell/chime/gong — FM / inharmonic partial synthesis,
 *  taiko/frame drum/water drum/hand drum/rim — pitched membranes + noise,
 *  drone/pad/choir — sustained beds (detuned saws, formant "ahh").
 */

export interface NoteCtx {
  ac: BaseAudioContext;
  out: AudioNode;
  res: AudioResources;
  /** Previous note frequency of this voice (portamento). */
  prev?: number;
}

export type Instrument = (c: NoteCtx, t: number, freq: number, dur: number, vel: number, orn?: Ornament) => void;

const v2 = (vel: number): number => Math.pow(Math.max(0, Math.min(1, vel)), 1.4);

function vibrato(c: NoteCtx, t: number, dur: number, target: AudioParam, freq: number, rate: number, depth: number, delay: number): void {
  const lfo = osc(c.ac, 'sine', rate * rand(0.94, 1.06), t, dur + 0.3);
  const g = c.ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0, t + delay);
  g.gain.linearRampToValueAtTime(freq * depth, t + delay + 0.35);
  lfo.connect(g).connect(target);
}

/** Plucked zither (Earth). Ornaments: bend (press-bend into the note), trill (tremolo picking), grace. */
export const guzheng: Instrument = (c, t, f, dur, vel, orn) => {
  const vol = 0.34 * v2(vel);
  if (orn === 'grace') {
    pluck(c.ac, c.out, t, f * semis(2), { decay: 0.5, bright: 0.8, vol: vol * 0.6 });
    t += 0.07;
  }
  if (orn === 'trill' && dur > 0.4) {
    for (let x = 0; x < dur - 0.1; x += 0.075) pluck(c.ac, c.out, t + x, f, { decay: 0.6, bright: 0.7, vol: vol * (x === 0 ? 1 : 0.55), dur: 0.5 });
    return;
  }
  pluck(c.ac, c.out, t, f, { decay: 2.4, bright: 0.78, vol, bend: orn === 'bend' ? -2 : orn === 'slide' ? -1 : 0, pick: 0.12 });
  // Sympathetic octave shimmer.
  pluck(c.ac, c.out, t + 0.004, f * 2, { decay: 1.2, bright: 0.6, vol: vol * 0.12 });
};

/** Pear-shaped lute: brighter, shorter; long notes become rapid tremolo (lunzhi). */
export const pipa: Instrument = (c, t, f, dur, vel, orn) => {
  const vol = 0.3 * v2(vel);
  if (dur > 1.1 || orn === 'trill') {
    for (let x = 0; x < dur - 0.08; x += 0.066) pluck(c.ac, c.out, t + x, f, { decay: 0.5, bright: 0.85, vol: vol * (0.55 + 0.25 * Math.sin(x * 3)), dur: 0.35 });
    return;
  }
  pluck(c.ac, c.out, t, f, { decay: 1.2, bright: 0.85, vol, bend: orn === 'bend' ? -1 : 0, pick: 0.2 });
};

/** Oud-like lute (desert): darker string with a nasal body resonance. */
export const oud: Instrument = (c, t, f, dur, vel, orn) => {
  const vol = 0.34 * v2(vel);
  const body = filt(c.ac, 'peaking', 1150, 2, 7);
  const lp = filt(c.ac, 'lowpass', 3200, 0.7);
  body.connect(lp).connect(c.out);
  if (orn === 'grace') {
    pluck(c.ac, body, t, f * semis(1), { decay: 0.4, bright: 0.5, vol: vol * 0.6 });
    t += 0.06;
  }
  pluck(c.ac, body, t, f, { decay: 1.7, bright: 0.5, vol, bend: orn === 'bend' || orn === 'slide' ? -1 : 0, pick: 0.18 });
  if (dur > 1.2) pluck(c.ac, body, t + dur * 0.5, f, { decay: 1.0, bright: 0.45, vol: vol * 0.45 });
};

function flute(c: NoteCtx, t: number, f: number, dur: number, vel: number, orn: Ornament | undefined, o: { breath: number; buzz: number; bright: number; vol: number }): void {
  const ac = c.ac;
  const vol = o.vol * v2(vel);
  const rel = 0.22;
  const total = dur + rel;
  const main = osc(ac, 'sine', f, t, total);
  const h2 = osc(ac, 'triangle', f * 2, t, total);
  const h2g = gain(ac, 0.12);
  const lp = filt(ac, 'lowpass', o.bright, 0.6);
  const env = ahr(ac, t, Math.min(0.09, dur * 0.4), Math.max(0, dur - 0.09), rel, vol);
  main.connect(lp);
  h2.connect(h2g).connect(lp);
  lp.connect(env).connect(c.out);
  // Pitch: slides, trills, vibrato.
  if (orn === 'slide' || (orn === 'bend' && c.prev)) {
    const from = c.prev && Math.abs(Math.log2(c.prev / f)) < 1 ? c.prev : f * semis(-2);
    glide(main.frequency, t, from, f, 0.13);
    glide(h2.frequency, t, from * 2, f * 2, 0.13);
  } else if (orn === 'grace') {
    main.frequency.setValueAtTime(f * semis(2), t);
    main.frequency.setValueAtTime(f, t + 0.06);
    h2.frequency.setValueAtTime(f * 2 * semis(2), t);
    h2.frequency.setValueAtTime(f * 2, t + 0.06);
  } else if (orn === 'trill' && dur > 0.3) {
    for (let x = 0, k = 0; x < dur - 0.05; x += 0.07, k++) {
      const ff = k % 2 ? f * semis(2) : f;
      main.frequency.setValueAtTime(ff, t + x);
      h2.frequency.setValueAtTime(ff * 2, t + x);
    }
  }
  if (dur > 0.35) {
    vibrato(c, t, dur, main.frequency, f, 5.2, 0.007, 0.22);
    vibrato(c, t, dur, h2.frequency, f * 2, 5.2, 0.007, 0.22);
  }
  // Breath: band-passed noise riding the note.
  const br = noise(ac, c.res.white, t, total);
  const bf = filt(ac, 'bandpass', Math.min(9000, f * 2.2), 1.6);
  const benv = ahr(ac, t, 0.03, Math.max(0, dur - 0.03), rel, vol * o.breath);
  br.connect(bf).connect(benv).connect(c.out);
  if (o.buzz > 0) {
    // Dizi membrane buzz (dimo): a little nasal rasp on the harmonics.
    const bz = osc(ac, 'sawtooth', f, t, total);
    const bzf = filt(ac, 'bandpass', Math.min(8000, f * 4), 5);
    const benv2 = ahr(ac, t, 0.05, Math.max(0, dur - 0.05), rel, vol * o.buzz);
    bz.connect(bzf).connect(benv2).connect(c.out);
    if (orn === 'slide' || orn === 'bend') glide(bz.frequency, t, f * semis(-2), f, 0.13);
  }
}

/** Bamboo transverse flute with membrane buzz (Water/Air/Earth leads). */
export const dizi: Instrument = (c, t, f, dur, vel, orn) => flute(c, t, f, dur, vel, orn, { breath: 0.32, buzz: 0.05, bright: 5200, vol: 0.2 });

/** End-blown vertical flute: darker, breathier (Swamp, Water night). */
export const xiao: Instrument = (c, t, f, dur, vel, orn) => flute(c, t, f, dur, vel, orn, { breath: 0.55, buzz: 0, bright: 2400, vol: 0.22 });

/** Bowed fiddle (Fire): saw → body resonances, portamento from the previous note, deepening vibrato. */
export const erhu: Instrument = (c, t, f, dur, vel, orn) => {
  const ac = c.ac;
  const vol = 0.13 * v2(vel);
  const rel = 0.2;
  const total = dur + rel;
  const o = osc(ac, 'sawtooth', f, t, total);
  if (c.prev && Math.abs(Math.log2(c.prev / f)) < 0.8 && orn !== 'grace') glide(o.frequency, t, c.prev, f, orn === 'slide' ? 0.16 : 0.07);
  else if (orn === 'grace') {
    o.frequency.setValueAtTime(f * semis(2), t);
    o.frequency.setValueAtTime(f, t + 0.07);
  }
  if (orn === 'trill' && dur > 0.3) for (let x = 0, k = 0; x < dur - 0.05; x += 0.08, k++) o.frequency.setValueAtTime(k % 2 ? f * semis(1) : f, t + x);
  if (dur > 0.3) vibrato(c, t, dur, o.frequency, f, 5.8, 0.012, 0.18);
  const b1 = filt(ac, 'peaking', 640, 2.5, 9);
  const b2 = filt(ac, 'peaking', 1550, 3, 5);
  const b3 = filt(ac, 'peaking', 2900, 3, 3);
  const lp = filt(ac, 'lowpass', 3600, 0.8);
  const hp = filt(ac, 'highpass', f * 0.7, 0.7);
  // Bow pressure swell inside long notes.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(vol, t + Math.min(0.12, dur * 0.5));
  if (dur > 0.5) env.gain.linearRampToValueAtTime(vol * 1.15, t + dur * 0.6);
  env.gain.linearRampToValueAtTime(vol * 0.9, t + dur);
  env.gain.exponentialRampToValueAtTime(vol * 0.001, t + total);
  env.gain.linearRampToValueAtTime(0, t + total + 0.005);
  o.connect(hp).connect(b1).connect(b2).connect(b3).connect(lp).connect(env).connect(c.out);
  // Bow hair noise.
  const n = noise(ac, c.res.white, t, total);
  const nf = filt(ac, 'highpass', 2600, 0.7);
  const ne = ahr(ac, t, 0.05, Math.max(0, dur - 0.05), rel, vol * 0.18);
  n.connect(nf).connect(ne).connect(c.out);
};

/** Temple bell (FM). */
export const bellInst: Instrument = (c, t, f, dur, vel) => bell(c.ac, c.out, t, f, Math.max(1.6, Math.min(4, dur + 1.6)), 0.16 * v2(vel), 3.5, 2.0);

/** Small chime. */
export const chimeInst: Instrument = (c, t, f, _dur, vel) => chime(c.ac, c.out, t, f, 2.2, 0.12 * v2(vel));

/** Soft pad note (detuned triangles, slow attack). */
export const pad: Instrument = (c, t, f, dur, vel) => {
  const ac = c.ac;
  const vol = 0.07 * v2(vel);
  const lp = filt(ac, 'lowpass', Math.min(2400, f * 5), 0.5);
  const env = ahr(ac, t, Math.min(0.9, dur * 0.4), Math.max(0, dur - 0.9), 1.4, vol);
  lp.connect(env).connect(c.out);
  for (const d of [-7, 0, 7]) {
    const o = osc(ac, 'triangle', f, t, dur + 1.5, d);
    o.connect(lp);
  }
};

/** Choir "ahh" (formant-filtered saws) — spirit / Avatar State. */
export const choir: Instrument = (c, t, f, dur, vel) => {
  const ac = c.ac;
  const vol = 0.05 * v2(vel);
  const env = ahr(ac, t, Math.min(0.7, dur * 0.4), Math.max(0, dur - 0.7), 1.2, vol);
  const mix = gain(ac, 1);
  const vw = f > 350 ? VOWELS.a : VOWELS.o;
  const scale = f > 300 ? 1.15 : 1;
  for (let k = 0; k < 3; k++) {
    const bp = filt(ac, 'bandpass', vw[k] * scale, 8);
    const g = gain(ac, [3, 2, 1][k]);
    mix.connect(bp).connect(g).connect(env);
  }
  env.connect(c.out);
  for (const d of [-9, 0, 8]) {
    const o = osc(ac, 'sawtooth', f, t, dur + 1.3, d);
    vibrato(c, t, dur, o.frequency, f, 5, 0.004, 0.3);
    o.connect(mix);
  }
};

/** Sustained drone (detuned saws + sub, slowly breathing filter). */
export const drone: Instrument = (c, t, f, dur, vel) => {
  const ac = c.ac;
  const vol = 0.06 * v2(vel);
  const lp = filt(ac, 'lowpass', Math.min(900, f * 5), 0.9);
  const lfo = osc(ac, 'sine', rand(0.05, 0.09), t, dur + 3.2);
  const lg = gain(ac, Math.min(300, f * 1.8));
  lfo.connect(lg).connect(lp.frequency);
  const env = ahr(ac, t, Math.min(2.5, dur * 0.3), Math.max(0, dur - 2.5), 3, vol, 'lin');
  lp.connect(env).connect(c.out);
  for (const d of [-6, 5]) osc(ac, 'sawtooth', f, t, dur + 3.1, d).connect(lp);
  const sub = osc(ac, 'sine', f / 2, t, dur + 3.1);
  const sg = gain(ac, 0.6);
  sub.connect(sg).connect(lp);
};

/** Plucked bass (low KS + sine body). */
export const bass: Instrument = (c, t, f, dur, vel) => {
  const vol = 0.36 * v2(vel);
  const lp = filt(c.ac, 'lowpass', 900, 0.7);
  lp.connect(c.out);
  pluck(c.ac, lp, t, f, { decay: Math.min(2, dur + 0.6), bright: 0.25, vol, pick: 0.2 });
  ping(c.ac, c.out, t, f, Math.min(1.2, dur + 0.3), vol * 0.5, 'sine');
};

/** Staccato low strings (combat ostinato). */
export const lowstrings: Instrument = (c, t, f, dur, vel) => {
  const ac = c.ac;
  const vol = 0.11 * v2(vel);
  const lp = filt(ac, 'lowpass', 1100, 1.4);
  const env = perc(ac, t, 0.012, Math.min(0.32, dur * 0.9 + 0.08), vol);
  lp.connect(env).connect(c.out);
  for (const d of [-8, 8]) osc(ac, 'sawtooth', f, t, 0.45, d).connect(lp);
};

// ---------------------------------------------------------------- percussion

/** Big barrel drum. */
export const taiko: Instrument = (c, t, _f, _dur, vel) => {
  const ac = c.ac;
  const v = v2(vel);
  thump(ac, c.out, t, 105, 52, 0.65, 0.62 * v, 0.05);
  noiseHit(ac, c.out, c.res.noise, t, 'bandpass', 950, 1.1, 0.001, 0.07, 0.3 * v);
  noiseHit(ac, c.out, c.res.brown, t, 'lowpass', 260, 0.8, 0.002, 0.42, 0.42 * v);
};

/** Rim / woodblock click. */
export const rim: Instrument = (c, t, _f, _dur, vel) => {
  const v = v2(vel);
  ping(c.ac, c.out, t, 1650, 0.05, 0.2 * v, 'triangle');
  noiseHit(c.ac, c.out, c.res.white, t, 'highpass', 2500, 0.8, 0.001, 0.025, 0.12 * v);
};

/** Frame drum "dum". */
export const framedrum: Instrument = (c, t, _f, _dur, vel) => {
  const v = v2(vel);
  thump(c.ac, c.out, t, 135, 82, 0.38, 0.45 * v, 0.03);
  noiseHit(c.ac, c.out, c.res.noise, t, 'bandpass', 420, 1.2, 0.002, 0.12, 0.2 * v);
};

/** Frame drum "tek" (rim slap). */
export const tek: Instrument = (c, t, _f, _dur, vel) => {
  const v = v2(vel);
  noiseHit(c.ac, c.out, c.res.white, t, 'bandpass', 3200, 1.4, 0.001, 0.045, 0.22 * v);
  ping(c.ac, c.out, t, 2100, 0.03, 0.08 * v, 'sine');
};

/** Water drum: hollow gourd floating in water — rising "bloop". */
export const waterdrum: Instrument = (c, t, _f, _dur, vel) => {
  const ac = c.ac;
  const v = v2(vel);
  const o = osc(ac, 'sine', 170, t, 0.35);
  glide(o.frequency, t, 165, 235, 0.22);
  const g = perc(ac, t, 0.002, 0.28, 0.42 * v);
  o.connect(g).connect(c.out);
  noiseHit(ac, c.out, c.res.noise, t, 'bandpass', 380, 7, 0.002, 0.16, 0.35 * v);
};

/** Hand drum (light, Air). */
export const handdrum: Instrument = (c, t, _f, _dur, vel) => {
  const v = v2(vel);
  thump(c.ac, c.out, t, 210, 140, 0.2, 0.32 * v, 0.02);
  noiseHit(c.ac, c.out, c.res.noise, t, 'bandpass', 1800, 1.2, 0.001, 0.04, 0.14 * v);
};

/** Gong swell. */
export const gong: Instrument = (c, t, f, _dur, vel) => {
  const ac = c.ac;
  const v = v2(vel);
  const base = f > 0 ? f : 92;
  const env = ahr(ac, t, 0.04, 0.2, 4.2, 0.2 * v);
  env.connect(c.out);
  const partials: Array<[number, number]> = [[1, 1], [1.48, 0.6], [2.16, 0.45], [2.83, 0.3], [3.95, 0.2]];
  for (const [r, a] of partials) {
    const o = osc(ac, 'sine', base * r * rand(0.995, 1.005), t, 4.6);
    glide(o.frequency, t, base * r * 0.985, base * r, 0.8);
    const g = gain(ac, a);
    o.connect(g).connect(env);
  }
  noiseHit(ac, c.out, c.res.noise, t, 'bandpass', 1400, 0.8, 0.002, 0.3, 0.06 * v);
};

/** Shaker (desert). */
export const shaker: Instrument = (c, t, _f, _dur, vel) => {
  noiseHit(c.ac, c.out, c.res.white, t, 'highpass', 6000, 0.7, 0.012, 0.05, 0.08 * v2(vel));
};

export type InstrumentId =
  | 'guzheng'
  | 'pipa'
  | 'oud'
  | 'dizi'
  | 'xiao'
  | 'erhu'
  | 'bell'
  | 'chime'
  | 'pad'
  | 'choir'
  | 'drone'
  | 'bass'
  | 'lowstrings'
  | 'taiko'
  | 'rim'
  | 'framedrum'
  | 'tek'
  | 'waterdrum'
  | 'handdrum'
  | 'gong'
  | 'shaker';

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guzheng,
  pipa,
  oud,
  dizi,
  xiao,
  erhu,
  bell: bellInst,
  chime: chimeInst,
  pad,
  choir,
  drone,
  bass,
  lowstrings,
  taiko,
  rim,
  framedrum,
  tek,
  waterdrum,
  handdrum,
  gong,
  shaker,
};
