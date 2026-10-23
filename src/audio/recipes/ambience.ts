import { aliasSound, registerLoop, registerSound, type LoopInstance, type LoopRecipeOpts, type RecipeOpts } from '../registry';
import {
  babble,
  bell,
  chance,
  chime,
  droplet,
  filt,
  gain,
  glide,
  grains,
  noise,
  noiseAHR,
  noiseHit,
  osc,
  perc,
  pick,
  ping,
  rand,
  randi,
  semis,
  swell,
  thump,
  VOICE_TYPES,
  type AC,
} from '../synth';
import { eventPump, eventTimes, lfo, loopNoise, stopAll, type EventPump } from './util';

/**
 * Ambience beds (loops) and spot sounds for the ambience director. Beds are
 * cheap continuous textures (noise through moving filters, slow AM) plus
 * sparse scheduled events; positional detail (individual birds, owls, gulls,
 * frogs, bells, thunder) comes from the spot one-shots, which the director
 * places around the listener.
 *
 * Every loop understands setParam('intensity', 0..1.5) and most also
 * setParam('density', 0..2) for event rates.
 */

interface Bed {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
  pumps: EventPump[];
  onIntensity?: (k: number) => void;
}

function bed(ac: AC, out: AudioNode): Bed {
  const g = gain(ac, 1);
  g.connect(out);
  return { out: g, nodes: [], pumps: [] };
}

function finish(ac: AC, b: Bed): LoopInstance {
  return {
    stop(t: number) {
      for (const p of b.pumps) p.stop();
      stopAll(b.nodes, t);
    },
    setParam(name: string, v: number) {
      if (!Number.isFinite(v)) return;
      if (name === 'intensity') {
        const k = Math.max(0, Math.min(1.5, v));
        b.out.gain.setTargetAtTime(k, ac.currentTime, 0.4);
        b.onIntensity?.(k);
      } else if (name === 'density') for (const p of b.pumps) p.density = Math.max(0, Math.min(2, v));
    },
  };
}

/** Filtered noise layer with optional frequency wander. */
function layer(ac: AC, b: Bed, buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, lvl: number, wander = 0, rate = 0.1): { f: BiquadFilterNode; g: GainNode } {
  const s = loopNoise(ac, buf);
  const fl = filt(ac, type, f, q);
  const g = gain(ac, lvl);
  s.connect(fl).connect(g).connect(b.out);
  b.nodes.push(s);
  if (wander > 0) b.nodes.push(lfo(ac, rate, f * wander, fl.frequency));
  return { f: fl, g };
}

/** Gust modulation: base + two slow incommensurate LFOs on a gain. */
function gusts(ac: AC, b: Bed, g: GainNode, base: number, depth: number, r1 = 0.071, r2 = 0.13): void {
  g.gain.value = base;
  b.nodes.push(lfo(ac, r1, depth * 0.6, g.gain), lfo(ac, r2, depth * 0.4, g.gain));
}

// ---------------------------------------------------------------------------
// Wind family
// ---------------------------------------------------------------------------

registerLoop(
  'amb.wind',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 420, 0.6, 0.3, 0.45, 0.06);
    gusts(ac, b, main.g, 0.3, 0.22);
    const hi = layer(ac, b, o.white, 'highpass', 2500, 0.5, 0.025);
    gusts(ac, b, hi.g, 0.025, 0.02, 0.09, 0.17);
    const whistle = layer(ac, b, o.white, 'bandpass', 1100, 14, 0.04, 0.3, 0.05);
    gusts(ac, b, whistle.g, 0.03, 0.03, 0.05, 0.11);
    b.onIntensity = (k) => main.f.frequency.setTargetAtTime(320 + 260 * k, ac.currentTime, 1);
    return finish(ac, b);
  },
  { desc: 'general wind with gusts and a faint whistle', params: ['intensity'] },
);

registerLoop(
  'amb.wind.high',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 650, 0.7, 0.28, 0.5, 0.05);
    gusts(ac, b, main.g, 0.28, 0.24, 0.09, 0.19);
    for (const [f, r] of [[720, 0.043], [1150, 0.061], [1640, 0.083]] as const) {
      const w = layer(ac, b, o.white, 'bandpass', f, 16, 0.05, 0.25, r);
      gusts(ac, b, w.g, 0.04, 0.04, r * 1.7, r * 2.9);
    }
    layer(ac, b, o.brown, 'lowpass', 140, 0.7, 0.18);
    return finish(ac, b);
  },
  { desc: 'high-altitude wind: strong gusts and howling whistles (mountain summits)', params: ['intensity'] },
);

registerLoop(
  'amb.blizzard',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 800, 0.5, 0.42, 0.5, 0.11);
    gusts(ac, b, main.g, 0.42, 0.3, 0.13, 0.31);
    layer(ac, b, o.white, 'highpass', 3000, 0.5, 0.08, 0.3, 0.2);
    for (const f of [540, 860, 1300]) {
      const w = layer(ac, b, o.white, 'bandpass', f, 12, 0.07, 0.35, rand(0.05, 0.12));
      gusts(ac, b, w.g, 0.05, 0.05, rand(0.1, 0.2), rand(0.25, 0.4));
    }
    layer(ac, b, o.brown, 'lowpass', 180, 0.7, 0.25);
    return finish(ac, b);
  },
  { desc: 'blizzard howl (snow-laden roaring wind)', params: ['intensity'] },
);

registerLoop(
  'amb.desert',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 380, 0.6, 0.24, 0.4, 0.05);
    gusts(ac, b, main.g, 0.24, 0.18);
    const hiss = layer(ac, b, o.white, 'highpass', 4500, 0.6, 0.05);
    gusts(ac, b, hiss.g, 0.04, 0.035, 0.071, 0.13);
    const p = eventPump(ac, (t0, t1, d) => {
      for (const t of eventTimes(t0, t1, 1.2 * d)) grains(ac, b.out, o.white, t, rand(0.3, 0.8), randi(8, 20), { fLo: 3500, fHi: 9000, q: 1.2, dur: 0.004, peak: rand(0.01, 0.03) });
    });
    b.pumps.push(p);
    return finish(ac, b);
  },
  { desc: 'dry desert wind with hissing, skittering sand', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.sandstorm',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 600, 0.5, 0.4, 0.4, 0.13);
    gusts(ac, b, main.g, 0.4, 0.25, 0.17, 0.29);
    const hiss = layer(ac, b, o.white, 'bandpass', 5000, 0.7, 0.12, 0.2, 0.3);
    gusts(ac, b, hiss.g, 0.12, 0.06, 0.2, 0.37);
    layer(ac, b, o.brown, 'lowpass', 160, 0.7, 0.3);
    const p = eventPump(ac, (t0, t1, d) => {
      for (const t of eventTimes(t0, t1, 5 * d)) grains(ac, b.out, o.white, t, rand(0.2, 0.5), randi(10, 25), { fLo: 2500, fHi: 9000, q: 1, dur: 0.004, peak: rand(0.02, 0.05) });
    });
    b.pumps.push(p);
    return finish(ac, b);
  },
  { desc: 'sandstorm (roaring wind, blasting grit)', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.polar',
  (ac, out, o) => {
    const b = bed(ac, out);
    const main = layer(ac, b, o.noise, 'bandpass', 900, 0.8, 0.16, 0.4, 0.04);
    gusts(ac, b, main.g, 0.16, 0.12);
    const w = layer(ac, b, o.white, 'bandpass', 1900, 14, 0.035, 0.25, 0.03);
    gusts(ac, b, w.g, 0.03, 0.03, 0.04, 0.09);
    const p = eventPump(ac, (t0, t1, d) => {
      // Distant ice creaks / groans.
      for (const t of eventTimes(t0, t1, 0.12 * d)) {
        const f0 = rand(45, 80);
        const s = osc(ac, 'sawtooth', f0, t, 1.4);
        s.frequency.setValueAtTime(f0, t);
        s.frequency.linearRampToValueAtTime(f0 * rand(1.1, 1.5), t + 0.7);
        const bf = filt(ac, 'bandpass', rand(400, 800), 7);
        const g = swell(ac, t, 0.5, 0.2, 0.6, rand(0.03, 0.06));
        s.connect(bf).connect(g).connect(b.out);
      }
      for (const t of eventTimes(t0, t1, 0.6 * d)) grains(ac, b.out, o.white, t, 0.5, randi(4, 9), { fLo: 4000, fHi: 9000, q: 2, dur: 0.003, peak: 0.012 });
    });
    b.pumps.push(p);
    return finish(ac, b);
  },
  { desc: 'polar cold: thin bright wind, ice groans, ice-crystal ticks', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.snowfall',
  (ac, out, o) => {
    const b = bed(ac, out);
    layer(ac, b, o.white, 'highpass', 6500, 0.5, 0.012);
    const low = layer(ac, b, o.noise, 'lowpass', 380, 0.6, 0.12, 0.3, 0.05);
    gusts(ac, b, low.g, 0.12, 0.08);
    return finish(ac, b);
  },
  { desc: 'gentle snowfall (hushed hiss, muffled air)', params: ['intensity'] },
);

// ---------------------------------------------------------------------------
// Water family
// ---------------------------------------------------------------------------

/** Asymmetric swell LFO (slow build, quick crash, long wash) via a custom periodic wave. */
function swellWave(ac: AC): PeriodicWave {
  const n = 8;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  // Sawtooth-like with softened harmonics → slow rise, fast fall.
  for (let k = 1; k < n; k++) imag[k] = (k % 2 ? 1 : -1) / (k * k * 0.6 + k * 0.4);
  return ac.createPeriodicWave(real, imag, { disableNormalization: false });
}

registerLoop(
  'amb.surf',
  (ac, out, o) => {
    const b = bed(ac, out);
    const wave = swellWave(ac);
    const mk = (period: number, lvl: number, phase: number) => {
      // Body of the wave (low roar).
      const body = layer(ac, b, o.brown, 'lowpass', 520, 0.7, 0);
      const crash = layer(ac, b, o.noise, 'bandpass', 1300, 0.6, 0);
      const fizz = layer(ac, b, o.white, 'highpass', 3500, 0.5, 0);
      const l = ac.createOscillator();
      l.setPeriodicWave(wave);
      l.frequency.value = 1 / period;
      const off = ac.createConstantSource();
      off.offset.value = lvl * 0.55;
      const d1 = gain(ac, lvl * 0.45);
      const d2 = gain(ac, lvl * 0.22);
      const d3 = gain(ac, lvl * 0.06);
      l.connect(d1).connect(body.g.gain);
      off.connect(body.g.gain);
      l.connect(d2).connect(crash.g.gain);
      const off2 = ac.createConstantSource();
      off2.offset.value = lvl * 0.2;
      off2.connect(crash.g.gain);
      l.connect(d3).connect(fizz.g.gain);
      const off3 = ac.createConstantSource();
      off3.offset.value = lvl * 0.065;
      off3.connect(fizz.g.gain);
      const st = ac.currentTime + phase;
      l.start(st);
      off.start();
      off2.start();
      off3.start();
      b.nodes.push(l, off, off2, off3);
    };
    mk(rand(9, 11), 0.5, 0);
    mk(rand(13, 15.5), 0.35, rand(2, 5));
    return finish(ac, b);
  },
  { desc: 'ocean surf: waves building, crashing and washing back (two overlapping wave trains)', params: ['intensity'] },
);

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

function murmur(ac: AC, b: Bed, o: LoopRecipeOpts, voices: number, lvl: number): void {
  const walla = layer(ac, b, o.noise, 'bandpass', 900, 0.7, lvl * 0.5, 0.3, 0.09);
  gusts(ac, b, walla.g, lvl * 0.5, lvl * 0.15, 0.21, 0.37);
  layer(ac, b, o.noise, 'bandpass', 380, 0.8, lvl * 0.25);
  const types = ['male', 'female', 'elder_m', 'female', 'child', 'gruff'];
  const lp = filt(ac, 'lowpass', 1800, 0.7);
  lp.connect(b.out);
  b.pumps.push(
    eventPump(ac, (t0, t1, d) => {
      for (const t of eventTimes(t0, t1, voices * 0.9 * d)) {
        const base = VOICE_TYPES[pick(types)];
        babble(ac, lp, t, { ...base, f0: base.f0 * rand(0.9, 1.15) }, randi(3, 8), o.noise, lvl * rand(0.12, 0.3), chance(0.25));
      }
      // Footsteps & small activity.
      for (const t of eventTimes(t0, t1, 1.5 * d)) noiseHit(ac, b.out, o.white, t, 'bandpass', rand(1200, 3000), 1.5, 0.001, 0.015, lvl * rand(0.03, 0.08));
    }, 1.2),
  );
}

registerLoop(
  'amb.city',
  (ac, out, o) => {
    const b = bed(ac, out);
    murmur(ac, b, o, 3, 0.5);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        // Distant doors, carts and wood knocks.
        for (const t of eventTimes(t0, t1, 0.25 * d)) ping(ac, b.out, t, rand(250, 600), 0.06, rand(0.02, 0.05), 'triangle');
        for (const t of eventTimes(t0, t1, 0.08 * d)) grains(ac, b.out, o.white, t, rand(0.6, 1.4), randi(15, 30), { fLo: 900, fHi: 2500, q: 2, dur: 0.012, peak: 0.02 });
      }),
    );
    return finish(ac, b);
  },
  { desc: 'town murmur: distant crowd babble, footsteps, doors, carts', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.market',
  (ac, out, o) => {
    const b = bed(ac, out);
    murmur(ac, b, o, 5, 0.6);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        // Vendor calls (louder, rising), coin and pottery clinks, rattling carts.
        for (const t of eventTimes(t0, t1, 0.18 * d)) {
          const base = VOICE_TYPES[pick(['male', 'female', 'gruff'])];
          babble(ac, b.out, t, { ...base, f0: base.f0 * 1.25, rate: 6.5, range: 5 }, randi(3, 5), o.noise, rand(0.08, 0.14), true);
        }
        for (const t of eventTimes(t0, t1, 0.6 * d)) for (const f of [2400, 3130]) ping(ac, b.out, t + rand(0, 0.02), f * rand(0.9, 1.1), 0.1, 0.012);
        for (const t of eventTimes(t0, t1, 0.15 * d)) {
          ping(ac, b.out, t, rand(500, 900), 0.09, 0.02, 'triangle');
          noiseHit(ac, b.out, o.white, t, 'bandpass', 2000, 2, 0.001, 0.02, 0.025);
        }
      }),
    );
    return finish(ac, b);
  },
  { desc: 'busy market: vendor calls, clinking coins and pottery, carts', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.harbor',
  (ac, out, o) => {
    const b = bed(ac, out);
    const lap = layer(ac, b, o.noise, 'bandpass', 650, 0.8, 0);
    const l = ac.createOscillator();
    l.frequency.value = 0.38;
    const lg = gain(ac, 0.12);
    l.connect(lg).connect(lap.g.gain);
    const off = ac.createConstantSource();
    off.offset.value = 0.14;
    off.connect(lap.g.gain);
    l.start();
    off.start();
    b.nodes.push(l, off);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 0.35 * d)) {
          // Hull / mooring creak.
          const f0 = rand(90, 160);
          const s = osc(ac, 'sawtooth', f0, t, 0.6);
          glide(s.frequency, t, f0, f0 * rand(0.75, 1.3), 0.5);
          const bf = filt(ac, 'bandpass', rand(600, 1200), 6);
          const g = swell(ac, t, 0.15, 0.1, 0.3, rand(0.015, 0.035));
          s.connect(bf).connect(g).connect(b.out);
        }
        for (const t of eventTimes(t0, t1, 2 * d)) droplet(ac, b.out, t, rand(300, 800), 0.02, 0.06);
      }),
    );
    return finish(ac, b);
  },
  { desc: 'harbor: lapping water against hulls, creaking moorings', params: ['intensity', 'density'] },
);

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

/** A bird call: sine with rapid FM glides through a sequence of notes. */
function birdCall(ac: AC, out: AudioNode, t: number, kind: number, vol: number, pitch = 1): number {
  let tt = t;
  const notes = kind === 0 ? randi(2, 4) : kind === 1 ? randi(4, 8) : randi(6, 12);
  const base = rand(2200, 4200) * pitch;
  const motif = Array.from({ length: notes }, (_, i) => base * semis(kind === 2 ? (i % 2 ? 3 : 0) : rand(-5, 7)));
  for (let i = 0; i < notes; i++) {
    const f = motif[i];
    const d = kind === 2 ? rand(0.035, 0.05) : rand(0.06, 0.14);
    const s = osc(ac, 'sine', f, tt, d + 0.02);
    s.frequency.setValueAtTime(f * rand(0.8, 1.0), tt);
    s.frequency.exponentialRampToValueAtTime(f * rand(1.0, 1.35), tt + d * 0.6);
    s.frequency.exponentialRampToValueAtTime(f * rand(0.85, 1.05), tt + d);
    const g = perc(ac, tt, Math.min(0.01, d * 0.25), d, vol * rand(0.6, 1));
    s.connect(g).connect(out);
    tt += d + (kind === 2 ? 0.01 : rand(0.02, 0.08));
  }
  return tt - t;
}

registerLoop(
  'amb.forest',
  (ac, out, o) => {
    const b = bed(ac, out);
    const leaves = layer(ac, b, o.white, 'bandpass', 3200, 0.6, 0.05, 0.25, 0.1);
    gusts(ac, b, leaves.g, 0.045, 0.04, 0.09, 0.15);
    layer(ac, b, o.noise, 'lowpass', 300, 0.7, 0.05);
    const far = filt(ac, 'lowpass', 3000, 0.7);
    far.connect(b.out);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 1.2 * d)) birdCall(ac, far, t, randi(0, 2), rand(0.008, 0.025));
        // Woodpecker, occasionally.
        for (const t of eventTimes(t0, t1, 0.03 * d)) for (let i = 0; i < randi(8, 14); i++) ping(ac, b.out, t + i * 0.055, rand(900, 1100), 0.02, 0.02, 'triangle');
      }),
    );
    return finish(ac, b);
  },
  { desc: 'forest by day: rustling leaves, distant birdsong, the odd woodpecker', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.insects',
  (ac, out, o) => {
    const b = bed(ac, out);
    // Cicada chorus: band-limited noise with fast AM swelling in long cycles.
    for (const [f, am, cyc] of [[5200, 72, 0.09], [6400, 88, 0.06]] as const) {
      const c = layer(ac, b, o.white, 'bandpass', f, 6, 0);
      const vca = gain(ac, 0);
      c.g.disconnect();
      c.g.gain.value = 1;
      c.g.connect(vca).connect(b.out);
      const fast = ac.createOscillator();
      fast.frequency.value = am;
      const fg = gain(ac, 0.012);
      fast.connect(fg).connect(vca.gain);
      const slow = ac.createOscillator();
      slow.frequency.value = cyc;
      const sg = gain(ac, 0.012);
      slow.connect(sg).connect(vca.gain);
      const off = ac.createConstantSource();
      off.offset.value = 0.014;
      off.connect(vca.gain);
      fast.start();
      slow.start();
      off.start();
      b.nodes.push(fast, slow, off);
    }
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        // A passing bee.
        for (const t of eventTimes(t0, t1, 0.05 * d)) {
          const s = osc(ac, 'sawtooth', rand(200, 240), t, 1.6);
          const v = ac.createOscillator();
          v.frequency.value = 6;
          const vg = gain(ac, 8);
          v.connect(vg).connect(s.frequency);
          v.start(t);
          v.stop(t + 1.65);
          const bf = filt(ac, 'bandpass', 800, 1.5);
          const g = swell(ac, t, 0.6, 0.2, 0.7, 0.012);
          s.connect(bf).connect(g).connect(b.out);
        }
      }),
    );
    return finish(ac, b);
  },
  { desc: 'daytime insects: cicada chorus, passing bees (farmland, tropics, swamp)', params: ['intensity', 'density'] },
);

function cricketChirp(ac: AC, out: AudioNode, t: number, f: number, vol: number): void {
  const pulses = randi(2, 4);
  for (let i = 0; i < pulses; i++) {
    const s = osc(ac, 'sine', f, t + i * 0.033, 0.03);
    const g = perc(ac, t + i * 0.033, 0.003, 0.018, vol);
    s.connect(g).connect(out);
  }
}

registerLoop(
  'amb.night',
  (ac, out, o) => {
    const b = bed(ac, out);
    layer(ac, b, o.noise, 'lowpass', 400, 0.6, 0.06, 0.3, 0.04);
    // A few crickets with their own pitch and rhythm.
    const crickets = Array.from({ length: 5 }, () => ({ f: rand(3800, 5200), period: rand(0.45, 0.9), vol: rand(0.006, 0.016) }));
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const c of crickets) {
          let t = t0 + Math.random() * c.period;
          while (t < t1) {
            if (Math.random() < Math.min(1, 0.75 * d)) cricketChirp(ac, b.out, t, c.f, c.vol);
            t += c.period * rand(0.92, 1.08);
          }
        }
      }),
    );
    return finish(ac, b);
  },
  { desc: 'night: cricket chorus over still air', params: ['intensity', 'density'] },
);

function frogCroak(ac: AC, out: AudioNode, t: number, vol: number, deep: boolean): void {
  const f0 = deep ? rand(70, 110) : rand(160, 260);
  const n = deep ? randi(1, 2) : randi(2, 4);
  for (let i = 0; i < n; i++) {
    const tt = t + i * (deep ? 0.35 : 0.12);
    const s = osc(ac, 'sawtooth', f0, tt, deep ? 0.3 : 0.1);
    glide(s.frequency, tt, f0 * 0.9, f0 * 1.1, deep ? 0.25 : 0.08);
    const am = gain(ac, 0.5);
    const l = osc(ac, 'square', deep ? 28 : 45, tt, deep ? 0.3 : 0.1);
    const lg = gain(ac, 0.5);
    l.connect(lg).connect(am.gain);
    const bf = filt(ac, 'bandpass', deep ? 400 : 1200, 4);
    const g = perc(ac, tt, 0.01, deep ? 0.25 : 0.07, vol);
    s.connect(am).connect(bf).connect(g).connect(out);
  }
}

registerLoop(
  'amb.swamp',
  (ac, out, o) => {
    const b = bed(ac, out);
    layer(ac, b, o.brown, 'lowpass', 260, 0.7, 0.14, 0.3, 0.05);
    const hum = layer(ac, b, o.white, 'bandpass', 3800, 4, 0.012, 0.2, 0.07);
    gusts(ac, b, hum.g, 0.012, 0.008);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 1.6 * d)) frogCroak(ac, b.out, t, rand(0.03, 0.08), chance(0.3));
        for (const t of eventTimes(t0, t1, 0.8 * d)) for (let i = 0; i < randi(1, 3); i++) droplet(ac, b.out, t + i * 0.07, rand(140, 380), rand(0.02, 0.05), rand(0.06, 0.1));
        for (const t of eventTimes(t0, t1, 0.5 * d)) droplet(ac, b.out, t, rand(900, 1500), 0.025, 0.05);
      }),
    );
    return finish(ac, b);
  },
  { desc: 'swamp: frog chorus, bubbling mud, drips, humid hum', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.volcanic',
  (ac, out, o) => {
    const b = bed(ac, out);
    const rum = layer(ac, b, o.brown, 'lowpass', 85, 0.8, 0.45, 0.3, 0.03);
    gusts(ac, b, rum.g, 0.45, 0.2, 0.05, 0.083);
    const hiss = layer(ac, b, o.white, 'highpass', 3800, 0.6, 0.018, 0.2, 0.2);
    gusts(ac, b, hiss.g, 0.018, 0.012, 0.3, 0.47);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 1.3 * d)) {
          // Lava bubble: low bloop + spit.
          const f = rand(70, 160);
          const s = osc(ac, 'sine', f, t, 0.2);
          glide(s.frequency, t, f, f * rand(1.6, 2.4), 0.12);
          const g = perc(ac, t, 0.005, 0.14, rand(0.04, 0.09));
          s.connect(g).connect(b.out);
          if (chance(0.4)) grains(ac, b.out, o.white, t + 0.05, 0.15, randi(3, 7), { fLo: 2000, fHi: 7000, q: 1.5, dur: 0.004, peak: 0.03 });
        }
        for (const t of eventTimes(t0, t1, 0.04 * d)) thump(ac, b.out, t, 50, 28, 1.2, 0.12, 0.3);
      }),
    );
    return finish(ac, b);
  },
  { desc: 'volcanic: deep rumble, hissing vents, bubbling lava, distant booms', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.ashfall',
  (ac, out, o) => {
    const b = bed(ac, out);
    layer(ac, b, o.noise, 'lowpass', 900, 0.6, 0.06, 0.2, 0.05);
    layer(ac, b, o.brown, 'lowpass', 120, 0.7, 0.2);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 2 * d)) noiseHit(ac, b.out, o.white, t, 'bandpass', rand(2500, 6000), 1.5, 0.001, 0.006, rand(0.01, 0.03));
      }),
    );
    return finish(ac, b);
  },
  { desc: 'ashfall: soft sifting hiss, low rumble, faint embers', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.rain',
  (ac, out, o) => {
    const b = bed(ac, out);
    const wash = layer(ac, b, o.white, 'highpass', 2200, 0.5, 0.06);
    const body = layer(ac, b, o.noise, 'bandpass', 3800, 0.7, 0.07);
    const low = layer(ac, b, o.noise, 'lowpass', 900, 0.6, 0.08);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 18 * d)) droplet(ac, b.out, t, rand(1800, 4200), rand(0.004, 0.012), rand(0.01, 0.025));
        for (const t of eventTimes(t0, t1, 4 * d)) noiseHit(ac, b.out, o.white, t, 'bandpass', rand(3000, 7000), 2, 0.001, 0.01, rand(0.01, 0.03));
      }, 0.8),
    );
    b.onIntensity = (k) => {
      const now = ac.currentTime;
      wash.g.gain.setTargetAtTime(0.03 + 0.06 * k, now, 0.5);
      body.g.gain.setTargetAtTime(0.03 + 0.08 * k, now, 0.5);
      low.g.gain.setTargetAtTime(0.03 + 0.1 * k, now, 0.5);
      for (const p of b.pumps) p.density = 0.4 + k;
    };
    return finish(ac, b);
  },
  { desc: 'rain: steady wash, patter and close droplets', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.temple',
  (ac, out, o) => {
    const b = bed(ac, out);
    const air = layer(ac, b, o.noise, 'bandpass', 600, 0.6, 0.05, 0.3, 0.05);
    gusts(ac, b, air.g, 0.05, 0.04);
    // Pentatonic wind chimes: bursts of 2-5 notes when the breeze rises.
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 0.35 * d)) {
          const n = randi(2, 5);
          for (let i = 0; i < n; i++) chime(ac, b.out, t + i * rand(0.08, 0.25), 1046 * semis(pick(scale)), rand(1.6, 2.6), rand(0.01, 0.025));
        }
      }),
    );
    return finish(ac, b);
  },
  { desc: 'temple: breeze and pentatonic wind chimes', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.spirit',
  (ac, out, o) => {
    const b = bed(ac, out);
    for (const [f, beat] of [[523.3, 0.31], [784, 0.23], [1046.5, 0.17]] as const) {
      const s = ac.createOscillator();
      s.frequency.value = f;
      const s2 = ac.createOscillator();
      s2.frequency.value = f + beat;
      const g = gain(ac, 0.006);
      b.nodes.push(lfo(ac, rand(0.05, 0.1), 0.004, g.gain));
      s.connect(g);
      s2.connect(g);
      g.connect(b.out);
      s.start();
      s2.start();
      b.nodes.push(s, s2);
    }
    const breath = layer(ac, b, o.noise, 'bandpass', 900, 0.8, 0.03, 0.4, 0.04);
    gusts(ac, b, breath.g, 0.03, 0.025);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 0.12 * d)) chime(ac, b.out, t, rand(1400, 2400), 3, 0.012);
      }),
    );
    return finish(ac, b);
  },
  { desc: 'spirit places: shimmering beating tones, breath, rare chimes', params: ['intensity', 'density'] },
);

registerLoop(
  'amb.cave',
  (ac, out, o) => {
    const b = bed(ac, out);
    layer(ac, b, o.brown, 'lowpass', 120, 0.7, 0.12);
    layer(ac, b, o.noise, 'bandpass', 300, 1.5, 0.02, 0.3, 0.03);
    b.pumps.push(
      eventPump(ac, (t0, t1, d) => {
        for (const t of eventTimes(t0, t1, 0.9 * d)) {
          const f = rand(900, 1700);
          droplet(ac, b.out, t, f, rand(0.03, 0.07), 0.05);
          ping(ac, b.out, t + 0.002, f * 1.9, 0.25, 0.01);
        }
      }),
    );
    return finish(ac, b);
  },
  { desc: 'cave: low room tone and echoing drips', params: ['intensity', 'density'] },
);

// ---------------------------------------------------------------------------
// Spot sounds (placed around the listener by the director)
// ---------------------------------------------------------------------------

const AMB = { bus: 'ambient' as const, priority: 0, maxVoices: 3, cooldown: 0.2, reverb: 0.25 };

registerSound('amb.bird.chirp', (ac, out, t, o) => birdCall(ac, out, t, 0, 0.07 * o.volume, o.pitch) + 0.05, { ...AMB, duration: 0.8, desc: 'small bird chirp' });
registerSound('amb.bird.song', (ac, out, t, o) => birdCall(ac, out, t, 1, 0.07 * o.volume, o.pitch) + 0.05, { ...AMB, duration: 1.5, desc: 'songbird phrase' });
registerSound('amb.bird.warble', (ac, out, t, o) => birdCall(ac, out, t, 2, 0.06 * o.volume, o.pitch) + 0.05, { ...AMB, duration: 1.0, desc: 'warbling trill' });

registerSound(
  'amb.owl',
  (ac, out, t, o) => {
    const hoots = [0, 0.42, 0.62];
    for (const dt of hoots) {
      const f = rand(360, 400) * o.pitch * (dt === 0 ? 1 : 0.94);
      const s = osc(ac, 'sine', f, t + dt, 0.3);
      glide(s.frequency, t + dt, f * 1.05, f * 0.92, 0.22);
      const g = swell(ac, t + dt, 0.05, 0.08, 0.14, 0.1 * o.volume);
      const lp = filt(ac, 'lowpass', 900, 0.7);
      s.connect(lp).connect(g).connect(out);
      noiseAHR(ac, out, o.noise, t + dt, 'bandpass', f * 2, 3, 0.05, 0.05, 0.15, 0.02 * o.volume);
    }
    return 0.95;
  },
  { ...AMB, duration: 1.2, reverb: 0.35, range: 140, desc: 'owl hoots (night forests)' },
);

registerSound(
  'amb.gull',
  (ac, out, t, o) => {
    const n = randi(1, 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * rand(0.22, 0.32);
      const f0 = rand(1300, 1600) * o.pitch;
      const s = osc(ac, 'sawtooth', f0, tt, 0.3);
      s.frequency.setValueAtTime(f0 * 0.8, tt);
      s.frequency.exponentialRampToValueAtTime(f0 * 1.15, tt + 0.06);
      s.frequency.exponentialRampToValueAtTime(f0 * 0.7, tt + 0.24);
      const bp = filt(ac, 'bandpass', 2200 * o.pitch, 2);
      const g = swell(ac, tt, 0.04, 0.06, 0.15, 0.06 * o.volume);
      s.connect(bp).connect(g).connect(out);
    }
    return 0.3 + (n - 1) * 0.3;
  },
  { ...AMB, duration: 1.1, range: 160, desc: 'seagull cries (coasts, harbors)' },
);

registerSound(
  'amb.frog',
  (ac, out, t, o) => {
    frogCroak(ac, out, t, 0.12 * o.volume, chance(0.4));
    return 0.75;
  },
  { ...AMB, duration: 1.0, range: 60, desc: 'frog croak (swamps, ponds at night)' },
);

registerSound(
  'amb.cricket',
  (ac, out, t, o) => {
    const f = rand(3800, 5000) * o.pitch;
    for (let i = 0; i < 3; i++) cricketChirp(ac, out, t + i * 0.4, f, 0.05 * o.volume);
    return 1.0;
  },
  { ...AMB, duration: 1.2, range: 30, desc: 'a single nearby cricket' },
);

registerSound(
  'amb.bell',
  (ac, out, t, o) => {
    bell(ac, out, t, 196 * o.pitch, 4.5, 0.2 * o.volume, 1.41, 3.2);
    bell(ac, out, t, 392 * o.pitch * 1.002, 3.2, 0.06 * o.volume, 2.76, 1.4);
    return 4.6;
  },
  { ...AMB, duration: 5.0, reverb: 0.5, range: 400, maxVoices: 2, desc: 'temple bell (deep, long)' },
);

registerSound(
  'amb.chime',
  (ac, out, t, o) => {
    const scale = [0, 2, 4, 7, 9, 12];
    const n = randi(2, 4);
    for (let i = 0; i < n; i++) chime(ac, out, t + i * rand(0.07, 0.2), 1175 * semis(pick(scale)) * o.pitch, 2.2, 0.05 * o.volume);
    return 2.6;
  },
  { ...AMB, duration: 3.1, range: 60, desc: 'wind chime cluster' },
);

registerSound(
  'amb.hawk',
  (ac, out, t, o) => {
    const f0 = rand(2200, 2600) * o.pitch;
    const s = osc(ac, 'sawtooth', f0, t, 0.9);
    s.frequency.setValueAtTime(f0 * 1.1, t);
    s.frequency.exponentialRampToValueAtTime(f0 * 0.65, t + 0.85);
    const bp = filt(ac, 'bandpass', 2600 * o.pitch, 3);
    const g = swell(ac, t, 0.1, 0.25, 0.5, 0.05 * o.volume);
    s.connect(bp).connect(g).connect(out);
    return 0.9;
  },
  { ...AMB, duration: 1.2, reverb: 0.45, range: 400, desc: 'hawk / eagle cry over mountains' },
);

registerSound(
  'amb.lava.pop',
  (ac, out, t, o) => {
    const f = rand(60, 120) * o.pitch;
    const s = osc(ac, 'sine', f, t, 0.3);
    glide(s.frequency, t, f, f * 2.2, 0.15);
    const g = perc(ac, t, 0.004, 0.2, 0.2 * o.volume);
    s.connect(g).connect(out);
    grains(ac, out, o.white, t + 0.06, 0.3, 8, { fLo: 2000, fHi: 7000, q: 1.5, dur: 0.004, peak: 0.06 * o.volume });
    return 0.45;
  },
  { ...AMB, duration: 0.65, range: 50, desc: 'lava bubble pop with spitting embers' },
);

registerSound(
  'amb.wood.creak',
  (ac, out, t, o) => {
    const f0 = rand(90, 150) * o.pitch;
    const s = osc(ac, 'sawtooth', f0, t, 0.8);
    glide(s.frequency, t, f0, f0 * rand(0.7, 1.4), 0.7);
    const bf = filt(ac, 'bandpass', rand(700, 1300), 7);
    const am = gain(ac, 0.6);
    const l = osc(ac, 'square', rand(20, 35), t, 0.8);
    const lg = gain(ac, 0.4);
    l.connect(lg).connect(am.gain);
    const g = swell(ac, t, 0.2, 0.2, 0.35, 0.06 * o.volume);
    s.connect(bf).connect(am).connect(g).connect(out);
    return 0.8;
  },
  { ...AMB, duration: 1.0, range: 50, desc: 'creaking wood (ships, docks, bridges, old houses)' },
);

registerSound(
  'amb.vendor',
  (ac, out, t, o: RecipeOpts) => {
    const base = VOICE_TYPES[pick(['male', 'female', 'gruff'])];
    return babble(ac, out, t, { ...base, f0: base.f0 * 1.25 * o.pitch, rate: 6.5, range: 5 }, randi(4, 7), o.noise, 0.22 * o.volume, chance(0.5));
  },
  { ...AMB, duration: 1.6, range: 50, desc: 'market vendor calling out' },
);

aliasSound('amb.thunder', 'thunder.distant');
aliasSound('amb.drip', 'water.drip');
