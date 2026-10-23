import * as THREE from 'three';
import { registerTechnique } from '../CombatSystem';
import { rockVisual } from './common';

/** Baseline moveset — to be replaced by the full element moveset (see docs/TECHNIQUES.md). */
// ---------------- EARTH ----------------
registerTechnique({
  id: 'earth_rock_strike',
  name: 'Rock Strike',
  element: 'earth',
  kind: 'basic',
  tier: 1,
  description: 'Pull a stone from the ground and punch it toward your target.',
  usage: 'Primary attack. Slower, but hits hard and staggers.',
  icon: 'earth',
  chiCost: 5,
  cooldown: 0,
  windup: 0.24,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  interruptible: true,
  range: 22,
  starter: true,
  comboLength: 2,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_stomp', { speed: 1.6 });
    const f = cast.caster.position.clone().addScaledVector(cast.aimDir.clone().setY(0).normalize(), 1);
    cast.ctx.vfx.burst('dust', f, { count: 6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const o = cast.caster.castOrigin('chest', new THREE.Vector3()).addScaledVector(cast.aimDir.clone().setY(0).normalize(), 0.8);
    cast.projectile({
      position: o,
      velocity: cast.aimDir.clone().multiplyScalar(26),
      radius: 0.45,
      gravity: 4,
      life: 1.2,
      damage: 16,
      knockback: 8,
      stagger: 30,
      visual: rockVisual(0.4),
      onHitEntity: (p) => {
        ctx.vfx.burst('debris', p.position, { count: 10 });
        ctx.audio.play('rock_impact', { position: p.position, volume: 0.8 });
      },
      onHitWorld: (_p, pt) => {
        ctx.vfx.burst('debris', pt, { count: 8 });
        ctx.vfx.burst('dust', pt, { count: 6 });
        ctx.audio.play('rock_impact', { position: pt, volume: 0.6 });
      },
    });
    ctx.audio.play('rock_rise', { position: o, volume: 0.4, pitch: 1.5 });
  },
});

registerTechnique({
  id: 'earth_seismic_heavy',
  name: 'Seismic Stomp',
  element: 'earth',
  kind: 'heavy',
  tier: 1,
  description: 'Stamp the ground to send a shockwave rippling outward.',
  usage: 'Hold Aim to charge, release. Hits all around you.',
  icon: 'earth',
  chiCost: 16,
  cooldown: 2,
  windup: 0.35,
  recovery: 0.45,
  movement: 'root',
  airborne: false,
  chargeTime: 1.0,
  interruptible: false,
  range: 7,
  starter: true,
  begin(cast) {
    cast.caster.humanoid?.animator.play('base_stomp');
  },
  release(cast) {
    const ctx = cast.ctx;
    const pos = cast.caster.position.clone();
    const c = 0.5 + cast.charge * 0.5;
    cast.areaHit({ center: pos.clone().setY(pos.y + 0.8), radius: 6 * c + 2, height: 2, damage: 22 * c, knockback: 10 * c, knockDir: 'radial', launch: 6 * c, stagger: 50 });
    ctx.vfx.ring(pos.clone().setY(pos.y + 0.15), '#c8a878', 8 * c + 2, 0.5, { opacity: 0.6 });
    ctx.vfx.burst('dust', pos, { count: 30, radius: 3 });
    ctx.vfx.burst('debris', pos, { count: 16, radius: 2 });
    ctx.world.fx.crack(pos, 3 + 3 * c);
    ctx.world.fx.disturb(pos, 8, 1.2);
    ctx.audio.play('rock_impact', { position: pos, volume: 1, pitch: 0.7 });
    ctx.events.emit('camera:shake', { intensity: 0.3 * c, duration: 0.35 });
  },
});

