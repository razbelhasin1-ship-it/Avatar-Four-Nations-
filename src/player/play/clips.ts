import { registerClip } from '../../character/Animator';

/**
 * Poses for playful (non-combat) bending: holding a water orb or a lifted rock at three
 * heights (the held object follows the camera pitch, the arms follow the object) and a
 * Firebender's open right palm. Upper-body / right-arm masks, so walking keeps working.
 * Conventions: see the top of character/Animator.ts.
 */

// ---- Water: palms toward the orb, arms flowing in slow circles --------------------
const waterHold = (id: string, arm: number, fore: number, wrist: number, spine: number, head: number): void => {
  registerClip({
    id,
    duration: 2.4,
    loop: true,
    mask: 'upper',
    desc: 'Waterbender holding a floating orb of water in front (looped, flowing).',
    keys: [
      { t: 0, pose: { spine: [spine, 0.06, 0], head: [head, 0, 0], upperArmL: [arm + 0.06, 0, 0.34], upperArmR: [arm - 0.06, 0, -0.26], foreArmL: [fore + 0.08, 0, 0], foreArmR: [fore - 0.06, 0, 0], handL: [wrist, 0, 0.12], handR: [wrist - 0.08, 0, -0.08], fistL: 0.05, fistR: 0.05 } },
      { t: 1.2, pose: { spine: [spine, -0.06, 0], head: [head, 0, 0], upperArmL: [arm - 0.06, 0, 0.26], upperArmR: [arm + 0.06, 0, -0.34], foreArmL: [fore - 0.06, 0, 0], foreArmR: [fore + 0.08, 0, 0], handL: [wrist - 0.08, 0, 0.08], handR: [wrist, 0, -0.12], fistL: 0.05, fistR: 0.05 }, ease: 'inout' },
      { t: 2.4, pose: { spine: [spine, 0.06, 0], head: [head, 0, 0], upperArmL: [arm + 0.06, 0, 0.34], upperArmR: [arm - 0.06, 0, -0.26], foreArmL: [fore + 0.08, 0, 0], foreArmR: [fore - 0.06, 0, 0], handL: [wrist, 0, 0.12], handR: [wrist - 0.08, 0, -0.08], fistL: 0.05, fistR: 0.05 }, ease: 'inout' },
    ],
  });
};
waterHold('play_water_hold_low', -0.8, -0.55, -0.85, 0.2, 0.18);
waterHold('play_water_hold', -1.28, -0.5, -0.6, 0.06, 0);
waterHold('play_water_hold_high', -2.2, -0.35, -0.35, -0.06, -0.3);

// ---- Earth: a low, rooted lift, then fists holding the stone up ---------------------
registerClip({
  id: 'play_earth_lift',
  duration: 0.62,
  mask: 'full',
  desc: 'Earthbender sinks into a wide stance, palms low, then heaves both fists up to raise a rock.',
  events: [{ t: 0.24, name: 'lift' }],
  keys: [
    { t: 0, pose: { hipsY: -0.08, spine: [0.22, 0, 0], thighL: [-0.2, 0, 0.22], thighR: [0.08, 0, -0.22], shinL: [0.32, 0, 0], shinR: [0.26, 0, 0], upperArmL: [-0.45, 0, 0.32], upperArmR: [-0.45, 0, -0.32], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], handL: [0.5, 0, 0], handR: [0.5, 0, 0], fistL: 0.15, fistR: 0.15 } },
    { t: 0.24, pose: { hipsY: -0.2, spine: [0.34, 0, 0], thighL: [-0.38, 0, 0.3], thighR: [0.12, 0, -0.3], shinL: [0.62, 0, 0], shinR: [0.48, 0, 0], upperArmL: [-0.2, 0, 0.36], upperArmR: [-0.2, 0, -0.36], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0], handL: [0.7, 0, 0], handR: [0.7, 0, 0], fistL: 0.3, fistR: 0.3 }, ease: 'out' },
    { t: 0.62, pose: { hipsY: -0.05, spine: [0.04, 0, 0], thighL: [-0.12, 0, 0.16], thighR: [0.04, 0, -0.16], shinL: [0.16, 0, 0], shinR: [0.12, 0, 0], upperArmL: [-1.45, 0, 0.4], upperArmR: [-1.45, 0, -0.4], foreArmL: [-0.55, 0, 0], foreArmR: [-0.55, 0, 0], handL: [-0.15, 0, 0], handR: [-0.15, 0, 0], fistL: 0.8, fistR: 0.8 }, ease: 'back' },
  ],
});

const earthHold = (id: string, arm: number, fore: number, spine: number, head: number): void => {
  registerClip({
    id,
    duration: 2.0,
    loop: true,
    mask: 'upper',
    desc: 'Earthbender holding a lifted rock aloft with tense fists (looped).',
    keys: [
      { t: 0, pose: { spine: [spine, 0.04, 0], head: [head, 0, 0], upperArmL: [arm, 0, 0.42], upperArmR: [arm, 0, -0.42], foreArmL: [fore, 0, 0], foreArmR: [fore, 0, 0], handL: [-0.2, 0, 0], handR: [-0.2, 0, 0], fistL: 0.8, fistR: 0.8 } },
      { t: 1.0, pose: { spine: [spine + 0.03, -0.04, 0], head: [head, 0, 0], upperArmL: [arm - 0.08, 0, 0.38], upperArmR: [arm - 0.08, 0, -0.38], foreArmL: [fore - 0.1, 0, 0], foreArmR: [fore - 0.1, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], fistL: 0.85, fistR: 0.85 }, ease: 'inout' },
      { t: 2.0, pose: { spine: [spine, 0.04, 0], head: [head, 0, 0], upperArmL: [arm, 0, 0.42], upperArmR: [arm, 0, -0.42], foreArmL: [fore, 0, 0], foreArmR: [fore, 0, 0], handL: [-0.2, 0, 0], handR: [-0.2, 0, 0], fistL: 0.8, fistR: 0.8 }, ease: 'inout' },
    ],
  });
};
earthHold('play_earth_hold_low', -0.85, -0.45, 0.2, 0.18);
earthHold('play_earth_hold', -1.4, -0.5, 0.05, 0);
earthHold('play_earth_hold_high', -2.3, -0.3, -0.05, -0.3);

// ---- Earth: release — open hands pushing down as the rock is let go ----------------
registerClip({
  id: 'play_earth_drop',
  duration: 0.45,
  mask: 'upper',
  desc: 'Earthbender opens the fists and lowers the arms, letting a lifted rock fall.',
  keys: [
    { t: 0, pose: { upperArmL: [-1.3, 0, 0.4], upperArmR: [-1.3, 0, -0.4], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], fistL: 0.2, fistR: 0.2 } },
    { t: 0.45, pose: { upperArmL: [-0.35, 0, 0.2], upperArmR: [-0.35, 0, -0.2], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], handL: [0.4, 0, 0], handR: [0.4, 0, 0], fistL: 0.1, fistR: 0.1 }, ease: 'out' },
  ],
});

// ---- Fire: right forearm forward, palm turned up, a small flame cupped in it --------
registerClip({
  id: 'play_fire_palm',
  duration: 2.6,
  loop: true,
  mask: 'armR',
  desc: 'Firebender holding a small flame in the open right palm (forearm forward, palm up; looped breathing).',
  keys: [
    { t: 0, pose: { upperArmR: [-0.42, 0, -0.2], foreArmR: [-1.5, -1.3, 0], handR: [-0.12, -0.27, 0], fistR: 0.18 } },
    { t: 1.3, pose: { upperArmR: [-0.5, 0, -0.23], foreArmR: [-1.42, -1.3, 0], handR: [-0.18, -0.27, 0], fistR: 0.22 }, ease: 'inout' },
    { t: 2.6, pose: { upperArmR: [-0.42, 0, -0.2], foreArmR: [-1.5, -1.3, 0], handR: [-0.12, -0.27, 0], fistR: 0.18 }, ease: 'inout' },
  ],
});
