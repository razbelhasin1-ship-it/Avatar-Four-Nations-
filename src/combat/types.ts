import type * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import type { Element, ElementOrAvatar, WaterSourceType } from '../core/types';
import type { Humanoid } from '../character/Humanoid';
import type { Entity, HitInfo, HitResult } from '../entities/Entity';

/** 'passive' techniques are never cast; knowing them enables behaviour (e.g. drawing water from snow). */
export type TechniqueKind = 'basic' | 'heavy' | 'ability' | 'movement' | 'defense' | 'ultimate' | 'combined' | 'passive';

export interface WaterRequirement {
  /** Water units needed (from the bender's reserve and/or a nearby source). */
  amount: number;
  /** May draw from ice (frozen lakes, ice walls, glaciers). */
  allowIce?: boolean;
  /** May draw from snow fields. */
  allowSnow?: boolean;
  /** May use only liquid sources (default true unless allowIce/allowSnow only). */
  allowLiquid?: boolean;
  /** Ultimate-only exception: may conjure water when the environment cannot supply enough. */
  canConjure?: boolean;
}

/**
 * Static definition of a bending technique. One object per technique, registered
 * via registerTechnique() in src/combat/techniques/*.ts.
 */
export interface TechniqueDef {
  id: string;
  name: string;
  element: ElementOrAvatar;
  kind: TechniqueKind;
  /** 1 basic .. 4 master-level; drives UI ordering and mastery weight. */
  tier: 1 | 2 | 3 | 4;
  description: string;
  /** How to use it, shown in the technique library. */
  usage: string;
  /** Icon key (see src/ui/icons.ts) or a single emoji. */
  icon: string;
  chiCost: number;
  cooldown: number;
  water?: WaterRequirement;
  /** Seconds of anticipation before release(). */
  windup: number;
  /** Seconds the caster stays committed after release (or after channel ends). */
  recovery: number;
  /** Movement allowed while casting. */
  movement: 'free' | 'slow' | 'root';
  /** Castable while airborne. */
  airborne: boolean;
  /** Hold-to-charge (seconds to full charge). Charge 0..1 is passed to the cast. */
  chargeTime?: number;
  /** Channeled technique: channelUpdate() is called each frame until it returns false or this many seconds pass. */
  channel?: number;
  /** Stagger during windup cancels the cast. */
  interruptible: boolean;
  /** Preferred engagement range (AI + auto-target). */
  range: number;
  /** Granted automatically when this element is unlocked. */
  starter?: boolean;
  /** Only usable while the Avatar State / Elements Sphere is active. */
  requires?: 'avatarState' | 'elementsSphere';
  /** Number of chained steps for 'basic' combos (cast.comboIndex wraps). */
  comboLength?: number;
  /** Called when the cast starts (play animation, start gathering VFX). */
  begin?(cast: Cast): void;
  /** Called once at the end of windup: spawn hitboxes, projectiles, constructs. */
  release(cast: Cast): void;
  /** Channel tick; return false to stop channeling early. */
  channelUpdate?(cast: Cast, dt: number): boolean;
  /** Called when the cast finishes or is interrupted (cleanup). */
  end?(cast: Cast, interrupted: boolean): void;
  /** Optional AI hint: should an AI caster use this now? */
  aiScore?(caster: Combatant, target: Entity, dist: number): number;
}

/** Anything that can bend: the player and enemy/ally benders. */
export interface Combatant extends Entity {
  readonly humanoid: Humanoid | null;
  /** Active element (player switches; NPC benders have one). */
  element: Element;
  chi: number;
  maxChi: number;
  /** Water currently held/orbiting the bender (units). */
  waterReserve: number;
  maxWaterReserve: number;
  /** World-space casting origin. */
  castOrigin(which: 'handL' | 'handR' | 'hands' | 'chest' | 'feet', out: THREE.Vector3): THREE.Vector3;
  /** Damage multiplier from level, Avatar State, buffs. */
  powerMultiplier(): number;
  /** Whether this combatant is the player. */
  readonly isPlayer: boolean;
}

export interface WaterGrant {
  /** Units granted to this cast. */
  amount: number;
  /** Where the water came from (for visuals: stream from source to caster). Null if from reserve. */
  from: THREE.Vector3 | null;
  sourceId: string | null;
  sourceType: WaterSourceType | 'reserve' | 'conjured' | null;
  /** True when drawn from ice/snow (techniques may produce ice visuals). */
  frozen: boolean;
}

export interface AreaHitOptions {
  center: THREE.Vector3;
  radius: number;
  /** Optional cone restriction (direction + half-angle radians). */
  cone?: { dir: THREE.Vector3; halfAngle: number };
  /** Vertical half-height tolerance (default radius). */
  height?: number;
  damage: number;
  knockback?: number;
  /** Knockback direction: 'radial' (away from center) or a fixed vector. */
  knockDir?: 'radial' | THREE.Vector3;
  launch?: number;
  stagger?: number;
  stun?: number;
  knockdown?: boolean;
  status?: HitInfo['status'];
  /** Hit allies/neutral too (environment-wide effects). Default false. */
  friendlyFire?: boolean;
  /** Include the caster. Default false. */
  includeCaster?: boolean;
}

export interface ProjectileSpec {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  gravity?: number;
  /** Seconds before expiring. */
  life: number;
  damage: number;
  knockback?: number;
  launch?: number;
  stagger?: number;
  stun?: number;
  status?: HitInfo['status'];
  /** Number of entities it can pass through (0 = stops at first). */
  pierce?: number;
  /** Homing strength toward `target` (rad/s turn rate). */
  homing?: number;
  target?: Entity | null;
  /** Collide with terrain/architecture (default true). */
  collideWorld?: boolean;
  /** Visual object updated to the projectile's position each frame; disposed on expiry. */
  visual?: ProjectileVisual;
  onHitEntity?(p: Projectile, e: Entity, res: HitResult | null): void;
  onHitWorld?(p: Projectile, point: THREE.Vector3): void;
  onExpire?(p: Projectile): void;
}

export interface ProjectileVisual {
  object: THREE.Object3D;
  update(p: Projectile, dt: number): void;
  dispose(): void;
}

export interface Projectile {
  readonly id: number;
  readonly spec: ProjectileSpec;
  readonly cast: Cast;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  age: number;
  alive: boolean;
  /** Mark for removal. */
  kill(): void;
}

/** Runtime state of one technique execution. */
export interface Cast {
  readonly id: number;
  readonly ctx: GameContext;
  readonly def: TechniqueDef;
  readonly caster: Combatant;
  readonly origin: THREE.Vector3;
  readonly aimDir: THREE.Vector3;
  readonly aimPoint: THREE.Vector3;
  readonly target: Entity | null;
  readonly charge: number;
  readonly power: number;
  readonly comboIndex: number;
  readonly water: WaterGrant;
  readonly isPlayer: boolean;
  /** Seconds since the cast began. */
  elapsed: number;
  phase: 'windup' | 'channel' | 'recovery' | 'done';
  /** Free storage for technique-specific runtime data. */
  data: Record<string, any>;
  /** Apply an area hit now (deduplicated per cast & target). */
  areaHit(o: AreaHitOptions): Entity[];
  /** Launch a projectile owned by this cast. */
  projectile(spec: ProjectileSpec): Projectile;
  /** Deal a hit to a specific entity (deduplicated per cast & target unless allowRepeat). */
  hit(target: Entity, hit: Partial<HitInfo> & { damage: number }, allowRepeat?: boolean): HitResult | null;
  /** End a channel early / finish now. */
  finish(): void;
}
