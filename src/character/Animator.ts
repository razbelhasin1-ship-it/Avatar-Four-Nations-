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
 *    +z = lean toward the character's right?  (z rolls toward -X)  — use sparingly
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
 *    hipsZ (m, forward offset) for crouches / lunges.
 *
 * Clips are lists of keyed poses; any bone missing from a key is unaffected by
 * that clip (falls through to locomotion) unless `mask` says otherwise.
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
export type Pose = Partial<Record<BoneName, Euler3>> & { hipsY?: number; hipsZ?: number };

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
}

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

/**
 * Drives bone Object3D rotations every frame:
 *   rest + locomotion (procedural) blended with action clips (+ additive flinch).
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
  private phase = 0;
  private time = Math.random() * 100;
  private airBlend = 0;
  private moveBlend = 0;
  private runBlend = 0;
  private swimBlend = 0;
  private glideBlend = 0;
  private mountBlend = 0;
  private variantBlend = 0;
  private lean = 0;
  private landKick = 0;
  private flinch = 0;
  private flinchDir = 0;
  private actions: ActionLayer[] = [];
  private readonly restRot = new Map<BoneName, THREE.Euler>();
  private readonly restPos = new Map<BoneName, THREE.Vector3>();
  /** Scratch pose buffers. */
  private readonly locoPose: Record<string, Euler3> = {};
  private readonly finalPose: Record<string, Euler3> = {};
  private hipsY = 0;
  private hipsZ = 0;
  /** Footstep callback (foot plant during locomotion). */
  onFootstep: ((foot: 'L' | 'R') => void) | null = null;
  private lastStepSign = 0;
  /** Seconds left in a full-body lock (e.g. knockdown). */
  get busy(): boolean {
    return this.actions.some((a) => !a.ended && a.clip.mask === 'full' && a.weight > 0.5);
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
      out[0] = v[0]; out[1] = v[1]; out[2] = v[2];
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

  private sampleScalar(clip: Clip, t: number, key: 'hipsY' | 'hipsZ'): number | null {
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
    p[0] = x; p[1] = y; p[2] = z;
  }

  private computeLocomotion(dt: number): void {
    const L = this.loco;
    const s = L.style;
    this.time += dt;
    const t = this.time;

    // Blend targets
    const moving = L.grounded && !L.swimming ? clamp01(L.speed / 1.5) : 0;
    this.moveBlend = damp(this.moveBlend, moving, 10, dt);
    this.runBlend = damp(this.runBlend, clamp01((L.speed - 2.5) / 4), 8, dt);
    this.airBlend = damp(this.airBlend, !L.grounded && !L.swimming && !L.gliding && !L.mounted ? 1 : 0, 12, dt);
    this.swimBlend = damp(this.swimBlend, L.swimming ? 1 : 0, 6, dt);
    this.glideBlend = damp(this.glideBlend, L.gliding ? 1 : 0, 6, dt);
    this.mountBlend = damp(this.mountBlend, L.mounted ? 1 : 0, 10, dt);
    const variant = L.idleVariant && L.idleVariant !== 'stand' && L.speed < 0.3 && L.grounded ? 1 : 0;
    this.variantBlend = damp(this.variantBlend, variant, 4, dt);
    this.lean = damp(this.lean, Math.max(-0.35, Math.min(0.35, -L.turnRate * 0.06 * clamp01(L.speed / 6))), 8, dt);
    this.landKick = damp(this.landKick, 0, 6, dt);

    // Stride phase advances with distance travelled.
    const stride = lerp(1.25, 2.1, this.runBlend) * (s === 'air' ? 1.15 : s === 'earth' ? 0.92 : 1);
    this.phase += (L.speed / stride) * Math.PI * dt;
    const ph = this.phase;
    const sinp = Math.sin(ph);
    const cosp = Math.cos(ph);
    // Footsteps at phase zero-crossings.
    const sign = Math.sign(sinp);
    if (this.moveBlend > 0.5 && sign !== this.lastStepSign && sign !== 0) {
      this.onFootstep?.(sign > 0 ? 'L' : 'R');
    }
    this.lastStepSign = sign;

    // ---- Idle stance per style ----
    const breath = Math.sin(t * 1.6) * 0.025;
    let stanceWide = 0.06, knee = 0.06, armOut = 0.12, elbow = -0.18, chestFwd = 0.02, guard = 0;
    if (s === 'earth') { stanceWide = 0.2; knee = 0.28; armOut = 0.22; elbow = -0.6; chestFwd = 0.12; guard = 0.25; }
    else if (s === 'fire') { stanceWide = 0.12; knee = 0.18; armOut = 0.15; elbow = -1.1; chestFwd = 0.1; guard = 0.65; }
    else if (s === 'water') { stanceWide = 0.1; knee = 0.14; armOut = 0.28; elbow = -0.55; chestFwd = 0.04; guard = 0.2; }
    else if (s === 'air') { stanceWide = 0.05; knee = 0.08; armOut = 0.16; elbow = -0.35; chestFwd = -0.02; guard = 0.05; }
    else if (s === 'elder') { knee = 0.12; chestFwd = 0.22; elbow = -0.4; armOut = 0.1; }
    else if (s === 'guard') { stanceWide = 0.1; elbow = -0.25; }
    const sway = Math.sin(t * 0.7) * 0.03;

    let hipsY = -knee * 0.08 + breath * 0.3;
    let hipsZ = 0;
    this.setLoco('hips', 0, sway * 0.5, 0);
    this.setLoco('spine', chestFwd * 0.5, -sway, 0);
    this.setLoco('chest', chestFwd * 0.5 + breath, 0, 0);
    this.setLoco('neck', -chestFwd * 0.4, 0, 0);
    this.setLoco('head', -chestFwd * 0.3 + Math.sin(t * 0.37) * 0.04, Math.sin(t * 0.23) * 0.12, 0);
    this.setLoco('shoulderL', 0, 0, 0);
    this.setLoco('shoulderR', 0, 0, 0);
    this.setLoco('upperArmL', -guard * 0.6 + breath, 0, armOut);
    this.setLoco('upperArmR', -guard * 0.6 + breath, 0, -armOut);
    this.setLoco('foreArmL', elbow, 0, 0);
    this.setLoco('foreArmR', elbow, 0, 0);
    this.setLoco('handL', 0, 0, 0);
    this.setLoco('handR', 0, 0, 0);
    this.setLoco('thighL', -knee * 0.5, 0, stanceWide);
    this.setLoco('thighR', -knee * 0.5, 0, -stanceWide);
    this.setLoco('shinL', knee, 0, 0);
    this.setLoco('shinR', knee, 0, 0);
    this.setLoco('footL', -knee * 0.5, 0, -stanceWide * 0.6);
    this.setLoco('footR', -knee * 0.5, 0, stanceWide * 0.6);

    // ---- Walk / run cycle ----
    const m = this.moveBlend;
    if (m > 0.001) {
      const r = this.runBlend;
      const amp = lerp(0.42, 0.85, r) * (s === 'earth' ? 0.85 : 1);
      const kneeAmp = lerp(0.55, 1.25, r);
      const armAmp = lerp(0.35, 0.9, r);
      const leanF = lerp(0.04, 0.22, r) + (L.sprinting ? 0.12 : 0) + (s === 'fire' ? 0.06 : 0);
      const blendTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, m);
        p[1] = lerp(p[1], y, m);
        p[2] = lerp(p[2], z, m);
      };
      blendTo('thighL', -sinp * amp - 0.05, 0, 0.04);
      blendTo('thighR', sinp * amp - 0.05, 0, -0.04);
      blendTo('shinL', Math.max(0, cosp) * kneeAmp * 0.9 + 0.12, 0, 0);
      blendTo('shinR', Math.max(0, -cosp) * kneeAmp * 0.9 + 0.12, 0, 0);
      blendTo('footL', sinp * 0.25 * r - 0.05, 0, 0);
      blendTo('footR', -sinp * 0.25 * r - 0.05, 0, 0);
      blendTo('hips', 0, sinp * 0.12 * (1 - r * 0.4), 0);
      blendTo('spine', leanF, -sinp * 0.1, this.lean);
      blendTo('chest', leanF * 0.4, -sinp * 0.12, 0);
      blendTo('head', -leanF * 0.7, sinp * 0.05, 0);
      if (s === 'air' && L.sprinting) {
        // Airbender sprint: arms swept back, gliding stride.
        blendTo('upperArmL', 0.9, 0, 0.35);
        blendTo('upperArmR', 0.9, 0, -0.35);
        blendTo('foreArmL', -0.1, 0, 0);
        blendTo('foreArmR', -0.1, 0, 0);
      } else {
        blendTo('upperArmL', sinp * armAmp - guard * 0.3, 0, 0.1 + armOut * 0.3);
        blendTo('upperArmR', -sinp * armAmp - guard * 0.3, 0, -0.1 - armOut * 0.3);
        blendTo('foreArmL', -0.35 - r * 0.9 - Math.max(0, sinp) * 0.3, 0, 0);
        blendTo('foreArmR', -0.35 - r * 0.9 - Math.max(0, -sinp) * 0.3, 0, 0);
      }
      hipsY = lerp(hipsY, -Math.abs(cosp) * lerp(0.03, 0.07, r) + 0.02 * r, m);
      hipsZ = lerp(hipsZ, 0, m);
    }

    // ---- Airborne ----
    const a = this.airBlend;
    if (a > 0.001) {
      const rising = L.vy > 0 ? 1 : 0;
      const tuck = rising ? 0.9 : 0.4;
      const lerpTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, a); p[1] = lerp(p[1], y, a); p[2] = lerp(p[2], z, a);
      };
      lerpTo('thighL', -0.7 * tuck, 0, 0.1);
      lerpTo('thighR', -0.2 * tuck, 0, -0.1);
      lerpTo('shinL', 1.1 * tuck, 0, 0);
      lerpTo('shinR', 0.5 + 0.6 * tuck, 0, 0);
      lerpTo('upperArmL', -0.5, 0, 0.7);
      lerpTo('upperArmR', -0.5, 0, -0.7);
      lerpTo('foreArmL', -0.6, 0, 0);
      lerpTo('foreArmR', -0.6, 0, 0);
      lerpTo('spine', 0.1, 0, 0);
    }

    // ---- Glide (airbender) ----
    const g = this.glideBlend;
    if (g > 0.001) {
      const lerpTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, g); p[1] = lerp(p[1], y, g); p[2] = lerp(p[2], z, g);
      };
      const flutter = Math.sin(t * 6) * 0.04;
      lerpTo('spine', 0.55, 0, this.lean);
      lerpTo('chest', 0.25, 0, 0);
      lerpTo('head', -0.6, 0, 0);
      lerpTo('upperArmL', -0.2 + flutter, 0, 1.45);
      lerpTo('upperArmR', -0.2 - flutter, 0, -1.45);
      lerpTo('foreArmL', -0.1, 0, 0);
      lerpTo('foreArmR', -0.1, 0, 0);
      lerpTo('thighL', 0.35, 0, 0.08);
      lerpTo('thighR', 0.35, 0, -0.08);
      lerpTo('shinL', 0.3, 0, 0);
      lerpTo('shinR', 0.3, 0, 0);
      hipsZ = lerp(hipsZ, 0, g);
    }

    // ---- Swim ----
    const sw = this.swimBlend;
    if (sw > 0.001) {
      const st = t * 3;
      const lerpTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, sw); p[1] = lerp(p[1], y, sw); p[2] = lerp(p[2], z, sw);
      };
      lerpTo('spine', 0.9 * clamp01(L.speed / 2), 0, 0);
      lerpTo('head', -0.8 * clamp01(L.speed / 2), 0, 0);
      lerpTo('upperArmL', -1.6 + Math.sin(st) * 1.2, 0, 0.4);
      lerpTo('upperArmR', -1.6 - Math.sin(st) * 1.2, 0, -0.4);
      lerpTo('foreArmL', -0.4, 0, 0);
      lerpTo('foreArmR', -0.4, 0, 0);
      lerpTo('thighL', Math.sin(st * 1.5) * 0.4, 0, 0.06);
      lerpTo('thighR', -Math.sin(st * 1.5) * 0.4, 0, -0.06);
      lerpTo('shinL', 0.3, 0, 0);
      lerpTo('shinR', 0.3, 0, 0);
    }

    // ---- Mounted (sitting astride / cross-legged on a saddle) ----
    const mb = this.mountBlend;
    if (mb > 0.001) {
      const lerpTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, mb); p[1] = lerp(p[1], y, mb); p[2] = lerp(p[2], z, mb);
      };
      lerpTo('thighL', -1.45, 0, 0.55);
      lerpTo('thighR', -1.45, 0, -0.55);
      lerpTo('shinL', 1.6, 0, 0);
      lerpTo('shinR', 1.6, 0, 0);
      lerpTo('spine', 0.08 + Math.sin(t * 2) * 0.02, 0, 0);
      lerpTo('upperArmL', -0.6, 0, 0.2);
      lerpTo('upperArmR', -0.6, 0, -0.2);
      lerpTo('foreArmL', -0.9, 0, 0);
      lerpTo('foreArmR', -0.9, 0, 0);
      hipsY = lerp(hipsY, -0.5, mb);
    }

    // ---- Idle variants (meditate / sit / kneel / float) ----
    const vb = this.variantBlend;
    if (vb > 0.001 && L.idleVariant) {
      const lerpTo = (b: BoneName, x: number, y: number, z: number) => {
        const p = this.locoPose[b];
        p[0] = lerp(p[0], x, vb); p[1] = lerp(p[1], y, vb); p[2] = lerp(p[2], z, vb);
      };
      switch (L.idleVariant) {
        case 'meditate':
        case 'float':
          lerpTo('thighL', -1.5, 0.5, 0.75);
          lerpTo('thighR', -1.5, -0.5, -0.75);
          lerpTo('shinL', 2.4, 0, 0);
          lerpTo('shinR', 2.4, 0, 0);
          lerpTo('upperArmL', -0.5, 0, 0.35);
          lerpTo('upperArmR', -0.5, 0, -0.35);
          lerpTo('foreArmL', -1.0, 0, 0);
          lerpTo('foreArmR', -1.0, 0, 0);
          lerpTo('spine', 0, 0, 0);
          lerpTo('head', 0.1, 0, 0);
          hipsY = lerp(hipsY, L.idleVariant === 'float' ? 0.3 + Math.sin(t * 1.5) * 0.08 : -0.72, vb);
          break;
        case 'sit':
          lerpTo('thighL', -1.5, 0, 0.12);
          lerpTo('thighR', -1.5, 0, -0.12);
          lerpTo('shinL', 1.5, 0, 0);
          lerpTo('shinR', 1.5, 0, 0);
          lerpTo('upperArmL', -0.3, 0, 0.1);
          lerpTo('upperArmR', -0.3, 0, -0.1);
          hipsY = lerp(hipsY, -0.45, vb);
          break;
        case 'kneel':
          lerpTo('thighL', -1.4, 0, 0.1);
          lerpTo('thighR', 0.1, 0, -0.1);
          lerpTo('shinL', 1.45, 0, 0);
          lerpTo('shinR', 1.6, 0, 0);
          lerpTo('spine', 0.15, 0, 0);
          hipsY = lerp(hipsY, -0.42, vb);
          break;
        case 'guard':
          lerpTo('upperArmL', -0.1, 0, 0.1);
          lerpTo('upperArmR', -0.1, 0, -0.1);
          break;
        case 'work': {
          const w = Math.sin(t * 3);
          lerpTo('spine', 0.4, 0, 0);
          lerpTo('upperArmL', -1.0 + w * 0.3, 0, 0.1);
          lerpTo('upperArmR', -1.0 - w * 0.3, 0, -0.1);
          lerpTo('foreArmL', -0.8, 0, 0);
          lerpTo('foreArmR', -0.8, 0, 0);
          break;
        }
      }
    }

    hipsY -= this.landKick * 0.25;
    this.locoPose['thighL'][0] -= this.landKick * 0.4;
    this.locoPose['thighR'][0] -= this.landKick * 0.4;
    this.locoPose['shinL'][0] += this.landKick * 0.8;
    this.locoPose['shinR'][0] += this.landKick * 0.8;
    this.locoPose['spine'][0] += this.landKick * 0.25;
    this.hipsY = hipsY;
    this.hipsZ = hipsZ;
  }

  update(dt: number): void {
    this.computeLocomotion(dt);
    for (const name of BONE_NAMES) {
      const lp = this.locoPose[name];
      const fp = this.finalPose[name];
      fp[0] = lp[0]; fp[1] = lp[1]; fp[2] = lp[2];
    }
    let hipsY = this.hipsY;
    let hipsZ = this.hipsZ;

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
    }
    this.actions = this.actions.filter((a) => !(a.ended && a.weight <= 0));

    // Additive flinch.
    if (this.flinch > 0.001) {
      this.flinch = damp(this.flinch, 0, 7, dt);
      const f = this.flinch;
      this.finalPose['spine'][0] -= f * 0.3;
      this.finalPose['spine'][1] += f * 0.25 * this.flinchDir;
      this.finalPose['head'][0] -= f * 0.25;
      this.finalPose['upperArmL'][2] += f * 0.3;
      this.finalPose['upperArmR'][2] -= f * 0.3;
    }

    // Apply to bones.
    for (const name of BONE_NAMES) {
      const bone = this.bones[name];
      const rest = this.restRot.get(name)!;
      const p = this.finalPose[name];
      bone.rotation.set(rest.x + p[0], rest.y + p[1], rest.z + p[2]);
    }
    const hipsRest = this.restPos.get('hips')!;
    this.bones.hips.position.set(hipsRest.x, hipsRest.y + hipsY, hipsRest.z + hipsZ);
  }
}
