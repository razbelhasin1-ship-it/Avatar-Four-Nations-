import { registerClip, type Pose } from '../../../character/Animator';

/**
 * Earthbending clips — rooted, heavy, deliberate: stomps that drive into the
 * ground, wide horse stances, short powerful pushes. Conventions: see the
 * header of src/character/Animator.ts.
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

const STAND: Pose = { spine: [0.1, 0, 0], thighL: [-0.25, 0, 0.2], shinL: [0.35, 0, 0], thighR: [-0.25, 0, -0.2], shinR: [0.35, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-1.3, 0, 0], foreArmR: [-1.3, 0, 0], hipsY: -0.1, hipsZ: 0 };

// Stomp (right foot) to pop a rock up, then a straight right punch to send it.
const strikeR: Array<{ t: number; pose: Pose; ease?: 'in' | 'out' | 'inout' }> = [
  { t: 0, pose: { spine: [0.05, -0.2, 0], thighR: [-1.15, 0, -0.15], shinR: [1.3, 0, 0], thighL: [-0.2, 0, 0.15], shinL: [0.3, 0, 0], upperArmR: [0.35, 0, -0.35], foreArmR: [-1.9, 0, 0], upperArmL: [-0.8, 0, 0.35], foreArmL: [-1.5, 0, 0], hipsY: -0.04 } },
  { t: 0.13, pose: { spine: [0.18, -0.3, 0], thighR: [-0.35, 0, -0.32], shinR: [0.45, 0, 0], thighL: [-0.35, 0, 0.28], shinL: [0.5, 0, 0], upperArmR: [0.45, 0, -0.3], foreArmR: [-2.0, 0, 0], hipsY: -0.2 }, ease: 'in' },
  { t: 0.22, pose: { spine: [0.2, 0.45, 0], chest: [0, 0.15, 0], upperArmR: [-1.58, 0, -0.05], foreArmR: [-0.04, 0, 0], upperArmL: [0.2, 0, 0.45], foreArmL: [-1.9, 0, 0], hipsY: -0.22, hipsZ: 0.06 }, ease: 'out' },
  { t: 0.34, pose: { spine: [0.18, 0.4, 0], upperArmR: [-1.5, 0, -0.08], foreArmR: [-0.1, 0, 0] } },
  { t: 0.62, pose: { ...STAND, chest: [0, 0, 0] }, ease: 'inout' },
];
registerClip({ id: 'earth_strike_r', duration: 0.62, mask: 'full', events: [{ t: 0.22, name: 'release' }], keys: strikeR });
registerClip({ id: 'earth_strike_l', duration: 0.62, mask: 'full', events: [{ t: 0.22, name: 'release' }], keys: strikeR.map((k) => ({ ...k, pose: mirror(k.pose) })) });

// Heavy third strike: crouch, scoop a slab up with both hands, heave it forward.
registerClip({
  id: 'earth_strike_heavy',
  duration: 0.9,
  mask: 'full',
  events: [{ t: 0.42, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.6, 0, 0], thighL: [-1.1, 0, 0.35], shinL: [1.6, 0, 0], thighR: [-1.1, 0, -0.35], shinR: [1.6, 0, 0], upperArmL: [-0.6, 0, 0.15], upperArmR: [-0.6, 0, -0.15], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0], hipsY: -0.48 } },
    { t: 0.26, pose: { spine: [-0.1, 0, 0], thighL: [-0.45, 0, 0.3], shinL: [0.6, 0, 0], thighR: [-0.45, 0, -0.3], shinR: [0.6, 0, 0], upperArmL: [-1.4, 0, 0.25], upperArmR: [-1.4, 0, -0.25], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], hipsY: -0.16 }, ease: 'out' },
    { t: 0.42, pose: { spine: [0.3, 0, 0], upperArmL: [-1.55, 0, 0.12], upperArmR: [-1.55, 0, -0.12], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-1.2, 0, 0], handR: [-1.2, 0, 0], thighL: [-0.9, 0, 0.2], shinL: [0.9, 0, 0], thighR: [0.45, 0, -0.2], shinR: [0.3, 0, 0], hipsY: -0.24, hipsZ: 0.14 }, ease: 'out' },
    { t: 0.6, pose: { spine: [0.28, 0, 0], upperArmL: [-1.5, 0, 0.15], upperArmR: [-1.5, 0, -0.15] } },
    { t: 0.9, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Seismic slam: knee high, then a crushing stomp with both arms driving down.
registerClip({
  id: 'earth_slam',
  duration: 0.85,
  mask: 'full',
  events: [{ t: 0.3, name: 'release' }],
  keys: [
    { t: 0, pose: { ...STAND } },
    { t: 0.16, pose: { spine: [-0.15, 0, 0], thighL: [-1.45, 0, 0.2], shinL: [1.6, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [0.2, 0, 0], upperArmL: [-2.3, 0, 0.5], upperArmR: [-2.3, 0, -0.5], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], hipsY: 0.04 }, ease: 'out' },
    { t: 0.3, pose: { spine: [0.45, 0, 0], thighL: [-0.55, 0, 0.42], shinL: [0.9, 0, 0], thighR: [-0.55, 0, -0.42], shinR: [0.9, 0, 0], upperArmL: [0.15, 0, 0.55], upperArmR: [0.15, 0, -0.55], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], hipsY: -0.42 }, ease: 'in' },
    { t: 0.55, pose: { spine: [0.4, 0, 0], hipsY: -0.4 } },
    { t: 0.85, pose: { ...STAND }, ease: 'inout' },
  ],
});

// Charging the slam: low horse stance, fists at the hips, gathering (loop).
registerClip({
  id: 'earth_charge',
  duration: 0.5,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.25, 0, 0], thighL: [-0.75, 0, 0.45], shinL: [1.1, 0, 0], thighR: [-0.75, 0, -0.45], shinR: [1.1, 0, 0], upperArmL: [0.35, 0, 0.3], upperArmR: [0.35, 0, -0.3], foreArmL: [-1.8, 0, 0], foreArmR: [-1.8, 0, 0], footL: [-0.3, 0, -0.25], footR: [-0.3, 0, 0.25], hipsY: -0.36 } },
    { t: 0.25, pose: { spine: [0.27, 0, 0.02], hipsY: -0.38 }, ease: 'inout' },
    { t: 0.5, pose: { spine: [0.25, 0, 0], hipsY: -0.36 }, ease: 'inout' },
  ],
});

// Raise: stomp then both palms lift up (pillar / launch).
registerClip({
  id: 'earth_raise',
  duration: 0.7,
  mask: 'full',
  events: [{ t: 0.2, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.3, 0, 0], thighR: [-1.0, 0, -0.15], shinR: [1.2, 0, 0], upperArmL: [0.3, 0, 0.3], upperArmR: [0.3, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], hipsY: -0.12 } },
    { t: 0.1, pose: { spine: [0.35, 0, 0], thighR: [-0.4, 0, -0.35], shinR: [0.6, 0, 0], thighL: [-0.4, 0, 0.35], shinL: [0.6, 0, 0], hipsY: -0.3 }, ease: 'in' },
    { t: 0.2, pose: { spine: [-0.15, 0, 0], upperArmL: [-2.4, 0, 0.35], upperArmR: [-2.4, 0, -0.35], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], handL: [-1.0, 0, 0], handR: [-1.0, 0, 0], hipsY: -0.22 }, ease: 'out' },
    { t: 0.4, pose: { spine: [-0.12, 0, 0], upperArmL: [-2.3, 0, 0.35], upperArmR: [-2.3, 0, -0.35] } },
    { t: 0.7, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Wall: stomp, arms come up in front with forearms vertical.
registerClip({
  id: 'earth_wall',
  duration: 0.75,
  mask: 'full',
  events: [{ t: 0.26, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.3, 0, 0], upperArmL: [0.2, 0, 0.2], upperArmR: [0.2, 0, -0.2], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], thighL: [-1.0, 0, 0.15], shinL: [1.2, 0, 0], hipsY: -0.1 } },
    { t: 0.12, pose: { spine: [0.38, 0, 0], thighL: [-0.4, 0, 0.38], shinL: [0.65, 0, 0], thighR: [-0.4, 0, -0.38], shinR: [0.65, 0, 0], hipsY: -0.32 }, ease: 'in' },
    { t: 0.26, pose: { spine: [0.05, 0, 0], upperArmL: [-1.25, 0, 0.3], upperArmR: [-1.25, 0, -0.3], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], hipsY: -0.26 }, ease: 'out' },
    { t: 0.45, pose: { spine: [0.05, 0, 0], upperArmL: [-1.2, 0, 0.3], upperArmR: [-1.2, 0, -0.3] } },
    { t: 0.75, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Two-handed shove (punching a wall forward, sending the boulder).
registerClip({
  id: 'earth_push',
  duration: 0.65,
  mask: 'full',
  events: [{ t: 0.12, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-0.5, 0, 0.35], upperArmR: [-0.5, 0, -0.35], foreArmL: [-1.9, 0, 0], foreArmR: [-1.9, 0, 0], thighL: [-0.3, 0, 0.25], shinL: [0.5, 0, 0], thighR: [-0.2, 0, -0.25], shinR: [0.45, 0, 0], hipsY: -0.15 } },
    { t: 0.12, pose: { spine: [0.35, 0, 0], upperArmL: [-1.55, 0, 0.1], upperArmR: [-1.55, 0, -0.1], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-1.1, 0, 0], handR: [-1.1, 0, 0], thighL: [-0.95, 0, 0.2], shinL: [0.95, 0, 0], thighR: [0.55, 0, -0.18], shinR: [0.2, 0, 0], hipsY: -0.26, hipsZ: 0.16 }, ease: 'out' },
    { t: 0.3, pose: { spine: [0.32, 0, 0], upperArmL: [-1.5, 0, 0.12], upperArmR: [-1.5, 0, -0.12] } },
    { t: 0.65, pose: { ...STAND, handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Ground spikes: drop and drive both fists into the earth.
registerClip({
  id: 'earth_spikes',
  duration: 0.75,
  mask: 'full',
  events: [{ t: 0.24, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [-0.1, 0, 0], upperArmL: [-2.2, 0, 0.3], upperArmR: [-2.2, 0, -0.3], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], hipsY: -0.05 } },
    { t: 0.24, pose: { spine: [0.85, 0, 0], head: [-0.3, 0, 0], upperArmL: [-0.55, 0, 0.12], upperArmR: [-0.55, 0, -0.12], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], thighL: [-1.25, 0, 0.3], shinL: [1.9, 0, 0], thighR: [-0.4, 0, -0.3], shinR: [1.6, 0, 0], hipsY: -0.6 }, ease: 'in' },
    { t: 0.45, pose: { spine: [0.8, 0, 0], head: [-0.3, 0, 0], hipsY: -0.58 } },
    { t: 0.75, pose: { ...STAND, head: [0, 0, 0] }, ease: 'inout' },
  ],
});

// Boulder: crouch deep, hands under, heave a boulder up out of the ground.
registerClip({
  id: 'earth_boulder',
  duration: 0.6,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.7, 0, 0], thighL: [-1.3, 0, 0.4], shinL: [1.9, 0, 0], thighR: [-1.3, 0, -0.4], shinR: [1.9, 0, 0], upperArmL: [-0.4, 0, 0.25], upperArmR: [-0.4, 0, -0.25], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], handL: [0.8, 0, 0], handR: [0.8, 0, 0], hipsY: -0.55 } },
    { t: 0.42, pose: { spine: [0.05, 0, 0], thighL: [-0.5, 0, 0.35], shinL: [0.8, 0, 0], thighR: [-0.5, 0, -0.35], shinR: [0.8, 0, 0], upperArmL: [-1.2, 0, 0.4], upperArmR: [-1.2, 0, -0.4], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0], hipsY: -0.26 }, ease: 'inout' },
    { t: 0.6, pose: { spine: [0.05, 0, 0], upperArmL: [-1.25, 0, 0.4], upperArmR: [-1.25, 0, -0.4], hipsY: -0.26 } },
  ],
});

// Stone guard: forearms crossed high, deep stance (loop with a low tremble).
registerClip({
  id: 'earth_guard',
  duration: 0.6,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.2, 0, 0], head: [0.15, 0, 0], upperArmL: [-1.35, 0.3, -0.35], foreArmL: [-1.7, 0, 0], upperArmR: [-1.35, -0.3, 0.35], foreArmR: [-1.7, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.6, 0, 0.4], shinL: [0.9, 0, 0], thighR: [-0.2, 0, -0.4], shinR: [0.7, 0, 0], hipsY: -0.3 } },
    { t: 0.3, pose: { spine: [0.22, 0, 0], hipsY: -0.31 }, ease: 'inout' },
    { t: 0.6, pose: { spine: [0.2, 0, 0], hipsY: -0.3 }, ease: 'inout' },
  ],
});

// Rock armor: flex, fists down at the sides as stone climbs up the body.
registerClip({
  id: 'earth_armor',
  duration: 0.9,
  mask: 'full',
  keys: [
    { t: 0, pose: { ...STAND } },
    { t: 0.25, pose: { spine: [0.35, 0, 0], head: [0.2, 0, 0], upperArmL: [-0.2, 0, 0.55], upperArmR: [-0.2, 0, -0.55], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], thighL: [-0.5, 0, 0.42], shinL: [0.8, 0, 0], thighR: [-0.5, 0, -0.42], shinR: [0.8, 0, 0], hipsY: -0.34 }, ease: 'inout' },
    { t: 0.5, pose: { spine: [-0.15, 0, 0], head: [-0.2, 0, 0], upperArmL: [0.15, 0, 0.7], upperArmR: [0.15, 0, -0.7], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], hipsY: -0.2 }, ease: 'out' },
    { t: 0.9, pose: { ...STAND }, ease: 'inout' },
  ],
});

// Earth surf: sideways surfing stance on the moving wave (body lifted onto the crest).
registerClip({
  id: 'earth_surf_ride',
  duration: 1.0,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { hips: [0, 0.75, 0], spine: [0.15, -0.6, 0], head: [0, -0.15, 0], thighL: [-0.75, 0, 0.3], shinL: [1.0, 0, 0], thighR: [0.3, 0, -0.35], shinR: [0.75, 0, 0], upperArmL: [-0.5, 0, 1.0], upperArmR: [-0.2, 0, -0.8], foreArmL: [-0.4, 0, 0], foreArmR: [-0.8, 0, 0], hipsY: 0.22 } },
    { t: 0.5, pose: { hips: [0, 0.72, 0], spine: [0.2, -0.6, 0.05], upperArmL: [-0.6, 0, 1.05], upperArmR: [-0.15, 0, -0.75], hipsY: 0.18 }, ease: 'inout' },
    { t: 1.0, pose: { hips: [0, 0.75, 0], spine: [0.15, -0.6, 0], upperArmL: [-0.5, 0, 1.0], upperArmR: [-0.2, 0, -0.8], hipsY: 0.22 }, ease: 'inout' },
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
