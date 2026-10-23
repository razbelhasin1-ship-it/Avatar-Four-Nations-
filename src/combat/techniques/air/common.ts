import * as THREE from 'three';
import type { Entity } from '../../../entities/Entity';
import { airPuff } from '../../../vfx/effects/wind';
import type { Cast, Projectile } from '../../types';
import { bending } from '../bending/runtime';

/**
 * Airbending helpers: projectile deflection / reflection and the Slipstream
 * rhythm (an evasion — dodge or Air Dash — empowers the next air strike).
 */

const scratch: Projectile[] = [];
const tmp = new THREE.Vector3();

/** True when `p` belongs to someone hostile to the caster. */
export function hostileProjectile(cast: Cast, p: Projectile): boolean {
  const owner = p.cast.caster;
  if (owner === cast.caster) return false;
  return cast.ctx.combat.canHarm(owner, cast.caster);
}

/**
 * Deflect hostile projectiles near `center`.
 *  - 'outward': blown away from the centre (shields, spins, blasts).
 *  - 'return': sent back at their owner (Wind Redirection).
 * Redirected projectiles now belong to the air bender. Returns those deflected.
 */
export function deflectProjectiles(
  cast: Cast,
  center: THREE.Vector3,
  radius: number,
  mode: 'outward' | 'return' | THREE.Vector3,
  o: { cone?: { dir: THREE.Vector3; halfAngle: number }; speedMul?: number; damageMul?: number } = {},
): Projectile[] {
  const ctx = cast.ctx;
  const out: Projectile[] = [];
  for (const p of [...ctx.combat.projectilesInRadius(center, radius, scratch)]) {
    if (!p.alive || !hostileProjectile(cast, p)) continue;
    if (o.cone) {
      const to = tmp.subVectors(p.position, center);
      to.y = 0;
      const d = to.length();
      if (d > 0.3) {
        const dot = (to.x * o.cone.dir.x + to.z * o.cone.dir.z) / (d * Math.hypot(o.cone.dir.x, o.cone.dir.z));
        if (Math.acos(Math.max(-1, Math.min(1, dot))) > o.cone.halfAngle) continue;
      }
    }
    const owner = p.cast.caster as Entity;
    const speed = Math.max(14, p.velocity.length()) * (o.speedMul ?? 1);
    const v = new THREE.Vector3();
    let target: Entity | null | undefined;
    if (mode === 'return' && owner.alive) {
      v.copy(owner.aimPoint(tmp)).sub(p.position).normalize().multiplyScalar(speed);
      target = owner;
    } else if (mode instanceof THREE.Vector3) {
      v.copy(mode).normalize().multiplyScalar(speed);
    } else {
      v.subVectors(p.position, center).setY(0);
      if (v.lengthSq() < 1e-4) v.copy(p.velocity).negate();
      v.normalize();
      v.y = 0.25;
      v.normalize().multiplyScalar(speed);
    }
    const ok = ctx.combat.redirectProjectile(p, cast.caster, cast.def.id, v, { target, homing: target ? 7 : undefined, damageMul: o.damageMul });
    if (!ok) continue;
    out.push(p);
    airPuff(ctx, p.position.clone(), v.clone().normalize(), 0.8);
    ctx.audio.play('bend_air_deflect', { position: p.position, volume: 0.7 });
  }
  return out;
}

/** Slipstream: within the window after a dodge / Air Dash, consume it for an empowered strike. */
export function takeSlipstream(cast: Cast): boolean {
  if (!bending.slipstream(cast.caster)) return false;
  bending.state(cast.caster).lastEvade = -99;
  return true;
}

/** Open the slipstream window (after an evasive technique). */
export function openSlipstream(cast: Cast): void {
  bending.state(cast.caster).lastEvade = cast.ctx.time.elapsed;
}
