import * as THREE from 'three';
import { registerTechnique } from '../CombatSystem';
import { handOrigin } from './common';

/** Baseline moveset — to be replaced by the full element moveset (see docs/TECHNIQUES.md). */
// ---------------- FIRE ----------------
registerTechnique({
  id: 'fire_jab',
  name: 'Fire Jab',
  element: 'fire',
  kind: 'basic',
  tier: 1,
  description: 'Fast alternating punches that throw bolts of flame.',
  usage: 'Primary attack. Chain up to four jabs quickly.',
  icon: 'fire',
  chiCost: 3,
  cooldown: 0,
  windup: 0.07,
  recovery: 0.16,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 18,
  starter: true,
  comboLength: 4,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const em = ctx.vfx.emitter('fire', 70, { speed: 0.3, size: 0.6 }, 0.6);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(34),
      radius: 0.3,
      life: 0.6,
      damage: 6 + (cast.comboIndex === 3 ? 6 : 0),
      knockback: 3,
      stagger: 8,
      status: cast.comboIndex === 3 ? [{ type: 'burn', duration: 2 }] : undefined,
      visual: {
        object: new THREE.Object3D(),
        update: (p) => em.position.copy(p.position),
        dispose: () => em.stop(),
      },
      onHitEntity: (p) => ctx.vfx.burst('fire', p.position, { count: 12 }),
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('fire', pt, { count: 8 });
        ctx.vfx.burst('smoke', pt, { count: 3 });
        ctx.world.fx.scorch(pt, 0.8);
      },
    });
    ctx.vfx.flash(o, '#ff9040', 2, 0.1, 6);
    ctx.audio.play('fire_burst', { position: o, volume: 0.5, pitch: 1.4 });
  },
});

registerTechnique({
  id: 'fire_blast_heavy',
  name: 'Fire Blast',
  element: 'fire',
  kind: 'heavy',
  tier: 1,
  description: 'Compress your breath and chi into a roaring fireball.',
  usage: 'Hold Aim to charge, release to fire. Burns.',
  icon: 'fire',
  chiCost: 15,
  cooldown: 1.4,
  windup: 0.2,
  recovery: 0.4,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.2,
  interruptible: true,
  range: 26,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 1.3 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const c = 0.4 + cast.charge * 0.6;
    const em = ctx.vfx.emitter('fire', 120, { speed: 0.5, size: 1 + c }, 2);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(28),
      radius: 0.5 + c * 0.4,
      life: 1.2,
      damage: 24 * c,
      knockback: 10 * c,
      stagger: 40 * c,
      status: [{ type: 'burn', duration: 3 * c }],
      visual: {
        object: new THREE.Object3D(),
        update: (p) => em.position.copy(p.position),
        dispose: () => em.stop(),
      },
      onHitEntity: (p) => {
        ctx.vfx.burst('fire', p.position, { count: 30, speed: 1.5 });
        ctx.vfx.flash(p.position, '#ff7a30', 6, 0.3, 14);
        cast.areaHit({ center: p.position.clone(), radius: 2.5 * c, damage: 8 * c, knockback: 5, knockDir: 'radial' });
      },
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('fire', pt, { count: 26, speed: 1.4 });
        ctx.vfx.burst('smoke', pt, { count: 6 });
        ctx.vfx.flash(pt, '#ff7a30', 6, 0.3, 14);
        ctx.world.fx.scorch(pt, 1.8 * c);
        cast.areaHit({ center: pt.clone(), radius: 2.5 * c, damage: 10 * c, knockback: 6, knockDir: 'radial' });
      },
    });
    ctx.vfx.flash(o, '#ff9040', 5, 0.2, 10);
    ctx.audio.play('fire_burst', { position: o, volume: 1 });
  },
});
