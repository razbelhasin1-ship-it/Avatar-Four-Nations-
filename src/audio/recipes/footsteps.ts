import type { SurfaceType } from '../../core/types';
import { aliasSound, registerLoop, registerSound, type RecipeOpts } from '../registry';
import { chance, droplets, filt, gain, glide, grains, noise, noiseAHR, noiseHit, osc, perc, ping, rand, swell, thump, type AC } from '../synth';

/**
 * Footsteps per surface with walk / run / land variants, plus jumps, landings,
 * slides, glide wind and body falls.
 *
 * A step = heel strike (+ softer toe roll for walks) built from: a low body
 * thump (weight), a filtered-noise body (material), a grain train (crunch,
 * grit, rustle), and material extras (hollow wood resonance, glassy ice
 * partials, metal FM clank, mud squelch with suction pop, water splash with
 * droplets). Every play is randomised so repeated steps never sound identical.
 */

export type StepMode = 'walk' | 'run' | 'land';

/** Surfaces with dedicated recipes (every SurfaceType maps to one). */
export const STEP_SURFACES: readonly SurfaceType[] = [
  'grass',
  'tallgrass',
  'dirt',
  'mud',
  'gravel',
  'sand',
  'rock',
  'stone',
  'cobble',
  'plaster',
  'wood',
  'snow',
  'packedsnow',
  'ice',
  'water',
  'ash',
  'metal',
  'lava',
];

const M = { walk: 1, run: 1.3, land: 1.8 } as const;

type StepFn = (ac: AC, out: AudioNode, t: number, o: RecipeOpts, mode: StepMode, k: number) => void;

/** Generic two-phase strike: heel at t, toe at t + roll (walks only). */
function strike(ac: AC, out: AudioNode, t: number, mode: StepMode, fn: (t: number, k: number) => void): void {
  fn(t, 1);
  if (mode === 'walk') fn(t + rand(0.06, 0.1), 0.45);
}

const grassStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    thump(ac, out, tt, 85 * p, 52 * p, mode === 'land' ? 0.16 : 0.08, 0.24 * v);
    noiseHit(ac, out, o.noise, tt, 'bandpass', 700 * p, 0.8, 0.004, mode === 'land' ? 0.12 : 0.06, 0.2 * v);
    grains(ac, out, o.white, tt, mode === 'land' ? 0.2 : 0.12, mode === 'land' ? 16 : mode === 'run' ? 10 : 7, { fLo: 2400 * p, fHi: 6500 * p, q: 1.2, dur: 0.02, peak: 0.13 * v, front: 1.5 });
  });
  if (mode !== 'walk') noiseHit(ac, out, o.white, t + 0.02, 'highpass', 3200 * p, 0.7, 0.012, 0.08, 0.06 * o.volume * k);
};

const tallGrassStep: StepFn = (ac, out, t, o, mode, k) => {
  grassStep(ac, out, t, o, mode, k * 0.85);
  const p = o.pitch;
  const v = o.volume * k;
  const f = noiseAHR(ac, out, o.white, t, 'bandpass', 1700 * p, 0.9, 0.05, mode === 'run' ? 0.06 : 0.1, 0.16, 0.15 * v);
  f.frequency.exponentialRampToValueAtTime(4300 * p, t + 0.2);
  grains(ac, out, o.white, t + 0.03, 0.25, mode === 'land' ? 20 : 12, { fLo: 3000 * p, fHi: 7500 * p, q: 1.4, dur: 0.018, peak: 0.08 * v });
};

const dirtStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    thump(ac, out, tt, 95 * p, 58 * p, mode === 'land' ? 0.16 : 0.07, 0.3 * v);
    noiseHit(ac, out, o.noise, tt, 'bandpass', 520 * p, 1, 0.003, mode === 'land' ? 0.1 : 0.05, 0.28 * v);
    grains(ac, out, o.white, tt, mode === 'land' ? 0.14 : 0.06, mode === 'land' ? 12 : 5, { fLo: 1500 * p, fHi: 3800 * p, q: 2, dur: 0.008, peak: 0.12 * v });
  });
};

const mudStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  const v = o.volume * k;
  thump(ac, out, t, 72 * p, 44 * p, 0.1, 0.24 * v);
  const src = noise(ac, o.noise, t, 0.3);
  const f = filt(ac, 'lowpass', 350 * p, 7);
  f.frequency.setValueAtTime(350 * p, t);
  f.frequency.exponentialRampToValueAtTime(1150 * p, t + 0.05);
  f.frequency.exponentialRampToValueAtTime(300 * p, t + 0.2);
  const g = perc(ac, t, 0.01, mode === 'land' ? 0.3 : 0.18, 0.3 * v);
  src.connect(f).connect(g).connect(out);
  // Suction pop as the foot lifts.
  const tp = t + rand(0.1, 0.16);
  const o2 = osc(ac, 'sine', 230 * p, tp, 0.08);
  glide(o2.frequency, tp, 240 * p, 85 * p, 0.05);
  const g2 = perc(ac, tp, 0.003, 0.05, 0.12 * v);
  o2.connect(g2).connect(out);
  droplets(ac, out, t + 0.03, 0.15, mode === 'land' ? 5 : 2, 280 * p, 520 * p, 0.05 * v);
};

const gravelStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    thump(ac, out, tt, 100 * p, 66 * p, mode === 'land' ? 0.12 : 0.05, 0.22 * v);
    grains(ac, out, o.white, tt, mode === 'land' ? 0.18 : 0.09, mode === 'land' ? 34 : mode === 'run' ? 22 : 15, { fLo: 1800 * p, fHi: 7200 * p, q: 1.5, dur: 0.006, peak: 0.22 * v, front: 1.3 });
    noiseHit(ac, out, o.noise, tt, 'bandpass', 1200 * p, 0.8, 0.002, 0.04, 0.12 * v);
  });
};

const sandStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    thump(ac, out, tt, 70 * p, 50 * p, 0.06, 0.18 * v);
    noiseHit(ac, out, o.white, tt, 'bandpass', 2500 * p, 0.7, 0.012, mode === 'land' ? 0.2 : 0.09, 0.15 * v);
    grains(ac, out, o.white, tt, 0.1, mode === 'land' ? 18 : 10, { fLo: 3000 * p, fHi: 8000 * p, q: 1, dur: 0.004, peak: 0.06 * v });
  });
  if (mode !== 'walk') noiseHit(ac, out, o.white, t + 0.03, 'highpass', 4200 * p, 0.7, 0.02, 0.14, 0.07 * o.volume * k);
};

const rockStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    noiseHit(ac, out, o.white, tt, 'highpass', 2500 * p, 0.7, 0.001, 0.012, 0.3 * v);
    thump(ac, out, tt, 125 * p, 80 * p, mode === 'land' ? 0.1 : 0.04, 0.26 * v);
    grains(ac, out, o.white, tt + 0.005, 0.05, mode === 'land' ? 9 : 4, { fLo: 2000 * p, fHi: 5200 * p, q: 2, dur: 0.005, peak: 0.1 * v });
    noiseHit(ac, out, o.noise, tt, 'bandpass', 1800 * p, 4, 0.001, 0.03, 0.1 * v);
  });
};

const stoneStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    noiseHit(ac, out, o.white, tt, 'bandpass', 3200 * p, 1.2, 0.001, 0.015, 0.34 * v);
    noiseHit(ac, out, o.noise, tt, 'bandpass', 1400 * p, 2.5, 0.001, 0.04, 0.18 * v);
    thump(ac, out, tt, 112 * p, 74 * p, mode === 'land' ? 0.1 : 0.04, 0.2 * v);
  });
};

const cobbleStep: StepFn = (ac, out, t, o, mode, k) => {
  stoneStep(ac, out, t, o, mode, k * 0.85);
  const p = o.pitch;
  const v = o.volume * k;
  noiseHit(ac, out, o.white, t + rand(0.015, 0.03), 'bandpass', 2600 * p, 1.5, 0.001, 0.012, 0.16 * v);
  grains(ac, out, o.white, t, 0.06, 5, { fLo: 2200 * p, fHi: 5000 * p, q: 2, dur: 0.005, peak: 0.08 * v });
};

const plasterStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    noiseHit(ac, out, o.white, tt, 'bandpass', 1250 * p, 1, 0.001, 0.02, 0.26 * v);
    thump(ac, out, tt, 100 * p, 70 * p, mode === 'land' ? 0.1 : 0.05, 0.22 * v);
    noiseHit(ac, out, o.noise, tt, 'lowpass', 1500 * p, 0.7, 0.002, 0.04, 0.14 * v);
  });
};

const woodStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    noiseHit(ac, out, o.noise, tt, 'bandpass', 380 * p, 9, 0.002, mode === 'land' ? 0.14 : 0.07, 0.5 * v);
    ping(ac, out, tt, 195 * p, mode === 'land' ? 0.12 : 0.06, 0.2 * v, 'sine', 170 * p);
    noiseHit(ac, out, o.white, tt, 'bandpass', 2500 * p, 1, 0.001, 0.01, 0.12 * v);
  });
  if (mode !== 'walk' && chance(0.25)) {
    // Board creak.
    const tc = t + rand(0.03, 0.08);
    const cr = osc(ac, 'sawtooth', rand(120, 160) * p, tc, 0.2);
    glide(cr.frequency, tc, 150 * p, 110 * p, 0.16);
    const bf = filt(ac, 'bandpass', 900 * p, 6);
    const cg = perc(ac, tc, 0.03, 0.14, 0.045 * o.volume * k);
    cr.connect(bf).connect(cg).connect(out);
  }
};

const snowStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  const v = o.volume * k;
  const span = mode === 'land' ? 0.28 : mode === 'run' ? 0.12 : 0.16;
  grains(ac, out, o.white, t, span, mode === 'land' ? 45 : mode === 'run' ? 26 : 22, { fLo: 900 * p, fHi: 4200 * p, q: 1.3, dur: 0.011, peak: 0.24 * v, front: 1.2, fade: 0.4 });
  noiseHit(ac, out, o.noise, t, 'lowpass', 700 * p, 0.7, 0.006, 0.1, 0.13 * v);
  thump(ac, out, t, 70 * p, 45 * p, 0.08, 0.15 * v);
  if (mode === 'walk') grains(ac, out, o.white, t + rand(0.11, 0.15), 0.08, 9, { fLo: 1200 * p, fHi: 3800 * p, q: 1.3, dur: 0.01, peak: 0.13 * v });
  if (mode === 'land') noiseHit(ac, out, o.brown, t, 'lowpass', 420 * p, 0.7, 0.01, 0.2, 0.35 * v);
};

const packedSnowStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  const v = o.volume * k;
  grains(ac, out, o.white, t, 0.12, mode === 'land' ? 22 : 12, { fLo: 1500 * p, fHi: 3500 * p, q: 3, dur: 0.01, peak: 0.15 * v, front: 1.2 });
  const n = mode === 'land' ? 4 : 2;
  for (let i = 0; i < n; i++) {
    // Cold-snow squeak.
    const ts = t + rand(0.01, 0.09);
    const f0 = rand(1400, 2600) * p;
    const s = osc(ac, 'triangle', f0, ts, 0.05);
    glide(s.frequency, ts, f0, f0 * 1.22, 0.03);
    const g = perc(ac, ts, 0.003, 0.03, 0.045 * v);
    s.connect(g).connect(out);
  }
  thump(ac, out, t, 80 * p, 52 * p, 0.06, 0.18 * v);
};

const iceStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    noiseHit(ac, out, o.white, tt, 'highpass', 3500 * p, 0.7, 0.001, 0.01, 0.3 * v);
    for (const f of [2400, 3700, 5300]) ping(ac, out, tt, f * rand(0.95, 1.05) * p, rand(0.04, 0.08), 0.06 * v);
    thump(ac, out, tt, 122 * p, 90 * p, 0.04, 0.2 * v);
  });
  if (mode !== 'walk') noiseHit(ac, out, o.white, t + 0.01, 'bandpass', 5000 * p, 2, 0.01, 0.08, 0.06 * o.volume * k);
};

const waterStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  const v = o.volume * k;
  const big = mode === 'land';
  const f = noiseHit(ac, out, o.noise, t, 'bandpass', 1600 * p, 0.8, 0.004, big ? 0.35 : 0.18, (big ? 0.5 : 0.3) * v);
  f.frequency.exponentialRampToValueAtTime(700 * p, t + (big ? 0.3 : 0.16));
  noiseHit(ac, out, o.brown, t, 'lowpass', 500 * p, 0.7, 0.01, big ? 0.3 : 0.15, 0.2 * v);
  droplets(ac, out, t + 0.02, big ? 0.35 : 0.2, big ? 12 : mode === 'run' ? 6 : 4, 700 * p, 1800 * p, 0.06 * v);
};

const ashStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  const v = o.volume * k;
  noiseHit(ac, out, o.noise, t, 'lowpass', 1100 * p, 0.7, 0.008, mode === 'land' ? 0.2 : 0.1, 0.18 * v);
  grains(ac, out, o.white, t, 0.1, mode === 'land' ? 14 : 8, { fLo: 3500 * p, fHi: 8000 * p, q: 1, dur: 0.004, peak: 0.05 * v });
  thump(ac, out, t, 75 * p, 50 * p, 0.07, 0.18 * v);
  noiseAHR(ac, out, o.noise, t + 0.01, 'bandpass', 600 * p, 0.8, 0.04, 0.02, 0.16, 0.06 * v);
};

const metalStep: StepFn = (ac, out, t, o, mode, k) => {
  const p = o.pitch;
  strike(ac, out, t, mode, (tt, kk) => {
    const v = o.volume * k * kk;
    const f0 = rand(380, 460) * p;
    const car = osc(ac, 'sine', f0, tt, 0.2);
    const mod = osc(ac, 'sine', f0 * 1.41, tt, 0.2);
    const mg = gain(ac, f0 * 3);
    mod.connect(mg).connect(car.frequency);
    const g = perc(ac, tt, 0.001, mode === 'land' ? 0.25 : 0.12, 0.1 * v);
    car.connect(g).connect(out);
    noiseHit(ac, out, o.white, tt, 'highpass', 3000 * p, 0.7, 0.001, 0.008, 0.24 * v);
    for (const f of [1100, 1730, 2650]) ping(ac, out, tt, f * p * rand(0.98, 1.02), 0.15, 0.035 * v);
    thump(ac, out, tt, 130 * p, 90 * p, 0.04, 0.14 * v);
  });
};

const lavaStep: StepFn = (ac, out, t, o, mode, k) => {
  rockStep(ac, out, t, o, mode, k);
  noiseAHR(ac, out, o.white, t + 0.01, 'highpass', 4500 * o.pitch, 0.7, 0.01, 0.05, 0.2, 0.06 * o.volume * k);
};

const STEP_FNS: Record<SurfaceType, StepFn> = {
  grass: grassStep,
  tallgrass: tallGrassStep,
  dirt: dirtStep,
  mud: mudStep,
  gravel: gravelStep,
  sand: sandStep,
  rock: rockStep,
  stone: stoneStep,
  cobble: cobbleStep,
  plaster: plasterStep,
  wood: woodStep,
  snow: snowStep,
  packedsnow: packedSnowStep,
  ice: iceStep,
  water: waterStep,
  ash: ashStep,
  metal: metalStep,
  lava: lavaStep,
};

const HARD: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['stone', 'cobble', 'plaster', 'wood', 'metal', 'rock', 'ice']);
const DUR: Record<StepMode, number> = { walk: 0.32, run: 0.3, land: 0.5 };

for (const s of STEP_SURFACES) {
  for (const mode of ['walk', 'run', 'land'] as const) {
    const fn = STEP_FNS[s];
    registerSound(
      `step.${s}.${mode}`,
      (ac, out, t, o) => {
        fn(ac, out, t, o, mode, M[mode] * 0.75);
        // A bit of body weight on landings for every surface.
        if (mode === 'land') thump(ac, out, t, 68 * o.pitch, 40 * o.pitch, 0.18, 0.3 * o.volume);
        return DUR[mode];
      },
      { duration: DUR[mode] + 0.2, maxVoices: 4, cooldown: 0.05, priority: 1, reverb: HARD.has(s) ? 0.18 : 0.06, range: 45, desc: `${mode} footstep on ${s}` },
    );
  }
}

/** Footstep id for a surface and horizontal speed (used by the event bindings). */
export function stepId(surface: SurfaceType | undefined, speed: number, landing = false): string {
  const s = surface && STEP_FNS[surface] ? surface : 'dirt';
  return `step.${s}.${landing ? 'land' : speed > 5.5 ? 'run' : 'walk'}`;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Cloth rustle burst (fabric flutter). */
function cloth(ac: AC, out: AudioNode, t: number, o: RecipeOpts, dur: number, peak: number): void {
  const src = noise(ac, o.noise, t, dur + 0.05);
  const f = filt(ac, 'bandpass', 1300 * o.pitch, 0.9);
  const flutter = osc(ac, 'sine', rand(14, 22), t, dur + 0.05);
  const fg = gain(ac, 0.45);
  const amp = swell(ac, t, dur * 0.35, 0, dur * 0.65, peak);
  const vca = gain(ac, 0.55);
  flutter.connect(fg).connect(vca.gain);
  src.connect(f).connect(vca).connect(amp).connect(out);
}

registerSound(
  'move.jump',
  (ac, out, t, o) => {
    cloth(ac, out, t, o, 0.22, 0.18 * o.volume);
    const f = noiseHit(ac, out, o.noise, t, 'bandpass', 650 * o.pitch, 1.1, 0.02, 0.16, 0.2 * o.volume);
    f.frequency.exponentialRampToValueAtTime(1700 * o.pitch, t + 0.14);
    return 0.3;
  },
  { duration: 0.45, maxVoices: 3, desc: 'jump take-off: cloth swish + air' },
);
aliasSound('jump', 'move.jump');

registerSound(
  'move.land',
  (ac, out, t, o) => {
    thump(ac, out, t, 82 * o.pitch, 40 * o.pitch, 0.2, 0.45 * o.volume);
    noiseHit(ac, out, o.noise, t, 'lowpass', 900 * o.pitch, 0.7, 0.003, 0.14, 0.3 * o.volume);
    cloth(ac, out, t + 0.01, o, 0.18, 0.1 * o.volume);
    return 0.3;
  },
  { duration: 0.45, maxVoices: 3, desc: 'generic heavy landing (weight + cloth)' },
);
aliasSound('land', 'move.land');

registerSound(
  'move.cloth',
  (ac, out, t, o) => {
    cloth(ac, out, t, o, 0.3, 0.16 * o.volume);
    return 0.35;
  },
  { duration: 0.5, maxVoices: 3, desc: 'cloth rustle (turns, gestures, mounting)' },
);

function slide(ac: AC, out: AudioNode, t: number, o: RecipeOpts, kind: 'snow' | 'ice' | 'dirt', dur: number): void {
  const v = o.volume;
  const p = o.pitch;
  if (kind === 'snow') {
    noiseAHR(ac, out, o.white, t, 'bandpass', 2600 * p, 0.6, 0.06, dur * 0.6, dur * 0.35, 0.18 * v);
    grains(ac, out, o.white, t, dur, Math.round(dur * 40), { fLo: 1000 * p, fHi: 4000 * p, q: 1.2, dur: 0.012, peak: 0.12 * v });
    noiseAHR(ac, out, o.brown, t, 'lowpass', 500 * p, 0.7, 0.05, dur * 0.5, dur * 0.4, 0.15 * v);
  } else if (kind === 'ice') {
    const f = noiseAHR(ac, out, o.white, t, 'bandpass', 4200 * p, 2.5, 0.04, dur * 0.6, dur * 0.35, 0.12 * v);
    f.frequency.linearRampToValueAtTime(3200 * p, t + dur);
    noiseAHR(ac, out, o.noise, t, 'bandpass', 900 * p, 1.5, 0.05, dur * 0.5, dur * 0.4, 0.08 * v);
  } else {
    noiseAHR(ac, out, o.noise, t, 'bandpass', 900 * p, 0.8, 0.04, dur * 0.6, dur * 0.35, 0.22 * v);
    grains(ac, out, o.white, t, dur, Math.round(dur * 30), { fLo: 1500 * p, fHi: 5000 * p, q: 1.6, dur: 0.008, peak: 0.12 * v });
  }
}

for (const kind of ['snow', 'ice', 'dirt'] as const) {
  registerSound(
    `move.slide.${kind}`,
    (ac, out, t, o) => {
      slide(ac, out, t, o, kind, 0.75);
      return 0.85;
    },
    { duration: 0.95, maxVoices: 2, desc: `short slide on ${kind}` },
  );
  registerLoop(
    `loop.slide.${kind}`,
    (ac, out, o) => {
      const src = ac.createBufferSource();
      src.buffer = kind === 'snow' || kind === 'ice' ? o.white : o.noise;
      src.loop = true;
      const f = filt(ac, 'bandpass', kind === 'snow' ? 2600 : kind === 'ice' ? 4200 : 900, kind === 'ice' ? 2.5 : 0.7);
      const lp = filt(ac, 'lowpass', 6000, 0.7);
      const g = gain(ac, 0.2);
      // Irregular grain modulation (crunch / chatter).
      const am = ac.createOscillator();
      am.type = 'square';
      am.frequency.value = kind === 'ice' ? 9 : 27;
      const ag = gain(ac, kind === 'ice' ? 0.05 : 0.09);
      am.connect(ag).connect(g.gain);
      src.connect(f).connect(lp).connect(g).connect(out);
      src.start();
      am.start();
      return {
        stop(t: number) {
          src.stop(t);
          am.stop(t);
        },
        setParam(name: string, v: number) {
          if (name !== 'speed') return;
          const s = Math.max(0, Math.min(1.5, v));
          g.gain.setTargetAtTime(0.1 + 0.2 * s, ac.currentTime, 0.08);
          lp.frequency.setTargetAtTime(2500 + 6000 * s, ac.currentTime, 0.1);
          am.frequency.setTargetAtTime((kind === 'ice' ? 6 : 18) + 20 * s, ac.currentTime, 0.1);
        },
      };
    },
    { desc: `continuous slide on ${kind}`, params: ['speed'] },
  );
}

registerLoop(
  'loop.glide',
  (ac, out, o) => {
    const src = ac.createBufferSource();
    src.buffer = o.noise;
    src.loop = true;
    const f = filt(ac, 'bandpass', 700, 0.8);
    const hi = filt(ac, 'highpass', 300, 0.7);
    const g = gain(ac, 0.3);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = gain(ac, 160);
    lfo.connect(lg).connect(f.frequency);
    // Cloth flap of the glider.
    const flap = ac.createOscillator();
    flap.frequency.value = 11;
    const fg = gain(ac, 0.06);
    flap.connect(fg).connect(g.gain);
    src.connect(hi).connect(f).connect(g).connect(out);
    src.start();
    lfo.start();
    flap.start();
    return {
      stop(t: number) {
        src.stop(t);
        lfo.stop(t);
        flap.stop(t);
      },
      setParam(name: string, v: number) {
        if (name !== 'speed') return;
        const s = Math.max(0, Math.min(1.5, v));
        f.frequency.setTargetAtTime(500 + 900 * s, ac.currentTime, 0.15);
        g.gain.setTargetAtTime(0.12 + 0.3 * s, ac.currentTime, 0.15);
        flap.frequency.setTargetAtTime(8 + 10 * s, ac.currentTime, 0.2);
      },
    };
  },
  { desc: 'airbender glider wind rush', params: ['speed'] },
);

registerSound(
  'move.swim',
  (ac, out, t, o) => {
    const f = noiseHit(ac, out, o.noise, t, 'bandpass', 900 * o.pitch, 0.9, 0.05, 0.3, 0.2 * o.volume);
    f.frequency.exponentialRampToValueAtTime(450 * o.pitch, t + 0.3);
    droplets(ac, out, t + 0.1, 0.3, 4, 600 * o.pitch, 1400 * o.pitch, 0.04 * o.volume);
    return 0.45;
  },
  { duration: 0.6, maxVoices: 2, desc: 'swim stroke slosh' },
);

// ---------------------------------------------------------------------------
// Body falls
// ---------------------------------------------------------------------------

function bodyFall(ac: AC, out: AudioNode, t: number, o: RecipeOpts, heavy: boolean): void {
  const v = o.volume;
  const p = o.pitch;
  thump(ac, out, t, (heavy ? 70 : 90) * p, (heavy ? 32 : 45) * p, heavy ? 0.35 : 0.22, (heavy ? 0.6 : 0.45) * v);
  noiseHit(ac, out, o.noise, t, 'lowpass', (heavy ? 700 : 1000) * p, 0.7, 0.003, heavy ? 0.25 : 0.16, 0.35 * v);
  cloth(ac, out, t + 0.01, o, 0.25, 0.12 * v);
  // Secondary settle (limbs / gear).
  const t2 = t + rand(0.12, 0.2);
  thump(ac, out, t2, 110 * p, 60 * p, 0.1, 0.18 * v);
  grains(ac, out, o.white, t, 0.25, heavy ? 12 : 6, { fLo: 1500 * p, fHi: 5000 * p, q: 1.5, dur: 0.008, peak: 0.07 * v });
}

registerSound(
  'body.fall',
  (ac, out, t, o) => {
    bodyFall(ac, out, t, o, false);
    return 0.45;
  },
  { duration: 0.6, maxVoices: 3, desc: 'body hits the ground (defeated human)' },
);
registerSound(
  'body.fall.heavy',
  (ac, out, t, o) => {
    bodyFall(ac, out, t, o, true);
    return 0.6;
  },
  { duration: 0.8, maxVoices: 2, desc: 'heavy body / large creature collapses' },
);
registerSound(
  'body.fall.water',
  (ac, out, t, o) => {
    const f = noiseHit(ac, out, o.noise, t, 'bandpass', 1400 * o.pitch, 0.7, 0.004, 0.45, 0.5 * o.volume);
    f.frequency.exponentialRampToValueAtTime(500 * o.pitch, t + 0.4);
    thump(ac, out, t, 80 * o.pitch, 40 * o.pitch, 0.25, 0.4 * o.volume);
    droplets(ac, out, t + 0.05, 0.5, 14, 600 * o.pitch, 1800 * o.pitch, 0.06 * o.volume);
    return 0.65;
  },
  { duration: 0.8, maxVoices: 2, desc: 'body falls into water' },
);

// Legacy ids (Player plays these directly; the event bindings replace them with surface-aware steps).
aliasSound('footstep', 'step.dirt.walk');
aliasSound('footstep_snow', 'step.snow.walk');
aliasSound('footstep_stone', 'step.stone.walk');
aliasSound('footstep_water', 'step.water.walk');
