import { EARTH_STANCE, registerClip, type ClipKey, type Pose } from '../../../character/Animator';
import { legAt } from '../../../character/combatClips';
import { easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic } from '../../../core/MathUtil';

/**
 * Earthbending clips — rooted, heavy, deliberate: stomps that drive into the
 * ground, wide horse stances, short powerful pushes. Conventions: see the
 * header of src/character/Animator.ts.
 */

const mirror = (p: Pose): Pose => {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'hipsY' || k === 'hipsZ' || k === 'hipsX') {
      (out as Record<string, number>)[k] = k === 'hipsX' ? -(v as number) : (v as number);
      continue;
    }
    const e = v as [number, number, number];
    const swapped = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
    (out as Record<string, [number, number, number]>)[swapped] = [e[0], -e[1], -e[2]];
  }
  return out;
};

// The earthbending ready stance (Animator EARTH_STANCE) as a clip pose: moves start from it and
// settle back into it, feet where the stance plants them, so nothing pops when a clip fades out.
const ES = EARTH_STANCE;
const ES_OUT = 0.093 + ES.feet[0];
const STAND: Pose = {
  ...legAt('L', ES_OUT, ES.feet[1], -ES.drop, ES.sit, 0, 0, 0, 0, ES.toes),
  ...legAt('R', ES_OUT, ES.feet[1], -ES.drop, ES.sit, 0, 0, 0, 0, ES.toes),
  spine: [ES.spine, 0, 0],
  shoulderL: [0, 0, -ES.shoulders],
  shoulderR: [0, 0, ES.shoulders],
  upperArmL: [ES.lead[0], ES.lead[1], ES.lead[2]],
  foreArmL: [ES.lead[3], ES.lead[4], 0],
  upperArmR: [ES.rear[0], ES.rear[1], ES.rear[2]],
  foreArmR: [ES.rear[3], ES.rear[4], 0],
  hipsY: -ES.drop,
  hipsZ: ES.sit,
  hipsX: 0,
};
/** Both feet planted where the stance plants them (knees out over the toes), hips at the given offsets. */
const planted = (hipsY: number, hipsX = 0, hipsZ = ES.sit): Pose => ({
  ...legAt('L', ES_OUT, ES.feet[1], hipsY, hipsZ, 0, 0, 0, hipsX, ES.toes),
  ...legAt('R', ES_OUT, ES.feet[1], hipsY, hipsZ, 0, 0, 0, hipsX, ES.toes),
  hipsY,
  hipsZ,
  hipsX,
});
/** Weight on one foot, still planted at its stance spot (the caller keys the other leg). */
const standOn = (side: 'L' | 'R', hipsY: number, hipsX: number, hipsZ = ES.sit): Pose => ({
  ...legAt(side, ES_OUT, ES.feet[1], hipsY, hipsZ, 0, 0, 0, hipsX, ES.toes),
  hipsY,
  hipsZ,
  hipsX,
});

const EASES = { in: easeInCubic, out: easeOutCubic, inout: easeInOutCubic, back: easeOutBack, linear: (u: number) => u };
/**
 * A foot planted on its stance spot while the hips travel between two keys bows out mid-way when
 * only the end keys are solved (the joint angles interpolate while the hips translate). For each
 * [side, t0, t1], re-solve that leg at even steps of the hips' eased progress so it stays put.
 * Both keys must key the hips (STAND / planted / standOn do).
 */
function plantedPaths(keys: ClipKey[], paths: Array<['L' | 'R', number, number]>, steps = 4): ClipKey[] {
  const out = [...keys];
  const at = (t: number): ClipKey => {
    const k = keys.find((x) => Math.abs(x.t - t) < 1e-6);
    if (!k) throw new Error(`plantedPaths: no key at ${t}`);
    return k;
  };
  for (const [side, t0, t1] of paths) {
    const k0 = at(t0).pose, k1 = at(t1);
    const ease = EASES[k1.ease ?? 'linear'];
    const hip = (n: 'hipsY' | 'hipsX' | 'hipsZ', d: number, w: number) => (k0[n] ?? d) + ((k1.pose[n] ?? d) - (k0[n] ?? d)) * w;
    for (let i = 1; i < steps; i++) {
      const w = i / steps;
      // Time at which the eased hips have made `w` of their move (bisection; the eases are monotonic).
      let lo = 0, hi = 1;
      for (let j = 0; j < 24; j++) {
        const m = (lo + hi) / 2;
        if (ease(m) < w) lo = m;
        else hi = m;
      }
      const u = (lo + hi) / 2;
      out.push({ t: t0 + (t1 - t0) * u, pose: legAt(side, ES_OUT, ES.feet[1], hip('hipsY', -ES.drop, w), hip('hipsZ', ES.sit, w), 0, 0, 0, hip('hipsX', 0, w), ES.toes) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// Stomp (right foot) to pop a rock up, then a straight right punch to send it — from the horse
// stance: the weight shifts onto the left foot (which stays planted) as the right knee rises, the
// stomp lands back in the stance, deeper, and the punch drives the hips forward over planted feet.
const strikeR: Array<{ t: number; pose: Pose; ease?: 'in' | 'out' | 'inout' }> = [
  { t: 0, pose: { ...STAND } },
  { t: 0.07, pose: { spine: [0.05, -0.2, 0], ...standOn('L', -0.13, 0.07), thighR: [-1.15, -ES.toes, -0.3], shinR: [1.3, 0, 0], upperArmR: [0.35, 0, -0.35], foreArmR: [-1.9, 0, 0], upperArmL: [-0.8, 0, 0.35], foreArmL: [-1.5, 0, 0] }, ease: 'out' },
  { t: 0.13, pose: { spine: [0.18, -0.3, 0], ...planted(-0.24), upperArmR: [0.45, 0, -0.3], foreArmR: [-2.0, 0, 0] }, ease: 'in' },
  { t: 0.22, pose: { spine: [0.2, 0.45, 0], chest: [0, 0.15, 0], upperArmR: [-1.58, 0, -0.05], foreArmR: [-0.04, 0, 0], upperArmL: [0.2, 0, 0.45], foreArmL: [-1.9, 0, 0], ...planted(-0.24, 0, 0.05) }, ease: 'out' },
  { t: 0.34, pose: { spine: [0.18, 0.4, 0], upperArmR: [-1.5, 0, -0.08], foreArmR: [-0.1, 0, 0], ...planted(-0.23, 0, 0.04) } },
  { t: 0.62, pose: { ...STAND, chest: [0, 0, 0] }, ease: 'inout' },
];
const strikeRKeys = plantedPaths(strikeR, [['L', 0, 0.07], ['L', 0.07, 0.13]]);
registerClip({ id: 'earth_strike_r', duration: 0.62, mask: 'full', events: [{ t: 0.22, name: 'release' }], keys: strikeRKeys });
registerClip({ id: 'earth_strike_l', duration: 0.62, mask: 'full', events: [{ t: 0.22, name: 'release' }], keys: strikeRKeys.map((k) => ({ ...k, pose: mirror(k.pose) })) });

// Third strike: earth disc kick. Knee up and a left stomp (palms pressing down) pops a flat
// stone disc up to hip height; the right knee chambers and the heel drives it away in a
// front push kick, the body leaning back against the kick. The standing foot never leaves its
// stance spot.
registerClip({
  id: 'earth_strike_kick',
  duration: 0.8,
  mask: 'full',
  events: [{ t: 0.32, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { ...STAND } },
      { t: 0.07, pose: { spine: [0.05, 0.1, 0], ...standOn('R', -0.13, -0.07), thighL: [-1.1, ES.toes, 0.3], shinL: [1.3, 0, 0], upperArmL: [-0.8, 0, 0.35], foreArmL: [-1.5, 0, 0], upperArmR: [-0.8, 0, -0.35], foreArmR: [-1.5, 0, 0] }, ease: 'out' },
      { t: 0.13, pose: { spine: [0.22, 0, 0], ...planted(-0.24), upperArmL: [-0.35, 0, 0.35], foreArmL: [-0.4, 0, 0], handL: [0.9, 0, 0], upperArmR: [-0.35, 0, -0.35], foreArmR: [-0.4, 0, 0], handR: [0.9, 0, 0] }, ease: 'in' },
      { t: 0.24, pose: { spine: [0, 0, 0], ...standOn('L', -0.12, 0.08), thighR: [-1.4, -0.2, -0.05], shinR: [1.95, 0, 0], footR: [-0.35, 0, 0], upperArmL: [-1.0, 0, 0.45], foreArmL: [-1.7, 0, 0], handL: [0, 0, 0], upperArmR: [-0.25, 0, -0.5], foreArmR: [-1.6, 0, 0], handR: [0, 0, 0] }, ease: 'out' },
      { t: 0.32, pose: { spine: [-0.25, 0, 0], thighR: [-1.45, -0.2, -0.05], shinR: [0.05, 0, 0], footR: [-0.55, 0, 0], ...standOn('L', -0.1, 0.08, 0.08) }, ease: 'out' },
      { t: 0.46, pose: { spine: [-0.2, 0, 0], thighR: [-1.35, -0.2, -0.05], shinR: [0.25, 0, 0], ...standOn('L', -0.11, 0.08, 0.06) } },
      { t: 0.8, pose: { ...STAND, footR: [0, 0, 0] }, ease: 'inout' },
    ],
    [['R', 0, 0.07], ['R', 0.07, 0.13], ['L', 0.13, 0.24], ['L', 0.24, 0.32], ['L', 0.32, 0.46], ['L', 0.46, 0.8]],
  ),
});

// Heavy fourth strike: sink into the horse stance to scoop a slab up with both hands, heave it forward.
registerClip({
  id: 'earth_strike_heavy',
  duration: 0.9,
  mask: 'full',
  events: [{ t: 0.42, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.6, 0, 0], ...planted(-0.42, 0, -0.16), upperArmL: [-0.6, 0, 0.15], upperArmR: [-0.6, 0, -0.15], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0] } },
    { t: 0.26, pose: { spine: [-0.1, 0, 0], ...planted(-0.16), upperArmL: [-1.4, 0, 0.25], upperArmR: [-1.4, 0, -0.25], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0] }, ease: 'out' },
    // The left foot steps forward into a lunge (the right stays on its stance spot) and the slab
    // is heaved from the hips; then the left foot steps back into the stance.
    { t: 0.34, pose: { ...legAt('L', 0.36, 0.22, -0.18, 0.06, 0.1, 0, 0, 0.02, 0.15), ...legAt('R', ES_OUT, ES.feet[1], -0.18, 0.06, 0, 0, 0, 0.02, ES.toes), hipsY: -0.18, hipsZ: 0.06, hipsX: 0.02 } },
    { t: 0.42, pose: { spine: [0.3, 0, 0], upperArmL: [-1.55, 0, 0.12], upperArmR: [-1.55, 0, -0.12], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-1.2, 0, 0], handR: [-1.2, 0, 0], ...legAt('L', 0.32, 0.46, -0.24, 0.14, 0, 0, 0, 0.03, 0.15), ...legAt('R', ES_OUT, ES.feet[1], -0.24, 0.14, 0, 0, 0, 0.03, ES.toes), hipsY: -0.24, hipsZ: 0.14, hipsX: 0.03 }, ease: 'out' },
    { t: 0.6, pose: { spine: [0.28, 0, 0], upperArmL: [-1.5, 0, 0.15], upperArmR: [-1.5, 0, -0.15], ...legAt('L', 0.32, 0.46, -0.23, 0.13, 0, 0, 0, 0.03, 0.15), ...legAt('R', ES_OUT, ES.feet[1], -0.23, 0.13, 0, 0, 0, 0.03, ES.toes), hipsY: -0.23, hipsZ: 0.13, hipsX: 0.03 } },
    { t: 0.74, pose: { ...legAt('L', 0.37, 0.22, -0.18, 0.06, 0.08, 0, 0, 0.02, 0.15), ...legAt('R', ES_OUT, ES.feet[1], -0.18, 0.06, 0, 0, 0, 0.02, ES.toes), hipsY: -0.18, hipsZ: 0.06, hipsX: 0.02 }, ease: 'inout' },
    { t: 0.9, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Fifth strike, the finisher: Earth Crusher. The right knee comes up and stomps back into a deep
// stance as the arms swing out wide to the sides (two slabs burst out of the ground), the arms open
// wider still with the chest, then the hands clap together in front at 0.5 — the slabs slam shut.
registerClip({
  id: 'earth_strike_crush',
  duration: 1.0,
  mask: 'full',
  events: [{ t: 0.5, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { ...STAND } },
      { t: 0.09, pose: { spine: [0.02, 0, 0], ...standOn('L', -0.12, 0.07), thighR: [-1.15, -ES.toes, -0.3], shinR: [1.3, 0, 0], upperArmL: [-0.35, 0, 1.0], foreArmL: [-0.5, 0, 0], upperArmR: [-0.35, 0, -1.0], foreArmR: [-0.5, 0, 0] }, ease: 'out' },
      { t: 0.19, pose: { spine: [0.28, 0, 0], ...planted(-0.32), upperArmL: [-0.6, 0, 1.15], foreArmL: [-0.35, 0, 0], upperArmR: [-0.6, 0, -1.15], foreArmR: [-0.35, 0, 0] }, ease: 'in' },
      { t: 0.38, pose: { spine: [-0.08, 0, 0], chest: [-0.1, 0, 0], ...planted(-0.26), upperArmL: [-1.2, 0, 1.35], foreArmL: [-0.2, 0, 0], upperArmR: [-1.2, 0, -1.35], foreArmR: [-0.2, 0, 0] }, ease: 'inout' },
      { t: 0.5, pose: { spine: [0.32, 0, 0], chest: [0.08, 0, 0], ...planted(-0.34, 0, ES.sit + 0.06), upperArmL: [-1.5, 0, -0.16], foreArmL: [-0.12, 0, 0], handL: [-0.3, 0, 0], upperArmR: [-1.5, 0, 0.16], foreArmR: [-0.12, 0, 0], handR: [-0.3, 0, 0] }, ease: 'in' },
      { t: 0.72, pose: { spine: [0.3, 0, 0], ...planted(-0.33, 0, ES.sit + 0.05), upperArmL: [-1.45, 0, -0.14], upperArmR: [-1.45, 0, 0.14] } },
      { t: 1.0, pose: { ...STAND, chest: [0, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
    ],
    [['L', 0, 0.09], ['L', 0.09, 0.19]],
  ),
});

// Seismic slam: the weight rides over the right foot (planted on its stance spot) as the left
// knee comes up high, then a crushing stomp back into a very deep horse stance with both arms
// driving down.
registerClip({
  id: 'earth_slam',
  duration: 0.85,
  mask: 'full',
  events: [{ t: 0.3, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { ...STAND } },
      { t: 0.16, pose: { spine: [-0.15, 0, -0.08], ...standOn('R', -0.05, -0.2), thighL: [-1.45, ES.toes, 0.3], shinL: [1.6, 0, 0], upperArmL: [-2.3, 0, 0.5], upperArmR: [-2.3, 0, -0.5], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0] }, ease: 'out' },
      { t: 0.3, pose: { spine: [0.45, 0, 0], ...planted(-0.42, 0, -0.16), upperArmL: [0.15, 0, 0.55], upperArmR: [0.15, 0, -0.55], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0] }, ease: 'in' },
      { t: 0.55, pose: { spine: [0.4, 0, 0], ...planted(-0.4, 0, -0.15) } },
      { t: 0.85, pose: { ...STAND }, ease: 'inout' },
    ],
    [['R', 0, 0.16], ['R', 0.16, 0.3]],
  ),
});

// Charging the slam: low horse stance, fists at the hips, gathering (loop).
registerClip({
  id: 'earth_charge',
  duration: 0.5,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.25, 0, 0], ...planted(-0.36, 0, -0.12), upperArmL: [0.35, 0, 0.3], upperArmR: [0.35, 0, -0.3], foreArmL: [-1.8, 0, 0], foreArmR: [-1.8, 0, 0] } },
    { t: 0.25, pose: { spine: [0.27, 0, 0.02], ...planted(-0.38, 0, -0.13) }, ease: 'inout' },
    { t: 0.5, pose: { spine: [0.25, 0, 0], ...planted(-0.36, 0, -0.12) }, ease: 'inout' },
  ],
});

// Raise: stomp then both palms lift up (pillar / launch).
registerClip({
  id: 'earth_raise',
  duration: 0.7,
  mask: 'full',
  events: [{ t: 0.2, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { ...STAND } },
      { t: 0.05, pose: { spine: [0.3, 0, 0], ...standOn('L', -0.13, 0.07), thighR: [-1.0, -ES.toes, -0.3], shinR: [1.2, 0, 0], upperArmL: [0.3, 0, 0.3], upperArmR: [0.3, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0] }, ease: 'out' },
      { t: 0.1, pose: { spine: [0.35, 0, 0], ...planted(-0.3) }, ease: 'in' },
      { t: 0.2, pose: { spine: [-0.15, 0, 0], upperArmL: [-2.4, 0, 0.35], upperArmR: [-2.4, 0, -0.35], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], handL: [-1.0, 0, 0], handR: [-1.0, 0, 0], ...planted(-0.22) }, ease: 'out' },
      { t: 0.4, pose: { spine: [-0.12, 0, 0], upperArmL: [-2.3, 0, 0.35], upperArmR: [-2.3, 0, -0.35], ...planted(-0.22) } },
      { t: 0.7, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
    ],
    [['L', 0, 0.05], ['L', 0.05, 0.1]],
  ),
});

// Wall: stomp, arms come up in front with forearms vertical.
registerClip({
  id: 'earth_wall',
  duration: 0.75,
  mask: 'full',
  events: [{ t: 0.26, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { ...STAND } },
      { t: 0.06, pose: { spine: [0.3, 0, 0], upperArmL: [0.2, 0, 0.2], upperArmR: [0.2, 0, -0.2], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], ...standOn('R', -0.13, -0.07), thighL: [-1.0, ES.toes, 0.3], shinL: [1.2, 0, 0] }, ease: 'out' },
      { t: 0.12, pose: { spine: [0.38, 0, 0], ...planted(-0.32) }, ease: 'in' },
      { t: 0.26, pose: { spine: [0.05, 0, 0], upperArmL: [-1.25, 0, 0.3], upperArmR: [-1.25, 0, -0.3], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], ...planted(-0.26) }, ease: 'out' },
      { t: 0.45, pose: { spine: [0.05, 0, 0], upperArmL: [-1.2, 0, 0.3], upperArmR: [-1.2, 0, -0.3], ...planted(-0.26) } },
      { t: 0.75, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
    ],
    [['R', 0, 0.06], ['R', 0.06, 0.12]],
  ),
});

// Two-handed shove (punching a wall forward, sending the boulder): rooted — the hips drive forward
// over feet that stay planted in the horse stance.
registerClip({
  id: 'earth_push',
  duration: 0.65,
  mask: 'full',
  events: [{ t: 0.12, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-0.5, 0, 0.35], upperArmR: [-0.5, 0, -0.35], foreArmL: [-1.9, 0, 0], foreArmR: [-1.9, 0, 0], ...planted(-0.18, 0, -0.04) } },
    { t: 0.12, pose: { spine: [0.35, 0, 0], upperArmL: [-1.55, 0, 0.1], upperArmR: [-1.55, 0, -0.1], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-1.1, 0, 0], handR: [-1.1, 0, 0], ...planted(-0.26, 0, 0.12) }, ease: 'out' },
    { t: 0.3, pose: { spine: [0.32, 0, 0], upperArmL: [-1.5, 0, 0.12], upperArmR: [-1.5, 0, -0.12], ...planted(-0.25, 0, 0.11) } },
    { t: 0.65, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Ground spikes: arms up, then drop into a deep squat between planted feet and drive both fists
// into the earth.
registerClip({
  id: 'earth_spikes',
  duration: 0.75,
  mask: 'full',
  events: [{ t: 0.24, name: 'release' }],
  keys: plantedPaths(
    [
      { t: 0, pose: { spine: [-0.1, 0, 0], upperArmL: [-2.2, 0, 0.3], upperArmR: [-2.2, 0, -0.3], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], ...planted(-0.12) } },
      { t: 0.24, pose: { spine: [0.85, 0, 0], head: [-0.3, 0, 0], upperArmL: [-0.55, 0, 0.12], upperArmR: [-0.55, 0, -0.12], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], ...planted(-0.48, 0, -0.22) }, ease: 'in' },
      { t: 0.45, pose: { spine: [0.8, 0, 0], head: [-0.3, 0, 0], ...planted(-0.46, 0, -0.21) } },
      { t: 0.75, pose: { ...STAND, head: [0, 0, 0] }, ease: 'inout' },
    ],
    [['L', 0, 0.24], ['R', 0, 0.24], ['L', 0.45, 0.75], ['R', 0.45, 0.75]],
  ),
});

// Boulder: squat deep between planted feet, hands under, heave a boulder up out of the ground.
registerClip({
  id: 'earth_boulder',
  duration: 0.6,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.7, 0, 0], ...planted(-0.48, 0, -0.22), upperArmL: [-0.4, 0, 0.25], upperArmR: [-0.4, 0, -0.25], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], handL: [0.8, 0, 0], handR: [0.8, 0, 0] } },
    { t: 0.42, pose: { spine: [0.05, 0, 0], ...planted(-0.26), upperArmL: [-1.2, 0, 0.4], upperArmR: [-1.2, 0, -0.4], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0] }, ease: 'inout' },
    { t: 0.6, pose: { spine: [0.05, 0, 0], upperArmL: [-1.25, 0, 0.4], upperArmR: [-1.25, 0, -0.4], ...planted(-0.26) } },
  ],
});

// Stone guard: forearms crossed high, deep stance (loop with a low tremble).
registerClip({
  id: 'earth_guard',
  duration: 0.6,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.2, 0, 0], head: [0.15, 0, 0], upperArmL: [-1.35, 0.3, -0.35], foreArmL: [-1.7, 0, 0], upperArmR: [-1.35, -0.3, 0.35], foreArmR: [-1.7, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], ...planted(-0.3) } },
    { t: 0.3, pose: { spine: [0.22, 0, 0], ...planted(-0.31) }, ease: 'inout' },
    { t: 0.6, pose: { spine: [0.2, 0, 0], ...planted(-0.3) }, ease: 'inout' },
  ],
});

// Rock armor: flex, fists down at the sides as stone climbs up the body.
registerClip({
  id: 'earth_armor',
  duration: 0.9,
  mask: 'full',
  keys: [
    { t: 0, pose: { ...STAND } },
    { t: 0.25, pose: { spine: [0.35, 0, 0], head: [0.2, 0, 0], upperArmL: [-0.2, 0, 0.55], upperArmR: [-0.2, 0, -0.55], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], ...planted(-0.34, 0, -0.06) }, ease: 'inout' },
    { t: 0.5, pose: { spine: [-0.15, 0, 0], head: [-0.2, 0, 0], upperArmL: [0.15, 0, 0.7], upperArmR: [0.15, 0, -0.7], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], ...planted(-0.2) }, ease: 'out' },
    { t: 0.9, pose: { ...STAND }, ease: 'inout' },
  ],
});

// Earth surf: a low, sideways stance on the crest (the model is lifted onto it); the arms drive
// the wave in a rolling push — the lead hand presses forward and down while the rear one draws
// back, then they trade — the knees soaking up the ride.
registerClip({
  id: 'earth_surf_ride',
  duration: 1.0,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { hips: [0, 0.8, 0], spine: [0.22, -0.55, 0.04], head: [0.05, -0.25, 0], thighL: [-0.85, 0, 0.32], shinL: [1.15, 0, 0], thighR: [0.25, 0, -0.38], shinR: [0.95, 0, 0], footL: [-0.25, 0, 0], footR: [-0.35, 0, 0], upperArmL: [-1.1, 0, 0.55], foreArmL: [-0.35, 0, 0], handL: [-0.9, 0, 0], upperArmR: [-0.2, 0, -0.95], foreArmR: [-1.1, 0, 0], handR: [-0.4, 0, 0], hipsY: -0.04 } },
    { t: 0.5, pose: { hips: [0, 0.76, 0], spine: [0.26, -0.6, 0], upperArmL: [-0.45, 0, 0.9], foreArmL: [-0.9, 0, 0], handL: [-0.4, 0, 0], upperArmR: [-1.0, 0, -0.4], foreArmR: [-0.3, 0, 0], handR: [-0.9, 0, 0], thighL: [-0.9, 0, 0.32], shinL: [1.25, 0, 0], thighR: [0.22, 0, -0.38], shinR: [1.05, 0, 0], hipsY: -0.08 }, ease: 'inout' },
    { t: 1.0, pose: { hips: [0, 0.8, 0], spine: [0.22, -0.55, 0.04], upperArmL: [-1.1, 0, 0.55], foreArmL: [-0.35, 0, 0], handL: [-0.9, 0, 0], upperArmR: [-0.2, 0, -0.95], foreArmR: [-1.1, 0, 0], handR: [-0.4, 0, 0], thighL: [-0.85, 0, 0.32], shinL: [1.15, 0, 0], thighR: [0.25, 0, -0.38], shinR: [0.95, 0, 0], hipsY: -0.04 }, ease: 'inout' },
  ],
});

// Earth launch: deep crouch, palms down, then explode upward.
registerClip({
  id: 'earth_launch',
  duration: 0.55,
  mask: 'full',
  events: [{ t: 0.2, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.55, 0, 0], thighL: [-1.25, 0, 0.3], shinL: [1.9, 0, 0], thighR: [-1.25, 0, -0.3], shinR: [1.9, 0, 0], upperArmL: [0.1, 0, 0.35], upperArmR: [0.1, 0, -0.35], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], handL: [1.2, 0, 0], handR: [1.2, 0, 0], hipsY: -0.55 } },
    { t: 0.2, pose: { spine: [-0.15, 0, 0], head: [-0.25, 0, 0], thighL: [0.05, 0, 0.05], shinL: [0.1, 0, 0], thighR: [0.1, 0, -0.05], shinR: [0.2, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0], upperArmL: [-2.8, 0, 0.25], upperArmR: [-2.8, 0, -0.25], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], hipsY: 0.05 }, ease: 'out' },
    { t: 0.55, pose: { spine: [0.1, 0, 0], head: [0, 0, 0], thighL: [-0.8, 0, 0.1], shinL: [1.4, 0, 0], thighR: [-0.5, 0, -0.1], shinR: [1.2, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], upperArmL: [-0.5, 0, 0.9], upperArmR: [-0.5, 0, -0.9], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});
