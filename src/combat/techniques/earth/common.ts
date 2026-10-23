import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { SurfaceType, TechniqueFailReason } from '../../../core/types';
import { earthTint } from '../../../vfx/effects/rocks';
import type { Cast, Combatant } from '../../types';
import { bending } from '../bending/runtime';

/**
 * Earthbending helpers. Earth comes from the ground: techniques refuse to start
 * over water, ice, wood or metal (precheck), and stone takes the colour of the
 * ground it was torn from.
 */

const NON_EARTH: ReadonlySet<SurfaceType> = new Set<SurfaceType>(['water', 'ice', 'wood', 'metal', 'lava']);

export function bendableAt(ctx: GameContext, x: number, z: number, y: number): boolean {
  if (ctx.world.liquidAt(x, z) && (ctx.world.waterAt(x, z)?.level ?? -Infinity) > y - 0.3) return false;
  const s = ctx.world.groundAt(x, z, y + 0.6).surface;
  return !NON_EARTH.has(s);
}

/** TechniqueDef.precheck for ground-sourced earth techniques. */
export function earthPrecheck(caster: Combatant, ctx: GameContext): { reason: TechniqueFailReason; message: string } | null {
  const p = caster.position;
  if (caster.body?.swimming || !bendableAt(ctx, p.x, p.z, p.y)) return { reason: 'state', message: 'There is no earth to bend here.' };
  return null;
}

/** Ground point (on terrain / walkable stone) under (x, z). */
export function groundPoint(ctx: GameContext, x: number, z: number, nearY: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, ctx.world.groundAt(x, z, nearY + 1.5).y, z);
}

/** Stone colour for rock torn from the ground at a point. */
export function tintAt(ctx: GameContext, p: THREE.Vector3): string {
  return earthTint(ctx.world.groundAt(p.x, p.z, p.y + 1).surface);
}

/** Earth rhythm: a strike thrown inside the counter window (after a guard block) hits much harder. */
export function takeCounter(cast: Cast): number {
  return bending.counter(cast.caster, true) ? 1.6 : 1;
}
