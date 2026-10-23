import { registerClip } from './Animator';

/**
 * Shared base clips (reactions, movement accents, social). Technique-specific
 * clips are registered next to their techniques.
 * See Animator.ts header for pose conventions.
 */

registerClip({
  id: 'jump_start',
  duration: 0.25,
  mask: 'arms',
  keys: [
    { t: 0, pose: { upperArmL: [-0.6, 0, 0.5], upperArmR: [-0.6, 0, -0.5] } },
    { t: 0.25, pose: { upperArmL: [-0.4, 0, 0.7], upperArmR: [-0.4, 0, -0.7] }, ease: 'out' },
  ],
});

const dodge = (id: string, spin: number, low: number) =>
  registerClip({
    id,
    duration: 0.38,
    mask: 'full',
    keys: [
      { t: 0, pose: { spine: [0.3, spin * 0.3, 0], thighL: [-0.8, 0, 0.1], thighR: [0.4, 0, -0.1], shinL: [0.9, 0, 0], shinR: [0.6, 0, 0], upperArmL: [0.6, 0, 0.6], upperArmR: [0.6, 0, -0.6], hipsY: -low } },
      { t: 0.19, pose: { spine: [0.45, spin, 0], thighL: [-1.1, 0, 0.2], thighR: [0.2, 0, -0.2], shinL: [1.4, 0, 0], shinR: [1.2, 0, 0], hipsY: -low * 1.4 }, ease: 'out' },
      { t: 0.38, pose: { spine: [0.1, 0, 0], thighL: [-0.2, 0, 0.05], thighR: [-0.1, 0, -0.05], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0], hipsY: 0 }, ease: 'inout' },
    ],
  });
dodge('dodge_air', 2.2, 0.1);
dodge('dodge_water', 1.2, 0.25);
dodge('dodge_earth', 0.3, 0.35);
dodge('dodge_fire', 0.6, 0.2);

registerClip({
  id: 'knockdown',
  duration: 0.6,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [-0.3, 0, 0], hipsY: 0 } },
    { t: 0.3, pose: { spine: [-1.2, 0, 0], head: [-0.3, 0, 0], thighL: [-1.2, 0, 0.2], thighR: [-0.9, 0, -0.2], shinL: [0.6, 0, 0], shinR: [0.9, 0, 0], upperArmL: [-0.3, 0, 1.2], upperArmR: [-0.3, 0, -1.2], hipsY: -0.75 }, ease: 'in' },
    { t: 0.6, pose: { spine: [-1.45, 0, 0], head: [-0.2, 0, 0], thighL: [-1.4, 0, 0.25], thighR: [-1.3, 0, -0.25], shinL: [0.3, 0, 0], shinR: [0.5, 0, 0], upperArmL: [-0.2, 0, 1.4], upperArmR: [-0.2, 0, -1.4], hipsY: -0.82 }, ease: 'out' },
  ],
});

registerClip({
  id: 'getup',
  duration: 0.7,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [-1.4, 0, 0], thighL: [-1.4, 0, 0.25], thighR: [-1.3, 0, -0.25], hipsY: -0.82 } },
    { t: 0.35, pose: { spine: [0.6, 0, 0], thighL: [-1.6, 0, 0.2], thighR: [-0.4, 0, -0.2], shinL: [2.0, 0, 0], shinR: [1.6, 0, 0], hipsY: -0.55 }, ease: 'inout' },
    { t: 0.7, pose: { spine: [0, 0, 0], thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0], hipsY: 0 }, ease: 'out' },
  ],
});

registerClip({
  id: 'avatar_activate',
  duration: 0.9,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.2, 0, 0], upperArmL: [-0.2, 0, 0.2], upperArmR: [-0.2, 0, -0.2], hipsY: -0.1 } },
    { t: 0.3, pose: { spine: [0.35, 0, 0], head: [0.4, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-1.4, 0, 0], foreArmR: [-1.4, 0, 0], thighL: [-0.4, 0, 0.25], thighR: [-0.4, 0, -0.25], shinL: [0.8, 0, 0], shinR: [0.8, 0, 0], hipsY: -0.3 }, ease: 'in' },
    { t: 0.55, pose: { spine: [-0.35, 0, 0], head: [-0.45, 0, 0], upperArmL: [-0.2, 0, 1.3], upperArmR: [-0.2, 0, -1.3], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], thighL: [-0.1, 0, 0.3], thighR: [-0.1, 0, -0.3], shinL: [0.1, 0, 0], shinR: [0.1, 0, 0], hipsY: 0.15 }, ease: 'back' },
    { t: 0.9, pose: { spine: [0, 0, 0], head: [0, 0, 0], upperArmL: [-0.1, 0, 0.5], upperArmR: [-0.1, 0, -0.5], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

registerClip({
  id: 'interact',
  duration: 0.6,
  mask: 'armR',
  keys: [
    { t: 0, pose: { upperArmR: [0, 0, 0], foreArmR: [0, 0, 0] } },
    { t: 0.25, pose: { upperArmR: [-1.0, 0, -0.1], foreArmR: [-0.4, 0, 0] }, ease: 'out' },
    { t: 0.6, pose: { upperArmR: [0, 0, 0], foreArmR: [-0.2, 0, 0] }, ease: 'inout' },
  ],
});

registerClip({
  id: 'bow',
  duration: 1.2,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [0, 0, 0], upperArmL: [-0.4, 0.4, 0.2], upperArmR: [-0.4, -0.4, -0.2], foreArmL: [-1.6, 0, 0], foreArmR: [-1.6, 0, 0] } },
    { t: 0.4, pose: { spine: [0.6, 0, 0], head: [0.3, 0, 0], upperArmL: [-0.6, 0.4, 0.2], upperArmR: [-0.6, -0.4, -0.2], foreArmL: [-1.7, 0, 0], foreArmR: [-1.7, 0, 0] }, ease: 'inout' },
    { t: 1.2, pose: { spine: [0, 0, 0], head: [0, 0, 0], upperArmL: [0, 0, 0.1], upperArmR: [0, 0, -0.1], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0] }, ease: 'inout' },
  ],
});

registerClip({
  id: 'npc_gesture',
  duration: 1.6,
  mask: 'arms',
  keys: [
    { t: 0, pose: { upperArmR: [0, 0, -0.1], foreArmR: [-0.2, 0, 0] } },
    { t: 0.4, pose: { upperArmR: [-0.7, 0.3, -0.4], foreArmR: [-1.1, 0, 0] }, ease: 'out' },
    { t: 1.0, pose: { upperArmR: [-0.6, -0.2, -0.3], foreArmR: [-1.0, 0, 0] }, ease: 'inout' },
    { t: 1.6, pose: { upperArmR: [0, 0, -0.1], foreArmR: [-0.2, 0, 0] }, ease: 'inout' },
  ],
});

/** Generic element practice forms used by students/masters (replaced by richer forms in the combat module). */
const form = (id: string, a: number, b: number) =>
  registerClip({
    id,
    duration: 1.4,
    mask: 'full',
    keys: [
      { t: 0, pose: { upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3] } },
      { t: 0.5, pose: { spine: [0.1, a, 0], upperArmL: [-1.4, 0, 0.2], upperArmR: [-0.2, 0, -0.6], foreArmL: [-0.2, 0, 0], foreArmR: [-1.2, 0, 0], thighL: [-0.6, 0, 0.2], shinL: [0.6, 0, 0], hipsY: -0.12 }, ease: 'out' },
      { t: 1.0, pose: { spine: [0.1, b, 0], upperArmL: [-0.2, 0, 0.6], upperArmR: [-1.4, 0, -0.2], foreArmL: [-1.2, 0, 0], foreArmR: [-0.2, 0, 0], thighR: [-0.6, 0, -0.2], shinR: [0.6, 0, 0], hipsY: -0.12 }, ease: 'inout' },
      { t: 1.4, pose: { spine: [0, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], hipsY: 0 }, ease: 'inout' },
    ],
  });
form('air_form', 0.8, -0.8);
form('water_form', 0.5, -0.5);
form('earth_form', 0.2, -0.2);
form('fire_form', 0.4, -0.4);
