import { registerClip, type Pose } from '../character/Animator';

/**
 * Avatar State transformation clips. Conventions: src/character/Animator.ts header
 * (left = +X; upperArm -x swings forward, +z/-z raise sideways; hipsY in metres).
 */

const gather: Pose = {
  spine: [0.35, 0, 0], head: [0.35, 0, 0],
  upperArmL: [-0.5, 0, -0.1], upperArmR: [-0.5, 0, 0.1], foreArmL: [-1.9, 0, 0], foreArmR: [-1.9, 0, 0],
  thighL: [-0.5, 0, 0.15], thighR: [-0.5, 0, -0.15], shinL: [1.0, 0, 0], shinR: [1.0, 0, 0],
  hipsY: -0.28, fistL: 1, fistR: 1,
};

const burst: Pose = {
  spine: [-0.3, 0, 0], head: [-0.4, 0, 0],
  upperArmL: [-0.25, 0, 1.35], upperArmR: [-0.25, 0, -1.35], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], handL: [0, 0, 0.3], handR: [0, 0, -0.3],
  thighL: [-0.08, 0, 0.22], thighR: [-0.08, 0, -0.22], shinL: [0.15, 0, 0], shinR: [0.15, 0, 0], footL: [0.4, 0, 0], footR: [0.4, 0, 0],
  hipsY: 0.1, fistL: 0, fistR: 0,
};

const settle: Pose = {
  spine: [0, 0, 0], head: [0, 0, 0],
  upperArmL: [-0.15, 0, 0.45], upperArmR: [-0.15, 0, -0.45], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0],
  thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0],
  hipsY: 0, fistL: 0, fistR: 0,
};

const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'fistL', 'fistR']);
const upper = (p: Pose): Pose => Object.fromEntries(Object.entries(p).filter(([k]) => UPPER.has(k))) as Pose;

registerClip({
  id: 'avatar_awaken',
  duration: 0.75,
  mask: 'full',
  desc: 'Standard Avatar State entry: quick gather, then rise onto the toes (levitation) with arms flung wide. "release" = the energy wave.',
  events: [{ t: 0.3, name: 'release' }],
  keys: [
    { t: 0, pose: { ...gather, hipsY: -0.1, spine: [0.15, 0, 0], head: [0.1, 0, 0], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0], fistL: 0.6, fistR: 0.6 } },
    { t: 0.22, pose: gather, ease: 'in' },
    { t: 0.32, pose: burst, ease: 'back' },
    { t: 0.75, pose: settle, ease: 'inout' },
  ],
});

registerClip({
  id: 'avatar_awaken_upper',
  duration: 0.7,
  mask: 'upper',
  desc: 'Avatar State entry while moving: upper body only (the legs keep running).',
  events: [{ t: 0.28, name: 'release' }],
  keys: [
    { t: 0, pose: upper({ ...gather, spine: [0.15, 0, 0], head: [0.1, 0, 0] }) },
    { t: 0.2, pose: upper(gather), ease: 'in' },
    { t: 0.3, pose: upper(burst), ease: 'back' },
    { t: 0.7, pose: upper(settle), ease: 'inout' },
  ],
});

registerClip({
  id: 'avatar_sphere_awaken',
  duration: 1.6,
  mask: 'full',
  desc: 'Elements Sphere entry: deep gather, burst, then the arms draw the four elements up and around before settling into a ready stance.',
  events: [{ t: 0.5, name: 'release' }],
  keys: [
    { t: 0, pose: { ...gather, hipsY: -0.08, spine: [0.2, 0, 0], foreArmL: [-1.3, 0, 0], foreArmR: [-1.3, 0, 0] } },
    { t: 0.42, pose: { ...gather, hipsY: -0.34, upperArmL: [-0.9, 0, -0.35], upperArmR: [-0.9, 0, 0.35], foreArmL: [-2.2, 0, 0], foreArmR: [-2.2, 0, 0] }, ease: 'inout' },
    { t: 0.52, pose: { ...burst, hipsY: 0.14 }, ease: 'back' },
    { t: 0.95, pose: { ...burst, upperArmL: [-2.4, 0, 0.7], upperArmR: [-2.4, 0, -0.7], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], spine: [-0.22, 0, 0], head: [-0.25, 0, 0], hipsY: 0.16 }, ease: 'inout' },
    { t: 1.25, pose: { ...burst, upperArmL: [-0.9, 0, 1.1], upperArmR: [-0.9, 0, -1.1], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], hipsY: 0.1 }, ease: 'inout' },
    { t: 1.6, pose: { ...settle, upperArmL: [-0.25, 0, 0.5], upperArmR: [-0.25, 0, -0.5], foreArmL: [-0.55, 0, 0], foreArmR: [-0.55, 0, 0] }, ease: 'inout' },
  ],
});
