import { registerClip, type Pose } from '../../../character/Animator';

/**
 * Airbending clips — circular, light, always moving: palms rather than fists,
 * spins, sweeping arcs. Conventions: src/character/Animator.ts header.
 */

const mirror = (p: Pose): Pose => {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'hipsY' || k === 'hipsZ') {
      (out as Record<string, number>)[k] = v as number;
      continue;
    }
    const e = v as [number, number, number];
    const swapped = k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k;
    (out as Record<string, [number, number, number]>)[swapped] = [e[0], -e[1], -e[2]];
  }
  return out;
};

// Palm strikes (upper body; the legs keep moving — air never stands still).
const palmR: Pose[] = [
  { spine: [0.05, -0.35, 0], upperArmR: [0.3, 0, -0.45], foreArmR: [-1.7, 0, 0], handR: [-0.6, 0, 0], upperArmL: [-0.9, 0, 0.35], foreArmL: [-1.2, 0, 0] },
  { spine: [0.12, 0.45, 0], chest: [0, 0.12, 0], upperArmR: [-1.52, 0, -0.08], foreArmR: [-0.06, 0, 0], handR: [-1.35, 0, 0], upperArmL: [0.35, 0, 0.5], foreArmL: [-1.45, 0, 0], handL: [0, 0, 0] },
  { spine: [0.1, 0.4, 0], upperArmR: [-1.45, 0, -0.1], foreArmR: [-0.12, 0, 0], handR: [-1.2, 0, 0] },
  { spine: [0.04, 0, 0], chest: [0, 0, 0], upperArmR: [-0.5, 0, -0.3], foreArmR: [-0.9, 0, 0], handR: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], foreArmL: [-0.9, 0, 0] },
];
const times = [0, 0.08, 0.18, 0.4];
registerClip({ id: 'air_palm_r', duration: 0.4, mask: 'upper', events: [{ t: 0.08, name: 'release' }], keys: palmR.map((pose, i) => ({ t: times[i], pose, ease: i === 1 ? 'out' : 'inout' })) });
registerClip({ id: 'air_palm_l', duration: 0.4, mask: 'upper', events: [{ t: 0.08, name: 'release' }], keys: palmR.map((pose, i) => ({ t: times[i], pose: mirror(pose), ease: i === 1 ? 'out' : 'inout' })) });

// Third strike: Baguazhang crescent kick. The right leg swings up across the body and over in
// a high vertical arc (straight leg, hips turning with it), arms opened wide, the bender light
// on the toes of the support foot; at the top of the arc the foot cuts a tall blade of air.
registerClip({
  id: 'air_palm_kick',
  duration: 0.56,
  mask: 'full',
  events: [{ t: 0.18, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.06, -0.25, 0], thighR: [-0.25, 0, 0.12], shinR: [0.7, 0, 0], thighL: [-0.2, 0, 0.08], shinL: [0.35, 0, 0], upperArmL: [-0.9, 0, 0.55], foreArmL: [-0.7, 0, 0], handL: [-0.4, 0, 0], upperArmR: [-0.35, 0, -0.6], foreArmR: [-0.6, 0, 0], hipsY: -0.07 } },
    { t: 0.09, pose: { hips: [0, 0.3, 0], spine: [-0.04, 0.1, 0], thighR: [-1.0, 0, 0.5], shinR: [0.2, 0, 0], footR: [0.35, 0, 0], thighL: [-0.08, 0, 0.06], shinL: [0.15, 0, 0], footL: [0.25, 0, 0], upperArmL: [-0.35, 0, 1.2], foreArmL: [-0.2, 0, 0], upperArmR: [-0.15, 0, -1.15], foreArmR: [-0.2, 0, 0], hipsY: 0.02 }, ease: 'out' },
    { t: 0.18, pose: { hips: [0, 0.05, 0], spine: [-0.16, -0.05, 0], thighR: [-1.8, 0, 0.02], shinR: [0.04, 0, 0], footR: [-0.15, 0, 0], thighL: [0, 0, 0.05], shinL: [0.08, 0, 0], footL: [0.35, 0, 0], upperArmL: [-0.15, 0, 1.4], upperArmR: [-0.1, 0, -1.35], hipsY: 0.05 }, ease: 'out' },
    { t: 0.3, pose: { hips: [0, -0.3, 0], spine: [-0.06, -0.2, 0], thighR: [-1.15, 0, -0.8], shinR: [0.12, 0, 0], footR: [0.1, 0, 0], hipsY: 0.02 } },
    { t: 0.56, pose: { hips: [0, 0, 0], spine: [0.04, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], footR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], footL: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], foreArmL: [-0.9, 0, 0], handL: [0, 0, 0], upperArmR: [-0.5, 0, -0.3], foreArmR: [-0.9, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// Fourth strike: full spin, then a two-palm push. Play with fadeOut ~0 (ends at -2π).
registerClip({
  id: 'air_palm_spin',
  duration: 0.62,
  mask: 'full',
  events: [{ t: 0.3, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.1, -0.7, 0], upperArmL: [-0.5, 0, 0.9], foreArmL: [-0.4, 0, 0], upperArmR: [0.3, 0, -0.9], foreArmR: [-0.4, 0, 0], thighL: [-0.3, 0, 0.1], shinL: [0.4, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [0.3, 0, 0], hipsY: -0.08 } },
    { t: 0.15, pose: { hips: [0, -Math.PI, 0], spine: [0, 0, 0], upperArmL: [-0.15, 0, 1.45], foreArmL: [-0.05, 0, 0], upperArmR: [-0.15, 0, -1.45], foreArmR: [-0.05, 0, 0], thighL: [-0.5, 0, 0.1], shinL: [0.8, 0, 0], hipsY: 0.02 }, ease: 'linear' },
    { t: 0.3, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.2, 0, 0], upperArmL: [-1.52, 0, 0.12], upperArmR: [-1.52, 0, -0.12], foreArmL: [-0.06, 0, 0], foreArmR: [-0.06, 0, 0], handL: [-1.3, 0, 0], handR: [-1.3, 0, 0], thighL: [-0.75, 0, 0.15], shinL: [0.7, 0, 0], thighR: [0.4, 0, -0.1], shinR: [0.25, 0, 0], hipsY: -0.12, hipsZ: 0.1 }, ease: 'out' },
    { t: 0.42, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.18, 0, 0], upperArmL: [-1.45, 0, 0.15], upperArmR: [-1.45, 0, -0.15] } },
    { t: 0.62, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.04, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// Air blast release: step through and thrust both palms (light, extended).
registerClip({
  id: 'air_push',
  duration: 0.6,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [-0.05, 0, 0], upperArmL: [-0.6, 0.5, 0.2], upperArmR: [-0.6, -0.5, -0.2], foreArmL: [-1.8, 0, 0], foreArmR: [-1.8, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0], thighL: [-0.25, 0, 0.12], shinL: [0.35, 0, 0], hipsY: -0.04 } },
    { t: 0.1, pose: { spine: [0.22, 0, 0], upperArmL: [-1.6, 0, 0.18], upperArmR: [-1.6, 0, -0.18], foreArmL: [0, 0, 0], foreArmR: [0, 0, 0], handL: [-1.35, 0, 0], handR: [-1.35, 0, 0], thighL: [-0.8, 0, 0.1], shinL: [0.6, 0, 0], thighR: [0.5, 0, -0.08], shinR: [0.2, 0, 0], footR: [0.5, 0, 0], hipsY: -0.1, hipsZ: 0.12 }, ease: 'out' },
    { t: 0.3, pose: { spine: [0.2, 0, 0], upperArmL: [-1.55, 0, 0.22], upperArmR: [-1.55, 0, -0.22] } },
    { t: 0.6, pose: { spine: [0.03, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], footR: [0, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// Charging a blast: hands circle a ball of wind at the chest (loop).
registerClip({
  id: 'air_charge',
  duration: 1.0,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.05, 0.2, 0], upperArmL: [-1.25, 0.4, 0.05], foreArmL: [-1.0, 0, 0], handL: [-0.4, 0, 0], upperArmR: [-0.45, -0.4, -0.25], foreArmR: [-1.6, 0, 0], handR: [-0.6, 0, 0], thighL: [-0.35, 0, 0.12], shinL: [0.5, 0, 0], thighR: [0.15, 0, -0.1], shinR: [0.35, 0, 0], footR: [0.4, 0, 0], hipsY: -0.07 } },
    { t: 0.5, pose: { spine: [0.05, -0.2, 0], upperArmL: [-0.45, 0.4, 0.25], foreArmL: [-1.6, 0, 0], handL: [-0.6, 0, 0], upperArmR: [-1.25, -0.4, -0.05], foreArmR: [-1.0, 0, 0], handR: [-0.4, 0, 0], hipsY: -0.09 }, ease: 'inout' },
    { t: 1.0, pose: { spine: [0.05, 0.2, 0], upperArmL: [-1.25, 0.4, 0.05], foreArmL: [-1.0, 0, 0], handL: [-0.4, 0, 0], upperArmR: [-0.45, -0.4, -0.25], foreArmR: [-1.6, 0, 0], handR: [-0.6, 0, 0], hipsY: -0.07 }, ease: 'inout' },
  ],
});

// Low sweeping kick: right leg sweeps a half circle at ankle height.
registerClip({
  id: 'air_sweep_kick',
  duration: 0.62,
  mask: 'full',
  events: [{ t: 0.16, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0.9, 0], spine: [0.3, 0, 0], thighL: [-1.0, 0, 0.25], shinL: [1.6, 0, 0], thighR: [-0.3, 0, -0.9], shinR: [0.2, 0, 0], upperArmL: [-0.3, 0, 1.1], upperArmR: [-0.3, 0, -1.1], hipsY: -0.35 } },
    { t: 0.16, pose: { hips: [0, 0, 0], spine: [0.45, 0, 0.1], thighL: [-1.35, 0, 0.25], shinL: [2.05, 0, 0], thighR: [-0.1, 0, -1.4], shinR: [0.02, 0, 0], footR: [-0.3, 0, 0], upperArmL: [-0.1, 0, 1.4], upperArmR: [0.4, 0, -1.1], hipsY: -0.6 }, ease: 'out' },
    { t: 0.3, pose: { hips: [0, -0.9, 0], spine: [0.45, 0, 0.1], thighL: [-1.35, 0, 0.25], shinL: [2.05, 0, 0], thighR: [-0.1, 0, -1.4], shinR: [0.02, 0, 0], hipsY: -0.6 } },
    { t: 0.62, pose: { hips: [0, 0, 0], spine: [0.05, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], footR: [0, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], hipsY: 0 }, ease: 'inout' },
  ],
});

// Air dash: streamlined lean, arms swept back, legs trailing.
registerClip({
  id: 'air_dash',
  duration: 0.46,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.25, 0, 0], upperArmL: [-0.4, 0, 0.6], upperArmR: [-0.4, 0, -0.6] } },
    { t: 0.06, pose: { spine: [0.55, 0, 0], head: [-0.35, 0, 0], upperArmL: [0.95, 0, 0.35], upperArmR: [0.95, 0, -0.35], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], thighL: [0.2, 0, 0.05], shinL: [0.8, 0, 0], thighR: [0.45, 0, -0.05], shinR: [1.0, 0, 0], footL: [0.6, 0, 0], footR: [0.6, 0, 0] }, ease: 'out' },
    { t: 0.32, pose: { spine: [0.5, 0, 0], head: [-0.3, 0, 0], upperArmL: [0.9, 0, 0.4], upperArmR: [0.9, 0, -0.4] } },
    { t: 0.46, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], thighL: [-0.1, 0, 0], shinL: [0.2, 0, 0], thighR: [-0.1, 0, 0], shinR: [0.2, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Spinning air strike: arms flung out, one fast full turn (ends at 2π; fadeOut ~0).
registerClip({
  id: 'air_spin',
  duration: 0.6,
  mask: 'full',
  events: [{ t: 0.14, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.15, 0.6, 0], upperArmL: [-0.6, 0, 0.5], upperArmR: [-0.2, 0, -1.0], foreArmL: [-1.2, 0, 0], foreArmR: [-0.6, 0, 0], thighL: [-0.4, 0, 0.12], shinL: [0.7, 0, 0], thighR: [-0.4, 0, -0.12], shinR: [0.7, 0, 0], hipsY: -0.16 } },
    { t: 0.14, pose: { hips: [0, 1.6, 0], spine: [-0.05, 0, 0], upperArmL: [-0.05, 0, 1.5], upperArmR: [-0.05, 0, -1.5], foreArmL: [0, 0, 0], foreArmR: [0, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0], thighL: [-0.05, 0, 0.05], shinL: [0.1, 0, 0], thighR: [-0.05, 0, -0.05], shinR: [0.1, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], hipsY: 0.05 }, ease: 'in' },
    { t: 0.36, pose: { hips: [0, 2 * Math.PI, 0], spine: [-0.05, 0, 0], upperArmL: [-0.05, 0, 1.45], upperArmR: [-0.05, 0, -1.45], hipsY: 0.05 }, ease: 'linear' },
    { t: 0.6, pose: { hips: [0, 2 * Math.PI, 0], spine: [0.05, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// Air shield: arms drawn up and around in a sphere (loop with a slow circling sway).
registerClip({
  id: 'air_shield_hold',
  duration: 1.2,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0, 0.15, 0], upperArmL: [-1.9, 0, 0.55], upperArmR: [-1.2, 0, -0.75], foreArmL: [-0.9, 0, 0], foreArmR: [-1.2, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], thighL: [-0.3, 0, 0.15], shinL: [0.45, 0, 0], thighR: [-0.2, 0, -0.15], shinR: [0.4, 0, 0], hipsY: -0.08 } },
    { t: 0.6, pose: { spine: [0, -0.15, 0], upperArmL: [-1.2, 0, 0.75], upperArmR: [-1.9, 0, -0.55], foreArmL: [-1.2, 0, 0], foreArmR: [-0.9, 0, 0], hipsY: -0.1 }, ease: 'inout' },
    { t: 1.2, pose: { spine: [0, 0.15, 0], upperArmL: [-1.9, 0, 0.55], upperArmR: [-1.2, 0, -0.75], foreArmL: [-0.9, 0, 0], foreArmR: [-1.2, 0, 0], hipsY: -0.08 }, ease: 'inout' },
  ],
});

// Riding the air scooter: crouched balance on a spinning ball (body lifted via hipsY).
registerClip({
  id: 'air_scooter_ride',
  duration: 0.8,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.32, 0, 0], head: [-0.25, 0, 0], thighL: [-1.0, 0, 0.12], shinL: [1.55, 0, 0], thighR: [-0.85, 0, -0.12], shinR: [1.45, 0, 0], footL: [-0.4, 0, 0], footR: [-0.4, 0, 0], upperArmL: [-0.35, 0, 1.05], upperArmR: [-0.35, 0, -1.05], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], hipsY: 0.42 } },
    { t: 0.4, pose: { spine: [0.36, 0, 0.06], upperArmL: [-0.3, 0, 1.15], upperArmR: [-0.4, 0, -0.95], hipsY: 0.45 }, ease: 'inout' },
    { t: 0.8, pose: { spine: [0.32, 0, 0], upperArmL: [-0.35, 0, 1.05], upperArmR: [-0.35, 0, -1.05], hipsY: 0.42 }, ease: 'inout' },
  ],
});

// Wind redirection: a big circular sweep of both hands, then palms out to catch.
registerClip({
  id: 'air_redirect',
  duration: 0.75,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.05, 0.3, 0], upperArmL: [-0.3, 0, 0.4], upperArmR: [-1.8, 0, -0.4], foreArmL: [-0.6, 0, 0], foreArmR: [-0.5, 0, 0], thighL: [-0.3, 0, 0.12], shinL: [0.4, 0, 0], hipsY: -0.06 } },
    { t: 0.12, pose: { spine: [0.08, -0.3, 0], upperArmL: [-1.8, 0, 0.4], upperArmR: [-0.3, 0, -0.4], foreArmL: [-0.5, 0, 0], foreArmR: [-0.6, 0, 0] }, ease: 'inout' },
    { t: 0.24, pose: { spine: [0.15, 0, 0], upperArmL: [-1.45, 0, 0.35], upperArmR: [-1.45, 0, -0.35], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], handL: [-1.2, 0, 0.3], handR: [-1.2, 0, -0.3], thighL: [-0.6, 0, 0.15], shinL: [0.6, 0, 0], thighR: [0.3, 0, -0.1], shinR: [0.25, 0, 0], hipsY: -0.12 }, ease: 'out' },
    { t: 0.55, pose: { spine: [0.15, 0, 0], upperArmL: [-1.4, 0, 0.4], upperArmR: [-1.4, 0, -0.4] } },
    { t: 0.75, pose: { spine: [0.03, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// Vortex: arms roll around each other, then a lifting palm thrust sends the tornado out.
registerClip({
  id: 'air_vortex_cast',
  duration: 0.95,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-1.0, 0, 0.2], upperArmR: [-0.4, 0, -0.2], foreArmL: [-1.4, 0, 0], foreArmR: [-1.7, 0, 0], thighL: [-0.3, 0, 0.15], shinL: [0.5, 0, 0], thighR: [-0.2, 0, -0.15], shinR: [0.4, 0, 0], hipsY: -0.12 } },
    { t: 0.15, pose: { upperArmL: [-0.4, 0, 0.2], upperArmR: [-1.0, 0, -0.2], foreArmL: [-1.7, 0, 0], foreArmR: [-1.4, 0, 0], spine: [0.05, 0.25, 0] }, ease: 'inout' },
    { t: 0.3, pose: { upperArmL: [-1.0, 0, 0.2], upperArmR: [-0.4, 0, -0.2], foreArmL: [-1.4, 0, 0], foreArmR: [-1.7, 0, 0], spine: [0.05, -0.25, 0], hipsY: -0.16 }, ease: 'inout' },
    { t: 0.42, pose: { spine: [0.2, 0.3, 0], upperArmR: [-1.6, 0, -0.05], foreArmR: [0, 0, 0], handR: [-1.3, 0, 0], upperArmL: [-2.4, 0, 0.5], foreArmL: [-0.4, 0, 0], thighL: [-0.7, 0, 0.15], shinL: [0.7, 0, 0], thighR: [0.4, 0, -0.1], shinR: [0.25, 0, 0], hipsY: -0.1, hipsZ: 0.08 }, ease: 'out' },
    { t: 0.7, pose: { spine: [0.18, 0.28, 0], upperArmR: [-1.55, 0, -0.08] } },
    { t: 0.95, pose: { spine: [0.03, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.06], shinL: [0.15, 0, 0], thighR: [-0.1, 0, -0.06], shinR: [0.15, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});
