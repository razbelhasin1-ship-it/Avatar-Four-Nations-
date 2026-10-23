import { aliasSound, registerLoop, registerSound, type RecipeOpts } from '../registry';
import {
  ahr,
  chance,
  droplet,
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
  perc,
  ping,
  rand,
  randi,
  send,
  shaper,
  swell,
  thump,
  type AC,
} from '../synth';
import { eventPump, eventTimes, lfo, loopNoise, stopAll } from './util';

/**
 * Elemental sound library: water (drawing, splashes, droplets, streams), ice
 * (forming, cracking, creaking, shattering), stone (grinding, rising, impacts,
 * crumbling), air (whooshes, gusts, vortex hum), fire (whoosh, crackle, roar,
 * explosion) and lightning. Bending modules can switch to these generic ids.
 */

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

/** Fire crackle pops (grain train, very short high grains). */
export function crackle(ac: AC, out: AudioNode, o: RecipeOpts, t: number, span: number, n: number, peak: number): void {
  grains(ac, out, o.white, t, span, n, { fLo: 1800, fHi: 7500, q: 1.6, dur: 0.004, peak, type: 'bandpass' });
}

/** Low rumble (brown noise through a low-pass) with an AHR envelope. */
export function rumble(ac: AC, out: AudioNode, o: RecipeOpts, t: number, freq: number, a: number, h: number, r: number, peak: number): BiquadFilterNode {
  return noiseAHR(ac, out, o.brown, t, 'lowpass', freq, 0.8, a, h, r, peak);
}

/** Swept band-pass noise whoosh. */
export function whoosh(ac: AC, out: AudioNode, o: RecipeOpts, t: number, f0: number, f1: number, f2: number, dur: number, peak: number, q = 1.2): void {
  const src = noise(ac, o.noise, t, dur + 0.05);
  const f = filt(ac, 'bandpass', f0, q);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.4);
  f.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = swell(ac, t, dur * 0.35, 0, dur * 0.65, peak);
  src.connect(f).connect(g).connect(out);
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

registerSound(
  'water.draw',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.75);
    const f = filt(ac, 'bandpass', 300 * p, 2);
    f.frequency.setValueAtTime(300 * p, t);
    f.frequency.exponentialRampToValueAtTime(1400 * p, t + 0.55);
    const g = swell(ac, t, 0.3, 0.15, 0.25, 0.32 * v);
    src.connect(f).connect(g).connect(out);
    for (let i = 0; i < 6; i++) droplet(ac, out, t + 0.05 + i * 0.07 + rand(0, 0.03), rand(220, 520) * p * (1 + i * 0.12), 0.07 * v, 0.06);
    rumble(ac, out, o, t, 600 * p, 0.2, 0.15, 0.3, 0.14 * v);
    const s = osc(ac, 'sine', 150 * p, t + 0.15, 0.4);
    glide(s.frequency, t + 0.15, 150 * p, 420 * p, 0.35);
    const sg = swell(ac, t + 0.15, 0.2, 0, 0.18, 0.05 * v);
    s.connect(sg).connect(out);
    return 0.75;
  },
  { duration: 0.95, maxVoices: 3, cooldown: 0.15, desc: 'water pulled out of a liquid source (gurgle + rising swirl)' },
);

registerSound(
  'water.draw.ice',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    grains(ac, out, o.white, t, 0.5, 26, { fLo: 3000 * p, fHi: 9000 * p, q: 2, dur: 0.004, peak: 0.16 * v, front: 0.8 });
    for (let i = 0; i < 4; i++) ping(ac, out, t + rand(0.05, 0.4), rand(2200, 5200) * p, rand(0.05, 0.12), 0.05 * v);
    const cr = osc(ac, 'sawtooth', 75 * p, t, 0.55);
    glide(cr.frequency, t, 70 * p, 95 * p, 0.5);
    const bf = filt(ac, 'bandpass', 650 * p, 6);
    const cg = swell(ac, t, 0.2, 0.1, 0.2, 0.05 * v);
    cr.connect(bf).connect(cg).connect(out);
    return 0.6;
  },
  { duration: 0.8, maxVoices: 2, cooldown: 0.15, desc: 'water drawn from ice (crackles + creak)' },
);

registerSound(
  'water.draw.snow',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    grains(ac, out, o.white, t, 0.45, 30, { fLo: 900 * p, fHi: 4200 * p, q: 1.3, dur: 0.01, peak: 0.16 * v });
    whoosh(ac, out, o, t, 500 * p, 1500 * p, 900 * p, 0.55, 0.14 * v, 0.9);
    return 0.6;
  },
  { duration: 0.8, maxVoices: 2, cooldown: 0.15, desc: 'water drawn from snow (crunchy swirl)' },
);

registerSound(
  'water.draw.mist',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    noiseAHR(ac, out, o.white, t, 'highpass', 3800 * p, 0.6, 0.2, 0.15, 0.35, 0.09 * v);
    for (let i = 0; i < 5; i++) ping(ac, out, t + 0.1 + i * 0.07, rand(2500, 4200) * p, 0.25, 0.025 * v);
    droplets(ac, out, t + 0.2, 0.4, 5, 900 * p, 2000 * p, 0.03 * v);
    return 0.75;
  },
  { duration: 0.95, maxVoices: 2, cooldown: 0.2, desc: 'moisture/rain condensed into water (airy shimmer)' },
);

registerSound(
  'water.flask',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Cork pop.
    const c = osc(ac, 'sine', 620 * p, t, 0.06);
    glide(c.frequency, t, 640 * p, 300 * p, 0.04);
    const cg = perc(ac, t, 0.001, 0.04, 0.18 * v);
    c.connect(cg).connect(out);
    noiseHit(ac, out, o.white, t, 'bandpass', 2400 * p, 1, 0.001, 0.015, 0.12 * v);
    // Slosh.
    const src = noise(ac, o.noise, t + 0.06, 0.45);
    const f = filt(ac, 'lowpass', 900 * p, 3);
    const amp = gain(ac, 0.6);
    lfo(ac, 9, 0.4, amp.gain);
    const g = swell(ac, t + 0.06, 0.12, 0.1, 0.2, 0.22 * v);
    src.connect(f).connect(amp).connect(g).connect(out);
    droplets(ac, out, t + 0.1, 0.3, 4, 500 * p, 1100 * p, 0.05 * v);
    return 0.55;
  },
  { duration: 0.75, maxVoices: 2, cooldown: 0.2, desc: 'water skin uncorked and poured' },
);

function splash(ac: AC, out: AudioNode, o: RecipeOpts, t: number, size: number): number {
  const p = o.pitch;
  const v = o.volume;
  const dur = 0.25 + 0.55 * size;
  if (size > 0.6) thump(ac, out, t, 95 * p, 40 * p, 0.3, 0.45 * v * size);
  const sv = noiseVoice(ac, out, o.noise, t, 'bandpass', (1700 + 600 * size) * p, 0.7, 0.004, 0, dur, (0.3 + 0.25 * size) * v);
  sv.filter.frequency.exponentialRampToValueAtTime(550 * p, t + dur * 0.9);
  if (size > 0.4) {
    const c = noiseHit(ac, out, o.white, t, 'lowpass', 6000 * p, 0.7, 0.003, dur * 0.8, 0.18 * v * size);
    c.frequency.exponentialRampToValueAtTime(400 * p, t + dur * 0.8);
  }
  rumble(ac, out, o, t, 500 * p, 0.01, 0.02, dur * 0.7, 0.18 * v);
  droplets(ac, out, t + 0.04, dur * 1.1, Math.round(4 + 12 * size), 650 * p, 1900 * p, 0.055 * v);
  send(ac, sv.env, o.reverb, 0.3 * size);
  return dur + 0.15;
}

registerSound('water.splash.small', (ac, out, t, o) => splash(ac, out, o, t, 0.2), { duration: 0.6, maxVoices: 5, desc: 'small splash (droplet impact, stepping in a puddle)' });
registerSound('water.splash', (ac, out, t, o) => splash(ac, out, o, t, 0.55), { duration: 0.9, maxVoices: 5, desc: 'medium splash' });
registerSound('water.splash.big', (ac, out, t, o) => splash(ac, out, o, t, 1), { duration: 1.3, maxVoices: 3, desc: 'big splash / wave crash / body into water' });
aliasSound('water_splash', 'water.splash');

registerSound(
  'water.droplets',
  (ac, out, t, o) => {
    droplets(ac, out, t, 0.5, 10, 800 * o.pitch, 2200 * o.pitch, 0.08 * o.volume);
    return 0.62;
  },
  { duration: 0.8, maxVoices: 4, desc: 'scattered droplets' },
);

registerSound(
  'water.drip',
  (ac, out, t, o) => {
    const f = rand(900, 1500) * o.pitch;
    droplet(ac, out, t, f, 0.16 * o.volume, 0.05);
    ping(ac, out, t + 0.002, f * 1.9, 0.18, 0.03 * o.volume);
    droplet(ac, out, t + 0.12, f * 0.97, 0.04 * o.volume, 0.05);
    return 0.35;
  },
  { duration: 0.5, maxVoices: 4, reverb: 0.35, range: 30, desc: 'single drip (caves, swamp, icicles)' },
);

registerSound(
  'water.bubble',
  (ac, out, t, o) => {
    for (let i = 0; i < 7; i++) droplet(ac, out, t + i * rand(0.03, 0.07), rand(250, 700) * o.pitch, 0.08 * o.volume, rand(0.04, 0.08));
    return 0.6;
  },
  { duration: 0.75, maxVoices: 3, desc: 'bubbles rising (underwater, swamp gas, hot spring)' },
);

registerSound(
  'water.whoosh',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.55);
    const f = filt(ac, 'bandpass', 900 * p, 2.5);
    f.frequency.setValueAtTime(900 * p, t);
    f.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(1100 * p, t + 0.5);
    const am = gain(ac, 0.75);
    lfo(ac, rand(24, 32), 0.25, am.gain, 'triangle');
    const g = swell(ac, t, 0.16, 0.1, 0.28, 0.42 * v);
    src.connect(f).connect(am).connect(g).connect(out);
    droplets(ac, out, t + 0.25, 0.25, 4, 900 * p, 2000 * p, 0.04 * v);
    return 0.6;
  },
  { duration: 0.8, maxVoices: 4, desc: 'water swished through the air (whips, streams)' },
);
aliasSound('water_whoosh', 'water.whoosh');

/** Flowing water bed: layered band-passed noise with slow random modulation + bubbling events. */
function flowLoop(kind: 'stream' | 'river' | 'waterfall' | 'lake') {
  return (ac: AC, out: AudioNode, o: { noise: AudioBuffer; white: AudioBuffer; brown: AudioBuffer }) => {
    const srcs: AudioScheduledSourceNode[] = [];
    const master = gain(ac, 1);
    master.connect(out);
    const layer = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, g: number, modRate: number, modDepth: number) => {
      const s = loopNoise(ac, buf);
      const fl = filt(ac, type, f, q);
      const gg = gain(ac, g);
      srcs.push(s, lfo(ac, modRate, f * modDepth, fl.frequency));
      s.connect(fl).connect(gg).connect(master);
      return gg;
    };
    let pump: { stop(): void; density: number } | null = null;
    if (kind === 'stream') {
      layer(o.noise, 'bandpass', 1300, 0.9, 0.35, 0.21, 0.25);
      layer(o.white, 'bandpass', 3200, 1.2, 0.12, 0.33, 0.2);
      pump = eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 14 * d)) droplet(ac, master, t, rand(350, 1300), rand(0.02, 0.07), rand(0.03, 0.07));
      });
    } else if (kind === 'river') {
      layer(o.brown, 'lowpass', 420, 0.7, 0.55, 0.11, 0.3);
      layer(o.noise, 'bandpass', 900, 0.6, 0.32, 0.17, 0.3);
      layer(o.white, 'highpass', 3500, 0.5, 0.05, 0.27, 0.2);
      pump = eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 6 * d)) droplet(ac, master, t, rand(200, 700), rand(0.015, 0.04), rand(0.04, 0.09));
      });
    } else if (kind === 'waterfall') {
      layer(o.brown, 'lowpass', 300, 0.7, 0.8, 0.07, 0.2);
      layer(o.noise, 'bandpass', 700, 0.5, 0.45, 0.13, 0.2);
      layer(o.white, 'bandpass', 2600, 0.6, 0.18, 0.19, 0.15);
    } else {
      // Lake shore: soft lapping (slow periodic swells).
      const g = layer(o.noise, 'bandpass', 700, 0.8, 0.0, 0.15, 0.2);
      const lap = ac.createOscillator();
      lap.frequency.value = 0.42;
      const lg = gain(ac, 0.16);
      lap.connect(lg).connect(g.gain);
      const base = ac.createConstantSource();
      base.offset.value = 0.17;
      base.connect(g.gain);
      lap.start();
      base.start();
      srcs.push(lap, base);
      pump = eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 1.5 * d)) droplet(ac, master, t, rand(300, 800), 0.025, 0.06);
      });
    }
    return {
      stop(t: number) {
        pump?.stop();
        stopAll(srcs, t);
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') master.gain.setTargetAtTime(Math.max(0, Math.min(2, v)), ac.currentTime, 0.3);
        if (name === 'density' && pump) pump.density = Math.max(0, Math.min(3, v));
      },
    };
  };
}

registerLoop('loop.water.stream', flowLoop('stream'), { desc: 'babbling brook with bubbling droplets', params: ['intensity', 'density'] });
registerLoop('loop.water.river', flowLoop('river'), { desc: 'broad river flow', params: ['intensity', 'density'] });
registerLoop('loop.water.waterfall', flowLoop('waterfall'), { desc: 'waterfall roar', params: ['intensity'] });
registerLoop('loop.water.lake', flowLoop('lake'), { desc: 'gentle lake-shore lapping', params: ['intensity', 'density'] });
registerLoop('water_flow', flowLoop('river'), { desc: 'legacy: flowing water (river)', params: ['intensity', 'density'] });

// ---------------------------------------------------------------------------
// Ice
// ---------------------------------------------------------------------------

registerSound(
  'ice.form',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Crystallising: grain density increasing toward the end.
    grains(ac, out, o.white, t, 0.7, 34, { fLo: 3000 * p, fHi: 9500 * p, q: 2.2, dur: 0.004, peak: 0.16 * v, front: 0.55 });
    for (let i = 0; i < 6; i++) {
      const ts = t + 0.1 + i * 0.1 + rand(0, 0.04);
      const f = rand(1800, 3200) * p * (1 + i * 0.12);
      const s = ping(ac, out, ts, f, 0.25, 0.045 * v);
      glide(s.frequency, ts, f, f * 1.06, 0.2);
    }
    const cr = osc(ac, 'sawtooth', 85 * p, t, 0.8);
    glide(cr.frequency, t, 80 * p, 120 * p, 0.7);
    const bf = filt(ac, 'bandpass', 700 * p, 5);
    const cg = swell(ac, t, 0.35, 0.1, 0.3, 0.05 * v);
    cr.connect(bf).connect(cg).connect(out);
    ping(ac, out, t + 0.72, 3520 * p, 0.6, 0.06 * v);
    return 1.0;
  },
  { duration: 1.25, maxVoices: 3, reverb: 0.25, desc: 'ice crystallising (rising crackle + glassy shimmer)' },
);

function iceCrack(ac: AC, out: AudioNode, o: RecipeOpts, t: number, big: number): void {
  const p = o.pitch;
  const v = o.volume;
  noiseHit(ac, out, o.white, t, 'highpass', 1500 * p, 0.7, 0.0008, 0.012, 0.55 * v * big);
  grains(ac, out, o.white, t + 0.01, 0.12 * big + 0.05, Math.round(4 + 6 * big), { fLo: 2500 * p, fHi: 8000 * p, q: 3, dur: 0.005, peak: 0.25 * v });
  // The "pew": stress wave whistling down through the ice.
  const s = osc(ac, 'sine', 3200 * p, t, 0.25);
  glide(s.frequency, t + 0.005, 3200 * p, 700 * p, 0.18);
  const sg = perc(ac, t, 0.002, 0.18, 0.09 * v);
  s.connect(sg).connect(out);
  thump(ac, out, t, 70 * p, 45 * p, 0.15 * big + 0.05, 0.25 * v * big);
}

registerSound(
  'ice.crack',
  (ac, out, t, o) => {
    iceCrack(ac, out, o, t, 0.6);
    return 0.35;
  },
  { duration: 0.6, maxVoices: 4, reverb: 0.3, desc: 'sharp ice crack with whistling stress wave' },
);
aliasSound('ice_crack', 'ice.crack');

registerSound(
  'ice.creak',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const f0 = rand(55, 85) * p;
    const s = osc(ac, 'sawtooth', f0, t, 1.3);
    s.frequency.setValueAtTime(f0, t);
    s.frequency.linearRampToValueAtTime(f0 * rand(1.1, 1.5), t + 0.6);
    s.frequency.linearRampToValueAtTime(f0 * rand(0.8, 1.05), t + 1.2);
    const bf = filt(ac, 'bandpass', rand(450, 850) * p, 6);
    const am = gain(ac, 0.6);
    lfo(ac, rand(18, 30), 0.4, am.gain, 'square');
    const g = swell(ac, t, 0.4, 0.3, 0.5, 0.1 * v);
    s.connect(bf).connect(am).connect(g).connect(out);
    return 1.25;
  },
  { duration: 1.45, maxVoices: 2, reverb: 0.3, range: 120, desc: 'deep groan of stressed ice / glaciers' },
);

registerSound(
  'ice.shatter',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    noiseHit(ac, out, o.white, t, 'highpass', 2000 * p, 0.7, 0.001, 0.3, 0.4 * v);
    for (let i = 0; i < 18; i++) ping(ac, out, t + Math.pow(Math.random(), 1.6) * 0.6, rand(1800, 7500) * p, rand(0.04, 0.15), rand(0.02, 0.06) * v);
    grains(ac, out, o.white, t + 0.05, 0.6, 24, { fLo: 3000 * p, fHi: 9000 * p, q: 3, dur: 0.006, peak: 0.12 * v, fade: 0.8 });
    thump(ac, out, t, 90 * p, 50 * p, 0.2, 0.3 * v);
    return 0.95;
  },
  { duration: 1.2, maxVoices: 3, reverb: 0.25, desc: 'ice construct shattering into shards' },
);

// ---------------------------------------------------------------------------
// Stone
// ---------------------------------------------------------------------------

function grind(ac: AC, out: AudioNode, o: RecipeOpts, t: number, dur: number, peak: number, f0 = 600): void {
  const p = o.pitch;
  const src = noise(ac, o.noise, t, dur + 0.05);
  const f = filt(ac, 'lowpass', f0 * p, 1.2);
  const jit = gain(ac, 0.6);
  lfo(ac, rand(19, 27), 0.35, jit.gain, 'square');
  lfo(ac, rand(5, 8), 0.15, jit.gain, 'sawtooth');
  const g = ahr(ac, t, 0.08, dur * 0.6, dur * 0.35, peak);
  src.connect(f).connect(jit).connect(g).connect(out);
  grains(ac, out, o.white, t, dur, Math.round(dur * 30), { fLo: 900 * p, fHi: 3200 * p, q: 2, dur: 0.012, peak: peak * 0.4 });
}

registerSound(
  'stone.grind',
  (ac, out, t, o) => {
    grind(ac, out, o, t, 0.95, 0.4 * o.volume);
    rumble(ac, out, o, t, 120 * o.pitch, 0.1, 0.5, 0.35, 0.3 * o.volume);
    return 1.05;
  },
  { duration: 1.3, maxVoices: 3, desc: 'stone grinding against stone' },
);

registerSound(
  'stone.rise',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const f = rumble(ac, out, o, t, 200 * p, 0.12, 0.35, 0.35, 0.5 * v);
    f.frequency.exponentialRampToValueAtTime(900 * p, t + 0.5);
    grind(ac, out, o, t + 0.05, 0.6, 0.25 * v, 800);
    const s = osc(ac, 'sine', 40 * p, t, 0.85);
    glide(s.frequency, t, 38 * p, 72 * p, 0.6);
    const sg = swell(ac, t, 0.3, 0.2, 0.3, 0.32 * v);
    s.connect(sg).connect(out);
    grains(ac, out, o.white, t + 0.55, 0.3, 10, { fLo: 1500 * p, fHi: 5000 * p, q: 1.5, dur: 0.008, peak: 0.1 * v, fade: 0.7 });
    return 0.9;
  },
  { duration: 1.15, maxVoices: 4, desc: 'rock column / wall rising from the ground' },
);
aliasSound('rock_rise', 'stone.rise');

function stoneImpact(ac: AC, out: AudioNode, o: RecipeOpts, t: number, size: number): number {
  const p = o.pitch;
  const v = o.volume;
  thump(ac, out, t, 78 * p, 33 * p, 0.25 + 0.3 * size, (0.55 + 0.25 * size) * v);
  const c = noiseVoice(ac, out, o.white, t, 'bandpass', 1300 * p, 0.9, 0.001, 0, 0.05 + 0.05 * size, 0.42 * v);
  send(ac, c.env, o.reverb, 0.2 + 0.3 * size);
  noiseHit(ac, out, o.noise, t, 'lowpass', 900 * p, 0.7, 0.002, 0.25 + 0.25 * size, 0.3 * v);
  grains(ac, out, o.white, t + 0.02, 0.25 + 0.35 * size, Math.round(8 + 18 * size), { fLo: 1500 * p, fHi: 5500 * p, q: 1.5, dur: 0.008, peak: 0.12 * v, fade: 0.8 });
  if (size > 0.6) rumble(ac, out, o, t, 140 * p, 0.02, 0.15, 0.7, 0.35 * v);
  return 0.45 + 0.5 * size;
}

registerSound('stone.impact', (ac, out, t, o) => stoneImpact(ac, out, o, t, 0.4), { duration: 0.95, maxVoices: 5, desc: 'rock hits something hard (thud + crack + debris)' });
registerSound('stone.slam', (ac, out, t, o) => stoneImpact(ac, out, o, t, 1), { duration: 1.4, maxVoices: 3, reverb: 0.2, desc: 'huge earth slam (boulder, stomp, collapsing wall)' });
aliasSound('rock_impact', 'stone.impact');

registerSound(
  'stone.crumble',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const ts = t + Math.pow(i / n, 1.3) * 0.85 + rand(0, 0.03);
      const k = 1 - (i / n) * 0.7;
      ping(ac, out, ts, rand(300, 900) * p, rand(0.03, 0.07), 0.08 * v * k, 'triangle');
      noiseHit(ac, out, o.white, ts, 'bandpass', rand(1500, 4000) * p, 1.5, 0.001, 0.015, 0.1 * v * k);
    }
    noiseAHR(ac, out, o.noise, t, 'lowpass', 1200 * p, 0.7, 0.05, 0.4, 0.45, 0.16 * v);
    thump(ac, out, t, 90 * p, 50 * p, 0.2, 0.3 * v);
    return 1.0;
  },
  { duration: 1.3, maxVoices: 3, desc: 'stone construct crumbling into rubble' },
);

registerSound(
  'stone.debris',
  (ac, out, t, o) => {
    grains(ac, out, o.white, t, 0.45, 16, { fLo: 1200 * o.pitch, fHi: 5000 * o.pitch, q: 1.8, dur: 0.01, peak: 0.16 * o.volume, fade: 0.8 });
    for (let i = 0; i < 5; i++) ping(ac, out, t + rand(0, 0.4), rand(400, 1100) * o.pitch, 0.04, 0.05 * o.volume, 'triangle');
    return 0.55;
  },
  { duration: 0.75, maxVoices: 4, desc: 'pebbles and small debris scattering' },
);

// ---------------------------------------------------------------------------
// Air
// ---------------------------------------------------------------------------

registerSound(
  'air.whoosh',
  (ac, out, t, o) => {
    const p = o.pitch;
    whoosh(ac, out, o, t, 500 * p, 2300 * p, 700 * p, 0.45, 0.5 * o.volume);
    thump(ac, out, t, 120 * p, 60 * p, 0.08, 0.12 * o.volume);
    return 0.5;
  },
  { duration: 0.7, maxVoices: 6, desc: 'generic air whoosh (swings, passes, element switch)' },
);
aliasSound('whoosh', 'air.whoosh');

registerSound(
  'air.gust',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 1.6);
    const f = filt(ac, 'bandpass', 420 * p, 0.7);
    lfo(ac, 0.9, 160 * p, f.frequency);
    const g = swell(ac, t, 0.55, 0.3, 0.7, 0.45 * v);
    src.connect(f).connect(g).connect(out);
    noiseAHR(ac, out, o.white, t + 0.1, 'highpass', 2200 * p, 0.6, 0.4, 0.3, 0.6, 0.06 * v);
    const w = noise(ac, o.white, t, 1.5);
    const wf = filt(ac, 'bandpass', 1100 * p, 14);
    wf.frequency.setValueAtTime(900 * p, t);
    wf.frequency.linearRampToValueAtTime(1500 * p, t + 0.7);
    wf.frequency.linearRampToValueAtTime(1000 * p, t + 1.4);
    const wg = swell(ac, t + 0.1, 0.5, 0.2, 0.6, 0.1 * v);
    w.connect(wf).connect(wg).connect(out);
    return 1.6;
  },
  { duration: 1.8, maxVoices: 3, desc: 'gust of wind with a faint whistle' },
);

function vortexBody(ac: AC, out: AudioNode, o: { noise: AudioBuffer }, t: number, dur: number, peak: number, pitch: number): AudioScheduledSourceNode[] {
  const src = noise(ac, o.noise, t, dur);
  const f = filt(ac, 'bandpass', 800 * pitch, 2.4);
  const l = osc(ac, 'sine', 7, t, dur);
  const lg = gain(ac, 420 * pitch);
  l.connect(lg).connect(f.frequency);
  const g = swell(ac, t, dur * 0.3, dur * 0.3, dur * 0.4, peak);
  src.connect(f).connect(g).connect(out);
  const hum = osc(ac, 'sawtooth', 70 * pitch, t, dur);
  const hf = filt(ac, 'lowpass', 260 * pitch, 2);
  const trem = gain(ac, 0.6);
  const tl = osc(ac, 'sine', 7, t, dur);
  const tlg = gain(ac, 0.4);
  tl.connect(tlg).connect(trem.gain);
  const hg = swell(ac, t, dur * 0.3, dur * 0.3, dur * 0.4, peak * 0.5);
  hum.connect(hf).connect(trem).connect(hg).connect(out);
  return [src, l, hum, tl];
}

registerSound(
  'air.vortex',
  (ac, out, t, o) => {
    vortexBody(ac, out, o, t, 1.5, 0.4 * o.volume, o.pitch);
    return 1.55;
  },
  { duration: 1.8, maxVoices: 3, desc: 'swirling vortex burst (tornado, air spout)' },
);

registerLoop(
  'loop.air.vortex',
  (ac, out, o) => {
    const g = gain(ac, 1);
    g.connect(out);
    const src = loopNoise(ac, o.noise);
    const f = filt(ac, 'bandpass', 800, 2.4);
    const spin = lfo(ac, 6, 420, f.frequency);
    const ng = gain(ac, 0.42);
    src.connect(f).connect(ng).connect(g);
    const hum = ac.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 68;
    const hf = filt(ac, 'lowpass', 260, 2);
    const trem = gain(ac, 0.6);
    const tl = lfo(ac, 6, 0.35, trem.gain);
    const hg = gain(ac, 0.2);
    hum.connect(hf).connect(trem).connect(hg).connect(g);
    hum.start();
    return {
      stop(t: number) {
        stopAll([src, spin, hum, tl], t);
      },
      setPitch(p: number) {
        hum.frequency.setTargetAtTime(68 * p, ac.currentTime, 0.1);
        f.frequency.setTargetAtTime(800 * p, ac.currentTime, 0.1);
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') {
          const k = Math.max(0, Math.min(1.5, v));
          spin.frequency.setTargetAtTime(3 + 7 * k, ac.currentTime, 0.2);
          tl.frequency.setTargetAtTime(3 + 7 * k, ac.currentTime, 0.2);
          g.gain.setTargetAtTime(0.4 + 0.6 * k, ac.currentTime, 0.2);
        }
      },
    };
  },
  { desc: 'sustained vortex hum (air spout, tornado, sphere)', params: ['intensity'] },
);

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

registerSound(
  'fire.whoosh',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.6);
    const f = filt(ac, 'lowpass', 3000 * p, 0.9);
    f.frequency.setValueAtTime(900 * p, t);
    f.frequency.exponentialRampToValueAtTime(3200 * p, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(500 * p, t + 0.55);
    const sh = shaper(ac, 'tanh', 0.3);
    const g = swell(ac, t, 0.1, 0.08, 0.38, 0.5 * v);
    src.connect(f).connect(sh).connect(g).connect(out);
    crackle(ac, out, o, t + 0.05, 0.4, 8, 0.1 * v);
    thump(ac, out, t, 110 * p, 50 * p, 0.12, 0.2 * v);
    return 0.62;
  },
  { duration: 0.85, maxVoices: 6, desc: 'fire swept through the air (fire whip, flame arc)' },
);

registerSound(
  'fire.burst',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const f = noiseHit(ac, out, o.noise, t, 'lowpass', 2600 * p, 0.8, 0.01, 0.5, 0.6 * v);
    f.frequency.exponentialRampToValueAtTime(420 * p, t + 0.5);
    thump(ac, out, t, 92 * p, 45 * p, 0.22, 0.38 * v);
    crackle(ac, out, o, t + 0.03, 0.45, 10, 0.12 * v);
    return 0.7;
  },
  { duration: 0.9, maxVoices: 6, desc: 'fire blast (fist of flame)' },
);
aliasSound('fire_burst', 'fire.burst');

registerSound(
  'fire.ignite',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.noise, t, 0.5);
    const f = filt(ac, 'lowpass', 300 * p, 1.2);
    f.frequency.setValueAtTime(300 * p, t);
    f.frequency.exponentialRampToValueAtTime(2600 * p, t + 0.18);
    f.frequency.exponentialRampToValueAtTime(900 * p, t + 0.45);
    const g = swell(ac, t, 0.12, 0.05, 0.3, 0.45 * v);
    src.connect(f).connect(g).connect(out);
    thump(ac, out, t + 0.02, 70 * p, 45 * p, 0.2, 0.3 * v);
    crackle(ac, out, o, t + 0.15, 0.3, 6, 0.08 * v);
    return 0.5;
  },
  { duration: 0.7, maxVoices: 4, desc: '"fwoomp" — flames catching (braziers, torches, kindling)' },
);

registerSound(
  'fire.roar',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const src = noise(ac, o.brown, t, 1.45);
    const src2 = noise(ac, o.noise, t, 1.45);
    const mix = gain(ac, 1);
    src.connect(mix);
    const g2 = gain(ac, 0.5);
    src2.connect(g2).connect(mix);
    const f = filt(ac, 'lowpass', 900 * p, 1.1);
    lfo(ac, rand(3, 5), 220 * p, f.frequency);
    const sh = shaper(ac, 'asym', 0.5);
    const g = swell(ac, t, 0.35, 0.45, 0.6, 0.5 * v);
    mix.connect(f).connect(sh).connect(g).connect(out);
    thump(ac, out, t, 60 * p, 40 * p, 0.6, 0.22 * v);
    crackle(ac, out, o, t + 0.1, 1.2, 22, 0.1 * v);
    return 1.45;
  },
  { duration: 1.7, maxVoices: 3, desc: 'roaring flames (fire stream, dragon breath, blaze)' },
);

registerSound(
  'fire.explosion',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Crack transient.
    noiseHit(ac, out, o.white, t, 'highpass', 800 * p, 0.6, 0.0008, 0.03, 0.5 * v);
    // Sub boom.
    thump(ac, out, t, 95 * p, 26 * p, 1.0, 0.75 * v, 0.2);
    // Body: distorted noise sweeping down.
    const src = noise(ac, o.noise, t, 1.7);
    const f = filt(ac, 'lowpass', 5000 * p, 0.7);
    f.frequency.setValueAtTime(5000 * p, t);
    f.frequency.exponentialRampToValueAtTime(180 * p, t + 1.4);
    const sh = shaper(ac, 'tanh', 0.6);
    const g = perc(ac, t, 0.004, 1.5, 0.5 * v);
    src.connect(f).connect(sh).connect(g).connect(out);
    send(ac, g, o.reverb, 0.6);
    rumble(ac, out, o, t + 0.05, 160 * p, 0.05, 0.3, 1.2, 0.45 * v);
    crackle(ac, out, o, t + 0.1, 1.0, 26, 0.12 * v);
    grains(ac, out, o.white, t + 0.2, 1.0, 14, { fLo: 1200 * p, fHi: 4000 * p, q: 1.5, dur: 0.01, peak: 0.08 * v, fade: 0.9 });
    return 1.7;
  },
  { duration: 2.0, maxVoices: 3, reverb: 0.25, range: 160, desc: 'fire explosion (boom, crack, rumble, debris)' },
);

/** Campfire / brazier: low roar + crackle pops + occasional hiss. */
registerLoop(
  'loop.fire.crackle',
  (ac, out, o) => {
    const g = gain(ac, 1);
    g.connect(out);
    const bed = loopNoise(ac, o.brown);
    const bf = filt(ac, 'lowpass', 520, 0.8);
    const bg = gain(ac, 0.28);
    const flick = lfo(ac, 2.3, 0.08, bg.gain);
    bed.connect(bf).connect(bg).connect(g);
    const roar = loopNoise(ac, o.noise);
    const rf = filt(ac, 'bandpass', 900, 0.8);
    const rg = gain(ac, 0.06);
    roar.connect(rf).connect(rg).connect(g);
    const res = { noise: o.noise, white: o.white, brown: o.brown, reverb: o.reverb, pitch: 1, volume: 1, seed: 0 };
    const pump = eventPump(ac, (t0, t1, d) => {
      for (const t of eventTimes(t0, t1, 9 * d)) {
        if (chance(0.15)) crackle(ac, g, res, t, 0.08, randi(3, 6), rand(0.05, 0.12));
        else noiseHit(ac, g, o.white, t, 'bandpass', rand(1500, 6000), 1.5, 0.0008, rand(0.004, 0.012), rand(0.04, 0.16));
      }
      for (const t of eventTimes(t0, t1, 0.15 * d)) noiseAHR(ac, g, o.white, t, 'highpass', 4500, 0.7, 0.1, 0.2, 0.4, 0.035);
    });
    return {
      stop(t: number) {
        pump.stop();
        stopAll([bed, flick, roar], t);
      },
      setParam(name: string, v: number) {
        if (name === 'intensity') {
          const k = Math.max(0, Math.min(2, v));
          bg.gain.setTargetAtTime(0.18 + 0.2 * k, ac.currentTime, 0.2);
          rg.gain.setTargetAtTime(0.03 + 0.12 * k, ac.currentTime, 0.2);
          pump.density = 0.5 + k;
        }
      },
    };
  },
  { desc: 'crackling fire (campfire, brazier, burning debris)', params: ['intensity'] },
);
registerLoop('fire_crackle', (ac, out, o) => {
  const r = loopFireRoar(ac, out, o, 0.35);
  return r;
}, { desc: 'legacy: fire crackle (sustained flames)', params: ['intensity'] });

function loopFireRoar(ac: AC, out: AudioNode, o: { noise: AudioBuffer; white: AudioBuffer; brown: AudioBuffer }, base: number) {
  const g = gain(ac, base);
  g.connect(out);
  const a = loopNoise(ac, o.brown);
  const b = loopNoise(ac, o.noise);
  const mix = gain(ac, 1);
  a.connect(mix);
  const bg = gain(ac, 0.45);
  b.connect(bg).connect(mix);
  const f = filt(ac, 'lowpass', 1100, 1);
  const wob = lfo(ac, 4.2, 260, f.frequency);
  const sh = shaper(ac, 'asym', 0.45);
  const out2 = gain(ac, 0.7);
  mix.connect(f).connect(sh).connect(out2).connect(g);
  const res = { noise: o.noise, white: o.white, brown: o.brown, reverb: out2, pitch: 1, volume: 1, seed: 0 };
  const pump = eventPump(ac, (t0, t1, d) => {
    for (const t of eventTimes(t0, t1, 6 * d)) crackle(ac, g, res, t, 0.05, randi(2, 4), rand(0.03, 0.09));
  });
  return {
    stop(t: number) {
      pump.stop();
      stopAll([a, b, wob], t);
    },
    setPitch(p: number) {
      f.frequency.setTargetAtTime(1100 * p, ac.currentTime, 0.1);
    },
    setParam(name: string, v: number) {
      if (name === 'intensity') {
        const k = Math.max(0, Math.min(2, v));
        g.gain.setTargetAtTime(base * (0.4 + 0.8 * k), ac.currentTime, 0.15);
        f.frequency.setTargetAtTime(600 + 900 * k, ac.currentTime, 0.15);
        pump.density = 0.5 + k;
      }
    },
  };
}

registerLoop('loop.fire.roar', (ac, out, o) => loopFireRoar(ac, out, o, 0.8), { desc: 'sustained roaring flame (flamethrower, fire tornado core)', params: ['intensity'] });

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

registerSound(
  'lightning.crack',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    noiseHit(ac, out, o.white, t, 'highpass', 600 * p, 0.6, 0.0006, 0.035, 0.7 * v);
    // Electrical zaps: sawtooth chirps with FM grit.
    for (let i = 0; i < 4; i++) {
      const ts = t + i * rand(0.025, 0.05);
      const z = osc(ac, 'sawtooth', 2400 * p, ts, 0.08);
      glide(z.frequency, ts, rand(1800, 3200) * p, rand(150, 320) * p, 0.06);
      const zg = perc(ac, ts, 0.001, 0.06, 0.12 * v);
      z.connect(zg).connect(out);
    }
    // Buzz.
    const b = osc(ac, 'square', 118 * p, t, 0.35);
    const bf = filt(ac, 'bandpass', 1800 * p, 1.5);
    const bam = gain(ac, 0.5);
    lfo(ac, 47, 0.5, bam.gain, 'square');
    const bg = perc(ac, t, 0.002, 0.3, 0.07 * v);
    b.connect(bf).connect(bam).connect(bg).connect(out);
    // Thunder tail.
    const th = noiseVoice(ac, out, o.brown, t + 0.04, 'lowpass', 320 * p, 0.8, 0.12, 0.2, 1.1, 0.45 * v);
    th.filter.frequency.exponentialRampToValueAtTime(120 * p, t + 1.2);
    send(ac, th.env, o.reverb, 0.5);
    thump(ac, out, t, 90 * p, 30 * p, 0.5, 0.4 * v);
    return 1.5;
  },
  { duration: 1.8, maxVoices: 3, reverb: 0.25, range: 200, desc: 'lightning bolt crack (zap + buzz + thunder)' },
);

registerSound(
  'lightning.zap',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    for (let i = 0; i < 3; i++) {
      const ts = t + i * 0.03;
      const z = osc(ac, 'sawtooth', 2000 * p, ts, 0.06);
      glide(z.frequency, ts, rand(1500, 2600) * p, rand(200, 400) * p, 0.05);
      const zg = perc(ac, ts, 0.001, 0.05, 0.1 * v);
      z.connect(zg).connect(out);
    }
    noiseHit(ac, out, o.white, t, 'highpass', 3000 * p, 0.7, 0.001, 0.05, 0.2 * v);
    return 0.25;
  },
  { duration: 0.4, maxVoices: 4, desc: 'small electric arc / sparks' },
);

registerSound(
  'thunder.distant',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    const n = randi(2, 4);
    for (let i = 0; i < n; i++) {
      const ts = t + i * rand(0.3, 0.7);
      rumble(ac, out, o, ts, rand(150, 300) * p, rand(0.15, 0.4), rand(0.1, 0.4), rand(0.8, 1.4), rand(0.25, 0.45) * v);
    }
    return 3.4;
  },
  { duration: 3.8, maxVoices: 2, reverb: 0.4, range: 2000, desc: 'distant rolling thunder (storms)' },
);
