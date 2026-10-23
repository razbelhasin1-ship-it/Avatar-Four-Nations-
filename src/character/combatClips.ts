import { registerClip, solveLegIK, type Clip, type ClipKey, type Ease, type Euler3, type Pose } from './Animator';

/**
 * Reusable combat motion library — element-agnostic body mechanics that technique
 * authors can play directly (`animator.play('strike_r', { onEvent })`) and react to
 * the 'release' event (the frame the blow lands / the element leaves the hands).
 * Documented in src/character/CLIPS.md (ids, durations, release times).
 *
 * Authoring notes (pose conventions: top of Animator.ts):
 *  - 'upper' clips leave the legs to locomotion; the Animator re-plants unkeyed feet
 *    when a clip crouches/lunges (hipsY / hipsZ), so upper-body clips can sink into a
 *    stance without keying legs and still work while walking.
 *  - 'full' clips key the legs explicitly; grounded leg poses are solved with the
 *    same 2-bone IK the locomotion uses (`legAt`) so feet meet the ground exactly.
 *  - Full spins rotate `hips` through 2π and then snap back to 0 with a second key at
 *    the same time, so the fade-out never unwinds the spin.
 */

const HIP_Y = 0.905;
const HIP_X = 0.093;
const THIGH = 0.425;
const SHIN = 0.415;
const ANKLE = 0.065;

type Side = 'L' | 'R';

/**
 * Leg pose that puts the ankle on the ground at lateral distance `out` (m, from the
 * body centre line, outward positive) and forward offset `fwd`, for the given hips
 * offsets. `lift` raises the ankle, `pitch` tilts the foot (+ = toes down).
 */
export function legAt(side: Side, out: number, fwd: number, hipsY: number, hipsZ = 0, lift = 0, pitch = 0, toeOut = 0.12, hipsX = 0): Pose {
  const s = side === 'L' ? 1 : -1;
  const ik = solveLegIK(s * (out - HIP_X) - hipsX, ANKLE + lift - (HIP_Y + hipsY), fwd - hipsZ, THIGH, SHIN, pitch);
  const p: Pose = {};
  // Toe-out is applied at the ankle so it never moves the solved ankle position.
  p[`thigh${side}`] = [ik.thighX, 0, ik.thighZ];
  p[`shin${side}`] = [ik.shin, 0, 0];
  p[`foot${side}`] = [ik.foot, s * toeOut, -ik.thighZ * 0.8];
  return p;
}

/** Both feet planted: `w` = stance half-width, `stagger` = left foot forward (m). */
export function stance(w: number, stagger: number, hipsY: number, hipsZ = 0, hipsX = 0): Pose {
  return {
    ...legAt('L', w, stagger / 2, hipsY, hipsZ, 0, 0, 0.12, hipsX),
    ...legAt('R', w, -stagger / 2, hipsY, hipsZ, 0, 0, 0.12, hipsX),
    hipsY,
    hipsZ,
    hipsX,
  };
}

const MIRROR: Record<string, string> = {
  shoulderL: 'shoulderR', shoulderR: 'shoulderL',
  upperArmL: 'upperArmR', upperArmR: 'upperArmL',
  foreArmL: 'foreArmR', foreArmR: 'foreArmL',
  handL: 'handR', handR: 'handL',
  thighL: 'thighR', thighR: 'thighL',
  shinL: 'shinR', shinR: 'shinL',
  footL: 'footR', footR: 'footL',
  fistL: 'fistR', fistR: 'fistL',
};

/** Left/right mirror of a pose (swap sides, negate twist/roll, negate hipsX). */
export function mirrorPose(p: Pose): Pose {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    const m = MIRROR[k] ?? k;
    if (typeof v === 'number') out[m] = k === 'hipsX' ? -v : v;
    else {
      const e = v as Euler3;
      out[m] = [e[0], -e[1], -e[2]];
    }
  }
  return out as Pose;
}

function mirrorClip(c: Clip, id: string, desc?: string): Clip {
  return registerClip({ ...c, id, desc: desc ?? c.desc, keys: c.keys.map((k) => ({ ...k, pose: mirrorPose(k.pose) })) });
}

const K = (t: number, pose: Pose, ease?: Ease): ClipKey => ({ t, pose, ease });

/** Arms-up fighting guard (fists at chin height). */
const GUARD: Pose = {
  upperArmL: [-0.55, 0, 0.28],
  foreArmL: [-1.75, 0, 0],
  handL: [0, 0, 0],
  upperArmR: [-0.45, 0, -0.3],
  foreArmR: [-1.85, 0, 0],
  handR: [0, 0, 0],
  fistL: 0.85,
  fistR: 0.85,
};
/** Relaxed settle pose at the end of most strikes. */
const SETTLE: Pose = {
  spine: [0.04, 0, 0],
  chest: [0, 0, 0],
  neck: [0, 0, 0],
  head: [0, 0, 0],
  upperArmL: [-0.4, 0, 0.25],
  foreArmL: [-1.35, 0, 0],
  handL: [0, 0, 0],
  upperArmR: [-0.4, 0, -0.25],
  foreArmR: [-1.35, 0, 0],
  handR: [0, 0, 0],
  fistL: 0.6,
  fistR: 0.6,
  hipsY: -0.03,
  hipsZ: 0,
};
const LEGS_REST = (hipsY = -0.02): Pose => stance(0.11, 0.02, hipsY);

// -----------------------------------------------------------------------------
// Strikes
// -----------------------------------------------------------------------------

const strikeR = registerClip({
  id: 'strike_r',
  duration: 0.5,
  mask: 'upper',
  desc: 'Straight right punch / palm strike with hip twist; left fist chambers at the hip.',
  events: [{ t: 0.16, name: 'release' }],
  keys: [
    K(0, { spine: [0.05, -0.28, 0], chest: [0, -0.22, 0], head: [0, 0.35, 0], upperArmR: [0.55, 0, -0.2], foreArmR: [-2.05, 0, 0], upperArmL: [-0.95, 0, 0.22], foreArmL: [-1.3, 0, 0], fistR: 1, fistL: 0.85, hipsY: -0.04 }),
    K(0.16, { spine: [0.12, 0.32, 0], chest: [0.04, 0.3, 0], head: [0, -0.5, 0], upperArmR: [-1.56, 0, 0.1], foreArmR: [-0.04, 0, 0], handR: [0, 0, 0], upperArmL: [0.45, 0, 0.16], foreArmL: [-2.1, 0, 0], fistR: 1, fistL: 1, hipsY: -0.09, hipsZ: 0.05 }, 'out'),
    K(0.27, { spine: [0.1, 0.26, 0], chest: [0.03, 0.24, 0], head: [0, -0.4, 0], upperArmR: [-1.48, 0, 0.06], foreArmR: [-0.12, 0, 0], upperArmL: [0.38, 0, 0.18], foreArmL: [-2.05, 0, 0], hipsY: -0.08, hipsZ: 0.04 }),
    K(0.5, SETTLE, 'inout'),
  ],
});
mirrorClip(strikeR, 'strike_l', 'Straight left punch / palm strike (mirror of strike_r).');

const whipR = registerClip({
  id: 'whip_r',
  duration: 0.55,
  mask: 'upper',
  desc: 'Right arm raised back and high, then lashed forward and down with a wrist snap (water whip, fire whip, air slice).',
  events: [{ t: 0.26, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.14, { spine: [-0.1, -0.38, 0], chest: [-0.05, -0.2, 0], head: [0, 0.45, 0], upperArmR: [-2.45, 0.3, -0.62], foreArmR: [-1.25, 0, 0], handR: [0.45, 0, 0], upperArmL: [-0.85, 0, 0.42], foreArmL: [-1.25, 0, 0], fistR: 0.25, fistL: 0.5, hipsY: -0.03 }, 'out'),
    K(0.26, { spine: [0.22, 0.36, 0], chest: [0.06, 0.22, 0], head: [0, -0.5, 0], upperArmR: [-1.12, -0.2, 0.05], foreArmR: [-0.1, 0, 0], handR: [-0.55, 0, 0], upperArmL: [0.32, 0, 0.32], foreArmL: [-1.65, 0, 0], fistR: 0.15, hipsY: -0.1, hipsZ: 0.05 }, 'in'),
    K(0.36, { spine: [0.18, 0.42, 0], chest: [0.05, 0.25, 0], head: [0, -0.55, 0], upperArmR: [-0.62, -0.1, 0.28], foreArmR: [-0.22, 0, 0], handR: [0.3, 0, 0], hipsY: -0.09, hipsZ: 0.04 }, 'out'),
    K(0.55, SETTLE, 'inout'),
  ],
});
mirrorClip(whipR, 'whip_l', 'Left arm whip (mirror of whip_r).');

registerClip({
  id: 'push_two',
  duration: 0.6,
  mask: 'upper',
  desc: 'Two-handed palm push from a chest chamber, short lunge (air blast, water wave, earth shove).',
  events: [{ t: 0.24, name: 'release' }],
  keys: [
    K(0, { spine: [-0.05, 0, 0], upperArmL: [0.35, 0, 0.35], foreArmL: [-2.1, 0, 0], upperArmR: [0.35, 0, -0.35], foreArmR: [-2.1, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], fistL: 0.1, fistR: 0.1, hipsY: -0.05 }),
    K(0.12, { spine: [-0.14, 0, 0], chest: [-0.06, 0, 0], upperArmL: [0.45, 0, 0.38], foreArmL: [-2.2, 0, 0], upperArmR: [0.45, 0, -0.38], foreArmR: [-2.2, 0, 0], hipsY: -0.08, hipsZ: -0.03 }, 'out'),
    K(0.24, { spine: [0.2, 0, 0], chest: [0.06, 0, 0], head: [-0.2, 0, 0], upperArmL: [-1.5, 0, 0.08], foreArmL: [-0.05, 0, 0], upperArmR: [-1.5, 0, -0.08], foreArmR: [-0.05, 0, 0], handL: [-1.1, 0, 0], handR: [-1.1, 0, 0], fistL: 0, fistR: 0, hipsY: -0.12, hipsZ: 0.08 }, 'out'),
    K(0.36, { spine: [0.17, 0, 0], head: [-0.17, 0, 0], upperArmL: [-1.45, 0, 0.1], upperArmR: [-1.45, 0, -0.1], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], hipsY: -0.11, hipsZ: 0.07 }),
    K(0.6, { ...SETTLE, fistL: 0.3, fistR: 0.3 }, 'inout'),
  ],
});

registerClip({
  id: 'release_forward',
  duration: 0.45,
  mask: 'upper',
  desc: 'Explosive two-hand thrust from the charge_hold chamber (charged fire blast, air cannon, water jet).',
  events: [{ t: 0.12, name: 'release' }],
  keys: [
    K(0, { spine: [0.12, 0, 0], upperArmL: [0.4, 0, 0.3], foreArmL: [-2.05, 0, 0], upperArmR: [0.4, 0, -0.3], foreArmR: [-2.05, 0, 0], fistL: 1, fistR: 1, hipsY: -0.18 }),
    K(0.12, { spine: [0.28, 0, 0], chest: [0.08, 0, 0], head: [-0.3, 0, 0], upperArmL: [-1.52, 0, 0.06], foreArmL: [-0.02, 0, 0], upperArmR: [-1.52, 0, -0.06], foreArmR: [-0.02, 0, 0], handL: [-0.9, 0, 0], handR: [-0.9, 0, 0], fistL: 0.1, fistR: 0.1, hipsY: -0.16, hipsZ: 0.11 }, 'out'),
    K(0.25, { spine: [0.24, 0, 0], head: [-0.26, 0, 0], upperArmL: [-1.45, 0, 0.08], upperArmR: [-1.45, 0, -0.08], foreArmL: [-0.1, 0, 0], foreArmR: [-0.1, 0, 0], hipsY: -0.14, hipsZ: 0.09 }),
    K(0.45, SETTLE, 'inout'),
  ],
});

registerClip({
  id: 'charge_hold',
  duration: 0.6,
  loop: true,
  mask: 'upper',
  desc: 'Looping charge stance: sunk hips, fists drawn to the hips, shoulders tense with a slight tremble. Event "charged" once per play after the first half-cycle.',
  events: [{ t: 0.3, name: 'charged' }],
  keys: [
    K(0, { spine: [0.15, 0, 0], chest: [0.05, 0, 0], head: [-0.12, 0, 0], shoulderL: [0, 0, -0.06], shoulderR: [0, 0, 0.06], upperArmL: [0.38, 0, 0.3], foreArmL: [-2.05, 0, 0], upperArmR: [0.38, 0, -0.3], foreArmR: [-2.05, 0, 0], fistL: 1, fistR: 1, hipsY: -0.18 }),
    K(0.15, { spine: [0.16, 0.02, 0], chest: [0.06, 0, 0.01], upperArmL: [0.4, 0, 0.32], upperArmR: [0.36, 0, -0.29], hipsY: -0.185 }, 'inout'),
    K(0.3, { spine: [0.15, 0, 0], chest: [0.05, 0, 0], upperArmL: [0.38, 0, 0.3], upperArmR: [0.38, 0, -0.3], hipsY: -0.18 }, 'inout'),
    K(0.45, { spine: [0.16, -0.02, 0], chest: [0.06, 0, -0.01], upperArmL: [0.36, 0, 0.29], upperArmR: [0.4, 0, -0.32], hipsY: -0.185 }, 'inout'),
    K(0.6, { spine: [0.15, 0, 0], chest: [0.05, 0, 0], upperArmL: [0.38, 0, 0.3], upperArmR: [0.38, 0, -0.3], hipsY: -0.18 }, 'inout'),
  ],
});

registerClip({
  id: 'circle_arms',
  duration: 1.0,
  mask: 'upper',
  desc: 'Flowing circle: arms cross low, rise wide at shoulder height and close forward with palms out (water gather/redirect, air swirl).',
  events: [{ t: 0.7, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.25, { spine: [0.16, 0.25, 0], chest: [0.05, 0.1, 0], head: [0.05, -0.3, 0], upperArmL: [-0.55, 0, -0.18], foreArmL: [-0.75, 0, 0], upperArmR: [-0.5, 0, 0.18], foreArmR: [-0.7, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], fistL: 0.05, fistR: 0.05, hipsY: -0.1, hipsX: 0.02 }, 'inout'),
    K(0.5, { spine: [-0.06, -0.15, 0], chest: [-0.04, -0.08, 0], head: [-0.05, 0.15, 0], upperArmL: [-0.65, 0.2, 1.3], foreArmL: [-0.3, 0, 0], upperArmR: [-0.65, -0.2, -1.3], foreArmR: [-0.3, 0, 0], handL: [0.2, 0, 0], handR: [0.2, 0, 0], hipsY: -0.03, hipsX: -0.02 }, 'inout'),
    K(0.7, { spine: [0.14, 0, 0], chest: [0.04, 0, 0], head: [-0.15, 0, 0], upperArmL: [-1.45, 0, 0.32], foreArmL: [-0.2, 0, 0], upperArmR: [-1.45, 0, -0.32], foreArmR: [-0.2, 0, 0], handL: [-0.85, 0, 0], handR: [-0.85, 0, 0], hipsY: -0.13, hipsZ: 0.05, hipsX: 0 }, 'out'),
    K(1.0, { ...SETTLE, fistL: 0.2, fistR: 0.2 }, 'inout'),
  ],
});

registerClip({
  id: 'lift_up',
  duration: 0.9,
  mask: 'upper',
  desc: 'Crouch with palms up, then rise lifting both hands to shoulder height (raise a boulder, lift water from a pool).',
  events: [{ t: 0.6, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.3, { spine: [0.42, 0, 0], chest: [0.1, 0, 0], head: [-0.3, 0, 0], upperArmL: [-0.55, 0, 0.32], foreArmL: [-0.3, 0, 0], upperArmR: [-0.55, 0, -0.32], foreArmR: [-0.3, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], fistL: 0.15, fistR: 0.15, hipsY: -0.24, hipsZ: 0.02 }, 'inout'),
    K(0.6, { spine: [-0.1, 0, 0], chest: [-0.05, 0, 0], head: [-0.12, 0, 0], upperArmL: [-1.6, 0, 0.3], foreArmL: [-0.55, 0, 0], upperArmR: [-1.6, 0, -0.3], foreArmR: [-0.55, 0, 0], handL: [-0.9, 0, 0], handR: [-0.9, 0, 0], fistL: 0.25, fistR: 0.25, hipsY: 0, hipsZ: 0 }, 'out'),
    K(0.9, { spine: [0.02, 0, 0], upperArmL: [-1.2, 0, 0.3], foreArmL: [-0.9, 0, 0], upperArmR: [-1.2, 0, -0.3], foreArmR: [-0.9, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], hipsY: -0.04 }, 'inout'),
  ],
});

registerClip({
  id: 'raise_two',
  duration: 0.6,
  mask: 'upper',
  desc: 'Both arms thrust from low to overhead, palms up (raise a wall or pillar, updraft).',
  events: [{ t: 0.32, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.16, { spine: [0.32, 0, 0], head: [-0.2, 0, 0], upperArmL: [0.25, 0, 0.32], foreArmL: [-1.25, 0, 0], upperArmR: [0.25, 0, -0.32], foreArmR: [-1.25, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], fistL: 0.5, fistR: 0.5, hipsY: -0.2 }, 'out'),
    K(0.32, { spine: [-0.15, 0, 0], chest: [-0.06, 0, 0], head: [-0.28, 0, 0], upperArmL: [-2.6, 0, 0.3], foreArmL: [-0.25, 0, 0], upperArmR: [-2.6, 0, -0.3], foreArmR: [-0.25, 0, 0], handL: [-0.6, 0, 0], handR: [-0.6, 0, 0], fistL: 0.1, fistR: 0.1, hipsY: 0.01 }, 'out'),
    K(0.42, { spine: [-0.12, 0, 0], head: [-0.24, 0, 0], upperArmL: [-2.5, 0, 0.32], upperArmR: [-2.5, 0, -0.32], hipsY: 0 }),
    K(0.6, { ...SETTLE, upperArmL: [-1.0, 0, 0.3], upperArmR: [-1.0, 0, -0.3], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0] }, 'inout'),
  ],
});

registerClip({
  id: 'breath',
  duration: 1.0,
  mask: 'upper',
  desc: 'Fire breath: deep inhale leaning back, then exhale forward with the hands framing the mouth.',
  events: [{ t: 0.45, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.3, { spine: [-0.2, 0, 0], chest: [-0.15, 0, 0], neck: [-0.1, 0, 0], head: [-0.2, 0, 0], upperArmL: [0.42, 0, 0.5], foreArmL: [-1.6, 0, 0], upperArmR: [0.42, 0, -0.5], foreArmR: [-1.6, 0, 0], fistL: 1, fistR: 1, hipsY: -0.02 }, 'inout'),
    K(0.45, { spine: [0.32, 0, 0], chest: [0.1, 0, 0], neck: [0.05, 0, 0], head: [-0.4, 0, 0], upperArmL: [-1.3, 0, 0.22], foreArmL: [-1.35, 0, 0], upperArmR: [-1.3, 0, -0.22], foreArmR: [-1.35, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], fistL: 0.35, fistR: 0.35, hipsY: -0.12, hipsZ: 0.06 }, 'out'),
    K(0.8, { spine: [0.3, 0, 0], chest: [0.1, 0, 0], head: [-0.38, 0, 0], upperArmL: [-1.25, 0, 0.24], upperArmR: [-1.25, 0, -0.24], hipsY: -0.11, hipsZ: 0.05 }),
    K(1.0, SETTLE, 'inout'),
  ],
});

registerClip({
  id: 'block_cross',
  duration: 0.5,
  mask: 'upper',
  desc: 'Forearms crossed in front of the face, braced (play with hold:true while blocking). "release" = block is up.',
  events: [{ t: 0.1, name: 'release' }],
  keys: [
    K(0, {}),
    K(0.1, { spine: [0.12, 0, 0], head: [0.1, 0, 0], upperArmL: [-1.3, 0, -0.28], foreArmL: [-1.45, 0, 0], upperArmR: [-1.25, 0, 0.3], foreArmR: [-1.55, 0, 0], fistL: 1, fistR: 1, hipsY: -0.1 }, 'out'),
    K(0.5, { spine: [0.1, 0, 0], head: [0.08, 0, 0], upperArmL: [-1.28, 0, -0.26], foreArmL: [-1.45, 0, 0], upperArmR: [-1.23, 0, 0.28], foreArmR: [-1.55, 0, 0], hipsY: -0.1 }, 'inout'),
  ],
});

// -----------------------------------------------------------------------------
// Full-body: kicks, stomps, spins, leaps
// -----------------------------------------------------------------------------

registerClip({
  id: 'kick_front',
  duration: 0.65,
  mask: 'full',
  desc: 'Right front snap kick: chamber the knee, extend, re-chamber, set down (fire kick, air kick).',
  events: [{ t: 0.26, name: 'release' }],
  keys: [
    K(0, { ...GUARD, hipsY: -0.02 }),
    K(0.12, { ...GUARD, spine: [-0.1, 0, 0], thighR: [-1.35, -0.05, -0.04], shinR: [1.75, 0, 0], footR: [0.35, 0, 0], upperArmR: [0.15, 0, -0.35], foreArmR: [-1.5, 0, 0], hipsY: -0.04 }, 'out'),
    K(0.26, { ...GUARD, spine: [-0.24, 0, 0], head: [0.18, 0, 0], thighR: [-1.6, -0.05, -0.04], shinR: [0.06, 0, 0], footR: [-0.25, 0, 0], upperArmR: [0.35, 0, -0.4], foreArmR: [-1.4, 0, 0], hipsY: -0.02, hipsZ: -0.04 }, 'out'),
    K(0.38, { ...GUARD, spine: [-0.12, 0, 0], head: [0.08, 0, 0], thighR: [-1.3, -0.05, -0.04], shinR: [1.6, 0, 0], footR: [0.3, 0, 0], hipsY: -0.04, hipsZ: 0 }, 'inout'),
    K(0.65, { ...SETTLE, ...legAt('R', 0.11, -0.01, -0.03) }, 'inout'),
  ],
});

const TAU = Math.PI * 2;

registerClip({
  id: 'kick_spin',
  duration: 0.8,
  mask: 'full',
  desc: 'Spinning roundhouse: wind, turn on the left foot and sweep the right leg out at hip height through a full turn.',
  events: [{ t: 0.45, name: 'release' }],
  keys: [
    K(0, { hips: [0, 0, 0], ...GUARD, ...LEGS_REST(-0.02) }),
    K(0.15, { hips: [0, 0.35, 0], spine: [0.1, 0.2, 0], ...GUARD, ...stance(0.12, 0.04, -0.1), hipsY: -0.1 }, 'out'),
    K(0.32, { hips: [0, -1.6, 0], spine: [-0.08, -0.3, 0], upperArmL: [-0.3, 0, 1.15], foreArmL: [-0.5, 0, 0], upperArmR: [-0.3, 0, -1.15], foreArmR: [-0.5, 0, 0], thighL: [-0.1, 0.1, 0.05], shinL: [0.18, 0, 0], footL: [-0.05, 0, 0], thighR: [-0.6, 0, -0.9], shinR: [1.2, 0, 0], footR: [0.3, 0, 0], hipsY: 0.02 }, 'inout'),
    K(0.45, { hips: [0, -3.4, 0], spine: [-0.15, -0.15, -0.35], head: [0, 0.2, 0.3], upperArmL: [0.15, 0, 0.9], foreArmL: [-1.2, 0, 0], upperArmR: [-0.2, 0, -0.55], foreArmR: [-1.6, 0, 0], thighL: [-0.04, 0.1, 0.1], shinL: [0.2, 0, 0], footL: [-0.05, 0, -0.08], thighR: [-0.3, 0, -1.42], shinR: [0.06, 0, 0], footR: [0.25, 0, 0], hipsY: 0.02 }, 'out'),
    K(0.6, { hips: [0, -5.4, 0], spine: [0, -0.1, 0], head: [0, 0, 0], ...GUARD, thighR: [-0.45, 0, -0.65], shinR: [1.0, 0, 0], footR: [0.2, 0, 0], thighL: [-0.12, 0.1, 0.06], shinL: [0.3, 0, 0], footL: [-0.1, 0, 0], hipsY: -0.03 }, 'inout'),
    K(0.8, { hips: [0, -TAU, 0], spine: [0.04, 0, 0], ...GUARD, ...LEGS_REST(-0.03) }, 'inout'),
    K(0.8, { hips: [0, 0, 0] }),
  ],
});

registerClip({
  id: 'sweep_low',
  duration: 0.9,
  mask: 'full',
  desc: 'Low spinning leg sweep: drop onto the bent left leg, right leg extended along the ground, full turn, rise.',
  events: [{ t: 0.42, name: 'release' }],
  keys: [
    K(0, { hips: [0, 0, 0], ...LEGS_REST(-0.02) }),
    K(0.16, { hips: [0, 0.25, 0], spine: [0.55, 0.1, 0], head: [-0.4, 0, 0], upperArmL: [-0.7, 0, 0.6], foreArmL: [-0.8, 0, 0], upperArmR: [-0.35, 0, -0.75], foreArmR: [-0.3, 0, 0], ...legAt('L', 0.16, 0.12, -0.45), thighR: [-0.25, 0, -1.25], shinR: [0.1, 0, 0], footR: [0.3, 0, 0], fistL: 0.6, fistR: 0.2, hipsY: -0.45 }, 'out'),
    K(0.42, { hips: [0, -3.0, 0], spine: [0.6, 0, 0], head: [-0.45, 0, 0], upperArmL: [-0.4, 0, 0.9], foreArmL: [-0.6, 0, 0], upperArmR: [-0.6, 0, -0.5], foreArmR: [-0.2, 0, 0], ...legAt('L', 0.16, 0.12, -0.47), thighR: [-0.15, 0, -1.3], shinR: [0.06, 0, 0], footR: [0.35, 0, 0], hipsY: -0.47 }, 'inout'),
    K(0.66, { hips: [0, -5.6, 0], spine: [0.5, 0, 0], head: [-0.35, 0, 0], upperArmL: [-0.5, 0, 0.7], foreArmL: [-0.9, 0, 0], upperArmR: [-0.4, 0, -0.6], foreArmR: [-0.6, 0, 0], ...legAt('L', 0.16, 0.12, -0.4), thighR: [-0.35, 0, -0.9], shinR: [0.6, 0, 0], footR: [0.2, 0, 0], hipsY: -0.4 }, 'inout'),
    K(0.9, { hips: [0, -TAU, 0], spine: [0.12, 0, 0], head: [0, 0, 0], ...GUARD, ...stance(0.13, 0.04, -0.1) }, 'inout'),
    K(0.9, { hips: [0, 0, 0] }),
  ],
});

registerClip({
  id: 'stomp',
  duration: 0.7,
  mask: 'full',
  desc: 'Earthbending stomp: raise the right knee high, drive the foot down into a sunk stance, fists punch down.',
  events: [{ t: 0.38, name: 'release' }],
  keys: [
    K(0, { ...LEGS_REST(-0.02) }),
    K(0.22, { spine: [-0.06, 0, 0.05], upperArmL: [-0.7, 0, 0.62], foreArmL: [-1.5, 0, 0], upperArmR: [-0.7, 0, -0.62], foreArmR: [-1.5, 0, 0], fistL: 1, fistR: 1, ...legAt('L', 0.12, 0.0, 0.01), thighR: [-1.45, -0.1, -0.12], shinR: [1.6, 0, 0], footR: [0.15, 0, 0], hipsY: 0.01 }, 'out'),
    K(0.38, { spine: [0.28, 0, 0], head: [-0.2, 0, 0], upperArmL: [0.12, 0, 0.36], foreArmL: [-0.35, 0, 0], upperArmR: [0.12, 0, -0.36], foreArmR: [-0.35, 0, 0], ...stance(0.26, 0.05, -0.22), fistL: 1, fistR: 1 }, 'in'),
    K(0.5, { spine: [0.26, 0, 0], head: [-0.18, 0, 0], upperArmL: [0.1, 0, 0.38], foreArmL: [-0.4, 0, 0], upperArmR: [0.1, 0, -0.38], foreArmR: [-0.4, 0, 0], ...stance(0.26, 0.05, -0.21) }),
    K(0.7, { ...SETTLE, ...stance(0.2, 0.04, -0.08) }, 'inout'),
  ],
});

registerClip({
  id: 'slam_down',
  duration: 0.75,
  mask: 'full',
  desc: 'Both fists raised overhead then slammed down to the ground in a deep crouch (earthquake, ground slam).',
  events: [{ t: 0.42, name: 'release' }],
  keys: [
    K(0, { ...LEGS_REST(-0.02) }),
    K(0.25, { spine: [-0.25, 0, 0], chest: [-0.08, 0, 0], head: [0.1, 0, 0], upperArmL: [-2.7, 0, 0.25], foreArmL: [-0.5, 0, 0], upperArmR: [-2.7, 0, -0.25], foreArmR: [-0.5, 0, 0], fistL: 1, fistR: 1, ...stance(0.16, 0.02, 0.02) }, 'out'),
    K(0.42, { spine: [0.75, 0, 0], chest: [0.2, 0, 0], head: [-0.5, 0, 0], upperArmL: [-0.95, 0, 0.22], foreArmL: [-0.12, 0, 0], upperArmR: [-0.95, 0, -0.22], foreArmR: [-0.12, 0, 0], ...stance(0.27, 0.06, -0.4, 0.04) }, 'in'),
    K(0.55, { spine: [0.72, 0, 0], chest: [0.18, 0, 0], head: [-0.48, 0, 0], upperArmL: [-0.92, 0, 0.24], upperArmR: [-0.92, 0, -0.24], ...stance(0.27, 0.06, -0.39, 0.04) }),
    K(0.75, { ...SETTLE, spine: [0.2, 0, 0], ...stance(0.22, 0.04, -0.14) }, 'inout'),
  ],
});

registerClip({
  id: 'spin_360',
  duration: 0.7,
  mask: 'full',
  desc: 'Full-body turn on the spot with arms extended (air spin, tornado, fire ring). Small hop at mid-turn.',
  events: [{ t: 0.35, name: 'release' }],
  keys: [
    K(0, { hips: [0, 0, 0], ...LEGS_REST(-0.02) }),
    K(0.1, { hips: [0, -0.4, 0], spine: [0.08, -0.15, 0], upperArmL: [-0.6, 0, 0.3], foreArmL: [-1.6, 0, 0], upperArmR: [-0.6, 0, -0.3], foreArmR: [-1.6, 0, 0], ...stance(0.13, 0.02, -0.09) }, 'out'),
    K(0.35, { hips: [0, Math.PI, 0], spine: [-0.05, 0.1, 0], head: [-0.05, 0, 0], upperArmL: [-0.2, 0, 1.4], foreArmL: [-0.15, 0, 0], upperArmR: [-0.2, 0, -1.4], foreArmR: [-0.15, 0, 0], handL: [0, 0, 0.2], handR: [0, 0, -0.2], fistL: 0.1, fistR: 0.1, thighL: [-0.3, 0.1, 0.12], shinL: [0.55, 0, 0], footL: [0.2, 0, 0], thighR: [0.1, -0.1, -0.12], shinR: [0.65, 0, 0], footR: [0.3, 0, 0], hipsY: 0.06 }, 'inout'),
    K(0.55, { hips: [0, Math.PI * 1.75, 0], spine: [0, 0.05, 0], upperArmL: [-0.25, 0, 1.25], upperArmR: [-0.25, 0, -1.25], ...stance(0.13, 0.02, -0.06) }, 'inout'),
    K(0.7, { hips: [0, TAU, 0], ...SETTLE, ...LEGS_REST(-0.03) }, 'inout'),
    K(0.7, { hips: [0, 0, 0] }),
  ],
});

registerClip({
  id: 'leap_strike',
  duration: 1.0,
  mask: 'full',
  desc: 'Crouch, leap (in place — the caller moves the body) with knees tucked and fists overhead, land in a deep crouch driving the right fist into the ground.',
  events: [{ t: 0.7, name: 'release' }],
  keys: [
    K(0, { ...LEGS_REST(-0.02) }),
    K(0.15, { spine: [0.32, 0, 0], head: [-0.25, 0, 0], upperArmL: [0.65, 0, 0.3], foreArmL: [-0.5, 0, 0], upperArmR: [0.65, 0, -0.3], foreArmR: [-0.5, 0, 0], fistL: 0.8, fistR: 0.8, ...stance(0.15, 0.02, -0.22) }, 'out'),
    K(0.4, { spine: [-0.15, 0, 0], head: [0.05, 0, 0], upperArmL: [-2.6, 0, 0.25], foreArmL: [-0.45, 0, 0], upperArmR: [-2.6, 0, -0.25], foreArmR: [-0.45, 0, 0], fistL: 1, fistR: 1, thighL: [-1.2, 0.1, 0.15], shinL: [1.6, 0, 0], footL: [0.4, 0, 0], thighR: [-0.9, -0.1, -0.15], shinR: [1.8, 0, 0], footR: [0.45, 0, 0], hipsY: 0.45 }, 'out'),
    K(0.7, { spine: [0.72, 0, 0], chest: [0.15, 0, 0], head: [-0.5, 0, 0], upperArmR: [-0.75, 0, -0.1], foreArmR: [-0.05, 0, 0], upperArmL: [0.25, 0, 0.55], foreArmL: [-0.6, 0, 0], fistL: 0.6, fistR: 1, ...stance(0.24, 0.12, -0.38, 0.03) }, 'in'),
    K(0.85, { spine: [0.7, 0, 0], chest: [0.14, 0, 0], head: [-0.48, 0, 0], upperArmR: [-0.75, 0, -0.1], foreArmR: [-0.05, 0, 0], upperArmL: [0.22, 0, 0.55], ...stance(0.24, 0.12, -0.37, 0.03) }),
    K(1.0, { ...SETTLE, spine: [0.18, 0, 0], ...stance(0.18, 0.06, -0.1) }, 'inout'),
  ],
});

// -----------------------------------------------------------------------------
// Per-element dodges (played by Player on dodge). Distinct body mechanics:
//   air   — spinning tucked hop, arms flung wide
//   water — low flowing slide, one leg extended, arms sweeping a wave
//   earth — short heavy brace: deep horse stance, forearms up
//   fire  — explosive dash: torso pitched forward, arms driven back like jets
// -----------------------------------------------------------------------------

registerClip({
  id: 'dodge_air',
  duration: 0.45,
  mask: 'full',
  desc: 'Airbender evasion: light tucked hop with a full spin and arms flung wide.',
  keys: [
    K(0, { hips: [0, 0, 0], ...LEGS_REST(-0.04) }),
    K(0.08, { hips: [0, 0.6, 0], spine: [0.1, 0.2, 0], upperArmL: [-0.5, 0, 0.6], foreArmL: [-1.2, 0, 0], upperArmR: [-0.5, 0, -0.6], foreArmR: [-1.2, 0, 0], ...stance(0.12, 0, -0.1) }, 'out'),
    K(0.22, { hips: [0, Math.PI * 1.1, 0], spine: [0.15, 0, 0], head: [0.1, 0, 0], upperArmL: [-0.4, 0, 1.45], foreArmL: [-0.2, 0, 0], upperArmR: [-0.4, 0, -1.45], foreArmR: [-0.2, 0, 0], fistL: 0, fistR: 0, thighL: [-1.15, 0.1, 0.15], shinL: [1.6, 0, 0], footL: [0.4, 0, 0], thighR: [-0.85, -0.1, -0.15], shinR: [1.7, 0, 0], footR: [0.45, 0, 0], hipsY: 0.12 }, 'out'),
    K(0.36, { hips: [0, Math.PI * 1.85, 0], spine: [0.08, 0, 0], upperArmL: [-0.5, 0, 1.0], foreArmL: [-0.5, 0, 0], upperArmR: [-0.5, 0, -1.0], foreArmR: [-0.5, 0, 0], thighL: [-0.5, 0.1, 0.1], shinL: [0.8, 0, 0], footL: [0.2, 0, 0], thighR: [-0.3, -0.1, -0.1], shinR: [0.7, 0, 0], footR: [0.2, 0, 0], hipsY: 0.02 }, 'inout'),
    K(0.45, { hips: [0, TAU, 0], spine: [0.05, 0, 0], upperArmL: [-0.4, 0, 0.5], foreArmL: [-0.7, 0, 0], upperArmR: [-0.4, 0, -0.5], foreArmR: [-0.7, 0, 0], ...stance(0.12, 0.02, -0.06) }, 'inout'),
    K(0.45, { hips: [0, 0, 0] }),
  ],
});

registerClip({
  id: 'dodge_water',
  duration: 0.45,
  mask: 'full',
  desc: 'Waterbender evasion: low flowing slide with one leg extended and the arms sweeping a wave.',
  keys: [
    K(0, { ...LEGS_REST(-0.03) }),
    K(0.12, { hips: [0, 0.35, 0.05], spine: [0.3, -0.3, 0.12], head: [-0.15, 0.3, 0], upperArmL: [-0.4, 0, 1.1], foreArmL: [-0.4, 0, 0], handL: [0.3, 0, 0], upperArmR: [-1.2, 0.3, -0.3], foreArmR: [-0.6, 0, 0], handR: [-0.5, 0, 0], fistL: 0.05, fistR: 0.05, ...legAt('L', 0.17, 0.08, -0.3, 0, 0, 0, 0.3, -0.05), ...legAt('R', 0.55, -0.08, -0.3, 0, 0.02, 0.4, 0.12, -0.05), hipsY: -0.3, hipsX: -0.05 }, 'out'),
    K(0.28, { hips: [0, 0.45, 0.06], spine: [0.34, -0.35, 0.15], head: [-0.2, 0.35, 0], upperArmL: [-1.25, -0.3, 0.6], foreArmL: [-0.3, 0, 0], handL: [-0.4, 0, 0], upperArmR: [0.35, 0, -0.9], foreArmR: [-0.4, 0, 0], handR: [0.4, 0, 0], ...legAt('L', 0.18, 0.06, -0.33, 0, 0, 0, 0.3, -0.07), ...legAt('R', 0.6, -0.1, -0.33, 0, 0.02, 0.4, 0.12, -0.07), hipsY: -0.33, hipsX: -0.07 }, 'inout'),
    K(0.45, { hips: [0, 0, 0], spine: [0.06, 0, 0], head: [0, 0, 0], ...SETTLE, ...stance(0.14, 0.02, -0.08), hipsX: 0 }, 'inout'),
  ],
});

registerClip({
  id: 'dodge_earth',
  duration: 0.42,
  mask: 'full',
  desc: 'Earthbender evasion: a short heavy sidestep into a deep horse stance with forearms raised to brace.',
  keys: [
    K(0, { ...LEGS_REST(-0.03) }),
    K(0.1, { spine: [0.12, 0, 0], ...GUARD, upperArmL: [-1.25, 0, -0.1], foreArmL: [-1.6, 0, 0], upperArmR: [-1.2, 0, 0.12], foreArmR: [-1.65, 0, 0], ...stance(0.2, 0.02, -0.16) }, 'out'),
    K(0.24, { spine: [0.18, 0, 0], head: [0.05, 0, 0], ...GUARD, upperArmL: [-1.3, 0, -0.08], foreArmL: [-1.65, 0, 0], upperArmR: [-1.25, 0, 0.1], foreArmR: [-1.7, 0, 0], ...stance(0.31, 0.03, -0.3) }, 'in'),
    K(0.42, { ...SETTLE, ...GUARD, spine: [0.08, 0, 0], ...stance(0.24, 0.03, -0.14) }, 'inout'),
  ],
});

registerClip({
  id: 'dodge_fire',
  duration: 0.38,
  mask: 'full',
  desc: 'Firebender evasion: explosive dash with the torso pitched forward and both arms driven back like jets.',
  keys: [
    K(0, { ...LEGS_REST(-0.03) }),
    K(0.08, { spine: [0.35, 0, 0], chest: [0.1, 0, 0], head: [-0.4, 0, 0], upperArmL: [0.9, 0, 0.35], foreArmL: [-0.25, 0, 0], upperArmR: [0.9, 0, -0.35], foreArmR: [-0.25, 0, 0], handL: [0.5, 0, 0], handR: [0.5, 0, 0], fistL: 0.1, fistR: 0.1, thighL: [-1.1, 0.05, 0.05], shinL: [1.1, 0, 0], footL: [0.1, 0, 0], thighR: [0.55, -0.05, -0.05], shinR: [0.7, 0, 0], footR: [0.5, 0, 0], hipsY: -0.08, hipsZ: 0.05 }, 'out'),
    K(0.22, { spine: [0.48, 0, 0], chest: [0.12, 0, 0], head: [-0.5, 0, 0], upperArmL: [1.15, 0, 0.3], foreArmL: [-0.15, 0, 0], upperArmR: [1.15, 0, -0.3], foreArmR: [-0.15, 0, 0], handL: [0.6, 0, 0], handR: [0.6, 0, 0], thighL: [-1.2, 0.05, 0.05], shinL: [1.0, 0, 0], footL: [0.15, 0, 0], thighR: [0.6, -0.05, -0.05], shinR: [0.6, 0, 0], footR: [0.5, 0, 0], hipsY: -0.1, hipsZ: 0.06 }, 'inout'),
    K(0.38, { ...SETTLE, spine: [0.12, 0, 0], head: [-0.05, 0, 0], ...GUARD, ...stance(0.13, 0.1, -0.08) }, 'inout'),
  ],
});
