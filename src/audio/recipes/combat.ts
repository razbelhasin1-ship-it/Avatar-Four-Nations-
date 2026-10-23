import { aliasSound, registerSound, type RecipeOpts } from '../registry';
import { droplets, filt, gain, glide, grains, noise, noiseAHR, noiseHit, noiseVoice, osc, perc, ping, send, swell, thump, type AC } from '../synth';
import { crackle, whoosh } from './elements';

/**
 * Combat feedback: hits by element (with blocked / parried / killed variants),
 * the player taking damage, per-element dodges, and technique failures.
 * Hits are short and punchy (≤ 0.5 s) so rapid combos stay readable.
 */

function punch(ac: AC, out: AudioNode, o: RecipeOpts, t: number, peak: number): void {
  const p = o.pitch;
  thump(ac, out, t, 150 * p, 58 * p, 0.12, 0.55 * peak);
  noiseHit(ac, out, o.white, t, 'bandpass', 1500 * p, 1, 0.0008, 0.02, 0.3 * peak);
  noiseHit(ac, out, o.noise, t, 'lowpass', 700 * p, 0.7, 0.002, 0.08, 0.3 * peak);
}

registerSound(
  'hit.physical',
  (ac, out, t, o) => {
    punch(ac, out, o, t, o.volume);
    return 0.25;
  },
  { duration: 0.4, maxVoices: 6, cooldown: 0.02, desc: 'generic body impact (punch, kick, blunt hit)' },
);
aliasSound('hit', 'hit.physical');

registerSound(
  'hit.air',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 120 * p, 55 * p, 0.12, 0.4 * v);
    const f = noiseHit(ac, out, o.noise, t, 'bandpass', 1300 * p, 1, 0.002, 0.14, 0.4 * v);
    f.frequency.exponentialRampToValueAtTime(600 * p, t + 0.14);
    noiseHit(ac, out, o.white, t + 0.01, 'highpass', 3000 * p, 0.6, 0.006, 0.12, 0.12 * v);
    return 0.3;
  },
  { duration: 0.45, maxVoices: 6, cooldown: 0.02, desc: 'airbending blast connects (airy thump)' },
);

registerSound(
  'hit.water',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 110 * p, 50 * p, 0.12, 0.4 * v);
    const f = noiseHit(ac, out, o.noise, t, 'bandpass', 2100 * p, 0.8, 0.002, 0.18, 0.42 * v);
    f.frequency.exponentialRampToValueAtTime(700 * p, t + 0.18);
    noiseHit(ac, out, o.white, t, 'highpass', 2500 * p, 0.7, 0.001, 0.03, 0.2 * v);
    droplets(ac, out, t + 0.03, 0.22, 5, 800 * p, 2000 * p, 0.05 * v);
    return 0.35;
  },
  { duration: 0.5, maxVoices: 6, cooldown: 0.02, desc: 'water strike connects (wet slap)' },
);

registerSound(
  'hit.earth',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 95 * p, 40 * p, 0.2, 0.6 * v);
    noiseHit(ac, out, o.white, t, 'bandpass', 1100 * p, 0.9, 0.0008, 0.04, 0.45 * v);
    grains(ac, out, o.white, t + 0.01, 0.2, 12, { fLo: 1500 * p, fHi: 5000 * p, q: 1.6, dur: 0.008, peak: 0.12 * v, fade: 0.8 });
    noiseHit(ac, out, o.brown, t, 'lowpass', 400 * p, 0.7, 0.003, 0.2, 0.3 * v);
    return 0.4;
  },
  { duration: 0.55, maxVoices: 6, cooldown: 0.02, desc: 'earth strike connects (rock crunch + thud)' },
);

registerSound(
  'hit.fire',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 105 * p, 48 * p, 0.12, 0.38 * v);
    const f = noiseHit(ac, out, o.noise, t, 'lowpass', 2600 * p, 0.9, 0.002, 0.2, 0.45 * v);
    f.frequency.exponentialRampToValueAtTime(600 * p, t + 0.2);
    noiseAHR(ac, out, o.white, t + 0.02, 'highpass', 5000 * p, 0.7, 0.02, 0.05, 0.25, 0.08 * v);
    crackle(ac, out, o, t + 0.02, 0.25, 6, 0.1 * v);
    return 0.38;
  },
  { duration: 0.55, maxVoices: 6, cooldown: 0.02, desc: 'fire strike connects (burst + sizzle)' },
);

registerSound(
  'hit.avatar',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 85 * p, 35 * p, 0.3, 0.6 * v);
    noiseHit(ac, out, o.noise, t, 'bandpass', 1200 * p, 0.8, 0.001, 0.15, 0.35 * v);
    for (const f of [880, 1320, 1760]) ping(ac, out, t + 0.01, f * p, 0.5, 0.05 * v);
    return 0.55;
  },
  { duration: 0.75, maxVoices: 4, cooldown: 0.02, reverb: 0.25, desc: 'Avatar-State strike connects (impact + shimmer)' },
);

registerSound(
  'hit.block',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 140 * p, 90 * p, 0.06, 0.35 * v);
    noiseHit(ac, out, o.white, t, 'bandpass', 2200 * p, 3, 0.0008, 0.04, 0.4 * v);
    ping(ac, out, t, 680 * p, 0.08, 0.1 * v, 'triangle');
    whoosh(ac, out, o, t + 0.02, 1200 * p, 2400 * p, 800 * p, 0.2, 0.12 * v);
    return 0.3;
  },
  { duration: 0.45, maxVoices: 5, cooldown: 0.02, desc: 'attack blocked / deflected (muted clack + glance)' },
);

registerSound(
  'hit.parry',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    noiseHit(ac, out, o.white, t, 'highpass', 3000 * p, 0.8, 0.0008, 0.02, 0.35 * v);
    const car = osc(ac, 'sine', 1240 * p, t, 0.9);
    const mod = osc(ac, 'sine', 1240 * p * 2.41, t, 0.9);
    const mg = gain(ac, 1240 * p * 1.4);
    mod.connect(mg).connect(car.frequency);
    const g = perc(ac, t, 0.001, 0.8, 0.14 * v);
    car.connect(g).connect(out);
    send(ac, g, o.reverb, 0.4);
    ping(ac, out, t, 2950 * p, 0.6, 0.06 * v);
    whoosh(ac, out, o, t, 900 * p, 3200 * p, 1400 * p, 0.25, 0.14 * v);
    return 0.85;
  },
  { duration: 1.0, maxVoices: 3, cooldown: 0.05, priority: 2, desc: 'perfect block / parry (bright ring)' },
);

registerSound(
  'hit.kill',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 75 * p, 28 * p, 0.55, 0.65 * v, 0.12);
    const b = noiseVoice(ac, out, o.brown, t, 'lowpass', 300 * p, 0.8, 0.01, 0.05, 0.55, 0.35 * v);
    send(ac, b.env, o.reverb, 0.5);
    noiseHit(ac, out, o.white, t, 'bandpass', 1400 * p, 0.8, 0.0008, 0.05, 0.3 * v);
    whoosh(ac, out, o, t + 0.05, 1600 * p, 700 * p, 300 * p, 0.5, 0.1 * v);
    return 0.7;
  },
  { duration: 0.9, maxVoices: 3, cooldown: 0.05, priority: 2, reverb: 0.2, desc: 'finishing blow (deep boom + tail)' },
);

registerSound(
  'hit.player',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    thump(ac, out, t, 115 * p, 45 * p, 0.18, 0.55 * v);
    noiseHit(ac, out, o.noise, t, 'lowpass', 900 * p, 0.8, 0.001, 0.12, 0.35 * v);
    const sub = osc(ac, 'sine', 48, t + 0.02, 0.3);
    const sg = perc(ac, t + 0.02, 0.01, 0.25, 0.25 * v);
    sub.connect(sg).connect(out);
    return 0.35;
  },
  { duration: 0.5, maxVoices: 3, cooldown: 0.06, priority: 2, desc: 'the player takes damage (punchy, low)' },
);

// ---------------------------------------------------------------------------
// Dodges per element
// ---------------------------------------------------------------------------

registerSound(
  'dodge.air',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    whoosh(ac, out, o, t, 700 * p, 3600 * p, 1800 * p, 0.32, 0.45 * v, 1.2);
    const src = noise(ac, o.white, t, 0.3);
    const f = filt(ac, 'highpass', 4000 * p, 0.7);
    const fl = gain(ac, 0.5);
    const l = osc(ac, 'square', 24, t, 0.3);
    const lg = gain(ac, 0.5);
    l.connect(lg).connect(fl.gain);
    const g = swell(ac, t, 0.08, 0.05, 0.15, 0.08 * v);
    src.connect(f).connect(fl).connect(g).connect(out);
    return 0.36;
  },
  { duration: 0.55, maxVoices: 3, desc: 'airbender dodge: quick rising swoosh with flutter' },
);

registerSound(
  'dodge.water',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.45);
    const f = filt(ac, 'bandpass', 600 * p, 2);
    f.frequency.setValueAtTime(600 * p, t);
    f.frequency.exponentialRampToValueAtTime(1500 * p, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(800 * p, t + 0.4);
    const am = gain(ac, 0.7);
    const l = osc(ac, 'triangle', 28, t, 0.45);
    const lg = gain(ac, 0.3);
    l.connect(lg).connect(am.gain);
    const g = swell(ac, t, 0.12, 0.08, 0.22, 0.42 * v);
    src.connect(f).connect(am).connect(g).connect(out);
    droplets(ac, out, t + 0.15, 0.25, 4, 900 * p, 2000 * p, 0.045 * v);
    return 0.45;
  },
  { duration: 0.65, maxVoices: 3, desc: 'waterbender dodge: flowing swish with droplets' },
);

registerSound(
  'dodge.earth',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.32);
    const f = filt(ac, 'bandpass', 700 * p, 0.9);
    const g = swell(ac, t, 0.05, 0.12, 0.12, 0.38 * v);
    src.connect(f).connect(g).connect(out);
    grains(ac, out, o.white, t, 0.28, 14, { fLo: 1200 * p, fHi: 4500 * p, q: 1.5, dur: 0.01, peak: 0.13 * v });
    thump(ac, out, t + 0.26, 90 * p, 50 * p, 0.14, 0.45 * v);
    return 0.45;
  },
  { duration: 0.65, maxVoices: 3, desc: 'earthbender dodge: grounded scrape ending in a planted thud' },
);

registerSound(
  'dodge.fire',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const f = noiseHit(ac, out, o.noise, t, 'lowpass', 3200 * p, 0.8, 0.006, 0.28, 0.42 * v);
    f.frequency.exponentialRampToValueAtTime(700 * p, t + 0.28);
    whoosh(ac, out, o, t, 600 * p, 2600 * p, 900 * p, 0.3, 0.3 * v);
    thump(ac, out, t, 120 * p, 55 * p, 0.1, 0.25 * v);
    crackle(ac, out, o, t + 0.05, 0.25, 5, 0.08 * v);
    return 0.4;
  },
  { duration: 0.6, maxVoices: 3, desc: 'firebender dodge: flame-propelled burst' },
);

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

registerSound(
  'fail.nowater',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Dry fizz: crackly hiss with nothing wet in it.
    noiseAHR(ac, out, o.white, t, 'highpass', 3200 * p, 0.6, 0.02, 0.12, 0.22, 0.12 * v);
    grains(ac, out, o.white, t, 0.32, 18, { fLo: 3500 * p, fHi: 9000 * p, q: 2.5, dur: 0.003, peak: 0.1 * v, fade: 0.6 });
    // A weak gurgle that never arrives.
    const s = osc(ac, 'sine', 210 * p, t + 0.04, 0.3);
    glide(s.frequency, t + 0.04, 210 * p, 330 * p, 0.18);
    const sg = swell(ac, t + 0.04, 0.1, 0.02, 0.15, 0.06 * v);
    s.connect(sg).connect(out);
    whoosh(ac, out, o, t, 900 * p, 1400 * p, 600 * p, 0.35, 0.1 * v, 0.8);
    return 0.45;
  },
  { duration: 0.6, maxVoices: 1, cooldown: 0.4, priority: 2, desc: 'waterbending fails: no water nearby (dry fizz)' },
);

registerSound(
  'fail.chi',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    whoosh(ac, out, o, t, 500 * p, 800 * p, 300 * p, 0.3, 0.16 * v, 0.7);
    const s = osc(ac, 'triangle', 180 * p, t, 0.3);
    glide(s.frequency, t, 190 * p, 120 * p, 0.25);
    const g = perc(ac, t, 0.01, 0.25, 0.1 * v);
    const lp = filt(ac, 'lowpass', 600, 0.7);
    s.connect(lp).connect(g).connect(out);
    return 0.35;
  },
  { duration: 0.5, maxVoices: 1, cooldown: 0.4, priority: 2, desc: 'not enough chi (weak breathy puff)' },
);

registerSound(
  'fail.cooldown',
  (ac, out, t, o) => {
    ping(ac, out, t, 900 * o.pitch, 0.03, 0.08 * o.volume, 'triangle');
    ping(ac, out, t + 0.06, 760 * o.pitch, 0.03, 0.06 * o.volume, 'triangle');
    return 0.12;
  },
  { duration: 0.25, maxVoices: 1, cooldown: 0.25, priority: 2, desc: 'technique still recovering (soft double tick)' },
);

registerSound(
  'fail.generic',
  (ac, out, t, o) => {
    ping(ac, out, t, 240 * o.pitch, 0.07, 0.14 * o.volume, 'triangle');
    ping(ac, out, t + 0.09, 200 * o.pitch, 0.08, 0.12 * o.volume, 'triangle');
    noiseHit(ac, out, o.noise, t, 'lowpass', 800, 0.7, 0.002, 0.05, 0.06 * o.volume);
    return 0.22;
  },
  { duration: 0.35, maxVoices: 1, cooldown: 0.3, priority: 2, desc: 'action not possible (muted double knock)' },
);

