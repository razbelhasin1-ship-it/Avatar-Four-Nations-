/**
 * Glider flight model (pure — unit tested): speed along the flight path and a pitch angle.
 *
 * Gravity pulls along the path (−g·sin γ) against drag (k·v²), so the glider settles into a slow,
 * flat glide (~16 m/s, sinking under 2 m/s: about 8 m forward per metre lost). Diving steepens the
 * path and builds speed; let go and the excess speed pitches the nose up into a zoom climb that
 * trades it back for height. Too slow and the nose drops until speed returns. An airbender adds
 * lift on top: a gust of wind bent under the wings (a short, decaying climb) and the steady rise
 * of an updraft column.
 */

export const GLIDER = {
  /** Gravity along the path (real, not the stylised on-foot gravity). */
  g: 9.81,
  /** Drag factor: g·sin(cruise) = k·v² sets the cruise speed. */
  drag: 0.0046,
  /** Flight path angles (radians, negative = descending). */
  cruisePitch: -0.12,
  divePitch: -0.72,
  maxClimbPitch: 0.5,
  /** Excess speed over cruise → nose-up (rad per m/s). */
  zoom: 0.055,
  cruiseSpeed: 16,
  stallSpeed: 7,
  minSpeed: 4,
  maxSpeed: 34,
  /** How fast the pitch follows its target (1/s). */
  pitchRate: 3.0,
  /** Airbent gust: lift added (m/s), how fast it fades (1/s), chi cost, minimum gap (s), speed kick (m/s). */
  gustLift: 9,
  gustDecay: 2.2,
  gustCost: 14,
  gustCooldown: 0.45,
  gustSpeed: 1.2,
  /** Rising air in an updraft column's core (m/s). */
  updraftLift: 9,
  /** Turn rate at full stick (rad/s). */
  turnRate: 1.6,
  /** Chi regained per second while flying (bending the wind costs focus). */
  chiRegen: 6,
} as const;

export interface GliderState {
  /** Airspeed along the path (m/s). */
  speed: number;
  /** Flight path angle (rad). */
  pitch: number;
  /** Extra lift from gusts (m/s, decaying). */
  lift: number;
  /** Seconds until another gust can be bent. */
  gustCooldown: number;
}

export interface GliderInput {
  dive: boolean;
  /** Steady rising air at this spot (m/s), e.g. an updraft column. */
  updraft: number;
}

export function newGliderState(speed: number): GliderState {
  return { speed: Math.max(GLIDER.stallSpeed + 2, Math.min(GLIDER.maxSpeed, speed)), pitch: -0.08, lift: 0, gustCooldown: 0 };
}

/** Pitch the glider wants for these inputs at its current speed. */
export function targetPitch(s: GliderState, input: GliderInput): number {
  let t: number = input.dive ? GLIDER.divePitch : GLIDER.cruisePitch;
  if (!input.dive && s.speed > GLIDER.cruiseSpeed) t = Math.min(GLIDER.maxClimbPitch, GLIDER.cruisePitch + (s.speed - GLIDER.cruiseSpeed) * GLIDER.zoom);
  if (s.speed < GLIDER.stallSpeed) t = Math.min(t, -0.45);
  return t;
}

/**
 * Advance the glider by dt. Returns the velocity it flies with this step: vertical (m/s, up +)
 * and horizontal (m/s, along the heading).
 */
export function stepGlider(s: GliderState, input: GliderInput, dt: number): { vy: number; vh: number } {
  const want = targetPitch(s, input);
  s.pitch += (want - s.pitch) * (1 - Math.exp(-GLIDER.pitchRate * dt));
  const accel = -GLIDER.g * Math.sin(s.pitch) - GLIDER.drag * s.speed * s.speed;
  s.speed = Math.max(GLIDER.minSpeed, Math.min(GLIDER.maxSpeed, s.speed + accel * dt));
  s.lift *= Math.exp(-GLIDER.gustDecay * dt);
  if (s.lift < 0.01) s.lift = 0;
  s.gustCooldown = Math.max(0, s.gustCooldown - dt);
  return { vy: s.speed * Math.sin(s.pitch) + s.lift + input.updraft, vh: s.speed * Math.cos(s.pitch) };
}

/** Bend a gust under the wings: true if it caught (not cooling down). */
export function gust(s: GliderState): boolean {
  if (s.gustCooldown > 0) return false;
  s.lift = Math.min(GLIDER.gustLift * 1.6, s.lift + GLIDER.gustLift);
  s.speed = Math.min(GLIDER.maxSpeed, s.speed + GLIDER.gustSpeed);
  s.gustCooldown = GLIDER.gustCooldown;
  return true;
}
