import * as THREE from 'three';
import type { Element } from '../core/types';
import { clamp01, damp, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from '../core/MathUtil';

/**
 * Bone naming + pose conventions (READ BEFORE AUTHORING POSES)
 * ----------------------------------------------------------------
 * Character faces local +Z, up is +Y. The character's LEFT side is +X, RIGHT is -X.
 * Rest pose: standing straight, arms hanging straight down, legs straight.
 * Pose values are Euler XYZ offsets (radians) added to the rest orientation.
 *
 *  spine / chest / neck / head (point up):
 *    +x = bend forward (head: look down), -x = lean back (look up)
 *    +y = twist to the character's left, -y = twist right
 *    +z = lean toward the character's right (z rolls the top toward -X) — use sparingly
 *  upperArmL / upperArmR (point down):
 *    -x = swing arm FORWARD (x = -PI/2 → arm straight forward, -PI → straight up)
 *    +x = swing arm backward
 *    upperArmL: +z = raise sideways (outward), upperArmR: -z = raise sideways (outward)
 *    y = twist along arm
 *  foreArmL / foreArmR: -x = bend elbow (hand comes forward/up). 0 = straight.
 *  handL / handR: x = flex wrist, z = tilt
 *  thighL / thighR (point down): -x = leg forward (kick/step), +x = leg back,
 *    thighL +z = leg out to the side (left), thighR -z = leg out (right)
 *  shinL / shinR: +x = bend knee (foot goes back). 0 = straight.
 *  footL / footR: -x = toes up, +x = point toes.
 *  hips: whole upper+lower body rotation; pose also supports hipsY (m, vertical offset),
 *    hipsZ (m, forward offset) and hipsX (m, sideways) for crouches / lunges / sways.
 *  fistL / fistR (0 open .. 1 closed fist): hand closure while the clip plays.
 *
 * Clips are lists of keyed poses; any bone missing from a key is unaffected by
 * that clip (falls through to locomotion) unless `mask` says otherwise.
 *
 * Locomotion is procedural: legs are solved with 2-bone IK toward foot targets
 * that stay planted while the body moves (stride length synced to speed), with
 * per-style gait (air light & bouncy, earth wide & heavy, fire leaning forward,
 * water flowing arms), turn lean, jump/fall/land, glide, swim, mounted and
 * idle variants (meditate, sit, kneel, work, guard, float).
 */

export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulderL',
  'upperArmL',
  'foreArmL',
  'handL',
  'shoulderR',
  'upperArmR',
  'foreArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export type Euler3 = [number, number, number];
export type Pose = Partial<Record<BoneName, Euler3>> & { hipsY?: number; hipsZ?: number; hipsX?: number; fistL?: number; fistR?: number };

export type Ease = 'linear' | 'in' | 'out' | 'inout' | 'back';

export interface ClipKey {
  /** Seconds from clip start. */
  t: number;
  pose: Pose;
  /** Easing used when interpolating INTO this key. */
  ease?: Ease;
}

export type BoneMask = 'full' | 'upper' | 'lower' | 'arms' | 'armL' | 'armR';

export interface Clip {
  id: string;
  duration: number;
  keys: ClipKey[];
  loop?: boolean;
  /** Which bones this clip may drive (default: those present in its keys). */
  mask?: BoneMask;
  /** Named timing markers, e.g. { t: 0.25, name: 'release' }. */
  events?: Array<{ t: number; name: string }>;
  /** Short description (docs / tooling). */
  desc?: string;
}

export interface PlayOptions {
  speed?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Called for each clip event as playback crosses it. */
  onEvent?: (name: string) => void;
  onEnd?: () => void;
  /** Keep holding the last key after the clip ends (until stop()). */
  hold?: boolean;
  /** Layer weight multiplier. */
  weight?: number;
}

const MASK_BONES: Record<BoneMask, ReadonlySet<BoneName>> = {
  full: new Set(BONE_NAMES),
  upper: new Set<BoneName>(['spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR']),
  lower: new Set<BoneName>(['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']),
  arms: new Set<BoneName>(['shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR']),
  armL: new Set<BoneName>(['shoulderL', 'upperArmL', 'foreArmL', 'handL']),
  armR: new Set<BoneName>(['shoulderR', 'upperArmR', 'foreArmR', 'handR']),
};

function ease(e: Ease | undefined, t: number): number {
  switch (e) {
    case 'in':
      return easeInCubic(t);
    case 'out':
      return easeOutCubic(t);
    case 'inout':
      return easeInOutCubic(t);
    case 'back':
      return easeOutBack(t);
    default:
      return t;
  }
}

/** Global clip library; techniques register their own clips at module load. */
const CLIPS = new Map<string, Clip>();
export function registerClip(c: Clip): Clip {
  CLIPS.set(c.id, c);
  return c;
}
export function getClip(id: string): Clip | undefined {
  return CLIPS.get(id);
}
/** All registered clip ids (tooling / tests). */
export function clipIds(): string[] {
  return [...CLIPS.keys()];
}

/** Locomotion style per element / context. */
export type LocoStyle = Element | 'neutral' | 'npc' | 'elder' | 'guard' | 'child';

export interface LocomotionState {
  /** Horizontal speed (m/s). */
  speed: number;
  grounded: boolean;
  vy: number;
  sprinting: boolean;
  swimming: boolean;
  gliding: boolean;
  sliding: boolean;
  mounted: boolean;
  /** Seated/kneeling/meditating idle (overrides locomotion). */
  idleVariant?: 'stand' | 'meditate' | 'sit' | 'kneel' | 'guard' | 'work' | 'float';
  /** Turn rate (rad/s), for leaning. */
  turnRate: number;
  style: LocoStyle;
  /** Lateral movement relative to facing (-1 left .. 1 right), for strafing. */
  strafe: number;
  /** Optional: movement direction relative to facing (rad, 0 forward, ±π backward). */
  moveDir?: number;
}

// -----------------------------------------------------------------------------
// Gait styles
// -----------------------------------------------------------------------------

interface Gait {
  walkLen: number;
  runLen: number;
  duty: [number, number];
  lift: [number, number];
  bob: [number, number];
  drop: [number, number];
  lean: [number, number];
  width: number;
  armSwing: [number, number];
  elbow: [number, number];
  armOut: number;
  twist: number;
  fist: number;
  cadence: number;
  /** Idle stance. */
  idle: {
    drop: number;
    width: number;
    stagger: number;
    toeOut: number;
    chest: number;
    upper: [number, number];
    fore: number;
    asym: number;
    fist: number;
    hipsYaw: number;
    sway: number;
  };
}

const BASE_GAIT: Gait = {
  walkLen: 1.16,
  runLen: 1.65,
  duty: [0.6, 0.34],
  lift: [0.075, 0.19],
  bob: [0.022, 0.045],
  drop: [0.012, 0.09],
  lean: [0.04, 0.18],
  width: 0.012,
  armSwing: [0.32, 0.85],
  elbow: [-0.32, -1.35],
  armOut: 0.08,
  twist: 0.1,
  fist: 0.3,
  cadence: 1,
  idle: { drop: 0.012, width: 0.03, stagger: 0, toeOut: 0.12, chest: 0.02, upper: [0.04, 0.09], fore: -0.18, asym: 0, fist: 0.28, hipsYaw: 0, sway: 1 },
};

const GAITS: Record<LocoStyle, Gait> = {
  neutral: BASE_GAIT,
  npc: BASE_GAIT,
  air: {
    ...BASE_GAIT,
    walkLen: 1.24,
    runLen: 1.75,
    duty: [0.56, 0.28],
    lift: [0.09, 0.24],
    bob: [0.03, 0.07],
    drop: [0.008, 0.07],
    lean: [0.03, 0.2],
    armSwing: [0.3, 0.7],
    elbow: [-0.25, -0.9],
    fist: 0.08,
    idle: { drop: 0.02, width: 0.04, stagger: 0.04, toeOut: 0.1, chest: -0.02, upper: [-0.12, 0.2], fore: -0.45, asym: 0.1, fist: 0.06, hipsYaw: 0.06, sway: 1.6 },
  },
  water: {
    ...BASE_GAIT,
    walkLen: 1.18,
    runLen: 1.7,
    duty: [0.6, 0.33],
    lift: [0.07, 0.18],
    bob: [0.018, 0.04],
    drop: [0.03, 0.1],
    lean: [0.05, 0.16],
    armSwing: [0.28, 0.75],
    elbow: [-0.45, -1.1],
    armOut: 0.22,
    fist: 0.12,
    idle: { drop: 0.05, width: 0.08, stagger: 0.1, toeOut: 0.18, chest: 0.04, upper: [-0.42, 0.26], fore: -0.95, asym: 0.25, fist: 0.12, hipsYaw: 0.18, sway: 1.2 },
  },
  earth: {
    ...BASE_GAIT,
    walkLen: 1.08,
    runLen: 1.5,
    duty: [0.66, 0.42],
    lift: [0.055, 0.14],
    bob: [0.03, 0.06],
    drop: [0.05, 0.13],
    lean: [0.08, 0.2],
    width: 0.06,
    armSwing: [0.26, 0.6],
    elbow: [-0.65, -1.5],
    armOut: 0.2,
    twist: 0.14,
    fist: 0.95,
    cadence: 0.92,
    idle: { drop: 0.11, width: 0.17, stagger: 0.02, toeOut: 0.32, chest: 0.12, upper: [-0.32, 0.3], fore: -1.45, asym: 0, fist: 1, hipsYaw: 0, sway: 0.5 },
  },
  fire: {
    ...BASE_GAIT,
    walkLen: 1.16,
    runLen: 1.68,
    duty: [0.58, 0.32],
    lift: [0.08, 0.2],
    drop: [0.03, 0.11],
    lean: [0.1, 0.3],
    armSwing: [0.3, 0.9],
    elbow: [-0.9, -1.55],
    armOut: 0.1,
    fist: 0.9,
    cadence: 1.06,
    idle: { drop: 0.075, width: 0.1, stagger: 0.17, toeOut: 0.2, chest: 0.12, upper: [-0.75, 0.16], fore: -1.45, asym: 0.4, fist: 0.95, hipsYaw: 0.32, sway: 0.7 },
  },
  elder: {
    ...BASE_GAIT,
    walkLen: 0.85,
    runLen: 1.2,
    lift: [0.05, 0.1],
    bob: [0.012, 0.02],
    lean: [0.22, 0.3],
    armSwing: [0.14, 0.3],
    elbow: [-0.55, -0.9],
    fist: 0.45,
    cadence: 0.85,
    idle: { drop: 0.03, width: 0.04, stagger: 0, toeOut: 0.2, chest: 0.24, upper: [0.32, 0.08], fore: -1.1, asym: 0, fist: 0.5, hipsYaw: 0, sway: 0.6 },
  },
  guard: {
    ...BASE_GAIT,
    armSwing: [0.2, 0.6],
    elbow: [-0.2, -1.2],
    fist: 0.8,
    idle: { drop: 0.0, width: 0.06, stagger: 0, toeOut: 0.18, chest: -0.04, upper: [0.02, 0.05], fore: -0.06, asym: 0, fist: 0.85, hipsYaw: 0, sway: 0.25 },
  },
  child: {
    ...BASE_GAIT,
    walkLen: 0.95,
    runLen: 1.4,
    bob: [0.035, 0.07],
    cadence: 1.2,
    armSwing: [0.42, 0.95],
    idle: { ...BASE_GAIT.idle, sway: 1.8 },
  },
};

interface ActionLayer {
  clip: Clip;
  time: number;
  speed: number;
  weight: number;
  targetWeight: number;
  fadeIn: number;
  fadeOut: number;
  opts: PlayOptions;
  bones: ReadonlySet<BoneName>;
  ended: boolean;
  firedEvents: Set<number>;
}

// Scratch objects (no per-frame allocation).
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _hip = new THREE.Vector3();

export interface LegIK {
  thighX: number;
  thighZ: number;
  shin: number;
  foot: number;
  reach: number;
}

/**
 * Pure 2-bone leg IK in the hips frame. (dx,dy,dz) = ankle target minus hip joint.
 * Returns pose offsets following the bone conventions above.
 */
export function solveLegIK(dx: number, dy: number, dz: number, a: number, b: number, footPitch = 0, out?: LegIK): LegIK {
  const o = out ?? { thighX: 0, thighZ: 0, shin: 0, foot: 0, reach: 0 };
  const len = Math.hypot(dx, dy, dz);
  const maxL = (a + b) * 0.9995;
  const d = Math.min(maxL, Math.max(Math.abs(a - b) + 1e-4, len));
  const cosKnee = (a * a + b * b - d * d) / (2 * a * b);
  const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosKnee)));
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const inv = 1 / (len || 1);
  const nx = dx * inv, ny = dy * inv, nz = dz * inv;
  const roll = Math.asin(Math.max(-1, Math.min(1, nx)));
  const pitch = Math.atan2(-nz, -ny);
  o.thighX = pitch - alpha;
  o.thighZ = roll;
  o.shin = knee;
  o.foot = -(o.thighX + o.shin) + footPitch;
  o.reach = len / (a + b);
  return o;
}

/**
 * Drives bone Object3D rotations every frame:
 *   rest + procedural locomotion (IK legs) blended with action clips (+ additive flinch).
 */
export class Animator {
  readonly loco: LocomotionState = {
    speed: 0,
    grounded: true,
    vy: 0,
    sprinting: false,
    swimming: false,
    gliding: false,
    sliding: false,
    mounted: false,
    turnRate: 0,
    style: 'neutral',
    strafe: 0,
  };
  /** Hand closure 0 (open) .. 1 (fist), [left, right] — read by Humanoid each frame. */
  readonly fist: [number, number] = [0.25, 0.25];
  /** Footstep callback (foot plant during locomotion). */
  onFootstep: ((foot: 'L' | 'R') => void) | null = null;

  private phase = 0;
  private time = Math.random() * 100;
  private airBlend = 0;
  private moveBlend = 0;
  private runBlend = 0;
  private sprintBlend = 0;
  private swimBlend = 0;
  private swimMove = 0;
  private glideBlend = 0;
  private mountBlend = 0;
  private variantBlend = 0;
  private variantKind: LocomotionState['idleVariant'] = 'stand';
  private lean = 0;
  private landKick = 0;
  private flinch = 0;
  private flinchDir = 0;
  private styleFist = 0.3;
  private actions: ActionLayer[] = [];
  private readonly restRot = new Map<BoneName, THREE.Euler>();
  private readonly restPos = new Map<BoneName, THREE.Vector3>();
  /** Scratch pose buffers. */
  private readonly locoPose: Record<string, Euler3> = {};
  private readonly finalPose: Record<string, Euler3> = {};
  private hipsY = 0;
  private hipsZ = 0;
  private hipsX = 0;
  private lastPlant: [number, number] = [0, 0];
  private stepCycle = 0;
  private readonly ik: LegIK = { thighX: 0, thighZ: 0, shin: 0, foot: 0, reach: 0 };

  /** True while a full-body clip dominates (knockdown, dodges, heavy casts). */
  get busy(): boolean {
    return this.actions.some((a) => !a.ended && a.clip.mask === 'full' && a.weight > 0.5);
  }

  /** Eyes should be closed (meditation, knocked down). */
  get eyesClosed(): boolean {
    return (this.variantKind === 'meditate' && this.variantBlend > 0.6) || this.actions.some((a) => a.clip.id === 'knockdown' && a.weight > 0.6 && a.time > 0.45);
  }

  constructor(private readonly bones: Record<BoneName, THREE.Object3D>) {
    for (const name of BONE_NAMES) {
      const b = bones[name];
      this.restRot.set(name, b.rotation.clone());
      this.restPos.set(name, b.position.clone());
      this.locoPose[name] = [0, 0, 0];
      this.finalPose[name] = [0, 0, 0];
    }
  }

  /** Play a clip (by object or registered id) on the action layer. */
  play(clipOrId: Clip | string, opts: PlayOptions = {}): Clip | null {
    const clip = typeof clipOrId === 'string' ? CLIPS.get(clipOrId) : clipOrId;
    if (!clip) {
      console.warn(`[Animator] unknown clip ${String(clipOrId)}`);
      return null;
    }
    const bones = new Set<BoneName>();
    if (clip.mask) for (const b of MASK_BONES[clip.mask]) bones.add(b);
    else for (const k of clip.keys) for (const b of Object.keys(k.pose)) if ((BONE_NAMES as readonly string[]).includes(b)) bones.add(b as BoneName);
    // Fade out existing layers that overlap.
    for (const a of this.actions) {
      if (!a.ended && [...a.bones].some((b) => bones.has(b))) {
        a.targetWeight = 0;
        a.fadeOut = Math.min(a.fadeOut, opts.fadeIn ?? 0.08);
      }
    }
    this.actions.push({
      clip,
      time: 0,
      speed: opts.speed ?? 1,
      weight: (opts.fadeIn ?? 0.08) > 0 ? 0 : 1,
      targetWeight: opts.weight ?? 1,
      fadeIn: opts.fadeIn ?? 0.08,
      fadeOut: opts.fadeOut ?? 0.15,
      opts,
      bones,
      ended: false,
      firedEvents: new Set(),
    });
    return clip;
  }

  /** Stop all action clips (or those matching id). */
  stop(id?: string, fadeOut = 0.15): void {
    for (const a of this.actions) {
      if (id && a.clip.id !== id) continue;
      a.targetWeight = 0;
      a.fadeOut = fadeOut;
      a.ended = true;
      if (fadeOut <= 0) a.weight = 0;
    }
  }

  isPlaying(id: string): boolean {
    return this.actions.some((a) => a.clip.id === id && !a.ended);
  }

  /** Brief additive flinch (hit reaction). dir: -1 from left, 1 from right, 0 front. */
  hitReact(strength = 1, dir = 0): void {
    this.flinch = Math.min(1.5, this.flinch + strength);
    this.flinchDir = dir;
  }

  notifyLanding(speed: number): void {
    this.landKick = Math.min(1, speed / 14);
  }

  private samplePose(clip: Clip, t: number, bone: BoneName, out: Euler3): boolean {
    const keys = clip.keys;
    let prev: ClipKey | null = null;
    let next: ClipKey | null = null;
    for (const k of keys) {
      if (!(bone in k.pose)) continue;
      if (k.t <= t) prev = k;
      else {
        next = k;
        break;
      }
    }
    if (!prev && !next) return false;
    if (!prev) prev = next;
    if (!next) {
      const v = prev!.pose[bone]!;
      out[0] = v[0];
      out[1] = v[1];
      out[2] = v[2];
      return true;
    }
    const a = prev!.pose[bone]!, b = next.pose[bone]!;
    const span = next.t - prev!.t;
    const f = span > 0 ? ease(next.ease, clamp01((t - prev!.t) / span)) : 1;
    out[0] = lerp(a[0], b[0], f);
    out[1] = lerp(a[1], b[1], f);
    out[2] = lerp(a[2], b[2], f);
    return true;
  }

  private sampleScalar(clip: Clip, t: number, key: 'hipsY' | 'hipsZ' | 'hipsX' | 'fistL' | 'fistR'): number | null {
    let prev: ClipKey | null = null, next: ClipKey | null = null;
    for (const k of clip.keys) {
      if (k.pose[key] === undefined) continue;
      if (k.t <= t) prev = k;
      else {
        next = k;
        break;
      }
    }
    if (!prev && !next) return null;
    if (!prev) return next!.pose[key]!;
    if (!next) return prev.pose[key]!;
    const span = next.t - prev.t;
    const f = span > 0 ? ease(next.ease, clamp01((t - prev.t) / span)) : 1;
    return lerp(prev.pose[key]!, next.pose[key]!, f);
  }

  private setLoco(b: BoneName, x: number, y: number, z: number): void {
    const p = this.locoPose[b];
    p[0] = x;
    p[1] = y;
    p[2] = z;
  }

  private blendLoco(b: BoneName, x: number, y: number, z: number, w: number): void {
    const p = this.locoPose[b];
    p[0] = lerp(p[0], x, w);
    p[1] = lerp(p[1], y, w);
    p[2] = lerp(p[2], z, w);
  }

  /** Solve one leg toward an ankle target given in the root frame (rest-relative). */
  private legTo(side: 1 | -1, tx: number, ty: number, tz: number, footPitch: number, w: number): void {
    const th = this.bones[side > 0 ? 'thighL' : 'thighR'];
    const sh = this.bones[side > 0 ? 'shinL' : 'shinR'];
    const ft = this.bones[side > 0 ? 'footL' : 'footR'];
    const a = Math.abs(sh.position.y) || 0.425;
    const b = Math.abs(ft.position.y) || 0.415;
    const hipsRest = this.restPos.get('hips')!;
    const hp = this.locoPose.hips;
    // Hip joint in root space and target in the hips frame.
    _e.set(hp[0], hp[1], hp[2]);
    _q.setFromEuler(_e);
    _hip.copy(th.position).applyQuaternion(_q);
    _hip.x += hipsRest.x + this.hipsX;
    _hip.y += hipsRest.y + this.hipsY;
    _hip.z += hipsRest.z + this.hipsZ;
    _v.set(tx - _hip.x, ty - _hip.y, tz - _hip.z).applyQuaternion(_q.invert());
    const ik = solveLegIK(_v.x, _v.y, _v.z, a, b, footPitch, this.ik);
    const n = side > 0 ? 'L' : 'R';
    this.blendLoco(`thigh${n}` as BoneName, ik.thighX, this.locoPose[`thigh${n}` as BoneName][1], ik.thighZ, w);
    this.blendLoco(`shin${n}` as BoneName, ik.shin, 0, 0, w);
    this.blendLoco(`foot${n}` as BoneName, ik.foot, 0, -ik.thighZ * 0.8, w);
  }

  private computeLocomotion(dt: number): void {
    const L = this.loco;
    const s = L.style;
    const G = GAITS[s] ?? BASE_GAIT;
    this.time += dt;
    const t = this.time;

    // ---- Blend targets ----
    const grounded = L.grounded && !L.swimming && !L.mounted;
    const turning = grounded ? clamp01((Math.abs(L.turnRate) - 1.2) / 3) * (1 - clamp01(L.speed / 1.2)) : 0;
    const moving = grounded ? Math.max(clamp01(L.speed / 1.1), turning * 0.6) : 0;
    this.moveBlend = damp(this.moveBlend, moving, 9, dt);
    this.runBlend = damp(this.runBlend, clamp01((L.speed - 2.6) / 2.6), 7, dt);
    this.sprintBlend = damp(this.sprintBlend, L.sprinting && L.speed > 4 ? 1 : 0, 6, dt);
    this.airBlend = damp(this.airBlend, !L.grounded && !L.swimming && !L.gliding && !L.mounted ? 1 : 0, 12, dt);
    this.swimBlend = damp(this.swimBlend, L.swimming ? 1 : 0, 5, dt);
    this.swimMove = damp(this.swimMove, clamp01(L.speed / 1.6), 4, dt);
    this.glideBlend = damp(this.glideBlend, L.gliding ? 1 : 0, 6, dt);
    this.mountBlend = damp(this.mountBlend, L.mounted ? 1 : 0, 10, dt);
    const variant = L.idleVariant && L.idleVariant !== 'stand' && L.speed < 0.3 && (L.grounded || L.idleVariant === 'float') && !L.swimming && !L.mounted ? 1 : 0;
    if (variant && L.idleVariant !== this.variantKind && this.variantBlend < 0.05) this.variantKind = L.idleVariant;
    this.variantBlend = damp(this.variantBlend, variant && L.idleVariant === this.variantKind ? 1 : 0, 3.5, dt);
    if (this.variantBlend < 0.02 && variant) this.variantKind = L.idleVariant;
    const leanTarget = Math.max(-0.32, Math.min(0.32, -L.turnRate * 0.055 * clamp01(L.speed / 5)));
    this.lean = damp(this.lean, leanTarget, 7, dt);
    this.landKick = damp(this.landKick, 0, 5, dt);

    const m = this.moveBlend;
    const r = this.runBlend;
    const sp = this.sprintBlend;
    const I = G.idle;
    const breath = Math.sin(t * 1.5) * 0.022;
    const sway = Math.sin(t * 0.6) * 0.025 * I.sway;

    // ---- Idle stance (upper body) ----
    let hipsY = -I.drop + breath * 0.15;
    let hipsZ = 0;
    let hipsX = sway * 0.4;
    const flow = s === 'water' ? Math.sin(t * 0.9) : 0;
    this.setLoco('hips', 0, I.hipsYaw + sway * 0.3, 0);
    this.setLoco('spine', I.chest * 0.45, -I.hipsYaw * 0.55 - sway * 0.4, -sway * 0.3);
    this.setLoco('chest', I.chest * 0.55 + breath, -I.hipsYaw * 0.35, 0);
    this.setLoco('neck', -I.chest * 0.35, 0, 0);
    this.setLoco('head', -I.chest * 0.3 + Math.sin(t * 0.37) * 0.035, Math.sin(t * 0.23) * 0.1 - I.hipsYaw * 0.15, 0);
    this.setLoco('shoulderL', 0, 0, 0);
    this.setLoco('shoulderR', 0, 0, 0);
    const asym = I.asym;
    this.setLoco('upperArmL', I.upper[0] - asym * 0.35 + breath * 0.6 + flow * 0.08, flow * 0.1, I.upper[1] + flow * 0.06);
    this.setLoco('upperArmR', I.upper[0] + asym * 0.3 + breath * 0.6 - flow * 0.08, -flow * 0.1, -I.upper[1] + flow * 0.06);
    this.setLoco('foreArmL', I.fore - asym * 0.1 + flow * 0.12, 0, 0);
    this.setLoco('foreArmR', I.fore + asym * 0.1 - flow * 0.12, 0, 0);
    this.setLoco('handL', flow * 0.15, 0, 0);
    this.setLoco('handR', -flow * 0.15, 0, 0);
    this.setLoco('thighL', 0, I.toeOut, 0);
    this.setLoco('thighR', 0, -I.toeOut, 0);
    this.setLoco('shinL', 0, 0, 0);
    this.setLoco('shinR', 0, 0, 0);
    this.setLoco('footL', 0, 0, 0);
    this.setLoco('footR', 0, 0, 0);
    let fist = I.fist;

    // ---- Gait (phase, stride synced to speed) ----
    const speed = Math.max(L.speed, turning * 0.6);
    const strideLen = lerp(G.walkLen + 0.12 * speed, G.runLen + 0.2 * speed, r);
    const f = (speed / Math.max(0.3, strideLen)) * G.cadence;
    const prevPhase = this.phase;
    this.phase = (this.phase + f * dt) % 1;
    const duty = lerp(G.duty[0], G.duty[1], r);
    const S = Math.min(0.52, (speed * duty) / Math.max(0.2, f)) * (L.speed > 0.2 ? 1 : 0.15);
    const lift = lerp(G.lift[0], G.lift[1], r) * (0.4 + 0.6 * clamp01(speed / 1.5));
    const dir = L.moveDir ?? 0;
    const fwd = Math.cos(dir), lat = Math.sin(dir) + L.strafe * 0.7;
    // Footsteps at plant (start of stance).
    if (m > 0.5) {
      for (const [k, off] of [[0, 0], [1, 0.5]] as Array<[number, number]>) {
        const a = (prevPhase + off) % 1;
        const b = (this.phase + off) % 1;
        if (b < a && this.lastPlant[k] !== Math.floor(t * 10)) {
          this.lastPlant[k] = Math.floor(t * 10);
          this.onFootstep?.(k === 0 ? 'L' : 'R');
        }
      }
    }

    if (m > 0.001) {
      const armSwing = lerp(G.armSwing[0], G.armSwing[1], r);
      const elbow = lerp(G.elbow[0], G.elbow[1], r);
      const leanF = lerp(G.lean[0], G.lean[1], r) + sp * (s === 'air' ? 0.24 : 0.1);
      const ph = this.phase * Math.PI * 2;
      const sinp = Math.sin(ph), cosp = Math.cos(ph);
      // Body bob: lowest at foot plant (twice per cycle).
      const bob = lerp(G.bob[0], G.bob[1], r) * (s === 'air' ? 1 + sp * 0.5 : 1);
      const yBob = -lerp(G.drop[0], G.drop[1], r) - (r > 0.5 ? Math.abs(Math.cos(ph)) : 1 - Math.abs(Math.cos(ph))) * bob;
      hipsY = lerp(hipsY, yBob, m);
      hipsZ = lerp(hipsZ, leanF * 0.06, m);
      hipsX = lerp(hipsX, -sinp * 0.012 * (1 - r), m);
      this.blendLoco('hips', 0, sinp * G.twist * (1 - r * 0.4), -sinp * 0.03 + this.lean * 0.4, m);
      this.blendLoco('spine', leanF * 0.7, -sinp * G.twist * 0.9, this.lean * 0.6, m);
      this.blendLoco('chest', leanF * 0.3 + breath * 0.5, -sinp * G.twist * 0.6, this.lean * 0.3, m);
      this.blendLoco('neck', -leanF * 0.35, 0, -this.lean * 0.3, m);
      this.blendLoco('head', -leanF * 0.55, sinp * 0.04, -this.lean * 0.4, m);
      if (s === 'air' && sp > 0.01) {
        // Airbender sprint: arms swept back, gliding stride.
        const k = sp;
        this.blendLoco('upperArmL', lerp(sinp * armSwing, 1.05, k), 0, lerp(G.armOut, 0.42, k), m);
        this.blendLoco('upperArmR', lerp(-sinp * armSwing, 1.05, k), 0, lerp(-G.armOut, -0.42, k), m);
        this.blendLoco('foreArmL', lerp(elbow, -0.08, k), 0, 0, m);
        this.blendLoco('foreArmR', lerp(elbow, -0.08, k), 0, 0, m);
        this.blendLoco('handL', 0.3 * k, 0, 0, m);
        this.blendLoco('handR', 0.3 * k, 0, 0, m);
      } else if (s === 'water') {
        // Flowing arms: wider, with the forearms trailing the upper arms.
        const lag = Math.sin(ph - 0.7);
        this.blendLoco('upperArmL', sinp * armSwing - 0.12, sinp * 0.15, G.armOut + 0.06 * Math.cos(ph), m);
        this.blendLoco('upperArmR', -sinp * armSwing - 0.12, -sinp * 0.15, -G.armOut - 0.06 * Math.cos(ph), m);
        this.blendLoco('foreArmL', elbow - Math.max(0, lag) * 0.35, 0, 0, m);
        this.blendLoco('foreArmR', elbow - Math.max(0, -lag) * 0.35, 0, 0, m);
        this.blendLoco('handL', lag * 0.25, 0, 0, m);
        this.blendLoco('handR', -lag * 0.25, 0, 0, m);
      } else {
        const punch = s === 'fire' ? 0.12 : 0;
        this.blendLoco('upperArmL', sinp * armSwing - punch, 0, G.armOut, m);
        this.blendLoco('upperArmR', -sinp * armSwing - punch, 0, -G.armOut, m);
        this.blendLoco('foreArmL', elbow - Math.max(0, -sinp) * 0.25, 0, 0, m);
        this.blendLoco('foreArmR', elbow - Math.max(0, sinp) * 0.25, 0, 0, m);
        this.blendLoco('handL', 0, 0, 0, m);
        this.blendLoco('handR', 0, 0, 0, m);
      }
      if (s === 'earth') {
        this.blendLoco('shoulderL', 0, 0, -0.06, m);
        this.blendLoco('shoulderR', 0, 0, 0.06, m);
      }
      fist = lerp(fist, G.fist, m);
    }
    this.hipsY = hipsY;
    this.hipsZ = hipsZ;
    this.hipsX = hipsX;

    // ---- Legs: planted IK toward foot targets ----
    const restAnkle = 0.065;
    if (this.mountBlend < 0.999 && this.swimBlend < 0.999 && this.glideBlend < 0.999) {
      for (const side of [1, -1] as const) {
        const hipX = Math.abs(this.bones[side > 0 ? 'thighL' : 'thighR'].position.x) || 0.093;
        // Idle target.
        const ix = side * (hipX + I.width + 0.012);
        const iz = (side > 0 ? 1 : -1) * I.stagger * 0.5 + 0.012;
        let tx = ix, ty = restAnkle, tz = iz, pitch = 0;
        if (m > 0.001) {
          const legPh = (this.phase + (side > 0 ? 0 : 0.5)) % 1;
          let along: number, up: number;
          if (legPh < duty) {
            const u = legPh / duty;
            along = S * 0.5 - S * u;
            up = 0;
            pitch = lerp(-0.18, 0.28, u) * clamp01(speed / 2);
            up += Math.max(0, u - 0.75) * 0.12 * clamp01(speed / 2);
          } else {
            const u = (legPh - duty) / (1 - duty);
            const e = u * u * (3 - 2 * u);
            along = -S * 0.5 + S * e;
            up = lift * Math.pow(Math.sin(Math.PI * Math.pow(u, r > 0.5 ? 0.7 : 0.9)), 0.85);
            pitch = lerp(0.5, -0.25, u) * clamp01(speed / 2);
          }
          const mx = side * (hipX + G.width + 0.01) + along * lat * 0.6;
          const mz = along * fwd + 0.02;
          tx = lerp(tx, mx, m);
          ty = lerp(ty, restAnkle + up, m);
          tz = lerp(tz, mz, m);
        }
        this.legTo(side, tx, ty, tz, pitch, 1);
      }
    }

    // ---- Airborne ----
    const a = this.airBlend;
    if (a > 0.001) {
      const rising = clamp01(L.vy / 4 + 0.5);
      const graceful = s === 'air' ? 1 : 0;
      this.blendLoco('thighL', lerp(-0.25, -0.85, rising), 0.05, 0.08, a);
      this.blendLoco('thighR', lerp(-0.05, -0.25, rising) + graceful * -0.2, -0.05, -0.08, a);
      this.blendLoco('shinL', lerp(0.35, 1.25, rising), 0, 0, a);
      this.blendLoco('shinR', lerp(0.25, 0.75, rising), 0, 0, a);
      this.blendLoco('footL', 0.35, 0, 0, a);
      this.blendLoco('footR', 0.45, 0, 0, a);
      this.blendLoco('upperArmL', lerp(-0.25, -0.75, rising), 0, lerp(1.0, 0.55, rising) + graceful * 0.2, a);
      this.blendLoco('upperArmR', lerp(-0.25, -0.75, rising), 0, -lerp(1.0, 0.55, rising) - graceful * 0.2, a);
      this.blendLoco('foreArmL', -0.55, 0, 0, a);
      this.blendLoco('foreArmR', -0.55, 0, 0, a);
      this.blendLoco('spine', lerp(-0.05, 0.12, rising), 0, this.lean * 0.5, a);
      this.blendLoco('head', lerp(0.1, -0.1, rising), 0, 0, a);
      this.hipsY = lerp(this.hipsY, 0, a);
      fist = lerp(fist, 0.3, a);
    }

    // ---- Glide (airbender) ----
    const g = this.glideBlend;
    if (g > 0.001) {
      const flutter = Math.sin(t * 7) * 0.04;
      this.blendLoco('hips', 1.15, 0, this.lean * 1.2, g);
      this.blendLoco('spine', -0.15, 0, 0, g);
      this.blendLoco('chest', -0.12, 0, 0, g);
      this.blendLoco('neck', -0.35, 0, 0, g);
      this.blendLoco('head', -0.55, 0, 0, g);
      this.blendLoco('upperArmL', -0.25 + flutter, 0, 1.38, g);
      this.blendLoco('upperArmR', -0.25 - flutter, 0, -1.38, g);
      this.blendLoco('foreArmL', -0.12, 0, 0, g);
      this.blendLoco('foreArmR', -0.12, 0, 0, g);
      this.blendLoco('handL', 0, 0, 0.2, g);
      this.blendLoco('handR', 0, 0, -0.2, g);
      this.blendLoco('thighL', 0.12, 0, 0.05, g);
      this.blendLoco('thighR', 0.18, 0, -0.05, g);
      this.blendLoco('shinL', 0.35, 0, 0, g);
      this.blendLoco('shinR', 0.25, 0, 0, g);
      this.blendLoco('footL', 0.6, 0, 0, g);
      this.blendLoco('footR', 0.6, 0, 0, g);
      this.hipsY = lerp(this.hipsY, 0, g);
      this.hipsZ = lerp(this.hipsZ, 0, g);
      fist = lerp(fist, 0.05, g);
    }

    // ---- Swim ----
    const sw = this.swimBlend;
    if (sw > 0.001) {
      const mv = this.swimMove;
      const st = t * (2.2 + mv * 1.2);
      const kick = Math.sin(t * 9) * 0.32 * mv;
      // Freestyle when moving, treading water when still.
      const strokeL = Math.sin(st), strokeR = Math.sin(st + Math.PI);
      this.blendLoco('hips', lerp(0.08, 1.12, mv), 0, Math.sin(st) * 0.12 * mv, sw);
      this.blendLoco('spine', lerp(0.05, -0.1, mv), Math.sin(st) * 0.15 * mv, 0, sw);
      this.blendLoco('neck', lerp(0, -0.45, mv), 0, 0, sw);
      this.blendLoco('head', lerp(0, -0.55, mv), Math.max(0, Math.sin(st)) * 0.4 * mv, 0, sw);
      this.blendLoco('upperArmL', lerp(-0.45 + Math.sin(t * 2.4) * 0.2, -1.5 - strokeL * 1.4, mv), 0, lerp(0.75, 0.25, mv), sw);
      this.blendLoco('upperArmR', lerp(-0.45 - Math.sin(t * 2.4) * 0.2, -1.5 - strokeR * 1.4, mv), 0, lerp(-0.75, -0.25, mv), sw);
      this.blendLoco('foreArmL', lerp(-0.5, -0.25 - Math.max(0, -strokeL) * 0.6, mv), 0, 0, sw);
      this.blendLoco('foreArmR', lerp(-0.5, -0.25 - Math.max(0, -strokeR) * 0.6, mv), 0, 0, sw);
      this.blendLoco('thighL', lerp(-0.3 + Math.sin(t * 2.4) * 0.3, kick, mv), 0, 0.08, sw);
      this.blendLoco('thighR', lerp(-0.3 - Math.sin(t * 2.4) * 0.3, -kick, mv), 0, -0.08, sw);
      this.blendLoco('shinL', lerp(0.7 + Math.cos(t * 2.4) * 0.35, 0.25 + Math.max(0, kick), mv), 0, 0, sw);
      this.blendLoco('shinR', lerp(0.7 - Math.cos(t * 2.4) * 0.35, 0.25 + Math.max(0, -kick), mv), 0, 0, sw);
      this.blendLoco('footL', 0.6, 0, 0, sw);
      this.blendLoco('footR', 0.6, 0, 0, sw);
      this.hipsY = lerp(this.hipsY, lerp(0, 0.3, mv), sw);
      this.hipsZ = lerp(this.hipsZ, 0, sw);
      fist = lerp(fist, 0.15, sw);
    }

    // ---- Mounted (pelvis rests on the saddle at the root) ----
    const mb = this.mountBlend;
    if (mb > 0.001) {
      const ride = Math.sin(t * 4.2) * 0.02;
      this.blendLoco('hips', 0.04, 0, 0, mb);
      this.blendLoco('thighL', -1.38, 0.15, 0.45, mb);
      this.blendLoco('thighR', -1.38, -0.15, -0.45, mb);
      this.blendLoco('shinL', 1.35, 0, 0, mb);
      this.blendLoco('shinR', 1.35, 0, 0, mb);
      this.blendLoco('footL', 0.1, 0, -0.2, mb);
      this.blendLoco('footR', 0.1, 0, 0.2, mb);
      this.blendLoco('spine', 0.1 + ride, 0, 0, mb);
      this.blendLoco('upperArmL', -0.55, 0, 0.18, mb);
      this.blendLoco('upperArmR', -0.55, 0, -0.18, mb);
      this.blendLoco('foreArmL', -1.0, 0, 0, mb);
      this.blendLoco('foreArmR', -1.0, 0, 0, mb);
      this.hipsY = lerp(this.hipsY, -0.82 + ride, mb);
      this.hipsZ = lerp(this.hipsZ, 0, mb);
      fist = lerp(fist, 0.85, mb);
    }

    // ---- Idle variants ----
    const vb = this.variantBlend;
    if (vb > 0.001) {
      const lt = (b: BoneName, x: number, y: number, z: number) => this.blendLoco(b, x, y, z, vb);
      switch (this.variantKind) {
        case 'meditate':
        case 'float': {
          const fl = this.variantKind === 'float';
          lt('hips', 0, 0, 0);
          lt('thighL', -1.45, 0.45, 0.78);
          lt('thighR', -1.45, -0.45, -0.78);
          lt('shinL', 2.45, 0, 0);
          lt('shinR', 2.45, 0, 0);
          lt('footL', -0.35, 0, -0.4);
          lt('footR', -0.35, 0, 0.4);
          lt('spine', 0.02, 0, 0);
          lt('chest', breath * 0.8, 0, 0);
          lt('neck', 0.05, 0, 0);
          lt('head', 0.12, 0, 0);
          lt('upperArmL', -0.42, 0.25, 0.32);
          lt('upperArmR', -0.42, -0.25, -0.32);
          lt('foreArmL', -1.15, -0.5, 0);
          lt('foreArmR', -1.15, 0.5, 0);
          lt('handL', -0.2, 0, -0.5);
          lt('handR', -0.2, 0, 0.5);
          this.hipsY = lerp(this.hipsY, fl ? -0.35 + Math.sin(t * 1.4) * 0.06 : -0.8, vb);
          this.hipsZ = lerp(this.hipsZ, 0, vb);
          fist = lerp(fist, 0.1, vb);
          break;
        }
        case 'sit':
          lt('hips', -0.1, 0, 0);
          lt('thighL', -1.25, 0.12, 0.28);
          lt('thighR', -1.25, -0.12, -0.28);
          lt('shinL', 1.55, 0, 0);
          lt('shinR', 1.55, 0, 0);
          lt('footL', -0.2, 0, 0);
          lt('footR', -0.2, 0, 0);
          lt('spine', 0.28, 0, 0);
          lt('head', 0.05, 0, 0);
          lt('upperArmL', -0.75, 0, 0.2);
          lt('upperArmR', -0.75, 0, -0.2);
          lt('foreArmL', -0.75, 0, 0);
          lt('foreArmR', -0.75, 0, 0);
          this.hipsY = lerp(this.hipsY, -0.82, vb);
          fist = lerp(fist, 0.35, vb);
          break;
        case 'kneel':
          lt('hips', 0, 0, 0);
          lt('thighL', -1.4, 0, 0.1);
          lt('shinL', 1.42, 0, 0);
          lt('footL', 0, 0, 0);
          lt('thighR', 0.22, 0, -0.1);
          lt('shinR', 1.8, 0, 0);
          lt('footR', 0.6, 0, 0);
          lt('spine', 0.14, 0, 0);
          lt('head', 0.18, 0, 0);
          lt('upperArmL', -0.75, 0, 0.12);
          lt('foreArmL', -0.7, 0, 0);
          lt('upperArmR', -0.1, 0, -0.12);
          lt('foreArmR', -0.3, 0, 0);
          this.hipsY = lerp(this.hipsY, -0.43, vb);
          this.hipsZ = lerp(this.hipsZ, -0.05, vb);
          fist = lerp(fist, 0.5, vb);
          break;
        case 'guard':
          lt('spine', -0.04, 0, 0);
          lt('chest', -0.03 + breath * 0.5, 0, 0);
          lt('upperArmL', 0.32, 0.3, 0.1);
          lt('upperArmR', 0.32, -0.3, -0.1);
          lt('foreArmL', -1.25, 0, 0);
          lt('foreArmR', -1.25, 0, 0);
          lt('head', -0.02, Math.sin(t * 0.2) * 0.25, 0);
          fist = lerp(fist, 0.6, vb);
          break;
        case 'work': {
          const w = Math.sin(t * 3.2);
          const hit = Math.pow(Math.max(0, Math.sin(t * 3.2)), 3);
          lt('spine', 0.5, 0, 0);
          lt('chest', 0.15, 0, 0);
          lt('head', 0.15, 0, 0);
          lt('upperArmL', -1.05 + w * 0.25, 0, 0.12);
          lt('upperArmR', -1.35 - hit * 0.6 + 0.4, 0, -0.12);
          lt('foreArmL', -0.75, 0, 0);
          lt('foreArmR', -0.9 + hit * 0.5, 0, 0);
          this.hipsY = lerp(this.hipsY, -0.16, vb);
          this.hipsZ = lerp(this.hipsZ, -0.06, vb);
          fist = lerp(fist, 0.85, vb);
          break;
        }
      }
    }

    // ---- Landing absorption (feet stay planted via IK) ----
    if (this.landKick > 0.01 && this.airBlend < 0.5) {
      const k = this.landKick;
      this.hipsY -= k * 0.2;
      this.locoPose.spine[0] += k * 0.28;
      this.locoPose.head[0] -= k * 0.12;
      this.locoPose.upperArmL[2] += k * 0.35;
      this.locoPose.upperArmR[2] -= k * 0.35;
      if (this.mountBlend < 0.5 && this.swimBlend < 0.5) {
        for (const side of [1, -1] as const) {
          const hipX = Math.abs(this.bones[side > 0 ? 'thighL' : 'thighR'].position.x) || 0.093;
          this.legTo(side, side * (hipX + 0.05), restAnkle, 0.04, 0, Math.min(1, k * 1.5));
        }
      }
    }
    this.styleFist = fist;
    this.stepCycle = this.phase;
  }

  update(dt: number): void {
    this.computeLocomotion(dt);
    for (const name of BONE_NAMES) {
      const lp = this.locoPose[name];
      const fp = this.finalPose[name];
      fp[0] = lp[0];
      fp[1] = lp[1];
      fp[2] = lp[2];
    }
    let hipsY = this.hipsY;
    let hipsZ = this.hipsZ;
    let hipsX = this.hipsX;
    let fistL = this.styleFist;
    let fistR = this.styleFist;

    const tmp: Euler3 = [0, 0, 0];
    for (const a of this.actions) {
      // Advance time & weights.
      const prevT = a.time;
      a.time += dt * a.speed;
      if (!a.ended) {
        if (a.time >= a.clip.duration) {
          if (a.clip.loop) a.time %= a.clip.duration;
          else if (!a.opts.hold) {
            a.ended = true;
            a.targetWeight = 0;
            a.opts.onEnd?.();
          }
        }
        if (a.weight < a.targetWeight) a.weight = Math.min(a.targetWeight, a.weight + dt / Math.max(0.001, a.fadeIn));
      }
      if (a.targetWeight === 0) a.weight = Math.max(0, a.weight - dt / Math.max(0.001, a.fadeOut));
      if (a.clip.events && a.opts.onEvent) {
        a.clip.events.forEach((ev, i) => {
          if (!a.firedEvents.has(i) && prevT <= ev.t && a.time >= ev.t) {
            a.firedEvents.add(i);
            a.opts.onEvent!(ev.name);
          }
        });
      }
      const ct = Math.min(a.time, a.clip.duration);
      const w = a.weight;
      if (w <= 0) continue;
      for (const b of a.bones) {
        if (!this.samplePose(a.clip, ct, b, tmp)) continue;
        const fp = this.finalPose[b];
        fp[0] = lerp(fp[0], tmp[0], w);
        fp[1] = lerp(fp[1], tmp[1], w);
        fp[2] = lerp(fp[2], tmp[2], w);
      }
      const hy = this.sampleScalar(a.clip, ct, 'hipsY');
      if (hy !== null) hipsY = lerp(hipsY, hy, w);
      const hz = this.sampleScalar(a.clip, ct, 'hipsZ');
      if (hz !== null) hipsZ = lerp(hipsZ, hz, w);
      const hx = this.sampleScalar(a.clip, ct, 'hipsX');
      if (hx !== null) hipsX = lerp(hipsX, hx, w);
      const fl = this.sampleScalar(a.clip, ct, 'fistL');
      if (fl !== null) fistL = lerp(fistL, fl, w);
      const fr = this.sampleScalar(a.clip, ct, 'fistR');
      if (fr !== null) fistR = lerp(fistR, fr, w);
    }
    this.actions = this.actions.filter((a) => !(a.ended && a.weight <= 0));

    // Additive flinch (directional).
    if (this.flinch > 0.001) {
      this.flinch = damp(this.flinch, 0, 7, dt);
      const f = this.flinch;
      this.finalPose.spine[0] -= f * 0.3;
      this.finalPose.spine[1] += f * 0.25 * this.flinchDir;
      this.finalPose.spine[2] += f * 0.12 * this.flinchDir;
      this.finalPose.head[0] -= f * 0.25;
      this.finalPose.upperArmL[2] += f * 0.3;
      this.finalPose.upperArmR[2] -= f * 0.3;
      this.finalPose.foreArmL[0] -= f * 0.3;
      this.finalPose.foreArmR[0] -= f * 0.3;
      hipsZ -= f * 0.035;
    }

    this.fist[0] = clamp01(fistL);
    this.fist[1] = clamp01(fistR);

    // Apply to bones.
    for (const name of BONE_NAMES) {
      const bone = this.bones[name];
      const rest = this.restRot.get(name)!;
      const p = this.finalPose[name];
      bone.rotation.set(rest.x + p[0], rest.y + p[1], rest.z + p[2]);
    }
    const hipsRest = this.restPos.get('hips')!;
    this.bones.hips.position.set(hipsRest.x + hipsX, hipsRest.y + hipsY, hipsRest.z + hipsZ);
  }

  /** Current normalised gait phase (0..1, left foot plant at 0). */
  get gaitPhase(): number {
    return this.stepCycle;
  }
}
