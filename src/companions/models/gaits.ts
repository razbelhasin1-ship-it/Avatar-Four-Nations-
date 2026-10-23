/**
 * Gait helpers shared by quadruped / biped creature models.
 *
 * Phases are in radians. A leg's swing is sin(phase): positive swings the leg
 * forward (thigh rot.x negative), the foot lifts while cos(phase) > 0 (knee
 * bends during the forward swing).
 */

export interface LegSpec {
  /** Bone names (thigh = hip pivot, shin = knee, foot optional). */
  thigh: string;
  shin: string;
  foot?: string;
  front: boolean;
  side: 1 | -1;
}

/** Walk: lateral sequence (LH, LF, RH, RF). Run: rotary gallop. */
export function legPhase(leg: LegSpec, run: number): number {
  const walk = leg.front ? (leg.side > 0 ? 0.25 : 0.75) : leg.side > 0 ? 0 : 0.5;
  const gallop = leg.front ? (leg.side > 0 ? 0 : 0.12) : leg.side > 0 ? 0.55 : 0.67;
  return (walk + (gallop - walk) * run) * Math.PI * 2;
}

export interface LegPose {
  thighX: number;
  shinX: number;
  footX: number;
}

/**
 * Pose for one leg at gait phase `ph` (already offset per leg).
 * `moving` 0..1 blends from standing; `amp` = thigh swing (rad); `lift` = knee bend (rad).
 * Front knees bend backward (+x on the shin) and hind hocks forward is approximated
 * by the sign convention `hindHock` (−1 flips the shin bend for hind legs).
 */
export function legPose(ph: number, moving: number, amp: number, lift: number, front: boolean, hindHock = 1): LegPose {
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const swing = -s * amp * moving;
  const up = Math.max(0, c) * lift * moving;
  const shin = front ? up : up * hindHock;
  return { thighX: swing, shinX: shin, footX: -swing * 0.5 - shin * 0.4 };
}
