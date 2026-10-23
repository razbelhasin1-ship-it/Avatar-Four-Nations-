import * as THREE from 'three';
import type { PlayOptions } from '../../../character/Animator';
import type { GameContext } from '../../../core/GameContext';
import type { Action } from '../../../core/Input';
import type { Entity, HitInfo } from '../../../entities/Entity';
import { solidAt } from '../../../vfx/effects/constructs';
import { effect, type LiveEffect } from '../../../vfx/effects/loop';
import type { Cast, Combatant } from '../../types';

/**
 * Small helpers shared by the air / fire / earth technique modules.
 */

export type HitSpec = Partial<HitInfo> & { damage: number };

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const scratch: Entity[] = [];

/** Horizontal unit direction; falls back to the yaw's forward vector. */
export function flatDir(v: THREE.Vector3, fallbackYaw = 0, out = new THREE.Vector3()): THREE.Vector3 {
  out.set(v.x, 0, v.z);
  if (out.lengthSq() < 1e-6) out.set(Math.sin(fallbackYaw), 0, Math.cos(fallbackYaw));
  return out.normalize();
}

/** The cast's aim flattened onto the ground plane. */
export function aimFlat(cast: Cast, out = new THREE.Vector3()): THREE.Vector3 {
  return flatDir(cast.aimDir, cast.caster.yaw, out);
}

export function forwardOf(c: Entity, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
}

/** Ground height at (x,z) near a reference height (terrain + walkable colliders). */
export function groundY(ctx: GameContext, x: number, z: number, nearY = Infinity): number {
  return ctx.world.groundAt(x, z, nearY + 1.5).y;
}

/** Play a clip on a combatant's humanoid (no-op for creatures without one). */
export function anim(c: Combatant, clip: string, opts?: PlayOptions): void {
  c.humanoid?.animator.play(clip, opts);
}

export function stopAnim(c: Combatant, clip: string, fade = 0.15): void {
  c.humanoid?.animator.stop(clip, fade);
}

/** Camera shake, attenuated by distance from the player (silent when far away). */
export function shake(ctx: GameContext, pos: THREE.Vector3, intensity: number, duration: number): void {
  const p = ctx.player;
  if (!p) return;
  const d = p.position.distanceTo(pos);
  const k = d < 6 ? 1 : Math.max(0, 1 - (d - 6) / 34);
  if (k <= 0.02) return;
  ctx.events.emit('camera:shake', { intensity: intensity * k, duration, position: { x: pos.x, y: pos.y, z: pos.z } });
}

/** Ability action the player has `id` slotted on (null for AI casters / unslotted). */
export function slotAction(ctx: GameContext, cast: Cast): Action | null {
  if (!cast.isPlayer) return null;
  const slots = ctx.progression.slotsFor(cast.caster.element);
  const i = slots.indexOf(cast.def.id);
  if (i < 0) return null;
  return (['ability1', 'ability2', 'ability3', 'ability4'] as const)[i];
}

/** Harmable entities around a point (excludes the caster). */
export function enemiesNear(cast: Cast, center: THREE.Vector3, radius: number): Entity[] {
  const out: Entity[] = [];
  for (const e of cast.ctx.entities.queryRadius(center, radius, undefined, scratch)) {
    if (e === cast.caster || !cast.ctx.combat.canHarm(cast.caster, e)) continue;
    out.push(e);
  }
  return out;
}

/** Nearest harmable entity whose position is within `radius` of `point`. */
export function targetNear(cast: Cast, point: THREE.Vector3, radius: number): Entity | null {
  let best: Entity | null = null;
  let bd = Infinity;
  for (const e of enemiesNear(cast, point, radius + 1)) {
    const d = Math.hypot(e.position.x - point.x, e.position.z - point.z);
    if (d < radius && d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Resolve the technique's intended target: explicit target, else an enemy near the aim point. */
export function resolveTarget(cast: Cast, assistRadius = 2.5): Entity | null {
  if (cast.target && cast.target.alive) return cast.target;
  return targetNear(cast, cast.aimPoint, assistRadius);
}

/**
 * Hit every harmable entity overlapping a sphere (vertical capsule tolerance like
 * CombatSystem.areaHit) with a per-entity hit built by `build` (custom knockback
 * directions). Deduplicated per cast unless allowRepeat.
 */
export function hitSphere(
  cast: Cast,
  center: THREE.Vector3,
  radius: number,
  height: number,
  build: (e: Entity, away: THREE.Vector3) => HitSpec | null,
  allowRepeat = false,
): Entity[] {
  const hits: Entity[] = [];
  const list = [...cast.ctx.entities.queryRadius(center, radius + 1.5, undefined, scratch)];
  for (const e of list) {
    if (e === cast.caster || !cast.ctx.combat.canHarm(cast.caster, e)) continue;
    const ap = e.aimPoint(tA);
    const dx = ap.x - center.x, dz = ap.z - center.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz > radius + e.radius) continue;
    if (Math.abs(ap.y - center.y) > height + e.height * 0.5) continue;
    const away = horiz > 1e-3 ? tB.set(dx / horiz, 0, dz / horiz) : tB.set(Math.sin(cast.caster.yaw), 0, Math.cos(cast.caster.yaw));
    const spec = build(e, away.clone());
    if (!spec) continue;
    const res = cast.hit(e, { point: ap.clone(), ...spec }, allowRepeat);
    if (res) hits.push(e);
  }
  return hits;
}

/** Knockback vector helper. */
export function push(dir: THREE.Vector3, amount: number): THREE.Vector3 {
  return new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(amount);
}

export interface SweepOptions {
  from: THREE.Vector3;
  /** Travel direction (unit; may tilt vertically). */
  dir: THREE.Vector3;
  length: number;
  duration: number;
  /** Hit radius, constant or by progress t (0..1). */
  radius: number | ((t: number) => number);
  /** Vertical half-height tolerance (default = radius). */
  height?: number;
  /** Keep the centre this far above the ground (ground-hugging waves). */
  hug?: number;
  /** Stop at solid colliders / steep terrain (default true). */
  stopAtWalls?: boolean;
  /** Build the hit for an entity (push = suggested knockback direction). Return null to skip. */
  hit: (e: Entity, push: THREE.Vector3, center: THREE.Vector3) => HitSpec | null;
  onHit?(e: Entity, center: THREE.Vector3): void;
  onStep?(center: THREE.Vector3, t: number): void;
  onStop?(center: THREE.Vector3, blocked: boolean): void;
}

/**
 * A travelling hit volume synchronised with a visual (wind blades, shock fronts,
 * flame crescents). Each entity is hit at most once per cast (dedup).
 */
export function sweep(cast: Cast, o: SweepOptions): LiveEffect {
  const ctx = cast.ctx;
  const center = new THREE.Vector3();
  const dir = o.dir.clone().normalize();
  const flat = flatDir(dir, cast.caster.yaw);
  let age = 0;
  let done = 0;
  let stopped = false;
  const sample = (d: number, t: number): boolean => {
    center.copy(o.from).addScaledVector(dir, d);
    if (o.hug !== undefined) center.y = groundY(ctx, center.x, center.z, center.y + 1) + o.hug;
    if (o.stopAtWalls !== false && d > 0.6) {
      const gh = ctx.world.heightAt(center.x, center.z);
      if (center.y < gh - 0.4 || solidAt(ctx, center, 0.2, [], 0.5)) {
        stopped = true;
        o.onStop?.(center.clone(), true);
        return false;
      }
    }
    const r = typeof o.radius === 'function' ? o.radius(t) : o.radius;
    const hits = hitSphere(cast, center, r, o.height ?? r, (e, away) => {
      const pushDir = flat.clone().multiplyScalar(0.8).addScaledVector(away, 0.45).normalize();
      return o.hit(e, pushDir, center);
    });
    for (const e of hits) o.onHit?.(e, center);
    o.onStep?.(center, t);
    return true;
  };
  return effect((dt) => {
    if (stopped) return false;
    age += dt;
    const t = Math.min(1, age / Math.max(0.001, o.duration));
    const dist = o.length * t;
    const r0 = typeof o.radius === 'function' ? o.radius(t) : o.radius;
    const step = Math.max(0.4, r0 * 0.75);
    let d = done;
    while (d < dist) {
      d = Math.min(dist, d + step);
      if (!sample(d, (d / o.length))) return false;
    }
    if (done === 0 && dist === 0 && !sample(0, 0)) return false;
    done = dist;
    if (t >= 1) {
      o.onStop?.(center.clone(), false);
      return false;
    }
    return true;
  });
}

export interface RingSweepOptions {
  center: THREE.Vector3;
  /** Facing of the arc (default: caster facing). */
  dir?: THREE.Vector3;
  /** Arc angle (radians, default full circle). */
  arc?: number;
  r0: number;
  r1: number;
  duration: number;
  /** Vertical half-height tolerance around center.y. */
  height: number;
  /** Require line of sight from the centre (walls shield targets). Default true. */
  occlude?: boolean;
  hit: (e: Entity, away: THREE.Vector3, radius: number) => HitSpec | null;
  onHit?(e: Entity): void;
  onStep?(radius: number, t: number): void;
}

/** Expanding ring / arc front (shockwaves, flame arcs, vortex rings). One hit per entity per cast. */
export function ringSweep(cast: Cast, o: RingSweepOptions): LiveEffect {
  const ctx = cast.ctx;
  const center = o.center.clone();
  const dir = o.dir ? flatDir(o.dir, cast.caster.yaw) : forwardOf(cast.caster);
  const half = (o.arc ?? Math.PI * 2) / 2;
  const eye = center.clone().setY(center.y + 0.6);
  let age = 0;
  return effect((dt) => {
    age += dt;
    const t = Math.min(1, age / Math.max(0.001, o.duration));
    const r = o.r0 + (o.r1 - o.r0) * (1 - (1 - t) * (1 - t));
    for (const e of [...ctx.entities.queryRadius(center, r + 1.5, undefined, scratch)]) {
      if (e === cast.caster || !ctx.combat.canHarm(cast.caster, e)) continue;
      const dx = e.position.x - center.x, dz = e.position.z - center.z;
      const d = Math.hypot(dx, dz);
      if (d > r + e.radius) continue;
      const ap = e.aimPoint(tA);
      if (Math.abs(ap.y - center.y) > o.height + e.height * 0.5) continue;
      if (half < Math.PI - 1e-3 && d > 0.6) {
        const dot = (dx * dir.x + dz * dir.z) / d;
        if (Math.acos(Math.max(-1, Math.min(1, dot))) > half + 0.15) continue;
      }
      if (o.occlude !== false && d > 1.2 && !ctx.world.hasLineOfSight(eye, ap)) continue;
      const away = d > 1e-3 ? new THREE.Vector3(dx / d, 0, dz / d) : dir.clone();
      const spec = o.hit(e, away, r);
      if (!spec) continue;
      if (cast.hit(e, { point: ap.clone(), ...spec })) o.onHit?.(e);
    }
    o.onStep?.(r, t);
    return t < 1;
  });
}

/** Desired movement direction: the player's camera-relative move input, else the aim. */
export function moveIntent(cast: Cast, out = new THREE.Vector3()): THREE.Vector3 {
  const ctx = cast.ctx;
  if (cast.isPlayer) {
    const mv = ctx.input.move;
    if (Math.hypot(mv.x, mv.y) > 0.25) {
      const f = ctx.camera.getWorldDirection(tA).setY(0);
      if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
      f.normalize();
      const r = tB.set(-f.z, 0, f.x);
      return out.set(0, 0, 0).addScaledVector(f, mv.y).addScaledVector(r, mv.x).normalize();
    }
  }
  return aimFlat(cast, out);
}

/** World position of a humanoid anchor (falls back to castOrigin). */
export function anchorPos(c: Combatant, name: 'footL' | 'footR' | 'head' | 'eyes' | 'handL' | 'handR' | 'chest', out = new THREE.Vector3()): THREE.Vector3 {
  const h = c.humanoid;
  if (h) {
    h.root.updateWorldMatrix(true, true);
    return h.anchors[name].getWorldPosition(out);
  }
  if (name === 'handL' || name === 'handR' || name === 'chest') return c.castOrigin(name, out);
  if (name === 'footL' || name === 'footR') return c.castOrigin('feet', out).setY(c.position.y + 0.3);
  return c.castOrigin('chest', out).setY(c.position.y + c.height * 0.92);
}

/** Random point offset on the XZ plane. */
export function jitter(p: THREE.Vector3, r: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return out.set(p.x + Math.cos(a) * d, p.y, p.z + Math.sin(a) * d);
}

/** Linear ease helpers. */
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number) => t * t;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
