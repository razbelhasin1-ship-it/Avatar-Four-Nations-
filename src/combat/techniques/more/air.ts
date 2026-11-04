import * as THREE from 'three';
import { Enemy } from '../../../ai/Enemy';
import type { Entity } from '../../../entities/Entity';
import { windCone, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import type { ProjectileVisual } from '../../types';
import { anim } from '../bending/util';
import { hostileProjectile } from '../air/common';
import { drag } from './common';

/**
 * Two more airbending moves.
 *  - Air Swipe: a thin crescent blade of air sent spinning away (Aang's air swipe) — long range,
 *    cuts through a line of foes and knocks them flat.
 *  - Air Suction: the reverse of a blast — air rushes back into your palms, dragging a foe (and
 *    the weapon from their hands) toward you and swallowing arrows and blasts in flight.
 */

const tA = new THREE.Vector3();
const disarmed = new WeakMap<Entity, number>();
let swipeGeo: THREE.BufferGeometry | null = null;
let swipeMat: THREE.MeshBasicMaterial | null = null;

Enemy.thinkHooks.push((e, _dt, ctx) => {
  const until = disarmed.get(e);
  if (until === undefined) return;
  if (until <= ctx.time.elapsed) disarmed.delete(e);
  else e.attackToken = false;
});

function crescentVisual(): ProjectileVisual {
  swipeGeo ??= new THREE.TorusGeometry(1.1, 0.07, 5, 26, Math.PI * 0.95);
  swipeMat ??= new THREE.MeshBasicMaterial({ color: '#f2f8ff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const g = new THREE.Group();
  const a = new THREE.Mesh(swipeGeo, swipeMat);
  const b = new THREE.Mesh(swipeGeo, swipeMat);
  b.scale.setScalar(0.82);
  b.position.z = -0.25;
  g.add(a, b);
  // Lay the arc flat, opening toward the direction of travel.
  a.rotation.set(-Math.PI / 2, 0, Math.PI * 0.025);
  b.rotation.copy(a.rotation);
  return {
    object: g,
    update(p) {
      const v = p.velocity;
      g.rotation.set(0, Math.atan2(v.x, v.z) + Math.PI / 2, 0);
      const k = Math.max(0, 1 - p.age / 0.9);
      g.scale.setScalar(0.8 + p.age * 0.9);
      swipeMat!.opacity = 0.55 * k + 0.1;
    },
    dispose() {
      /* shared */
    },
  };
}

registerTechnique({
  id: 'air_swipe',
  name: 'Air Swipe',
  element: 'air',
  kind: 'ability',
  tier: 2,
  description: 'Slice the air with an open hand and a thin crescent blade of wind spins away, widening as it flies. It passes through a line of foes and sweeps their feet out from under them.',
  usage: 'Aim and press. Long range; pierces up to three targets; knocks them down.',
  icon: 'air',
  chiCost: 14,
  cooldown: 2.5,
  windup: 0.2,
  recovery: 0.3,
  movement: 'free',
  airborne: true,
  interruptible: true,
  range: 24,
  begin(cast) {
    anim(cast.caster, 'whip_l', { speed: 1.4, fadeIn: 0.04 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const origin = c.castOrigin('hands', new THREE.Vector3());
    const dir = new THREE.Vector3().copy(cast.aimPoint).sub(origin).normalize();
    ctx.audio.play('bend_air_blast', { position: origin, volume: 0.7, pitch: 1.5 });
    cast.projectile({
      position: origin,
      velocity: dir.multiplyScalar(28),
      radius: 0.85,
      gravity: 0,
      life: 0.9,
      damage: 14,
      pierce: 3,
      knockback: 7,
      launch: 2.5,
      stagger: 60,
      visual: crescentVisual(),
      onHitEntity(_p, e) {
        if (e.body) e.stunned = Math.max(e.stunned, 0.5);
        ctx.vfx.burst('air', e.aimPoint(tA), { count: 6, speed: 3 });
      },
    });
  },
  aiScore: (_c, _t, dist) => (dist < 22 ? 0.4 : 0),
});

registerTechnique({
  id: 'air_suction',
  name: 'Air Suction',
  element: 'air',
  kind: 'ability',
  tier: 3,
  description: 'Draw a great breath of wind back into your palms. Foes in front of you are dragged off their feet toward you, weapons fly from their grip, and arrows and blasts in the air are swallowed whole.',
  usage: 'Aim and press. Pulls everyone in a cone ahead (about 14 m) and disarms them for a few seconds.',
  icon: 'air',
  chiCost: 22,
  cooldown: 7,
  windup: 0.3,
  recovery: 0.45,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 14,
  begin(cast) {
    anim(cast.caster, 'circle_arms', { speed: 1.6, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'push_two', { speed: 0.8, fadeIn: 0.04 });
    const origin = c.castOrigin('chest', new THREE.Vector3());
    const dir = new THREE.Vector3().copy(cast.aimPoint).sub(origin).setY(0).normalize();
    const far = origin.clone().addScaledVector(dir, 13);
    // Wind rushing inward: a cone pointing back at the bender, a spiral at its mouth.
    windCone(ctx, far, dir.clone().negate(), { length: 12, radius: 3.2, duration: 0.55, opacity: 0.7 });
    windSpiral(ctx, far.clone().setY(c.position.y), { height: 2.4, r0: 2.6, r1: 0.6, duration: 0.6, turns: 2 });
    ctx.audio.play('bend_air_swirl', { position: origin, volume: 0.9, pitch: 0.7 });
    let pulled = 0;
    for (const e of ctx.entities.queryRadius(c.position, 14)) {
      if (e === c || !ctx.combat.canHarm(c, e) || !e.body) continue;
      const to = tA.copy(e.position).sub(c.position).setY(0);
      const d = to.length();
      if (d < 1.5 || to.normalize().dot(dir) < Math.cos(0.5)) continue;
      cast.hit(e, { damage: 6, launch: 2.5, stagger: 70 });
      drag(ctx, e, c.position, 2.2, 14, 0.85);
      disarmed.set(e, ctx.time.elapsed + 4);
      pulled++;
    }
    // Arrows and blasts in the cone are swallowed.
    for (const p of [...ctx.combat.projectilesInRadius(far.clone().lerp(origin, 0.5), 9, [])]) {
      if (!p.alive || !hostileProjectile(cast, p)) continue;
      const to = tA.copy(p.position).sub(origin).setY(0);
      if (to.lengthSq() > 0.01 && to.normalize().dot(dir) > Math.cos(0.55)) {
        p.kill();
        ctx.vfx.burst('air', p.position, { count: 5, speed: 2 });
      }
    }
    if (pulled && cast.isPlayer) ctx.events.emit('ui:notify', { text: pulled > 1 ? `${pulled} foes dragged in and disarmed.` : 'Dragged in — and disarmed.', kind: 'info', duration: 2 });
  },
  aiScore: (_c, _t, dist) => (dist > 5 && dist < 13 ? 0.35 : 0),
});
