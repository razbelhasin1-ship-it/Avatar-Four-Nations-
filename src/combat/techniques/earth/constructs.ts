import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { Entity } from '../../../entities/Entity';
import { Boulder, liveConstructs, RockPillar, solidAt, StoneSpike, StoneWall } from '../../../vfx/effects/constructs';
import { rockImpact } from '../../../vfx/effects/earth';
import { debris, effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { aimFlat, anim, hitSphere, push, resolveTarget, shake } from '../bending/util';
import { bendableAt, earthPrecheck, groundPoint, takeCounter, tintAt } from './common';
import { seismicPulse } from './seismic';

/**
 * Earth constructs: Earth Pillar, Stone Wall (and punching it), Ground Spikes
 * and Boulder Roll. All are real dynamic colliders (see vfx/effects/constructs)
 * that rise out of the ground, block movement/projectiles and sink back.
 */

const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Earth Pillar
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'earth_pillar',
  name: 'Earth Pillar',
  element: 'earth',
  kind: 'ability',
  tier: 1,
  starter: true,
  description: 'A column of stone erupts from the ground. Under an enemy it hurls them skyward; with no target it rises beneath you as a vantage point.',
  usage: 'Aim at an enemy (up to 18 m) to launch them. With no enemy targeted, the pillar lifts you up. Pillars are solid and walkable, and sink back after a few seconds.',
  icon: 'earth',
  chiCost: 14,
  cooldown: 1.4,
  windup: 0.2,
  recovery: 0.3,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 18,
  precheck: earthPrecheck,
  begin(cast) {
    const ctx = cast.ctx;
    anim(cast.caster, 'earth_raise', { fadeIn: 0.05 });
    const target = resolveTarget(cast, 2.8);
    const t = target && target.position.distanceTo(cast.caster.position) <= 18.5 && bendableAt(ctx, target.position.x, target.position.z, target.position.y) ? target : null;
    cast.data.target = t;
    // Telegraph: the ground cracks and rumbles where the pillar will burst out.
    const at = t ? t.position : cast.caster.position;
    const g = groundPoint(ctx, at.x, at.z, at.y);
    ctx.vfx.burst('dust', g, { count: 8, radius: 0.9, speed: 0.6 });
    debris(g, 3, { spread: 0.3, speed: 2.5, size: 0.08, color: tintAt(ctx, g), life: 0.6 });
    ctx.world.fx.crack(g, 1.2);
    ctx.audio.play('bend_earth_sink', { position: g, volume: 0.5, pitch: 0.7 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const target = cast.data.target as Entity | null;
    const mul = takeCounter(cast);
    if (target && target.alive) {
      const g = groundPoint(ctx, target.position.x, target.position.z, target.position.y);
      new RockPillar(ctx, { x: g.x, z: g.z, ground: g.y, radius: 0.95, height: 3.4, ownerId: c.id, tint: tintAt(ctx, g), timing: { rise: 0.16, stand: 5, sink: 0.7 } });
      cast.hit(target, { damage: 12 * mul, launch: 13 + (mul > 1 ? 4 : 0), stagger: 45 * mul, knockback: push(aimFlat(cast), 2), point: target.aimPoint(tmp).clone() });
      shake(ctx, g, 0.2, 0.25);
      seismicPulse(ctx, c, c.position, 20);
    } else {
      // Under yourself: a slower rise you can ride up.
      const g = groundPoint(ctx, c.position.x, c.position.z, c.position.y);
      new RockPillar(ctx, { x: g.x, z: g.z, ground: g.y, radius: 1.05, height: 3.0, ownerId: c.id, tint: tintAt(ctx, g), timing: { rise: 0.38, stand: 6, sink: 0.8 } });
      shake(ctx, g, 0.12, 0.3);
    }
  },
  aiScore: (_c, _t, dist) => (dist > 3 && dist < 16 ? 0.5 : 0),
});

// ---------------------------------------------------------------------------
// Stone Wall (+ punching it forward)
// ---------------------------------------------------------------------------

/** The caster's standing (not yet thrown) wall, if any. */
export function ownWall(cast: Cast): StoneWall | null {
  for (const c of liveConstructs()) {
    if (c instanceof StoneWall && c.ownerId === cast.caster.id && c.alive && !c.launched && c.phase !== 'sink') return c;
  }
  return null;
}

/** Own wall standing in front of the caster within `maxDist` (for punching it). */
export function ownWallInFront(cast: Cast, maxDist: number): StoneWall | null {
  const w = ownWall(cast);
  if (!w) return null;
  const to = tmp.subVectors(w.group.position, cast.caster.position).setY(0);
  const d = to.length();
  if (d > maxDist) return null;
  const f = aimFlat(cast);
  return d < 0.5 || to.dot(f) / d > 0.55 ? w : null;
}

/** Rip the wall free and drive it forward as a crushing slab. */
export function punchWall(cast: Cast, wall: StoneWall): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const dir = aimFlat(cast);
  // Push away from the caster's side of the wall.
  const mul = takeCounter(cast);
  const hit = (center: THREE.Vector3) => {
    hitSphere(cast, center, wall.width * 0.5 + 0.5, wall.height * 0.5 + 0.4, () => ({ damage: 24 * mul, knockback: push(dir, 18), launch: 3, stagger: 70 * mul, knockdown: true }));
    return true;
  };
  let n = 0;
  wall.launch(dir, 17, 1.6, (center) => {
    if (n++ % 3 === 0) ctx.world.fx.crack(center.clone().setY(wall.baseY), 1.5);
    return hit(center);
  });
  ctx.audio.play('bend_rock_throw', { position: wall.center, volume: 1, pitch: 0.55 });
  ctx.audio.play('bend_earth_slam', { position: wall.center, volume: 0.6, pitch: 1.3 });
  shake(ctx, c.position, 0.25, 0.25);
}

registerTechnique({
  id: 'stone_wall',
  name: 'Stone Wall',
  element: 'earth',
  kind: 'defense',
  tier: 2,
  description: 'Raise a thick wall of stone that stops projectiles and blocks the way. Punch it to send the whole slab crashing forward.',
  usage: 'Raises a wall a few metres in front of you (lasts ~9 s; walkable on top). Use again — or hit it with Rock Strike — to punch it forward as a battering slab.',
  icon: 'earth',
  chiCost: 16,
  cooldown: 1.2,
  windup: 0.26,
  recovery: 0.35,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 6,
  precheck: earthPrecheck,
  begin(cast) {
    const wall = ownWall(cast);
    cast.data.wall = wall;
    anim(cast.caster, wall ? 'earth_push' : 'earth_wall', { fadeIn: 0.05 });
    if (wall) cast.elapsed += 0.12;
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const existing = cast.data.wall as StoneWall | null;
    if (existing && existing.alive && !existing.launched) {
      punchWall(cast, existing);
      return;
    }
    const dir = aimFlat(cast);
    const at = c.position.clone().addScaledVector(dir, 3.2);
    const g = groundPoint(ctx, at.x, at.z, c.position.y);
    if (!bendableAt(ctx, g.x, g.z, g.y) || g.y - c.position.y > 2.5) {
      ctx.vfx.burst('dust', g, { count: 8, radius: 1 });
      return;
    }
    const yaw = Math.atan2(dir.x, dir.z);
    new StoneWall(ctx, { x: g.x, z: g.z, ground: g.y - 0.15, yaw, width: 5.2, height: 3.1, thick: 0.95, ownerId: c.id, tint: tintAt(ctx, g) });
    shake(ctx, g, 0.18, 0.3);
    seismicPulse(ctx, c, c.position, 20);
  },
  aiScore: (_c, _t, dist) => (dist > 8 && dist < 25 ? 0.3 : 0),
});

// ---------------------------------------------------------------------------
// Ground Spikes — a line of stone spikes races forward.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'ground_spikes',
  name: 'Ground Spikes',
  element: 'earth',
  kind: 'ability',
  tier: 2,
  description: 'Drive your fists into the earth and send a line of stone spikes racing along the ground, impaling and launching anything in their path.',
  usage: 'A 15 m line toward your aim. Each enemy is hit once and thrown into the air. Stops at walls and water.',
  icon: 'earth',
  chiCost: 20,
  cooldown: 2.5,
  windup: 0.26,
  recovery: 0.4,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 15,
  precheck: earthPrecheck,
  begin(cast) {
    anim(cast.caster, 'earth_spikes', { fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const mul = takeCounter(cast);
    const start = c.position.clone().addScaledVector(dir, 1.4);
    let prevY = c.position.y;
    let i = 0;
    let t = 0;
    const spacing = 1.0;
    const count = 14;
    const interval = 0.035;
    let rumble: LoopHandle | null = ctx.audio.loop('bend_rumble_loop', { position: start, volume: 0.7 });
    effect(
      (dt) => {
        t += dt;
        while (i < count && t >= i * interval) {
          const p = start.clone().addScaledVector(dir, i * spacing);
          const g = groundPoint(ctx, p.x, p.z, prevY);
          if (Math.abs(g.y - prevY) > 1.6 || !bendableAt(ctx, g.x, g.z, g.y) || solidAt(ctx, g.clone().setY(g.y + 0.8), 0.4, [], 0.5)) {
            i = count;
            break;
          }
          prevY = g.y;
          const big = i % 2 === 0;
          const tint = tintAt(ctx, g);
          new StoneSpike(ctx, {
            x: g.x + (Math.random() - 0.5) * 0.3,
            z: g.z + (Math.random() - 0.5) * 0.3,
            ground: g.y,
            radius: big ? 0.55 : 0.4,
            height: big ? 2.1 : 1.5,
            ownerId: c.id,
            tint,
            collider: big,
            tilt: new THREE.Vector2(dir.z * 0.25 * (Math.random() - 0.3), -dir.x * 0.25 * (Math.random() - 0.3)),
            timing: { rise: 0.08, stand: 0.9 + (count - i) * 0.02, sink: 0.45 },
          });
          ctx.vfx.burst('dust', g, { count: 3, radius: 0.5, speed: 1.2 });
          if (big) debris(g, 2, { spread: 0.8, speed: 5, size: 0.1, color: tint, life: 1 });
          if (i % 3 === 0) ctx.world.fx.crack(g, 1);
          hitSphere(cast, g.clone().setY(g.y + 0.9), 1.25, 1.4, () => ({ damage: 16 * mul, launch: 7.5, knockback: push(dir, 4), stagger: 45 * mul }));
          rumble?.setPosition(g);
          i++;
        }
        if (i >= count && rumble) {
          rumble.stop(0.3);
          rumble = null;
        }
        return i < count;
      },
      () => rumble?.stop(0.2),
    );
    ctx.audio.play('bend_earth_rise', { position: start, volume: 1, pitch: 1.2 });
    shake(ctx, start, 0.15, 0.4);
    seismicPulse(ctx, c, c.position, 22);
  },
  aiScore: (_c, _t, dist) => (dist > 3 && dist < 14 ? 0.5 : 0),
});

// ---------------------------------------------------------------------------
// Boulder Roll
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'boulder_roll',
  name: 'Boulder Roll',
  element: 'earth',
  kind: 'ability',
  tier: 2,
  description: 'Heave a huge boulder out of the ground and send it rolling forward, flattening everything in its way.',
  usage: 'The boulder accelerates along the ground (about 30 m), crushing and knocking down every enemy it meets. It blocks projectiles and shatters against walls.',
  icon: 'earth',
  chiCost: 26,
  cooldown: 3.5,
  windup: 0.5,
  recovery: 0.4,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 22,
  precheck: earthPrecheck,
  begin(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'earth_boulder', { fadeIn: 0.06 });
    const dir = aimFlat(cast);
    const at = c.position.clone().addScaledVector(dir, 2.2);
    const g = groundPoint(ctx, at.x, at.z, c.position.y);
    cast.data.boulder = new Boulder(ctx, { x: g.x, z: g.z, ground: g.y, radius: 1.25, ownerId: c.id, tint: tintAt(ctx, g), rise: 0.45 });
    shake(ctx, g, 0.12, 0.45);
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const b = cast.data.boulder as Boulder | undefined;
    if (!b || !b.alive) return;
    anim(c, 'earth_push', { fadeIn: 0.04 });
    const dir = aimFlat(cast);
    const mul = takeCounter(cast);
    const loop = ctx.audio.loop('bend_rumble_loop', { position: b.center, volume: 1 });
    b.startRolling(dir, { speed: 9, maxSpeed: 19, accel: 22, maxTime: 3.2 }, (center) => {
      loop.setPosition(center);
      const hits = hitSphere(cast, center, b.radius + 0.4, b.radius + 0.3, () => ({ damage: 28 * mul, knockback: push(dir, 16), launch: 5, stagger: 80 * mul, knockdown: true }));
      for (const e of hits) rockImpact(ctx, e.aimPoint(tmp), 0.8, b.tint);
      if (hits.length) shake(ctx, center, 0.2, 0.2);
      return true;
    });
    effect(
      () => b.alive,
      () => loop.stop(0.3),
    );
    ctx.audio.play('bend_rock_throw', { position: b.center, volume: 1, pitch: 0.5 });
    shake(ctx, b.center, 0.18, 0.25);
  },
  end(cast, interrupted) {
    const b = cast.data.boulder as Boulder | undefined;
    if (interrupted && b && !b.rolling) b.shatter(12);
  },
  aiScore: (_c, _t, dist) => (dist > 6 && dist < 22 ? 0.45 : 0),
});
