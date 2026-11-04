import * as THREE from 'three';
import { Enemy } from '../../../ai/Enemy';
import type { Entity } from '../../../entities/Entity';
import { rockImpact, rockVisual } from '../../../vfx/effects/earth';
import { addEffect, debris, effect } from '../../../vfx/effects/loop';
import { rockGeometry } from '../../../vfx/effects/rocks';
import { registerTechnique } from '../../CombatSystem';
import { anim, resolveTarget, shake } from '../bending/util';
import { earthPrecheck, groundPoint, tintAt } from '../earth/common';
import { drag } from './common';

/**
 * Two more earthbending moves.
 *  - Earth Grip: the ground closes around a foe's feet (Toph's trap in "The Blind Bandit"). They
 *    cannot step away for a few seconds, but can still swing.
 *  - Stone Gloves: two fists of stone fly from your hands, strike, and drag the target toward you
 *    (the Dai Li's rock gloves, "Lake Laogai").
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
/** Entities whose feet are held (enemy id -> until, game time). */
const gripped = new WeakMap<Entity, number>();
let rockMat: THREE.MeshStandardMaterial | null = null;

// Gripped enemies keep their arms but not their feet.
Enemy.thinkHooks.push((e, _dt, ctx) => {
  const until = gripped.get(e);
  if (until === undefined) return;
  if (until <= ctx.time.elapsed) {
    gripped.delete(e);
    return;
  }
  e.moveMode = 'stop';
});

registerTechnique({
  id: 'earth_grip',
  name: 'Earth Grip',
  element: 'earth',
  kind: 'ability',
  tier: 2,
  description: 'Stamp, and the ground closes over your target\'s feet like a fist of stone. They cannot step away for a few seconds — but they can still swing at whoever comes close.',
  usage: 'Aim at or lock on to a foe standing on earth and press.',
  icon: 'earth',
  chiCost: 22,
  cooldown: 7,
  windup: 0.32,
  recovery: 0.35,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 16,
  precheck: earthPrecheck,
  begin(cast) {
    anim(cast.caster, 'stomp', { speed: 1.4, fadeIn: 0.04 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const target = resolveTarget(cast, 3);
    const at = target ? tA.copy(target.position) : tA.copy(cast.aimPoint);
    const g = groundPoint(ctx, at.x, at.z, at.y, tB);
    const tint = tintAt(ctx, g);
    ctx.world.fx.crack(g, 1.2);
    ctx.audio.play('bend_earth_rise', { position: g, volume: 0.8, pitch: 1.3 });
    // A ring of stone shards rises around the feet and holds there.
    rockMat ??= new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.95, flatShading: true });
    const mat = rockMat;
    mat.color.set(tint);
    const ring = new THREE.Group();
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(rockGeometry(i % 4, 0), mat);
      m.scale.set(0.32, 0.55, 0.32);
      m.position.set(Math.cos(a) * 0.45, -0.3, Math.sin(a) * 0.45);
      m.rotation.set(0.3 * Math.cos(a), a, -0.3 * Math.sin(a));
      ring.add(m);
    }
    ring.position.copy(g);
    ctx.vfx.group.add(ring);
    debris(g.clone().setY(g.y + 0.2), 6, { spread: 0.6, speed: 3, size: 0.12, color: tint });
    const hold = 2.8;
    if (target && ctx.combat.canHarm(cast.caster, target)) {
      cast.hit(target, { damage: 8, stagger: 25, status: [{ type: 'slow', duration: hold, magnitude: 1 }] });
      gripped.set(target, ctx.time.elapsed + hold);
      if (target.body) target.body.velocity.set(0, Math.min(0, target.body.velocity.y), 0);
    }
    // Rise, hold, crumble.
    let t = 0;
    const pos = ring.position;
    const follow = target;
    const step = (dt: number): boolean => {
      t += dt;
      const k = Math.min(1, t / 0.15);
      for (const c of ring.children) c.position.y = -0.3 + 0.45 * k;
      if (follow && follow.alive && t < hold) {
        // Feet held: the target stays put.
        pos.x = follow.position.x;
        pos.z = follow.position.z;
        if (follow.body && t < hold) follow.body.velocity.x = follow.body.velocity.z = 0;
      }
      if (t >= hold) {
        debris(pos.clone().setY(pos.y + 0.3), 8, { spread: 1, speed: 3, size: 0.14, color: tint });
        ctx.audio.play('bend_rock_throw', { position: pos, volume: 0.4, pitch: 1.5 });
        return false;
      }
      return true;
    };
    addEffect(
      effect(step, () => {
        ctx.vfx.group.remove(ring);
      }),
    );
  },
  aiScore: (_c, _t, dist) => (dist < 14 ? 0.3 : 0),
});

registerTechnique({
  id: 'stone_gloves',
  name: 'Stone Gloves',
  element: 'earth',
  kind: 'ability',
  tier: 2,
  description: 'Punch twice: two fists of stone break from your hands, fly at your target, strike, and drag them toward you.',
  usage: 'Aim and press. Each glove hits once and pulls; good for dragging a ranged foe into reach.',
  icon: 'earth',
  chiCost: 20,
  cooldown: 4.5,
  windup: 0.22,
  recovery: 0.45,
  movement: 'slow',
  airborne: false,
  interruptible: true,
  range: 22,
  precheck: earthPrecheck,
  begin(cast) {
    anim(cast.caster, 'earth_strike_r', { speed: 1.3, fadeIn: 0.04 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const tint = tintAt(ctx, c.position);
    const throwGlove = (hand: 'handL' | 'handR', delay: number) => {
      const fire = () => {
        const origin = c.castOrigin(hand, new THREE.Vector3());
        const dir = new THREE.Vector3().copy(cast.aimPoint).sub(origin).normalize();
        if (hand === 'handL') anim(c, 'earth_strike_l', { speed: 1.3, fadeIn: 0.03 });
        ctx.audio.play('bend_rock_throw', { position: origin, volume: 0.7, pitch: 1.25 });
        cast.projectile({
          position: origin,
          velocity: dir.multiplyScalar(30),
          radius: 0.38,
          gravity: 0,
          life: 22 / 30,
          damage: 13,
          stagger: 30,
          visual: rockVisual(ctx, 0.34, tint),
          onHitEntity(p, e) {
            // The glove grabs and drags them in.
            if (ctx.combat.canHarm(c, e)) drag(ctx, e, c.position, 2.4, 10, 0.7);
            e.stunned = Math.max(e.stunned, 0.35);
            rockImpact(ctx, p.position, 0.5, tint);
          },
          onHitWorld(_p, point) {
            rockImpact(ctx, point, 0.45, tint);
          },
        });
      };
      if (delay <= 0) fire();
      else {
        let t = 0;
        addEffect(effect((dt) => ((t += dt) < delay ? true : (fire(), false))));
      }
    };
    throwGlove('handR', 0);
    throwGlove('handL', 0.18);
    shake(ctx, c.position, 0.06, 0.15);
  },
  aiScore: (_c, _t, dist) => (dist > 6 && dist < 20 ? 0.35 : 0),
});
