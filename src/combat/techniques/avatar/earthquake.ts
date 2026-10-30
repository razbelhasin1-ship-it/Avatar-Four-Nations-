import * as THREE from 'three';
import { RockPillar, solidAt } from '../../../vfx/effects/constructs';
import { rockImpact, shardRing } from '../../../vfx/effects/earth';
import { debris, effect } from '../../../vfx/effects/loop';
import { earthTint } from '../../../vfx/effects/rocks';
import { registerTechnique } from '../../CombatSystem';
import { anim, enemiesNear, groundY, push, shake } from '../bending/util';
import { beginUltimate, heightAboveSurface, interruptCast, spiritPrecheck } from './common';

/**
 * Earthquake — the Avatar stomps and a shockwave rolls outward through the
 * ground: cracks race along radial lines, temporary rock formations erupt as
 * walkable dynamic colliders (they sink again after a few seconds — nothing is
 * permanently destroyed), and every grounded enemy the front passes is
 * knocked down, launched and has its cast interrupted (once per enemy).
 */

const RADIUS = 14;
const DURATION = 1.15;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

registerTechnique({
  id: 'ult_earthquake',
  name: 'Earthquake',
  element: 'avatar',
  kind: 'ultimate',
  tier: 4,
  requires: 'elementsSphere',
  description: 'Stomp with the weight of the world. A shockwave splits the ground around you, throws up jagged rock formations and knocks every grounded enemy off their feet, breaking their concentration.',
  usage: 'Elements Sphere only. The quake rolls 14 m out in every direction: knockdown, launch and cast interruption for enemies on the ground; the raised rocks can be climbed and sink after ~5 s. Costs 15 spirit.',
  icon: 'earth',
  chiCost: 30,
  cooldown: 8,
  windup: 0.55,
  recovery: 0.6,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 12,
  precheck: spiritPrecheck('ult_earthquake'),
  begin(cast) {
    beginUltimate(cast);
    const ctx = cast.ctx;
    anim(cast.caster, 'ult_earthquake_cast', { fadeIn: 0.05 });
    ctx.audio.play('ult.earthquake', { position: cast.caster.position, volume: 1 });
    ctx.vfx.burst('dust', cast.caster.position, { count: 8, radius: 1, speed: 0.6 });
    ctx.events.emit('camera:impulse', { pullback: 3, fovKick: 3, duration: 1.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const center = c.position.clone();
    center.y = groundY(ctx, center.x, center.z, center.y);
    const g = ctx.world.groundAt(center.x, center.z, center.y + 1);
    const tint = earthTint(g.surface);
    const q = ctx.vfx.quality;
    // Where the rock formations will rise (skipping water, solid architecture and the Avatar's own spot).
    const spots: Array<{ x: number; z: number; r: number; done: boolean; radius: number; height: number; variant: number }> = [];
    const nSpots = q === 'low' ? 6 : q === 'medium' ? 9 : 12;
    for (let i = 0; i < nSpots; i++) {
      const a = (i / nSpots) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r = 4 + ((i * 5) % 9) + Math.random() * 1.5;
      spots.push({ x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, r, done: false, radius: 0.55 + Math.random() * 0.5, height: 1.8 + Math.random() * 1.8, variant: i });
    }
    const nLines = q === 'low' ? 6 : 10;
    const lineAngles = Array.from({ length: nLines }, (_, i) => (i / nLines) * Math.PI * 2 + Math.random() * 0.3);
    let crackStep = 0;
    let age = 0;
    let prevR = 0;
    let disturbT = 0;
    shardRing(ctx, center, 4, tint, 0.35);
    rockImpact(ctx, center.clone().setY(center.y + 0.2), 1.6, tint);
    ctx.vfx.ring(center.clone().setY(center.y + 0.1), '#c8a878', RADIUS, DURATION, { opacity: 0.6 });
    ctx.audio.play('bend_earth_slam', { position: center, volume: 1 });
    shake(ctx, center, 0.6, 0.9);
    effect((dt) => {
      age += dt;
      const r = Math.min(RADIUS, 1 + (RADIUS - 1) * (age / DURATION));
      // Shockwave front: grounded enemies between the previous and current radius.
      for (const e of enemiesNear(cast, center, r + 1.5)) {
        const d = Math.hypot(e.position.x - center.x, e.position.z - center.z);
        if (d > r + 0.6 || d < prevR - 1.2) continue;
        if (heightAboveSurface(ctx, e) > 2.5) continue; // airborne: the ground cannot reach them
        const away = tmp.set(e.position.x - center.x, 0, e.position.z - center.z);
        if (away.lengthSq() < 1e-4) away.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        const res = cast.hit(e, { damage: 30, knockback: push(away, 8), launch: 6.5, knockdown: true, stagger: 100, stun: 0.6, point: e.aimPoint(tmp2).clone() });
        if (res) interruptCast(ctx, e);
      }
      // Cracks race along radial lines.
      while (crackStep * 2 + 1.5 < r) {
        const dist = crackStep * 2 + 1.5;
        for (const a of lineAngles) {
          const p = tmp.set(center.x + Math.cos(a) * dist, 0, center.z + Math.sin(a) * dist);
          p.y = groundY(ctx, p.x, p.z, center.y + 2);
          ctx.world.fx.crack(p, 1.3 + Math.random() * 0.5, Math.atan2(Math.cos(a), Math.sin(a)));
        }
        crackStep++;
      }
      // Dust and stones jump along the front.
      const n = q === 'low' ? 8 : 16;
      for (let i = 0; i < n; i++) {
        if (Math.random() > 0.35) continue;
        const a = Math.random() * Math.PI * 2;
        const p = tmp.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
        p.y = groundY(ctx, p.x, p.z, center.y + 2) + 0.1;
        ctx.vfx.burst('dust', p, { count: 2, dir: tmp2.set(Math.cos(a), 1, Math.sin(a)), spread: 0.5, speed: 2.4 });
        if (Math.random() < 0.3) debris(p, 2, { spread: 0.7, speed: 5, size: 0.1, radius: 0.4, color: tint, life: 1.4 });
      }
      // Rock formations erupt as the front reaches them.
      for (const s of spots) {
        if (s.done || s.r > r) continue;
        s.done = true;
        const gy = groundY(ctx, s.x, s.z, center.y + 3);
        if (Math.abs(gy - center.y) > 4 || ctx.world.liquidAt(s.x, s.z)) continue;
        if (solidAt(ctx, tmp.set(s.x, gy + 1.2, s.z), s.radius + 0.3, [], 0.5)) continue;
        new RockPillar(ctx, { x: s.x, z: s.z, ground: gy, radius: s.radius, height: s.height, ownerId: c.id, timing: { rise: 0.18, stand: 4.5 + Math.random() * 1.5, sink: 0.9 }, tint, variant: s.variant });
      }
      disturbT -= dt;
      if (disturbT <= 0) {
        disturbT = 0.15;
        ctx.world.fx.disturb(center, r + 1, 1.5);
      }
      prevR = r;
      return age < DURATION;
    });
  },
});
