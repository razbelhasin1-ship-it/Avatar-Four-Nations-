import { registerClip } from '../../../character/Animator';

/**
 * Ultimate (Elements Sphere) cast clips. Conventions: src/character/Animator.ts
 * header. Each has a "release" event matching its technique's windup.
 */

// Hurricane: arms wheel overhead (spinning the sky), then fling the storm forward.
registerClip({
  id: 'ult_hurricane_cast',
  duration: 1.0,
  mask: 'full',
  desc: 'Hurricane: both arms wheel up overhead with a torso twist, then sweep forward and wide to hurl the storm.',
  events: [{ t: 0.55, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.1, -0.3, 0], upperArmL: [-0.4, 0, 0.5], upperArmR: [-0.4, 0, -0.5], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], thighL: [-0.2, 0, 0.12], thighR: [0.15, 0, -0.12], shinL: [0.35, 0, 0], hipsY: -0.06 } },
    { t: 0.3, pose: { spine: [-0.25, 0.45, 0], head: [-0.25, 0, 0], upperArmL: [-2.7, 0, 0.45], upperArmR: [-2.5, 0, -0.6], foreArmL: [-0.4, 0, 0], foreArmR: [-0.5, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], thighL: [-0.1, 0, 0.18], thighR: [0.1, 0, -0.18], shinL: [0.15, 0, 0], hipsY: 0.06 }, ease: 'inout' },
    { t: 0.55, pose: { spine: [0.15, -0.35, 0], head: [0.05, 0, 0], upperArmL: [-1.75, 0, 0.95], upperArmR: [-1.75, 0, -0.95], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [-1.1, 0, 0], handR: [-1.1, 0, 0], thighL: [-0.6, 0, 0.15], shinL: [0.6, 0, 0], thighR: [0.35, 0, -0.12], shinR: [0.2, 0, 0], hipsY: -0.12, hipsZ: 0.12 }, ease: 'back' },
    { t: 1.0, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.4, 0, 0.35], upperArmR: [-0.4, 0, -0.35], foreArmL: [-0.7, 0, 0], foreArmR: [-0.7, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [0, 0, 0], shinL: [0, 0, 0], thighR: [0, 0, 0], shinR: [0, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// Tsunami: crouch and scoop low with both arms, rise and heave the wall forward and up.
registerClip({
  id: 'ult_tsunami_cast',
  duration: 1.15,
  mask: 'full',
  desc: 'Tsunami: deep crouch scooping both arms low, then rise into a lunge heaving both arms forward and up.',
  events: [{ t: 0.6, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.3, 0, 0], upperArmL: [0.55, 0, 0.3], upperArmR: [0.55, 0, -0.3], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], thighL: [-0.45, 0, 0.15], thighR: [0.3, 0, -0.15], shinL: [0.7, 0, 0], shinR: [0.35, 0, 0], hipsY: -0.16 } },
    { t: 0.4, pose: { spine: [0.6, 0, 0], head: [0.1, 0, 0], upperArmL: [-0.35, 0, 0.2], upperArmR: [-0.35, 0, -0.2], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], handL: [0.5, 0, 0], handR: [0.5, 0, 0], thighL: [-0.75, 0, 0.2], thighR: [0.2, 0, -0.2], shinL: [1.2, 0, 0], shinR: [0.9, 0, 0], hipsY: -0.36 }, ease: 'inout' },
    { t: 0.6, pose: { spine: [-0.22, 0, 0], head: [-0.25, 0, 0], upperArmL: [-2.25, 0, 0.35], upperArmR: [-2.25, 0, -0.35], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [-0.9, 0, 0], handR: [-0.9, 0, 0], thighL: [-0.75, 0, 0.15], shinL: [0.55, 0, 0], thighR: [0.45, 0, -0.1], shinR: [0.2, 0, 0], hipsY: 0.02, hipsZ: 0.22 }, ease: 'back' },
    { t: 1.15, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [0, 0, 0], shinL: [0, 0, 0], thighR: [0, 0, 0], shinR: [0, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// Earthquake: knee high and arms up, then stomp into a wide squat and slam both fists down.
registerClip({
  id: 'ult_earthquake_cast',
  duration: 1.1,
  mask: 'full',
  desc: 'Earthquake: raise the right knee high with both arms overhead, then stomp into a wide squat slamming both fists toward the ground.',
  events: [{ t: 0.55, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.05, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3], fistL: 0.8, fistR: 0.8 } },
    { t: 0.35, pose: { spine: [-0.22, 0, 0], head: [-0.15, 0, 0], upperArmL: [-2.5, 0, 0.55], upperArmR: [-2.5, 0, -0.55], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], thighR: [-1.6, 0, -0.1], shinR: [1.7, 0, 0], thighL: [0, 0, 0.05], shinL: [0.1, 0, 0], hipsY: 0.06, fistL: 1, fistR: 1 }, ease: 'out' },
    { t: 0.55, pose: { spine: [0.75, 0, 0], head: [0.2, 0, 0], upperArmL: [-1.15, 0, 0.3], upperArmR: [-1.15, 0, -0.3], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], thighL: [-0.65, 0, 0.42], thighR: [-0.65, 0, -0.42], shinL: [1.0, 0, 0], shinR: [1.0, 0, 0], hipsY: -0.46, fistL: 1, fistR: 1 }, ease: 'in' },
    { t: 0.75, pose: { spine: [0.7, 0, 0], upperArmL: [-1.1, 0, 0.32], upperArmR: [-1.1, 0, -0.32], thighL: [-0.62, 0, 0.42], thighR: [-0.62, 0, -0.42], shinL: [0.95, 0, 0], shinR: [0.95, 0, 0], hipsY: -0.44 } },
    { t: 1.1, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.3, 0, 0.3], upperArmR: [-0.3, 0, -0.3], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0], hipsY: 0, fistL: 0.3, fistR: 0.3 }, ease: 'inout' },
  ],
});

// Fire Tornado: a full spin with arms out (play with fadeOut ~0: ends at -2π), then a double punch.
registerClip({
  id: 'ult_fire_tornado_cast',
  duration: 0.95,
  mask: 'full',
  desc: 'Fire Tornado: full spin with blazing arms out wide, finishing in a planted double punch that sends the column forward.',
  events: [{ t: 0.55, name: 'release' }],
  keys: [
    { t: 0, pose: { hips: [0, 0, 0], spine: [0.1, 0.6, 0], upperArmL: [-1.2, 0, -0.2], upperArmR: [-1.2, 0, 0.2], foreArmL: [-1.5, 0, 0], foreArmR: [-1.5, 0, 0], fistL: 1, fistR: 1, hipsY: -0.08 } },
    { t: 0.28, pose: { hips: [0, -Math.PI, 0], spine: [0, 0, 0], upperArmL: [-0.2, 0, 1.4], upperArmR: [-0.2, 0, -1.4], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], thighL: [-0.4, 0, 0.1], shinL: [0.7, 0, 0], hipsY: 0.04 }, ease: 'linear' },
    { t: 0.55, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.22, 0, 0], upperArmL: [-1.55, 0, 0.1], upperArmR: [-1.55, 0, -0.1], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], thighL: [-0.65, 0, 0.12], shinL: [0.65, 0, 0], thighR: [0.4, 0, -0.1], shinR: [0.22, 0, 0], hipsY: -0.14, hipsZ: 0.12, fistL: 1, fistR: 1 }, ease: 'out' },
    { t: 0.95, pose: { hips: [0, -2 * Math.PI, 0], spine: [0.05, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], thighL: [-0.05, 0, 0.05], shinL: [0.1, 0, 0], thighR: [-0.05, 0, -0.05], shinR: [0.1, 0, 0], hipsY: 0, hipsZ: 0, fistL: 0.5, fistR: 0.5 }, ease: 'inout' },
  ],
});

// Cataclysm: gather all four elements while rising, compress into a tuck, then explode outward.
registerClip({
  id: 'ult_cataclysm_cast',
  duration: 2.3,
  mask: 'full',
  desc: 'Avatar Cataclysm: rise drawing the elements in with wide circling arms, compress into a tuck, then explode outward spread-eagle.',
  events: [{ t: 1.6, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.35, 0, 0], head: [0.2, 0, 0], upperArmL: [-0.3, 0, 0.2], upperArmR: [-0.3, 0, -0.2], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], thighL: [-0.4, 0, 0.12], thighR: [-0.4, 0, -0.12], shinL: [0.8, 0, 0], shinR: [0.8, 0, 0], hipsY: -0.2 } },
    { t: 0.6, pose: { spine: [-0.1, 0, 0], head: [-0.1, 0, 0], upperArmL: [-0.3, 0, 1.3], upperArmR: [-0.3, 0, -1.3], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], thighL: [-0.1, 0, 0.15], thighR: [-0.1, 0, -0.15], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0], footL: [0.5, 0, 0], footR: [0.5, 0, 0], hipsY: 0.1 }, ease: 'inout' },
    { t: 1.1, pose: { spine: [-0.25, 0, 0], head: [-0.3, 0, 0], upperArmL: [-2.85, 0, 0.3], upperArmR: [-2.85, 0, -0.3], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], hipsY: 0.12 }, ease: 'inout' },
    { t: 1.45, pose: { spine: [0.5, 0, 0], head: [0.35, 0, 0], upperArmL: [-1.0, 0, -0.3], upperArmR: [-1.0, 0, 0.3], foreArmL: [-2.2, 0, 0], foreArmR: [-2.2, 0, 0], thighL: [-1.0, 0, 0.2], thighR: [-1.0, 0, -0.2], shinL: [1.7, 0, 0], shinR: [1.7, 0, 0], footL: [0.3, 0, 0], footR: [0.3, 0, 0], hipsY: 0.12, fistL: 1, fistR: 1 }, ease: 'in' },
    { t: 1.6, pose: { spine: [-0.42, 0, 0], head: [-0.5, 0, 0], upperArmL: [-0.4, 0, 1.5], upperArmR: [-0.4, 0, -1.5], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [0, 0, 0.4], handR: [0, 0, -0.4], thighL: [-0.2, 0, 0.45], thighR: [-0.2, 0, -0.45], shinL: [0.1, 0, 0], shinR: [0.1, 0, 0], footL: [0.4, 0, 0], footR: [0.4, 0, 0], hipsY: 0.15, fistL: 0, fistR: 0 }, ease: 'back' },
    { t: 2.3, pose: { spine: [0.05, 0, 0], head: [0, 0, 0], upperArmL: [-0.3, 0, 0.4], upperArmR: [-0.3, 0, -0.4], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});
