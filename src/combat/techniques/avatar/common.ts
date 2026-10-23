import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { solidAt } from '../../../vfx/effects/constructs';
import type { Collider } from '../../../world/Collision';
import type { Entity } from '../../../entities/Entity';
import type { Cast, Combatant, TechniqueDef } from '../../types';

/**
 * Shared rules for the Avatar ultimates (Elements Sphere only): spirit cost
 * (checked before any cost is paid, spent when the cast begins), the sphere
 * reacting to each ultimate, and small spatial helpers.
 */

export const SPIRIT_COST: Readonly<Record<string, number>> = {
  ult_hurricane: 15,
  ult_tsunami: 15,
  ult_earthquake: 15,
  ult_fire_tornado: 15,
  ult_cataclysm: 30,
};

/** TechniqueDef.precheck: refuse the cast (nothing spent) without enough spirit. */
export function spiritPrecheck(id: string): NonNullable<TechniqueDef['precheck']> {
  return (caster: Combatant, ctx: GameContext) => {
    const cost = SPIRIT_COST[id] ?? 0;
    if (caster.isPlayer && ctx.avatar.spirit < cost) return { reason: 'state', message: `Not enough spirit — ${cost} needed.` };
    return null;
  };
}

/** Pay the spirit cost and let the Elements Sphere flare. Call from begin(). */
export function beginUltimate(cast: Cast): void {
  const ctx = cast.ctx;
  if (!cast.isPlayer) return;
  ctx.avatar.spendSpirit(SPIRIT_COST[cast.def.id] ?? 0);
  ctx.avatar.sphereFx?.pulse(1);
  ctx.events.emit('ultimate:cast', { id: cast.def.id });
}

/** Walkable surface height: terrain / colliders, or the water surface when higher (waves and storms ride on water). */
export function surfaceY(ctx: GameContext, x: number, z: number, nearY: number): number {
  const g = ctx.world.groundAt(x, z, nearY + 2).y;
  const l = ctx.world.liquidAt(x, z);
  return l && l.level > g ? l.level : g;
}

/** Height of an entity above the surface under it. */
export function heightAboveSurface(ctx: GameContext, e: Entity): number {
  return e.position.y - surfaceY(ctx, e.position.x, e.position.z, e.position.y);
}

/**
 * A solid obstacle big enough to stop a wave or a storm (walls, buildings,
 * cliffs, constructs) — tree trunks, posts and small rocks are flowed around.
 */
export function bigObstacleAt(ctx: GameContext, center: THREE.Vector3, radius: number, stepUp: number, minSize = 1.4): Collider | null {
  const ignore: number[] = [];
  for (let i = 0; i < 8; i++) {
    const c = solidAt(ctx, center, radius, ignore, stepUp);
    if (!c) return null;
    if (c.br >= minSize) return c;
    ignore.push(c.id);
  }
  return null;
}

/** Interrupt whatever an entity is casting (no-op for non-casters). */
export function interruptCast(ctx: GameContext, e: Entity): void {
  ctx.combat.interrupt(e as unknown as Combatant, false);
}

export const tmpA = new THREE.Vector3();
export const tmpB = new THREE.Vector3();
