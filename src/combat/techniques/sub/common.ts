import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { TechniqueFailReason } from '../../../core/types';
import type { SubSkillSystem } from '../../../subskills/SubSkills';
import type { LavaSystem } from '../../../subskills/lava/LavaSystem';
import { getTechnique } from '../../CombatSystem';
import type { Combatant } from '../../types';

/** Shared helpers for the sub-skill moves (lavabending, spiritual projection, bloodbending). */

export type Pre = { reason: TechniqueFailReason; message: string } | null;

export const subSys = (ctx: GameContext): SubSkillSystem | undefined => ctx.extra.get('subskills') as SubSkillSystem | undefined;
export const lavaSys = (ctx: GameContext): LavaSystem | undefined => ctx.extra.get('lava') as LavaSystem | undefined;

/** The branch gate (unlocked, Korra flags) for technique `id`. */
export function gate(id: string, caster: Combatant, ctx: GameContext): Pre {
  const def = getTechnique(id);
  if (!def) return { reason: 'locked', message: 'Unknown technique' };
  return subSys(ctx)?.gate(def, caster) ?? null;
}

const tmp = new THREE.Vector3();

/**
 * Where the caster is aiming on the ground, no farther than `range` (players aim with the camera;
 * others at their target or straight ahead).
 */
export function aimGround(ctx: GameContext, caster: Combatant, range: number, out = new THREE.Vector3(), target?: { position: THREE.Vector3 } | null, point?: THREE.Vector3): THREE.Vector3 {
  const p = caster.position;
  if (target) out.copy(target.position);
  else if (point) out.copy(point);
  else if (caster.isPlayer && ctx.player) out.copy(ctx.player.aimPoint3);
  else out.set(p.x + Math.sin(caster.yaw) * range * 0.6, p.y, p.z + Math.cos(caster.yaw) * range * 0.6);
  const dx = out.x - p.x, dz = out.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > range) out.set(p.x + (dx / d) * range, out.y, p.z + (dz / d) * range);
  if (d < 1.2 && !target) out.set(p.x + Math.sin(caster.yaw) * 3, out.y, p.z + Math.cos(caster.yaw) * 3);
  out.y = ctx.world.groundAt(out.x, out.z, Math.max(out.y, p.y) + 1.5).y;
  return out;
}

/** Lavabending precheck: branch gate + earth to melt where you aim. */
export function lavaCheck(id: string, range: number, atCaster = false) {
  return (caster: Combatant, ctx: GameContext): Pre => {
    const g = gate(id, caster, ctx);
    if (g) return g;
    const lava = lavaSys(ctx);
    if (!lava) return { reason: 'state', message: 'Lava is unavailable.' };
    const at = atCaster ? tmp.copy(caster.position) : aimGround(ctx, caster, range, tmp);
    const m = lava.meltable(at.x, at.z, at.y);
    if (!m.ok) return { reason: 'state', message: m.reason ?? 'There is no earth here to melt.' };
    return null;
  };
}

/** Text shown in the Technique Library for how a branch move is gained. */
export const SOURCE = {
  lava: 'Lavabending — awakens in the quest “The Heart of the Mountain” (Earth master)',
  projection: 'Spiritual Projection — quest “The Silent Mind” (Air master)',
  blood: 'Bloodbending — quest “The Puppetmaster” (Water master)',
};
