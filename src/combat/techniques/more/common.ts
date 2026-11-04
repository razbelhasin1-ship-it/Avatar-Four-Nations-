import type { GameContext } from '../../../core/GameContext';
import type { Entity } from '../../../entities/Entity';
import { addEffect, effect } from '../../../vfx/effects/loop';

/**
 * Drag a body toward a point over a short time (a pull that really moves it: a single knockback
 * impulse only slides a grounded body about a metre). Stops `stopDist` short of the point.
 */
export function drag(ctx: GameContext, e: Entity, toward: { x: number; z: number }, stopDist: number, speed: number, maxTime: number): void {
  if (!e.body) return;
  let t = 0;
  addEffect(
    effect((dt) => {
      t += dt;
      if (!e.alive || !e.body || t > maxTime || !ctx.session.active) return false;
      const dx = toward.x - e.position.x, dz = toward.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= stopDist) {
        e.body.external.set(0, e.body.external.y, 0);
        return false;
      }
      const v = Math.min(speed, (d - stopDist) / Math.max(dt, 1e-3));
      e.body.external.x = (dx / d) * v;
      e.body.external.z = (dz / d) * v;
      return true;
    }),
  );
}
