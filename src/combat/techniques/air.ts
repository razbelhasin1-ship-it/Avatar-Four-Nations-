import * as THREE from 'three';
import { registerTechnique } from '../CombatSystem';
import { handOrigin } from './common';

/** Baseline moveset — to be replaced by the full element moveset (see docs/TECHNIQUES.md). */
// ---------------- AIR ----------------
registerTechnique({
  id: 'air_gust',
  name: 'Air Palm',
  element: 'air',
  kind: 'basic',
  tier: 1,
  description: 'A quick palm strike that sends a cone of wind, scattering foes.',
  usage: 'Primary attack. Chain up to three strikes.',
  icon: 'air',
  chiCost: 4,
  cooldown: 0,
  windup: 0.1,
  recovery: 0.22,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 9,
  starter: true,
  comboLength: 3,
  begin(cast) {
    cast.caster.humanoid?.animator.play(cast.comboIndex % 2 ? 'base_strike_l' : 'base_strike_r', { speed: 1.3 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, cast.comboIndex % 2 ? 'handL' : 'handR');
    const dir = cast.aimDir.clone();
    cast.areaHit({ center: o.clone().addScaledVector(dir, 3.5), radius: 4.2, cone: { dir, halfAngle: 0.6 }, damage: 7 + cast.comboIndex * 2, knockback: 7 + cast.comboIndex * 3, knockDir: dir, stagger: 10 });
    ctx.vfx.burst('air', o, { count: 16, dir, spread: 0.35, speed: 1.6 });
    ctx.world.fx.disturb(o.clone().addScaledVector(dir, 4), 4, 0.8);
    ctx.audio.play('whoosh', { position: o, volume: 0.6, pitch: 1.2 + cast.comboIndex * 0.1 });
  },
});

registerTechnique({
  id: 'air_blast_heavy',
  name: 'Air Blast',
  element: 'air',
  kind: 'heavy',
  tier: 1,
  description: 'Gather the wind between your palms and release a powerful blast.',
  usage: 'Hold Aim to charge, release to fire.',
  icon: 'air',
  chiCost: 14,
  cooldown: 1.2,
  windup: 0.18,
  recovery: 0.4,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.2,
  interruptible: true,
  range: 16,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_push_two', { speed: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = handOrigin(cast, 'handR');
    const dir = cast.aimDir.clone();
    const c = 0.4 + cast.charge * 0.6;
    cast.areaHit({ center: o.clone().addScaledVector(dir, 6), radius: 6.5, cone: { dir, halfAngle: 0.5 }, damage: 18 * c, knockback: 18 * c, knockDir: dir, launch: 4 * c, stagger: 40 * c });
    ctx.vfx.burst('air', o, { count: 40, dir, spread: 0.3, speed: 2.4 });
    ctx.world.fx.disturb(o.clone().addScaledVector(dir, 6), 8, 1.4);
    ctx.audio.play('whoosh', { position: o, volume: 1, pitch: 0.8 });
    ctx.events.emit('camera:shake', { intensity: 0.12 * c, duration: 0.2 });
  },
});

