import * as THREE from 'three';
import type { ElementOrAvatar, EntityKind, SurfaceType, Team } from '../core/types';
import type { GameContext } from '../core/GameContext';
import { KinematicBody } from './KinematicBody';

export type StatusType =
  | 'burn' // damage over time
  | 'freeze' // rooted / encased in ice
  | 'slow'
  | 'soaked' // wet: fire weaker, freezes faster
  | 'stun'
  | 'lifted' // airborne / juggled
  | 'pulled' // drawn toward a point (hurricane)
  | 'blind' // dust / smoke
  | 'armor' // damage reduction (rock armor)
  | 'regen';

export interface StatusEffect {
  type: StatusType;
  remaining: number;
  magnitude: number;
  sourceId?: number;
}

export interface HitInfo {
  attacker: Entity | null;
  damage: number;
  element: ElementOrAvatar;
  techniqueId: string;
  /** Impulse added to velocity (m/s). */
  knockback?: THREE.Vector3;
  /** Extra upward launch velocity (m/s). */
  launch?: number;
  /** Poise damage; when poise breaks the target staggers. */
  stagger?: number;
  /** Seconds of hit-stun regardless of poise. */
  stun?: number;
  knockdown?: boolean;
  status?: Array<{ type: StatusType; duration: number; magnitude?: number }>;
  /** World-space impact point (for VFX & directional reactions). */
  point?: THREE.Vector3;
  unblockable?: boolean;
  /** Unique id of the technique instance — the CombatSystem uses it to prevent repeated damage from one collision. */
  hitId?: number;
}

export interface HitResult {
  damage: number;
  killed: boolean;
  blocked: boolean;
  staggered: boolean;
}

export class Health {
  hp: number;
  poise: number;
  invulnerable = 0;
  /** Seconds since last damage (for regen gating). */
  sinceDamage = 999;

  constructor(public maxHp: number, public maxPoise = 30, public poiseRegen = 12) {
    this.hp = maxHp;
    this.poise = maxPoise;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  get fraction(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  update(dt: number): void {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.sinceDamage += dt;
    if (this.sinceDamage > 1.5) this.poise = Math.min(this.maxPoise, this.poise + this.poiseRegen * dt);
  }

  heal(n: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp - before;
  }

  reset(): void {
    this.hp = this.maxHp;
    this.poise = this.maxPoise;
    this.invulnerable = 0;
  }
}

let nextEntityId = 1;

/**
 * Base class for anything that lives in the world and can be targeted or hit.
 * `root.position` is the entity's feet position.
 */
export abstract class Entity {
  readonly id = nextEntityId++;
  abstract readonly kind: EntityKind;
  team: Team = 'neutral';
  name = 'Entity';
  readonly tags = new Set<string>();
  readonly root = new THREE.Group();
  radius = 0.4;
  height = 1.8;
  body: KinematicBody | null = null;
  health: Health | null = null;
  alive = true;
  targetable = true;
  /** Facing yaw (radians). */
  yaw = 0;
  readonly statuses: StatusEffect[] = [];
  /** Damage multiplier applied to incoming hits (difficulty, armor). */
  damageTaken = 1;
  /** Remaining hit-stun seconds. */
  stunned = 0;
  /** Set while blocking/guarding (reduces damage, may parry). */
  guarding = false;
  /** EntityManager update throttling accumulator. */
  _accum = 0;
  /** Distance to player last frame (set by EntityManager). */
  distToPlayer = 0;
  /** True once dispose() has run. */
  disposed = false;

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** World-space point to aim at (chest height). */
  aimPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.root.position).setY(this.root.position.y + this.height * 0.6);
  }

  hasStatus(type: StatusType): StatusEffect | undefined {
    return this.statuses.find((s) => s.type === type);
  }

  addStatus(type: StatusType, duration: number, magnitude = 1, sourceId?: number): void {
    const existing = this.hasStatus(type);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
      existing.magnitude = Math.max(existing.magnitude, magnitude);
      return;
    }
    this.statuses.push({ type, remaining: duration, magnitude, sourceId });
  }

  removeStatus(type: StatusType): void {
    const i = this.statuses.findIndex((s) => s.type === type);
    if (i >= 0) this.statuses.splice(i, 1);
  }

  /** Tick statuses; returns burn damage taken this frame. */
  protected updateStatuses(dt: number): number {
    let dot = 0;
    for (let i = this.statuses.length - 1; i >= 0; i--) {
      const s = this.statuses[i];
      s.remaining -= dt;
      if (s.type === 'burn') dot += 4 * s.magnitude * dt;
      if (s.type === 'regen' && this.health) this.health.heal(3 * s.magnitude * dt);
      if (s.remaining <= 0) this.statuses.splice(i, 1);
    }
    if (this.stunned > 0) this.stunned = Math.max(0, this.stunned - dt);
    return dot;
  }

  /** Movement speed multiplier from statuses. */
  get speedFactor(): number {
    let f = 1;
    if (this.hasStatus('slow')) f *= 0.55;
    if (this.hasStatus('freeze')) f = 0;
    if (this.stunned > 0) f = 0;
    return f;
  }

  /**
   * Default hit handling: damage, poise/stagger, knockback, statuses.
   * Subclasses override `onHitReaction` for animation/AI responses.
   */
  receiveHit(hit: HitInfo, ctx: GameContext): HitResult {
    const res: HitResult = { damage: 0, killed: false, blocked: false, staggered: false };
    if (!this.alive || !this.health) return res;
    const h = this.health;
    if (h.invulnerable > 0) return res;
    let dmg = hit.damage * this.damageTaken;
    if (this.hasStatus('armor')) dmg *= 0.5;
    if (hit.element === 'fire' && this.hasStatus('soaked')) dmg *= 0.7;
    if (this.guarding && !hit.unblockable) {
      dmg *= 0.25;
      res.blocked = true;
    }
    dmg = Math.max(0, dmg);
    h.hp = Math.max(0, h.hp - dmg);
    h.sinceDamage = 0;
    res.damage = dmg;
    if (hit.stagger && !res.blocked) {
      h.poise -= hit.stagger;
      if (h.poise <= 0) {
        res.staggered = true;
        h.poise = h.maxPoise;
        this.stunned = Math.max(this.stunned, 0.6);
      }
    }
    if (hit.stun && !res.blocked) this.stunned = Math.max(this.stunned, hit.stun);
    if (this.body) {
      const kbScale = res.blocked ? 0.3 : 1;
      if (hit.knockback) this.body.impulse(hit.knockback.x * kbScale, 0, hit.knockback.z * kbScale);
      if (hit.launch && !res.blocked) this.body.launch(hit.launch);
    }
    if (hit.status && !res.blocked) for (const s of hit.status) this.addStatus(s.type, s.duration, s.magnitude ?? 1, hit.attacker?.id);
    if (h.dead) {
      res.killed = true;
      this.alive = false;
      this.onDeath(ctx, hit);
    } else {
      this.onHitReaction(hit, res, ctx);
    }
    return res;
  }

  protected onHitReaction(_hit: HitInfo, _res: HitResult, _ctx: GameContext): void {}

  protected onDeath(_ctx: GameContext, _hit: HitInfo): void {}

  /** Called by EntityManager each (possibly throttled) update. */
  abstract update(dt: number, ctx: GameContext): void;

  /** Release GPU resources. Remove from scene is handled by EntityManager. */
  dispose(): void {
    this.disposed = true;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.ownsGeometry) m.geometry.dispose();
    });
  }

  /** Surface under the entity (if it has a body). */
  get surface(): SurfaceType {
    return this.body?.surface ?? 'dirt';
  }
}
