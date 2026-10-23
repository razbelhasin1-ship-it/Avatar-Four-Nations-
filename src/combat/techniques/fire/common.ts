import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { Entity } from '../../../entities/Entity';
import { steam } from '../../../vfx/effects/fire';
import type { Cast, Projectile } from '../../types';

/**
 * Firebending interactions shared by the fire techniques: water → steam,
 * soaked targets dry out, heat events (melting ice constructs), and fire vs
 * water projectile cancellation.
 */

const tmp = new THREE.Vector3();
const scratch: Projectile[] = [];

/** Emit a heat pulse (ice constructs melt; standing water steams). Returns true if it hit water. */
export function heat(ctx: GameContext, pos: THREE.Vector3, radius: number, intensity: number, casterId: number): boolean {
  ctx.events.emit('bending:heat', { position: { x: pos.x, y: pos.y, z: pos.z }, radius, intensity, casterId });
  const w = ctx.world.waterAt(pos.x, pos.z);
  if (w && !w.frozen && pos.y < w.level + 0.6) {
    steam(ctx, tmp.set(pos.x, w.level + 0.1, pos.z), Math.min(2, 0.5 + intensity));
    return true;
  }
  return false;
}

/** Fire impact on the ground/world: scorch, or steam when it lands in water. */
export function fireWorldImpact(ctx: GameContext, cast: Cast, pt: THREE.Vector3, size: number): void {
  if (heat(ctx, pt, size * 1.5, size, cast.caster.id)) return;
  ctx.world.fx.scorch(pt, size);
  ctx.vfx.burst('smoke', pt, { count: Math.round(2 + size * 2), size: 0.5 + size * 0.3 });
}

/** Fire landing on an entity: soaked targets steam and dry off. */
export function fireOnEntity(ctx: GameContext, e: Entity, pt: THREE.Vector3, size: number): void {
  if (e.hasStatus('soaked')) {
    e.removeStatus('soaked');
    steam(ctx, pt, 0.6 + size * 0.5);
  }
}

/**
 * Fire projectile meets a hostile water projectile: both are destroyed in a
 * burst of steam. Call from the projectile visual's per-frame update.
 */
export function quenchCheck(ctx: GameContext, p: Projectile): boolean {
  if (!p.alive) return false;
  const near = ctx.combat.projectilesInRadius(p.position, p.spec.radius + 0.35, scratch);
  for (const o of near) {
    if (o === p || !o.alive || o.cast.def.element !== 'water') continue;
    if (!ctx.combat.canHarm(o.cast.caster, p.cast.caster) && !ctx.combat.canHarm(p.cast.caster, o.cast.caster)) continue;
    o.kill();
    p.kill();
    steam(ctx, p.position, 1 + p.spec.radius);
    return true;
  }
  return false;
}

/** Aim direction from a launch point toward the cast's aim point (hand offset correction). */
export function aimFrom(cast: Cast, from: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  out.subVectors(cast.aimPoint, from);
  if (out.lengthSq() < 4) return out.copy(cast.aimDir);
  return out.normalize();
}
