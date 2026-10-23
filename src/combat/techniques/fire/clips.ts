import { registerClip } from '../../../character/Animator';

/**
 * Firebending clips — compact, snappy, forward-driving. Conventions: see the
 * header of src/character/Animator.ts (left = +X; upperArm -x = forward;
 * upperArmL +z / upperArmR -z = out to the side; foreArm -x bends the elbow;
 * thigh -x = leg forward; shin +x bends the knee; hipsY/hipsZ in metres).
 */

// Alternating straight punches (upper body only: the legs keep running).
const jab = (id: string, side: 'R' | 'L') => {
  const s = side === 'R' ? 1 : -1;
  const ua = `upperArm${side}` as const;
  const fa = `foreArm${side}` as const;
  const ou = side === 'R' ? 'upperArmL' : 'upperArmR';
  const of = side === 'R' ? 'foreArmL' : 'foreArmR';
  registerClip({
    id,
    duration: 0.34,
    mask: 'upper',
    events: [{ t: 0.07, name: 'release' }],
    keys: [
      { t: 0, pose: { spine: [0.12, -0.3 * s, 0], [ua]: [0.35, 0, -0.35 * s], [fa]: [-1.9, 0, 0], [ou]: [-0.7, 0, 0.3 * s], [of]: [-1.7, 0, 0] } },
      { t: 0.07, pose: { spine: [0.18, 0.5 * s, 0], chest: [0, 0.15 * s, 0], [ua]: [-1.58, 0, -0.06 * s], [fa]: [-0.04, 0, 0], [ou]: [-0.25, 0, 0.4 * s], [of]: [-2.0, 0, 0] }, ease: 'out' },
      { t: 0.15, pose: { spine: [0.16, 0.42 * s, 0], [ua]: [-1.5, 0, -0.08 * s], [fa]: [-0.12, 0, 0] } },
      { t: 0.34, pose: { spine: [0.1, 0, 0], chest: [0, 0, 0], [ua]: [-0.65, 0, -0.25 * s], [fa]: [-1.6, 0, 0], [ou]: [-0.65, 0, 0.25 * s], [of]: [-1.6, 0, 0] }, ease: 'inout' },
    ],
  });
};
jab('fire_jab_r', 'R');
jab('fire_jab_l', 'L');

// Fourth strike: chambered roundhouse kick from the right leg.
registerClip({
  id: 'fire_jab_kick',
  duration: 0.56,
  mask: 'full',
  events: [{ t: 0.16, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.1, 0.2, 0], thighR: [-0.4, 0, -0.1], shinR: [0.6, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.2, 0, 0], upperArmL: [-0.7, 0, 0.3], foreArmL: [-1.7, 0, 0], upperArmR: [-0.6, 0, -0.3], foreArmR: [-1.6, 0, 0], hipsY: -0.04 } },
    { t: 0.08, pose: { hips: [0, 0.35, 0], spine: [0.05, 0.35, 0], thighR: [-1.25, 0, -0.35], shinR: [1.9, 0, 0], thighL: [-0.1, 0, 0.1], shinL: [0.25, 0, 0], upperArmL: [-0.5, 0, 0.8], upperArmR: [-0.2, 0, -0.9], hipsY: -0.02 }, ease: 'out' },
    { t: 0.16, pose: { hips: [0, 0.65, 0], spine: [-0.3, 0.3, 0.12], thighR: [-1.5, 0, -0.55], shinR: [0.05, 0, 0], footR: [0.5, 0, 0], thighL: [0.05, 0, 0.12], shinL: [0.15, 0, 0], upperArmL: [-0.3, 0, 1.15], foreArmL: [-0.5, 0, 0], upperArmR: [0.35, 0, -1.0], foreArmR: [-0.4, 0, 0] }, ease: 'out' },
    { t: 0.3, pose: { hips: [0, 0.6, 0], spine: [-0.25, 0.25, 0.1], thighR: [-1.35, 0, -0.5], shinR: [0.3, 0, 0], footR: [0.3, 0, 0] } },
    { t: 0.56, pose: { hips: [0, 0, 0], spine: [0.08, 0, 0], thighR: [-0.1, 0, -0.1], shinR: [0.2, 0, 0], footR: [0, 0, 0], thighL: [-0.1, 0, 0.1], shinL: [0.2, 0, 0], upperArmL: [-0.6, 0, 0.3], foreArmL: [-1.5, 0, 0], upperArmR: [-0.6, 0, -0.3], foreArmR: [-1.5, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// Two-handed push (fire blast release), stepping into a lunge.
registerClip({
  id: 'fire_push',
  duration: 0.6,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-0.9, 0, 0.3], upperArmR: [-0.9, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], thighL: [-0.4, 0, 0.25], shinL: [0.6, 0, 0], thighR: [-0.3, 0, -0.25], shinR: [0.6, 0, 0], hipsY: -0.12 } },
    { t: 0.1, pose: { spine: [0.3, 0, 0], upperArmL: [-1.55, 0, 0.08], upperArmR: [-1.55, 0, -0.08], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [-1.1, 0, 0], handR: [-1.1, 0, 0], thighL: [-0.85, 0, 0.12], shinL: [0.75, 0, 0], thighR: [0.45, 0, -0.1], shinR: [0.25, 0, 0], hipsY: -0.16, hipsZ: 0.12 }, ease: 'out' },
    { t: 0.26, pose: { spine: [0.26, 0, 0], upperArmL: [-1.45, 0, 0.12], upperArmR: [-1.45, 0, -0.12] } },
    { t: 0.6, pose: { spine: [0.08, 0, 0], upperArmL: [-0.55, 0, 0.3], upperArmR: [-0.55, 0, -0.3], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.25, 0, 0], thighR: [-0.1, 0, -0.12], shinR: [0.25, 0, 0], hipsY: -0.04, hipsZ: 0 }, ease: 'inout' },
  ],
});

// Charging a fireball: wide horse stance, hands cupping a sphere of fire.
registerClip({
  id: 'fire_charge',
  duration: 0.9,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.12, 0, 0], upperArmL: [-0.95, 0.5, -0.15], upperArmR: [-0.95, -0.5, 0.15], foreArmL: [-1.25, 0, 0], foreArmR: [-1.25, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], thighL: [-0.45, 0, 0.38], shinL: [0.75, 0, 0], thighR: [-0.45, 0, -0.38], shinR: [0.75, 0, 0], footL: [-0.25, 0, -0.2], footR: [-0.25, 0, 0.2], hipsY: -0.2 } },
    { t: 0.45, pose: { spine: [0.16, 0, 0], upperArmL: [-1.0, 0.55, -0.12], upperArmR: [-1.0, -0.55, 0.12], foreArmL: [-1.15, 0, 0], foreArmR: [-1.15, 0, 0], hipsY: -0.23 }, ease: 'inout' },
    { t: 0.9, pose: { spine: [0.12, 0, 0], upperArmL: [-0.95, 0.5, -0.15], upperArmR: [-0.95, -0.5, 0.15], foreArmL: [-1.25, 0, 0], foreArmR: [-1.25, 0, 0], hipsY: -0.2 }, ease: 'inout' },
  ],
});

// Low spinning sweep kick (flame sweep). Spin completes, then the pose rises; play with fadeOut ~0.
registerClip({
  id: 'fire_sweep',
  duration: 0.66,
  mask: 'full',
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.35, 0, 0], thighL: [-0.9, 0, 0.3], shinL: [1.5, 0, 0], thighR: [-0.9, 0, -0.3], shinR: [1.5, 0, 0], upperArmL: [-0.4, 0, 0.6], upperArmR: [-0.4, 0, -0.6], hipsY: -0.32 } },
    { t: 0.12, pose: { hips: [0, -1.4, 0], spine: [0.55, 0, 0.1], thighL: [-0.15, 0, 1.35], shinL: [0.05, 0, 0], footL: [0.3, 0, 0], thighR: [-1.25, 0, -0.25], shinR: [2.1, 0, 0], upperArmL: [-0.2, 0, 1.2], upperArmR: [0.4, 0, -0.9], foreArmL: [-0.3, 0, 0], foreArmR: [-0.6, 0, 0], hipsY: -0.55 }, ease: 'out' },
    { t: 0.3, pose: { hips: [0, -4.2, 0], spine: [0.55, 0, 0.1], thighL: [-0.15, 0, 1.35], shinL: [0.05, 0, 0], thighR: [-1.25, 0, -0.25], shinR: [2.1, 0, 0], hipsY: -0.55 } },
    { t: 0.4, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.45, 0, 0], thighL: [-0.7, 0, 0.4], shinL: [1.2, 0, 0], thighR: [-1.0, 0, -0.3], shinR: [1.6, 0, 0], hipsY: -0.42 }, ease: 'out' },
    { t: 0.66, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.1, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.25, 0, 0], footL: [0, 0, 0], thighR: [-0.15, 0, -0.12], shinR: [0.25, 0, 0], upperArmL: [-0.6, 0, 0.3], upperArmR: [-0.6, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], hipsY: -0.05 }, ease: 'inout' },
  ],
});

// Jet dash: low forward lean, fists driven back like thrusters.
registerClip({
  id: 'fire_dash',
  duration: 0.5,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.3, 0, 0], upperArmL: [0.4, 0, 0.3], upperArmR: [0.4, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], thighL: [-0.6, 0, 0.1], shinL: [0.9, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.6, 0, 0], hipsY: -0.15 } },
    { t: 0.06, pose: { spine: [0.75, 0, 0], head: [-0.5, 0, 0], upperArmL: [1.05, 0, 0.35], upperArmR: [1.05, 0, -0.35], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], thighL: [-0.5, 0, 0.1], shinL: [1.1, 0, 0], thighR: [0.55, 0, -0.1], shinR: [0.9, 0, 0], hipsY: -0.22 }, ease: 'out' },
    { t: 0.36, pose: { spine: [0.7, 0, 0], head: [-0.45, 0, 0], upperArmL: [1.0, 0, 0.35], upperArmR: [1.0, 0, -0.35] } },
    { t: 0.5, pose: { spine: [0.15, 0, 0], head: [0, 0, 0], upperArmL: [-0.6, 0, 0.3], upperArmR: [-0.6, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], thighL: [-0.3, 0, 0.12], shinL: [0.4, 0, 0], thighR: [-0.1, 0, -0.12], shinR: [0.3, 0, 0], hipsY: -0.06 }, ease: 'inout' },
  ],
});

// Airborne spinning kick with the right leg extended (ring of fire). One full turn.
registerClip({
  id: 'fire_spin_kick',
  duration: 0.62,
  mask: 'full',
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.2, 0, 0], thighL: [-1.0, 0, 0.1], shinL: [1.7, 0, 0], thighR: [-0.7, 0, -0.1], shinR: [1.4, 0, 0], upperArmL: [-0.5, 0, 0.5], upperArmR: [-0.5, 0, -0.5], hipsY: -0.1 } },
    { t: 0.1, pose: { hips: [0, 0.2, 0], spine: [-0.1, 0.2, 0], thighL: [-1.2, 0, 0.15], shinL: [2.0, 0, 0], thighR: [-0.35, 0, -1.45], shinR: [0.05, 0, 0], footR: [0.4, 0, 0], upperArmL: [-0.15, 0, 1.35], upperArmR: [-0.1, 0, -1.2], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], hipsY: 0 }, ease: 'out' },
    { t: 0.42, pose: { hips: [0, 2 * Math.PI, 0], spine: [-0.1, 0.2, 0], thighL: [-1.2, 0, 0.15], shinL: [2.0, 0, 0], thighR: [-0.35, 0, -1.45], shinR: [0.05, 0, 0] } },
    { t: 0.62, pose: { hips: [0, 2 * Math.PI, 0], spine: [0.1, 0, 0], thighL: [-0.2, 0, 0.12], shinL: [0.3, 0, 0], thighR: [-0.2, 0, -0.12], shinR: [0.3, 0, 0], footR: [0, 0, 0], upperArmL: [-0.6, 0, 0.3], upperArmR: [-0.6, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// Flamethrower stance: palms forward, braced (loops while channeling).
registerClip({
  id: 'fire_stream',
  duration: 0.5,
  mask: 'full',
  loop: true,
  keys: [
    { t: 0, pose: { spine: [0.2, 0, 0], upperArmL: [-1.5, 0.25, -0.12], upperArmR: [-1.5, -0.25, 0.12], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], handL: [-1.2, 0, 0], handR: [-1.2, 0, 0], thighL: [-0.6, 0, 0.25], shinL: [0.7, 0, 0], thighR: [0.35, 0, -0.22], shinR: [0.35, 0, 0], hipsY: -0.16, hipsZ: 0.06 } },
    { t: 0.25, pose: { spine: [0.22, 0, 0], upperArmL: [-1.52, 0.25, -0.1], upperArmR: [-1.52, -0.25, 0.1], hipsY: -0.17 }, ease: 'inout' },
    { t: 0.5, pose: { spine: [0.2, 0, 0], upperArmL: [-1.5, 0.25, -0.12], upperArmR: [-1.5, -0.25, 0.12], hipsY: -0.16 }, ease: 'inout' },
  ],
});

// Breath of fire: inhale (lean back, chest open) → exhale forward.
registerClip({
  id: 'fire_breath',
  duration: 1.7,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], hipsY: -0.05 } },
    { t: 0.36, pose: { spine: [-0.35, 0, 0], chest: [-0.15, 0, 0], head: [-0.35, 0, 0], upperArmL: [-0.2, 0, 1.0], upperArmR: [-0.2, 0, -1.0], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], thighL: [-0.3, 0, 0.3], shinL: [0.5, 0, 0], thighR: [-0.3, 0, -0.3], shinR: [0.5, 0, 0], hipsY: -0.1 }, ease: 'inout' },
    { t: 0.48, pose: { spine: [0.38, 0, 0], chest: [0.1, 0, 0], head: [-0.25, 0, 0], upperArmL: [0.45, 0, 0.35], upperArmR: [0.45, 0, -0.35], foreArmL: [-1.6, 0, 0], foreArmR: [-1.6, 0, 0], thighL: [-0.65, 0, 0.25], shinL: [0.75, 0, 0], thighR: [0.3, 0, -0.25], shinR: [0.4, 0, 0], hipsY: -0.2 }, ease: 'out' },
    { t: 1.35, pose: { spine: [0.42, 0, 0], chest: [0.12, 0, 0], head: [-0.3, 0, 0], hipsY: -0.22 } },
    { t: 1.7, pose: { spine: [0.08, 0, 0], chest: [0, 0, 0], head: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], thighL: [-0.15, 0, 0.12], shinL: [0.25, 0, 0], thighR: [-0.1, 0, -0.12], shinR: [0.25, 0, 0], hipsY: -0.04 }, ease: 'inout' },
  ],
});

// Explosive finisher: crouch, spring with both fists raised overhead (held through the leap).
registerClip({
  id: 'fire_leap',
  duration: 0.4,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.45, 0, 0], thighL: [-1.2, 0, 0.2], shinL: [1.9, 0, 0], thighR: [-1.1, 0, -0.2], shinR: [1.9, 0, 0], upperArmL: [0.6, 0, 0.4], upperArmR: [0.6, 0, -0.4], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], hipsY: -0.5 } },
    { t: 0.16, pose: { spine: [-0.25, 0, 0], head: [-0.2, 0, 0], thighL: [-0.9, 0, 0.12], shinL: [1.6, 0, 0], thighR: [-0.3, 0, -0.12], shinR: [1.2, 0, 0], upperArmL: [-2.85, 0, -0.12], upperArmR: [-2.85, 0, 0.12], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], hipsY: 0 }, ease: 'out' },
    { t: 0.4, pose: { spine: [-0.3, 0, 0], head: [-0.2, 0, 0], thighL: [-1.1, 0, 0.12], shinL: [1.8, 0, 0], thighR: [-0.5, 0, -0.12], shinR: [1.5, 0, 0], upperArmL: [-2.9, 0, -0.12], upperArmR: [-2.9, 0, 0.12], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0] } },
  ],
});

// Landing double-fist slam.
registerClip({
  id: 'fire_slam',
  duration: 0.7,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [-0.3, 0, 0], upperArmL: [-2.9, 0, -0.12], upperArmR: [-2.9, 0, 0.12], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], thighL: [-1.1, 0, 0.12], shinL: [1.8, 0, 0], thighR: [-0.5, 0, -0.12], shinR: [1.5, 0, 0] } },
    { t: 0.08, pose: { spine: [0.85, 0, 0], head: [-0.4, 0, 0], upperArmL: [-0.75, 0, -0.05], upperArmR: [-0.75, 0, 0.05], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], thighL: [-1.35, 0, 0.3], shinL: [2.0, 0, 0], thighR: [-0.9, 0, -0.3], shinR: [2.0, 0, 0], hipsY: -0.55 }, ease: 'in' },
    { t: 0.38, pose: { spine: [0.75, 0, 0], head: [-0.4, 0, 0], hipsY: -0.5 } },
    { t: 0.7, pose: { spine: [0.1, 0, 0], head: [0, 0, 0], upperArmL: [-0.6, 0, 0.3], upperArmR: [-0.6, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], thighL: [-0.2, 0, 0.12], shinL: [0.3, 0, 0], thighR: [-0.15, 0, -0.12], shinR: [0.3, 0, 0], hipsY: -0.05 }, ease: 'inout' },
  ],
});

// Lightning generation: slow circular arm sweeps gathering energy...
registerClip({
  id: 'fire_lightning_charge',
  duration: 0.9,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-0.3, 0, 0.4], upperArmR: [-0.3, 0, -0.4], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], thighL: [-0.4, 0, 0.3], shinL: [0.5, 0, 0], thighR: [0.2, 0, -0.3], shinR: [0.3, 0, 0], hipsY: -0.1 } },
    { t: 0.3, pose: { spine: [-0.05, 0.35, 0], upperArmL: [-2.3, 0, 0.5], upperArmR: [0.2, 0, -0.6], foreArmL: [-0.3, 0, 0], foreArmR: [-0.4, 0, 0], hipsY: -0.14 }, ease: 'inout' },
    { t: 0.6, pose: { spine: [-0.05, -0.35, 0], upperArmL: [0.2, 0, 0.6], upperArmR: [-2.3, 0, -0.5], foreArmL: [-0.4, 0, 0], foreArmR: [-0.3, 0, 0], hipsY: -0.16 }, ease: 'inout' },
    { t: 0.9, pose: { spine: [0.1, 0.4, 0], upperArmL: [0.5, 0, 0.5], upperArmR: [-1.2, 0, -0.3], foreArmL: [-0.3, 0, 0], foreArmR: [-1.4, 0, 0], thighL: [-0.6, 0, 0.3], shinL: [0.6, 0, 0], thighR: [0.4, 0, -0.3], shinR: [0.3, 0, 0], hipsY: -0.18 }, ease: 'inout' },
  ],
});

// ...then thrust two fingers forward to release the bolt.
registerClip({
  id: 'fire_lightning_release',
  duration: 0.75,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.1, 0.4, 0], upperArmL: [0.5, 0, 0.5], upperArmR: [-1.2, 0, -0.3], foreArmR: [-1.4, 0, 0], thighL: [-0.6, 0, 0.3], shinL: [0.6, 0, 0], thighR: [0.4, 0, -0.3], shinR: [0.3, 0, 0], hipsY: -0.18 } },
    { t: 0.06, pose: { spine: [0.15, 0.45, 0], chest: [0, 0.2, 0], upperArmR: [-1.6, 0, -0.02], foreArmR: [0, 0, 0], handR: [0.1, 0, 0], upperArmL: [0.7, 0, 0.75], foreArmL: [-0.2, 0, 0], thighL: [-0.85, 0, 0.3], shinL: [0.7, 0, 0], thighR: [0.55, 0, -0.3], shinR: [0.2, 0, 0], hipsY: -0.24, hipsZ: 0.1 }, ease: 'out' },
    { t: 0.4, pose: { spine: [0.15, 0.42, 0], upperArmR: [-1.58, 0, -0.02], foreArmR: [0, 0, 0] } },
    { t: 0.75, pose: { spine: [0.08, 0, 0], chest: [0, 0, 0], upperArmL: [-0.6, 0, 0.3], upperArmR: [-0.6, 0, -0.3], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], handR: [0, 0, 0], thighL: [-0.2, 0, 0.12], shinL: [0.3, 0, 0], thighR: [-0.1, 0, -0.12], shinR: [0.3, 0, 0], hipsY: -0.05, hipsZ: 0 }, ease: 'inout' },
  ],
});
