import * as THREE from 'three';
import { registerTechnique } from '../CombatSystem';
import { handOrigin, orbVisual } from './common';

/** Baseline moveset — to be replaced by the full element moveset (see docs/TECHNIQUES.md). */
// ---------------- WATER ----------------
registerTechnique({
  id: 'water_lash',
  name: 'Water Lash',
  element: 'water',
  kind: 'basic',
  tier: 1,
  description: 'Draw water and lash it at a foe. Requires a nearby water source or water you are holding.',
  usage: 'Primary attack. Needs water (rivers, sea, ponds, or your reserve).',
  icon: 'water',
  chiCost: 4,
  cooldown: 0,
  water: { amount: 4 },
  windup: 0.16,
  recovery: 0.25,
  movement: 'free',
  airborne: false,
  interruptible: false,
  range: 10,
  starter: true,
  comboLength: 3,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.1 });
    if (cast.water.from) cast.ctx.vfx.burst('splash', cast.water.from, { count: 8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const v = cast.aimDir.clone().multiplyScalar(30);
    cast.projectile({
      position: o,
      velocity: v,
      radius: 0.35,
      life: 0.45,
      damage: 9 + cast.comboIndex * 2,
      knockback: 5,
      stagger: 14,
      status: [{ type: 'soaked', duration: 6 }],
      visual: orbVisual('#7fc8f0', 0.28, false),
      onHitEntity: (p) => ctx.vfx.burst('splash', p.position, { count: 12 }),
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('splash', pt, { count: 10 });
        ctx.world.fx.wet(pt, 1.5);
      },
    });
    ctx.audio.play('water_whoosh', { position: o, volume: 0.6 });
  },
});

registerTechnique({
  id: 'water_surge_heavy',
  name: 'Water Surge',
  element: 'water',
  kind: 'heavy',
  tier: 1,
  description: 'Gather a large volume of water and drive it forward as a crashing surge.',
  usage: 'Hold Aim to charge, release. Needs a good amount of water.',
  icon: 'water',
  chiCost: 14,
  cooldown: 1.6,
  water: { amount: 14 },
  windup: 0.3,
  recovery: 0.5,
  movement: 'slow',
  airborne: false,
  chargeTime: 1.3,
  interruptible: true,
  range: 14,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 0.9 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const dir = cast.aimDir.clone().setY(Math.max(-0.2, cast.aimDir.y));
    const c = 0.5 + cast.charge * 0.5;
    cast.areaHit({ center: o.clone().addScaledVector(dir, 5), radius: 5, cone: { dir, halfAngle: 0.55 }, damage: 20 * c, knockback: 14 * c, knockDir: dir, stagger: 45 * c, status: [{ type: 'soaked', duration: 8 }] });
    ctx.vfx.burst('splash', o.clone().addScaledVector(dir, 3), { count: 50, dir, spread: 0.5, speed: 1.6 });
    ctx.vfx.burst('spray', o.clone().addScaledVector(dir, 5), { count: 20 });
    ctx.water.release(o.clone().addScaledVector(dir, 6), cast.water.amount * 0.6);
    ctx.audio.play('water_splash', { position: o, volume: 1 });
  },
});

