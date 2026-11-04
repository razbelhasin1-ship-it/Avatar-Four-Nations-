import * as THREE from 'three';
import { fireBoltVisual, flameBlade, flameRing } from '../../../vfx/effects/fire';
import { addEffect, effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { ProjectileVisual } from '../../types';
import { aimFlat, anim, hitSphere, shake } from '../bending/util';

/**
 * Two more firebending moves.
 *  - Fire Whip: a long lash of flame cracked across your front (Admiral Zhao and Azula's whips).
 *  - Dancing Dragon: the Sun Warriors' form — fire coils up around you, then two dragons of flame
 *    weave forward together ("The Firebending Masters").
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

registerTechnique({
  id: 'fire_whip',
  name: 'Fire Whip',
  element: 'fire',
  kind: 'ability',
  tier: 2,
  description: 'Swing your arm and a long lash of flame cracks across the ground in front of you. It reaches farther than a punch and catches several foes in one stroke.',
  usage: 'Aim and press: the lash sweeps about nine metres ahead.',
  icon: 'fire',
  chiCost: 18,
  cooldown: 3.5,
  windup: 0.26,
  recovery: 0.4,
  movement: 'slow',
  airborne: true,
  interruptible: true,
  range: 9,
  begin(cast) {
    anim(cast.caster, 'whip_r', { speed: 1.2, fadeIn: 0.04 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast, tA);
    const origin = c.castOrigin('handR', tB).clone();
    flameBlade(ctx, origin.clone().setY(origin.y - 0.2), dir, { length: 9, duration: 0.42, r0: 0.6, r1: 9, height: 0.55, arc: 0.55, roll: -0.35 });
    ctx.audio.play('bend_fire_whoosh', { position: origin, volume: 0.9, pitch: 0.85 });
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    // The lash: hit along the line, pushing sideways like a whip crack.
    for (let i = 1; i <= 5; i++) {
      const at = origin.clone().addScaledVector(dir, i * 1.7).setY(c.position.y + 1);
      hitSphere(cast, at, 1.1, 1.6, (e) => ({ damage: 16, knockback: right.clone().multiplyScalar(4).addScaledVector(dir, 3), stagger: 40, status: [{ type: 'burn', duration: 2.5, magnitude: 1 }] }));
    }
    ctx.world.fx.scorch?.(origin.clone().addScaledVector(dir, 5).setY(c.position.y), 1.2);
  },
  aiScore: (_c, _t, dist) => (dist < 8 ? 0.45 : 0),
});

/** A flame dragon: a fire bolt weaving side to side as it flies. */
function dragonVisual(ctx: Parameters<typeof fireBoltVisual>[0], phase: number): ProjectileVisual {
  const inner = fireBoltVisual(ctx, 0.5, { length: 4.5, palette: 'hot', trail: 1 });
  const g = new THREE.Group();
  g.add(inner.object);
  return {
    object: g,
    update(p, dt) {
      inner.update(p, dt);
      const v = p.velocity;
      const side = tA.set(-v.z, 0, v.x).normalize();
      const w = Math.sin(p.age * 9 + phase) * 0.9;
      inner.object.position.copy(side.multiplyScalar(w)).setY(Math.cos(p.age * 9 + phase) * 0.35);
    },
    dispose() {
      inner.dispose();
    },
  };
}

registerTechnique({
  id: 'dancing_dragon',
  name: 'Dancing Dragon',
  element: 'fire',
  kind: 'ability',
  tier: 3,
  description: 'The Sun Warriors\' form: turn, and fire coils up around you in a ring — then two dragons of flame weave forward together, spiralling around each other.',
  usage: 'Press: a burning ring hits everyone close, then the twin dragons fly where you aim.',
  icon: 'fire',
  chiCost: 34,
  cooldown: 9,
  windup: 0.55,
  recovery: 0.5,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 18,
  begin(cast) {
    anim(cast.caster, 'spin_360', { speed: 0.85, fadeIn: 0.05 });
    cast.ctx.audio.play('bend_fire_puff', { position: cast.caster.position, volume: 0.7, pitch: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const ground = c.position.clone();
    flameRing(ctx, ground, { r0: 0.6, r1: 3.6, height: 1.7, duration: 0.7, palette: 'hot' });
    cast.areaHit({ center: ground.clone().setY(ground.y + 1), radius: 3.6, height: 2, damage: 12, knockback: 6, knockDir: 'radial', stagger: 40, status: [{ type: 'burn', duration: 2 }] });
    ctx.audio.play('bend_fire_whoosh', { position: ground, volume: 1, pitch: 0.7 });
    shake(ctx, ground, 0.15, 0.3);
    // Then the dragons.
    let t = 0;
    let fired = false;
    addEffect(
      effect((dt) => {
        t += dt;
        if (!fired && t >= 0.3) {
          fired = true;
          anim(c, 'release_forward', { speed: 1.1, fadeIn: 0.04 });
          const origin = c.castOrigin('hands', new THREE.Vector3());
          const dir = new THREE.Vector3().copy(cast.aimPoint).sub(origin).normalize();
          if (dir.y > 0.2) dir.y = 0.2;
          dir.normalize();
          for (let k = 0; k < 2; k++) {
            cast.projectile({
              position: origin.clone(),
              velocity: dir.clone().multiplyScalar(20),
              radius: 0.7,
              gravity: 0,
              life: 0.95,
              damage: 22,
              pierce: 2,
              stagger: 60,
              knockback: 7,
              status: [{ type: 'burn', duration: 3 }],
              visual: dragonVisual(ctx, k * Math.PI),
            });
          }
          ctx.audio.play('bend_fire_whoosh', { position: origin, volume: 1, pitch: 0.6 });
        }
        return t < 0.35;
      }),
    );
  },
  aiScore: (_c, _t, dist) => (dist < 12 ? 0.4 : 0),
});
