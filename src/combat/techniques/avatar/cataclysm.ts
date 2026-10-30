import * as THREE from 'three';
import { createWaterMaterial } from '../../water/WaterMaterials';
import { RockPillar, solidAt } from '../../../vfx/effects/constructs';
import { shardRing } from '../../../vfx/effects/earth';
import { fireExplosion, flameRing } from '../../../vfx/effects/fire';
import { debris, effect } from '../../../vfx/effects/loop';
import { earthTint, rockGeometry, stoneMaterial } from '../../../vfx/effects/rocks';
import { shared, shellTorus } from '../../../vfx/effects/shapes';
import { windRing, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { anim, enemiesNear, groundY, hitSphere, push, shake } from '../bending/util';
import { beginUltimate, interruptCast, spiritPrecheck } from './common';

/**
 * Avatar Cataclysm (combined, slot 5) — the Avatar rises while all four
 * elements gather: wind spirals in, a ring of water contracts, rocks tear out
 * of the ground and orbit tight, a ring of fire closes in (enemies are drawn
 * toward the eye). At the peak everything is released in one battlefield-
 * scale blast (18 m): air throws, fire burns, earth erupts in a ring of rock
 * formations and cracks, water floods outward. One hit per enemy through
 * CombatSystem (hitSphere → cast.hit).
 */

const BLAST_R = 18;
const GATHER = 1.6;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

interface GatherRock {
  mesh: THREE.Mesh;
  a: number;
  r: number;
  y: number;
  vel: THREE.Vector3;
}

function gather(cast: Cast): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const q = ctx.vfx.quality;
  const startY = c.position.y;
  const g = ctx.world.groundAt(c.position.x, c.position.z, c.position.y + 1);
  const tint = earthTint(g.surface);
  // Water ring (contracts), rocks (rise and spiral in).
  const ringMat = createWaterMaterial({ opacity: 0, flow: 5, foam: 1.4, glow: 0.3 });
  ringMat.side = THREE.DoubleSide;
  const ring = new THREE.Mesh(shared(`avatar_cata_ring_${q}`, () => shellTorus(0.09, 6, q === 'low' ? 48 : 80)), ringMat);
  ring.rotation.x = Math.PI / 2;
  ctx.vfx.group.add(ring);
  const rocks: GatherRock[] = [];
  const nRocks = q === 'low' ? 4 : q === 'medium' ? 6 : 8;
  for (let i = 0; i < nRocks; i++) {
    const mesh = new THREE.Mesh(rockGeometry(i + 3, 1), stoneMaterial(tint));
    mesh.scale.setScalar(0.3 + (i % 3) * 0.08);
    ctx.vfx.group.add(mesh);
    rocks.push({ mesh, a: (i / nRocks) * Math.PI * 2, r: 8 + (i % 2) * 1.5, y: -0.5, vel: new THREE.Vector3() });
  }
  windSpiral(ctx, c.position.clone(), { height: 4, r0: 1, r1: 6, duration: 1.2, turns: 2.5, count: q === 'low' ? 1 : 3 });
  flameRing(ctx, c.position.clone().setY(c.position.y + 0.1), { r0: 11, r1: 1.6, height: 1.6, duration: GATHER * 0.95 });
  for (const r of rocks) {
    const p = tmp.set(c.position.x + Math.cos(r.a) * r.r, g.y + 0.2, c.position.z + Math.sin(r.a) * r.r);
    ctx.vfx.burst('dust', p, { count: 5, radius: 0.5, speed: 1 });
    debris(p, 3, { spread: 0.8, speed: 4, size: 0.08, radius: 0.4, color: tint, life: 1 });
  }
  let age = 0;
  let fling = 0;
  effect(
    (dt) => {
      age += dt;
      const released = !!cast.data.released;
      if (!released) {
        if (cast.phase === 'done' || !c.alive) return false; // interrupted: just clean up
        const k = Math.min(1, age / GATHER);
        const center = tmp2.set(c.position.x, c.position.y + 1.1, c.position.z);
        // Levitate.
        const b = c.body;
        if (b) {
          const target = startY + 1.5 * Math.min(1, age / 0.9);
          b.velocity.y = Math.max(-2, Math.min(4, (target - c.position.y) * 6));
          b.grounded = false;
        }
        // Water ring closes in.
        const rr = 9 - 7.6 * (k * k * (3 - 2 * k));
        ring.position.copy(center);
        ring.scale.setScalar(rr);
        ring.rotation.z += dt * 3;
        ringMat.uniforms.uOpacity.value = 0.85 * Math.min(1, age / 0.3);
        // Rocks rise, then spiral in to a tight orbit.
        for (const r of rocks) {
          r.a += dt * (1.2 + 3 * k);
          const rad = r.r * (1 - 0.82 * k);
          const y = Math.min(1.1, -0.5 + age * 2.4) + Math.sin(r.a * 2) * 0.4 * k;
          r.mesh.position.set(c.position.x + Math.cos(r.a) * rad, c.position.y + y, c.position.z + Math.sin(r.a) * rad);
          r.mesh.rotation.x += dt * 3;
          r.mesh.rotation.y += dt * 2;
        }
        // Spirit + wind converge; enemies are drawn toward the eye.
        if (Math.random() < dt * 30) {
          const p = tmp.randomDirection().multiplyScalar(6 + Math.random() * 3).add(center);
          ctx.vfx.burst(Math.random() < 0.5 ? 'spirit' : 'swirl', p, { count: 1, dir: tmp.subVectors(center, p), spread: 0.1, speed: 4, life: 0.8 });
        }
        if (Math.random() < dt * 12) ctx.vfx.burst('embers', center, { count: 3, radius: 3, swirl: 9, speed: 1 });
        for (const e of enemiesNear(cast, c.position, BLAST_R)) {
          const to = tmp.set(c.position.x - e.position.x, 0, c.position.z - e.position.z);
          const d = to.length();
          if (d < 2.5 || !e.body) continue;
          e.body.external.addScaledVector(to.divideScalar(d), 7 * dt);
        }
        return true;
      }
      // After the blast: the gathered rocks and water are thrown outward.
      fling += dt;
      for (const r of rocks) {
        if (fling < dt * 1.5) r.vel.set(Math.cos(r.a), 0.35, Math.sin(r.a)).multiplyScalar(26);
        r.vel.y -= 20 * dt;
        r.mesh.position.addScaledVector(r.vel, dt);
        r.mesh.rotation.x += dt * 8;
      }
      ring.scale.setScalar(1.4 + fling * 40);
      ringMat.uniforms.uOpacity.value = Math.max(0, 0.85 * (1 - fling / 0.45));
      return fling < 0.5;
    },
    () => {
      ring.removeFromParent();
      ringMat.dispose();
      for (const r of rocks) {
        if (cast.data.released) debris(r.mesh.position, 3, { spread: 1, speed: 4, size: 0.1, radius: 0.3, color: tint, life: 1.2 });
        r.mesh.removeFromParent();
      }
    },
  );
}

registerTechnique({
  id: 'ult_cataclysm',
  name: 'Avatar Cataclysm',
  element: 'avatar',
  kind: 'combined',
  tier: 4,
  requires: 'elementsSphere',
  description: 'Rise into the eye of all four elements. Wind, water, earth and fire converge around you, then explode across the battlefield in a single cataclysmic blast.',
  usage: 'Elements Sphere only (slot 5). A 1.6 s gathering (you levitate; enemies are drawn in), then an 18 m blast: massive damage, knockdown, burning, a ring of rock formations. Costs 30 spirit.',
  icon: 'avatar',
  chiCost: 50,
  cooldown: 18,
  windup: GATHER,
  recovery: 0.6,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: BLAST_R,
  precheck: spiritPrecheck('ult_cataclysm'),
  begin(cast) {
    beginUltimate(cast);
    const ctx = cast.ctx;
    anim(cast.caster, 'ult_cataclysm_cast', { fadeIn: 0.06 });
    ctx.audio.play('ult.cataclysm', { position: cast.caster.position, volume: 1 });
    ctx.events.emit('camera:impulse', { pullback: 5, fovKick: 6, duration: GATHER + 1 });
    ctx.avatar.sphereFx?.converge(GATHER);
    gather(cast);
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const c = cast.caster;
    const center = c.position.clone().setY(c.position.y + 1);
    const gy = groundY(ctx, c.position.x, c.position.z, c.position.y);
    const ground = new THREE.Vector3(c.position.x, gy, c.position.z);
    const g = ctx.world.groundAt(ground.x, ground.z, gy + 1);
    const tint = earthTint(g.surface);
    const q = ctx.vfx.quality;
    // One combined hit per enemy: air throw + earth knockdown + fire burn.
    const hits = hitSphere(cast, tmp.copy(ground).setY(gy + 1), BLAST_R, 9, (_e, away) => ({ damage: 60, knockback: push(away, 26), launch: 9, knockdown: true, stagger: 150, stun: 0.5, status: [{ type: 'burn', duration: 4, magnitude: 1.2 }] }));
    for (const e of hits) interruptCast(ctx, e);
    ctx.avatar.sphereFx?.burst();
    // Air.
    windRing(ctx, center.clone(), { r0: 1, r1: BLAST_R + 2, duration: 0.7, height: 4, spin: 3 });
    windRing(ctx, ground.clone().setY(gy + 0.2), { r0: 1, r1: BLAST_R + 4, duration: 0.8, flat: true, opacity: 0.8 });
    // Fire.
    flameRing(ctx, ground.clone().setY(gy + 0.05), { r0: 1, r1: BLAST_R - 2, height: 2.6, duration: 0.95 });
    fireExplosion(ctx, center.clone(), 5, { hot: true, smoke: true });
    ctx.world.fx.scorch(ground, 7);
    ctx.events.emit('bending:heat', { position: { x: ground.x, y: ground.y, z: ground.z }, radius: 12, intensity: 2, casterId: c.id });
    // Water.
    ctx.vfx.ring(ground.clone().setY(gy + 0.3), '#9fd8ff', BLAST_R, 0.9, { opacity: 0.5 });
    const nSplash = q === 'low' ? 8 : 16;
    for (let i = 0; i < nSplash; i++) {
      const a = (i / nSplash) * Math.PI * 2;
      const p = tmp.set(ground.x + Math.cos(a) * 6, gy + 0.5, ground.z + Math.sin(a) * 6);
      ctx.vfx.burst('splash', p, { count: 6, dir: tmp2.set(Math.cos(a), 0.7, Math.sin(a)), spread: 0.4, speed: 3 });
      if (i % 4 === 0) ctx.world.fx.wet(p, 3);
    }
    // Earth: shards, cracks and a ring of rock formations (temporary colliders).
    shardRing(ctx, ground, 8, tint, 0.5);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.world.fx.crack(tmp.set(ground.x + Math.cos(a) * 4, gy, ground.z + Math.sin(a) * 4), 3, Math.atan2(Math.cos(a), Math.sin(a)));
    }
    const nPillars = q === 'low' ? 6 : 10;
    for (let i = 0; i < nPillars; i++) {
      const a = (i / nPillars) * Math.PI * 2 + 0.2;
      const r = 9 + (i % 3) * 1.5;
      const x = ground.x + Math.cos(a) * r, z = ground.z + Math.sin(a) * r;
      const py = groundY(ctx, x, z, gy + 3);
      if (Math.abs(py - gy) > 4 || ctx.world.liquidAt(x, z) || solidAt(ctx, tmp.set(x, py + 1.2, z), 1, [], 0.5)) continue;
      new RockPillar(ctx, { x, z, ground: py, radius: 0.6 + (i % 2) * 0.3, height: 2 + (i % 3) * 0.8, ownerId: c.id, timing: { rise: 0.2, stand: 3.5 + (i % 4) * 0.4, sink: 0.9 }, tint, variant: i });
    }
    // Spirit.
    ctx.vfx.sphereWave(center, '#ffffff', BLAST_R, 0.9, 0.16);
    ctx.vfx.sphereWave(center, '#bfe8ff', BLAST_R * 0.7, 0.7, 0.14);
    ctx.vfx.flash(center, '#fff4e0', 8, 0.5, 40);
    ctx.vfx.burst('spirit', center, { count: 40, speed: 5, radius: 1 });
    ctx.world.fx.disturb(ground, 24, 2);
    ctx.audio.play('bend_explosion', { position: center, volume: 1, pitch: 0.7 });
    shake(ctx, center, 0.85, 0.9);
    ctx.events.emit('camera:impulse', { fovKick: 9, pullback: 2, duration: 0.9 });
  },
});
