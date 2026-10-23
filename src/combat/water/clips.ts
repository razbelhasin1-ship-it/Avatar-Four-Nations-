import { registerClip, type Pose } from '../../character/Animator';

/**
 * Waterbending animation clips (self-contained; see Animator.ts for the pose
 * conventions). Waterbending forms are circular and flowing: weight shifts,
 * torso twists that carry the arms, and wide arcs rather than straight jabs.
 *
 *   spine/chest: +x bend forward, +y twist to the character's LEFT
 *   upperArm: -x swing forward (-PI/2 forward, -PI up); L +z / R -z = outward
 *   foreArm: -x bend elbow · thigh: -x forward, L +z / R -z outward · shin: +x bend
 */

const mirror = (p: Pose): Pose => {
  const out: Pose = {};
  const swap: Record<string, string> = {
    upperArmL: 'upperArmR', upperArmR: 'upperArmL', foreArmL: 'foreArmR', foreArmR: 'foreArmL', handL: 'handR', handR: 'handL',
    thighL: 'thighR', thighR: 'thighL', shinL: 'shinR', shinR: 'shinL', footL: 'footR', footR: 'footL', shoulderL: 'shoulderR', shoulderR: 'shoulderL',
  };
  for (const [k, v] of Object.entries(p)) {
    if (k === 'hipsY' || k === 'hipsZ') {
      (out as Record<string, number>)[k] = v as number;
      continue;
    }
    const e = v as [number, number, number];
    const name = swap[k] ?? k;
    (out as Record<string, [number, number, number]>)[name] = [e[0], -e[1], -e[2]];
  }
  return out;
};

// ---- Water Whip 1: right-hand forehand lash (right → left) -------------------
const whipR: Pose[] = [
  { spine: [0.06, -0.5, 0], chest: [0, -0.22, 0], upperArmR: [-0.35, 0, -1.15], foreArmR: [-0.85, 0, 0], handR: [0.2, 0, 0], upperArmL: [-0.95, 0, 0.35], foreArmL: [-1.05, 0, 0] },
  { spine: [0.14, 0.38, 0], chest: [0.05, 0.22, 0], upperArmR: [-1.5, 0, 0.5], foreArmR: [-0.12, 0, 0], handR: [-0.2, 0, 0], upperArmL: [0.25, 0, 0.65], foreArmL: [-0.55, 0, 0] },
  { spine: [0.05, 0.08, 0], chest: [0, 0.02, 0], upperArmR: [-0.65, 0, -0.3], foreArmR: [-0.85, 0, 0], handR: [0, 0, 0], upperArmL: [-0.5, 0, 0.32], foreArmL: [-0.8, 0, 0] },
];
registerClip({
  id: 'water_whip_r',
  duration: 0.5,
  mask: 'upper',
  events: [{ t: 0.12, name: 'release' }],
  keys: [
    { t: 0, pose: whipR[0] },
    { t: 0.12, pose: whipR[1], ease: 'out' },
    { t: 0.5, pose: whipR[2], ease: 'inout' },
  ],
});

// ---- Water Whip 2: left-hand backhand lash (left → right) --------------------
registerClip({
  id: 'water_whip_l',
  duration: 0.5,
  mask: 'upper',
  events: [{ t: 0.12, name: 'release' }],
  keys: [
    { t: 0, pose: mirror(whipR[0]) },
    { t: 0.12, pose: mirror(whipR[1]), ease: 'out' },
    { t: 0.5, pose: mirror(whipR[2]), ease: 'inout' },
  ],
});

// ---- Water Whip 3: two-handed overhead crack -----------------------------------
registerClip({
  id: 'water_whip_slam',
  duration: 0.72,
  mask: 'full',
  events: [{ t: 0.2, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [-0.28, 0, 0], chest: [-0.1, 0, 0], upperArmL: [-2.75, 0, 0.28], upperArmR: [-2.75, 0, -0.28], foreArmL: [-0.45, 0, 0], foreArmR: [-0.45, 0, 0], thighL: [-0.12, 0, 0.12], thighR: [0.12, 0, -0.12], shinL: [0.1, 0, 0], shinR: [0.15, 0, 0], hipsY: 0.03 } },
    { t: 0.2, pose: { spine: [0.52, 0, 0], chest: [0.16, 0, 0], upperArmL: [-1.05, 0, 0.16], upperArmR: [-1.05, 0, -0.16], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], thighL: [-0.78, 0, 0.14], shinL: [0.62, 0, 0], thighR: [0.36, 0, -0.1], shinR: [0.4, 0, 0], hipsY: -0.24, hipsZ: 0.08 }, ease: 'in' },
    { t: 0.72, pose: { spine: [0.08, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.7, 0, 0], foreArmR: [-0.7, 0, 0], thighL: [-0.12, 0, 0.1], shinL: [0.15, 0, 0], thighR: [0, 0, -0.1], shinR: [0.15, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// ---- Freezing Strike: snapping lash ending in a palm thrust --------------------
registerClip({
  id: 'water_freeze_strike',
  duration: 0.6,
  mask: 'upper',
  events: [{ t: 0.16, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.05, -0.6, 0], chest: [0, -0.25, 0], upperArmR: [0.2, 0, -0.9], foreArmR: [-1.6, 0, 0], upperArmL: [-1.1, 0, 0.25], foreArmL: [-0.4, 0, 0], handL: [-0.5, 0, 0] } },
    { t: 0.16, pose: { spine: [0.18, 0.3, 0], chest: [0.08, 0.15, 0], upperArmR: [-1.62, 0, 0.08], foreArmR: [-0.02, 0, 0], handR: [-0.9, 0, 0], upperArmL: [0.2, 0, 0.5], foreArmL: [-0.9, 0, 0] }, ease: 'out' },
    { t: 0.6, pose: { spine: [0.05, 0.05, 0], chest: [0, 0, 0], upperArmR: [-0.6, 0, -0.25], foreArmR: [-0.8, 0, 0], handR: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], foreArmL: [-0.8, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Draw Water (hold, looping beckon) -----------------------------------------
registerClip({
  id: 'water_draw',
  duration: 1.4,
  loop: true,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [0.16, 0, 0], upperArmL: [-1.05, 0, 0.6], upperArmR: [-1.05, 0, -0.6], foreArmL: [-0.85, 0, 0], foreArmR: [-0.85, 0, 0], handL: [0.45, 0, 0], handR: [0.45, 0, 0] } },
    { t: 0.7, pose: { spine: [0.04, 0, 0], upperArmL: [-1.5, 0, 0.32], upperArmR: [-1.5, 0, -0.32], foreArmL: [-1.35, 0, 0], foreArmR: [-1.35, 0, 0], handL: [-0.35, 0, 0], handR: [-0.35, 0, 0] }, ease: 'inout' },
    { t: 1.4, pose: { spine: [0.16, 0, 0], upperArmL: [-1.05, 0, 0.6], upperArmR: [-1.05, 0, -0.6], foreArmL: [-0.85, 0, 0], foreArmR: [-0.85, 0, 0], handL: [0.45, 0, 0], handR: [0.45, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Water Blast: coil at the hip, then a two-handed thrust ---------------------
registerClip({
  id: 'water_blast',
  duration: 0.8,
  mask: 'full',
  events: [{ t: 0.26, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.12, -0.55, 0], chest: [0, -0.2, 0], upperArmR: [0.35, 0, -0.45], foreArmR: [-1.7, 0, 0], upperArmL: [-0.55, 0, -0.42], foreArmL: [-1.55, 0, 0], thighL: [-0.28, 0, 0.3], thighR: [0.15, 0, -0.3], shinL: [0.4, 0, 0], shinR: [0.35, 0, 0], hipsY: -0.16 } },
    { t: 0.26, pose: { spine: [0.26, 0.12, 0], chest: [0.1, 0.05, 0], upperArmL: [-1.56, 0, 0.12], upperArmR: [-1.56, 0, -0.12], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0], thighL: [-0.72, 0, 0.2], shinL: [0.52, 0, 0], thighR: [0.32, 0, -0.2], shinR: [0.28, 0, 0], hipsY: -0.22, hipsZ: 0.12 }, ease: 'out' },
    { t: 0.8, pose: { spine: [0.06, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.75, 0, 0], foreArmR: [-0.75, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.1, 0, 0.1], shinL: [0.14, 0, 0], thighR: [0, 0, -0.1], shinR: [0.14, 0, 0], hipsY: 0, hipsZ: 0 }, ease: 'inout' },
  ],
});

// ---- Water Shield: sweep overhead into a wide wrapping stance --------------------
registerClip({
  id: 'water_shield',
  duration: 0.55,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [0.15, 0, 0], upperArmL: [-0.55, 0, -0.35], upperArmR: [-0.55, 0, 0.35], foreArmL: [-1.0, 0, 0], foreArmR: [-1.0, 0, 0] } },
    { t: 0.22, pose: { spine: [-0.12, 0, 0], upperArmL: [-2.45, 0, 0.55], upperArmR: [-2.45, 0, -0.55], foreArmL: [-0.35, 0, 0], foreArmR: [-0.35, 0, 0] }, ease: 'out' },
    { t: 0.55, pose: { spine: [0.05, 0, 0], upperArmL: [-0.7, 0, 1.15], upperArmR: [-0.7, 0, -1.15], foreArmL: [-0.65, 0, 0], foreArmR: [-0.65, 0, 0] }, ease: 'inout' },
  ],
});
registerClip({
  id: 'water_shield_hold',
  duration: 1.6,
  loop: true,
  mask: 'arms',
  keys: [
    { t: 0, pose: { upperArmL: [-0.7, 0, 1.15], upperArmR: [-0.7, 0, -1.15], foreArmL: [-0.65, 0, 0], foreArmR: [-0.65, 0, 0] } },
    { t: 0.8, pose: { upperArmL: [-1.0, 0.2, 0.95], upperArmR: [-0.45, -0.2, -1.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.45, 0, 0] }, ease: 'inout' },
    { t: 1.6, pose: { upperArmL: [-0.7, 0, 1.15], upperArmR: [-0.7, 0, -1.15], foreArmL: [-0.65, 0, 0], foreArmR: [-0.65, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Ice Wall: crouch, then rise with both arms lifting the ice -----------------
registerClip({
  id: 'water_ice_wall',
  duration: 0.85,
  mask: 'full',
  events: [{ t: 0.35, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.48, 0, 0], chest: [0.12, 0, 0], upperArmL: [-0.45, 0, 0.25], upperArmR: [-0.45, 0, -0.25], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0], thighL: [-0.75, 0, 0.26], thighR: [-0.55, 0, -0.26], shinL: [1.05, 0, 0], shinR: [0.95, 0, 0], hipsY: -0.4 } },
    { t: 0.35, pose: { spine: [-0.18, 0, 0], chest: [-0.08, 0, 0], upperArmL: [-2.7, 0, 0.32], upperArmR: [-2.7, 0, -0.32], foreArmL: [-0.12, 0, 0], foreArmR: [-0.12, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], thighL: [-0.1, 0, 0.16], thighR: [0.05, 0, -0.16], shinL: [0.1, 0, 0], shinR: [0.05, 0, 0], hipsY: 0.03 }, ease: 'out' },
    { t: 0.85, pose: { spine: [0.05, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.7, 0, 0], foreArmR: [-0.7, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighL: [-0.08, 0, 0.1], thighR: [0, 0, -0.1], shinL: [0.12, 0, 0], shinR: [0.12, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// ---- Water Sweep: low crouch with a wide horizontal arm sweep -------------------
registerClip({
  id: 'water_sweep',
  duration: 0.85,
  mask: 'full',
  events: [{ t: 0.3, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [0.22, -0.85, 0], chest: [0.05, -0.3, 0], upperArmR: [-0.55, 0, -1.2], upperArmL: [-1.25, 0, -0.55], foreArmR: [-0.3, 0, 0], foreArmL: [-0.35, 0, 0], thighL: [-0.3, 0, 0.3], thighR: [0.1, 0, -0.3], shinL: [0.45, 0, 0], shinR: [0.4, 0, 0], hipsY: -0.14 } },
    { t: 0.3, pose: { spine: [0.42, 0.9, 0], chest: [0.12, 0.3, 0], upperArmL: [-0.55, 0, 1.25], upperArmR: [-1.3, 0, 0.55], foreArmL: [-0.15, 0, 0], foreArmR: [-0.2, 0, 0], thighL: [-0.92, 0, 0.45], shinL: [1.2, 0, 0], thighR: [0.22, 0, -0.55], shinR: [0.6, 0, 0], hipsY: -0.46 }, ease: 'out' },
    { t: 0.85, pose: { spine: [0.06, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.7, 0, 0], foreArmR: [-0.7, 0, 0], thighL: [-0.1, 0, 0.1], thighR: [0, 0, -0.1], shinL: [0.14, 0, 0], shinR: [0.14, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// ---- Ice Shards: gather overhead, fling outward in a fan -----------------------
registerClip({
  id: 'water_ice_shards',
  duration: 0.68,
  mask: 'upper',
  events: [{ t: 0.28, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [-0.18, 0, 0], upperArmL: [-2.6, 0, 0.18], upperArmR: [-2.6, 0, -0.18], foreArmL: [-0.95, 0, 0], foreArmR: [-0.95, 0, 0] } },
    { t: 0.28, pose: { spine: [0.26, 0, 0], chest: [0.08, 0, 0], upperArmL: [-1.42, 0, 0.78], upperArmR: [-1.42, 0, -0.78], foreArmL: [-0.05, 0, 0], foreArmR: [-0.05, 0, 0], handL: [-0.7, 0, 0], handR: [-0.7, 0, 0] }, ease: 'out' },
    { t: 0.68, pose: { spine: [0.05, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.75, 0, 0], foreArmR: [-0.75, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Water Jet: planted two-handed push, trembling under pressure --------------
registerClip({
  id: 'water_jet_hold',
  duration: 0.36,
  loop: true,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [0.14, 0, 0], chest: [0.05, 0, 0], upperArmL: [-1.5, 0, 0.13], upperArmR: [-1.5, 0, -0.13], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [-0.85, 0, 0], handR: [-0.85, 0, 0] } },
    { t: 0.18, pose: { spine: [0.1, 0, 0], chest: [0.02, 0, 0], upperArmL: [-1.46, 0.04, 0.16], upperArmR: [-1.46, -0.04, -0.16], foreArmL: [-0.14, 0, 0], foreArmR: [-0.14, 0, 0], handL: [-0.8, 0, 0], handR: [-0.8, 0, 0] }, ease: 'inout' },
    { t: 0.36, pose: { spine: [0.14, 0, 0], chest: [0.05, 0, 0], upperArmL: [-1.5, 0, 0.13], upperArmR: [-1.5, 0, -0.13], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [-0.85, 0, 0], handR: [-0.85, 0, 0] }, ease: 'inout' },
  ],
});
registerClip({
  id: 'water_jet_brace',
  duration: 0.3,
  mask: 'lower',
  keys: [
    { t: 0, pose: { thighL: [-0.2, 0, 0.18], thighR: [0.1, 0, -0.18], shinL: [0.2, 0, 0], shinR: [0.25, 0, 0], hipsY: -0.06 } },
    { t: 0.3, pose: { thighL: [-0.62, 0, 0.24], thighR: [0.38, 0, -0.22], shinL: [0.55, 0, 0], shinR: [0.3, 0, 0], hipsY: -0.2 }, ease: 'out' },
  ],
});

// ---- Water Spout: balancing on a column of water ------------------------------
registerClip({
  id: 'water_spout_ride',
  duration: 1.6,
  loop: true,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.08, 0, 0], upperArmL: [-0.45, 0, 1.15], upperArmR: [-0.45, 0, -1.15], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], thighL: [-0.5, 0, 0.18], thighR: [-0.22, 0, -0.18], shinL: [0.75, 0, 0], shinR: [0.5, 0, 0], hipsY: -0.08 } },
    { t: 0.8, pose: { spine: [0.04, 0.1, 0.04], upperArmL: [-0.6, 0, 1.0], upperArmR: [-0.3, 0, -1.25], foreArmL: [-0.55, 0, 0], foreArmR: [-0.3, 0, 0], thighL: [-0.42, 0, 0.18], thighR: [-0.3, 0, -0.18], shinL: [0.65, 0, 0], shinR: [0.6, 0, 0], hipsY: -0.04 }, ease: 'inout' },
    { t: 1.6, pose: { spine: [0.08, 0, 0], upperArmL: [-0.45, 0, 1.15], upperArmR: [-0.45, 0, -1.15], foreArmL: [-0.4, 0, 0], foreArmR: [-0.4, 0, 0], thighL: [-0.5, 0, 0.18], thighR: [-0.22, 0, -0.18], shinL: [0.75, 0, 0], shinR: [0.5, 0, 0], hipsY: -0.08 }, ease: 'inout' },
  ],
});
registerClip({
  id: 'water_spout_rise',
  duration: 0.4,
  mask: 'full',
  keys: [
    { t: 0, pose: { spine: [0.3, 0, 0], upperArmL: [-0.3, 0, 0.4], upperArmR: [-0.3, 0, -0.4], thighL: [-0.7, 0, 0.2], thighR: [-0.7, 0, -0.2], shinL: [1.1, 0, 0], shinR: [1.1, 0, 0], hipsY: -0.35 } },
    { t: 0.4, pose: { spine: [-0.1, 0, 0], upperArmL: [-2.2, 0, 0.7], upperArmR: [-2.2, 0, -0.7], foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0], thighL: [-0.2, 0, 0.12], thighR: [-0.1, 0, -0.12], shinL: [0.3, 0, 0], shinR: [0.2, 0, 0], hipsY: 0 }, ease: 'out' },
  ],
});

// ---- Healing Waters: glowing water cupped over the heart ------------------------
registerClip({
  id: 'water_heal',
  duration: 1.2,
  loop: true,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [0.1, 0, 0], head: [0.28, 0, 0], upperArmL: [-0.8, 0, 0.12], upperArmR: [-0.8, 0, -0.12], foreArmL: [-1.8, 0, 0], foreArmR: [-1.8, 0, 0], handL: [0.3, 0, 0], handR: [0.3, 0, 0] } },
    { t: 0.6, pose: { spine: [0.04, 0, 0], head: [0.15, 0, 0], upperArmL: [-1.0, 0, 0.35], upperArmR: [-1.0, 0, -0.35], foreArmL: [-1.45, 0, 0], foreArmR: [-1.45, 0, 0], handL: [-0.2, 0, 0], handR: [-0.2, 0, 0] }, ease: 'inout' },
    { t: 1.2, pose: { spine: [0.1, 0, 0], head: [0.28, 0, 0], upperArmL: [-0.8, 0, 0.12], upperArmR: [-0.8, 0, -0.12], foreArmL: [-1.8, 0, 0], foreArmR: [-1.8, 0, 0], handL: [0.3, 0, 0], handR: [0.3, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Moisture Extraction: arms wide, palms up, pulling the air inward -----------
registerClip({
  id: 'water_moisture',
  duration: 1.3,
  loop: true,
  mask: 'upper',
  keys: [
    { t: 0, pose: { spine: [-0.12, 0, 0], head: [-0.25, 0, 0], upperArmL: [-0.75, 0, 1.3], upperArmR: [-0.75, 0, -1.3], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], handL: [0.5, 0, 0], handR: [0.5, 0, 0] } },
    { t: 0.65, pose: { spine: [0.1, 0, 0], head: [0.1, 0, 0], upperArmL: [-1.2, 0, 0.45], upperArmR: [-1.2, 0, -0.45], foreArmL: [-1.45, 0, 0], foreArmR: [-1.45, 0, 0], handL: [-0.2, 0, 0], handR: [-0.2, 0, 0] }, ease: 'inout' },
    { t: 1.3, pose: { spine: [-0.12, 0, 0], head: [-0.25, 0, 0], upperArmL: [-0.75, 0, 1.3], upperArmR: [-0.75, 0, -1.3], foreArmL: [-0.3, 0, 0], foreArmR: [-0.3, 0, 0], handL: [0.5, 0, 0], handR: [0.5, 0, 0] }, ease: 'inout' },
  ],
});

// ---- Ice Spikes: knee up, stomp, arms driving down -----------------------------
registerClip({
  id: 'water_ice_spikes',
  duration: 0.95,
  mask: 'full',
  events: [{ t: 0.42, name: 'release' }],
  keys: [
    { t: 0, pose: { spine: [-0.12, 0, 0], upperArmL: [-2.0, 0, 0.5], upperArmR: [-2.0, 0, -0.5], foreArmL: [-0.5, 0, 0], foreArmR: [-0.5, 0, 0], thighR: [-1.25, 0, -0.1], shinR: [1.35, 0, 0], thighL: [0, 0, 0.1], shinL: [0.1, 0, 0], hipsY: 0.03 } },
    { t: 0.42, pose: { spine: [0.52, 0, 0], chest: [0.12, 0, 0], upperArmL: [-0.72, 0, 0.22], upperArmR: [-0.72, 0, -0.22], foreArmL: [-0.08, 0, 0], foreArmR: [-0.08, 0, 0], handL: [0.8, 0, 0], handR: [0.8, 0, 0], thighR: [-0.38, 0, -0.32], shinR: [0.38, 0, 0], thighL: [0.12, 0, 0.22], shinL: [0.42, 0, 0], hipsY: -0.32 }, ease: 'in' },
    { t: 0.95, pose: { spine: [0.06, 0, 0], chest: [0, 0, 0], upperArmL: [-0.5, 0, 0.3], upperArmR: [-0.5, 0, -0.3], foreArmL: [-0.7, 0, 0], foreArmR: [-0.7, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0], thighR: [0, 0, -0.1], shinR: [0.12, 0, 0], thighL: [-0.08, 0, 0.1], shinL: [0.12, 0, 0], hipsY: 0 }, ease: 'inout' },
  ],
});

// ---- Short "nothing to bend" flick ---------------------------------------------
registerClip({
  id: 'water_fizzle',
  duration: 0.45,
  mask: 'arms',
  keys: [
    { t: 0, pose: { upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0] } },
    { t: 0.18, pose: { upperArmL: [-1.2, 0, 0.5], upperArmR: [-1.2, 0, -0.5], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0] }, ease: 'out' },
    { t: 0.45, pose: { upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.6, 0, 0], foreArmR: [-0.6, 0, 0], handL: [0, 0, 0], handR: [0, 0, 0] }, ease: 'inout' },
  ],
});
