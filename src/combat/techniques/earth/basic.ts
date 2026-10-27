import * as THREE from 'three';
import { RisingRock, rockImpact, shardRing } from '../../../vfx/effects/earth';
import { debris } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending } from '../bending/runtime';
import { aimFlat, anim, hitSphere, push, ringSweep, shake } from '../bending/util';
import { earthPrecheck, groundPoint, takeCounter, tintAt } from './common';
import { ownWallInFront, punchWall } from './constructs';
import { seismicPulse } from './seismic';

/**
 * Earth basics: Rock Strike (stomp a rock out of the ground and punch it, right
 * then left; kick a spinning stone disc; heave a heavy slab) and Seismic Slam
 * (charged stomp shockwave). Earth is slow to start but every hit lands hard; a
 * counter window after Stone Guard boosts them.
 */

const tmp = new THREE.Vector3();

registerTechnique({
  id: 'earth_strike',
  name: 'Rock Strike',
  element: 'earth',
  kind: 'basic',
  tier: 1,
  starter: true,
  description: 'Stomp a rock up out of the ground and punch it at your foe; the third strike kicks a spinning stone disc, the fourth heaves up a heavy slab that shatters on impact.',
  usage: 'Primary attack — two quick rocks, a kicked stone disc that flies flat and fast, then a heavy fourth. Strike right after a Stone Guard block for a powerful counter. Punch your own Stone Wall to send it flying.',
  icon: 'earth',
  chiCost: 5,
  cooldown: 0,
  windup: 0.22,
  recovery: 0.28,
  movement: 'slow',
  airborne: false,
  interruptible: true,
  range: 22,
  comboLength: 4,
  precheck: earthPrecheck,
  begin(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const step = cast.comboIndex;
    const heavy = step === 3;
    const kick = step === 2;
    const wall = ownWallInFront(cast, 4.5);
    if (wall) {
      cast.data.wall = wall;
      anim(c, 'earth_push', { fadeIn: 0.05 });
      return;
    }
    anim(c, heavy ? 'earth_strike_heavy' : kick ? 'earth_strike_kick' : step ? 'earth_strike_l' : 'earth_strike_r', { speed: heavy ? 1 : 1.05, fadeIn: 0.05 });
    if (heavy) cast.elapsed -= 0.2;
    // The disc is stomped up, then kicked: release when the heel lands on it.
    if (kick) cast.elapsed -= 0.09;
    const counter = bending.counter(c);
    const fwd = aimFlat(cast);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const side = step === 0 ? 0.35 : step === 1 ? -0.35 : kick ? 0.12 : 0;
    const reach = kick ? 1.1 : 1.25;
    const gx = c.position.x + fwd.x * reach + right.x * side;
    const gz = c.position.z + fwd.z * reach + right.z * side;
    const ground = groundPoint(ctx, gx, gz, c.position.y);
    const radius = (heavy ? 0.62 : kick ? 0.52 : 0.34) * (counter ? 1.3 : 1);
    const hover = heavy ? ground.y + 1.15 : kick ? ground.y + 0.85 : c.position.y + 1.25;
    cast.data.rock = new RisingRock(ctx, ground, hover, radius, tintAt(ctx, ground), heavy ? 0.36 : kick ? 0.22 : 0.17, kick);
    ctx.audio.play('bend_earth_rise', { position: ground, volume: heavy ? 0.9 : kick ? 0.7 : 0.5, pitch: heavy ? 0.9 : kick ? 1.2 : 1.5 });
    ctx.vfx.burst('dust', c.position, { count: 4, radius: 0.4, speed: 0.8 });
    seismicPulse(ctx, c, c.position, heavy ? 22 : 16);
  },
  release(cast) {
    const ctx = cast.ctx;
    if (cast.data.wall) {
      punchWall(cast, cast.data.wall);
      return;
    }
    const rock = cast.data.rock as RisingRock | undefined;
    if (!rock) return;
    const heavy = cast.comboIndex === 3;
    const kick = cast.comboIndex === 2;
    const mul = takeCounter(cast);
    const from = rock.current.clone();
    // The kicked disc flies flat and fast, barely dropping.
    const speed = heavy ? 24 : kick ? 34 : 30;
    const gravity = heavy ? 7 : kick ? 1.5 : 5;
    const dir = tmp.subVectors(cast.aimPoint, from);
    const dist = dir.length();
    if (dist < 2) dir.copy(cast.aimDir);
    dir.normalize();
    if (kick) {
      dir.y = Math.max(-0.12, Math.min(0.15, dir.y));
      dir.normalize();
    }
    const vel = dir.clone().multiplyScalar(speed);
    vel.y += gravity * Math.min(1.2, dist / speed) * 0.5;
    const tint = rock.tint;
    const r = rock.radius;
    cast.projectile({
      position: from,
      velocity: vel,
      radius: r,
      gravity,
      life: heavy ? 1.6 : kick ? 1.0 : 1.3,
      damage: (heavy ? 22 : kick ? 15 : 11 + cast.comboIndex) * mul,
      knockback: (heavy ? 15 : kick ? 11 : 7) * (mul > 1 ? 1.3 : 1),
      launch: heavy ? 3 : kick ? 1 : 0,
      stagger: (heavy ? 65 : kick ? 40 : 26) * mul,
      visual: rock.toVisual(),
      onHitEntity: (p, e) => {
        rockImpact(ctx, p.position, heavy ? 1.2 : 0.6, tint);
        ctx.audio.play('rock_impact', { position: p.position, volume: heavy ? 1 : 0.7, pitch: heavy ? 0.8 : 1.1 });
        if (heavy) {
          hitSphere(p.cast, p.position, 2.2, 1.6, (x, away) => (x === e ? null : { damage: 8 * mul, knockback: push(away, 8), stagger: 25 }));
          shake(ctx, p.position, 0.22, 0.25);
        }
      },
      onHitWorld: (p, pt) => {
        rockImpact(ctx, pt, heavy ? 1.3 : 0.7, tint);
        ctx.audio.play('rock_impact', { position: pt, volume: heavy ? 0.9 : 0.6, pitch: heavy ? 0.8 : 1.1 });
        if (heavy) hitSphere(p.cast, pt.clone().setY(pt.y + 0.6), 2.2, 1.6, (_x, away) => ({ damage: 8 * mul, knockback: push(away, 8), stagger: 25 }));
      },
    });
    ctx.audio.play('bend_rock_throw', { position: from, volume: heavy ? 0.9 : kick ? 0.8 : 0.6, pitch: heavy ? 0.7 : kick ? 1.2 : 1 });
    if (kick) {
      // The heel strike: a crack of stone and grit off the disc's rim.
      ctx.audio.play('rock_impact', { position: from, volume: 0.45, pitch: 1.5 });
      ctx.vfx.burst('dust', from, { count: 5, radius: 0.4, speed: 1.2 });
    }
    if (mul > 1) {
      ctx.vfx.flash(from, '#ffe2a0', 3, 0.15, 8);
      ctx.vfx.burst('sparks', from, { count: 8, color: '#ffe8b0' });
    }
    if (heavy) shake(ctx, from, 0.1, 0.15);
  },
  end(cast, interrupted) {
    if (interrupted) (cast.data.rock as RisingRock | undefined)?.crumble();
  },
  aiScore: (_c, _t, dist) => (dist > 3 && dist < 20 ? 0.6 : 0.2),
});

registerTechnique({
  id: 'earth_slam',
  name: 'Seismic Slam',
  element: 'earth',
  kind: 'heavy',
  tier: 1,
  starter: true,
  description: 'Raise a knee and drive your foot into the ground: a crown of stone shards bursts outward and the shockwave launches everyone around you.',
  usage: 'Hold Aim to charge (wider, stronger shockwave), release to stomp. Hits all around you.',
  icon: 'earth',
  chiCost: 16,
  cooldown: 1.8,
  windup: 0.28,
  recovery: 0.45,
  movement: 'root',
  airborne: false,
  chargeTime: 1.0,
  interruptible: false,
  range: 7,
  precheck: earthPrecheck,
  begin(cast) {
    anim(cast.caster, 'earth_slam', { speed: 1.05, fadeIn: 0.05 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const k = 0.4 + 0.6 * cast.charge;
    const mul = takeCounter(cast);
    const R = 4 + 4.5 * k;
    const ground = groundPoint(ctx, c.position.x, c.position.z, c.position.y);
    const tint = tintAt(ctx, ground);
    shardRing(ctx, ground, R, tint, 0.3);
    ringSweep(cast, {
      center: ground.clone().setY(ground.y + 0.7),
      r0: 0.5,
      r1: R,
      duration: 0.28,
      height: 1.6,
      hit: (_e, away) => ({ damage: (14 + 18 * k) * mul, knockback: push(away, 8 + 8 * k), launch: 5 + 7 * k, stagger: (50 + 40 * k) * mul }),
      onHit: (e) => {
        ctx.vfx.burst('dust', e.position, { count: 6, radius: 0.5, speed: 1.4 });
        debris(e.position.clone().setY(e.position.y + 0.2), 3, { spread: 1, speed: 5, size: 0.12, color: tint });
      },
    });
    ctx.world.fx.crack(ground, R * 0.55);
    ctx.world.fx.disturb(ground, R * 1.5, 1);
    ctx.audio.play('bend_earth_slam', { position: ground, volume: 0.7 + 0.3 * k, pitch: 1.1 - 0.25 * k });
    shake(ctx, ground, 0.3 + 0.3 * k, 0.35 + 0.15 * k);
    seismicPulse(ctx, c, ground, 34);
  },
  aiScore: (_c, _t, dist) => (dist < 6 ? 0.6 : 0),
});

// Charging: the ground trembles and pebbles hop around the feet.
bending.chargeVisual(
  'earth',
  (ctx, p) => {
    let t = 0;
    let rumbleT = 0;
    const tint = tintAt(ctx, p.position);
    return {
      update(dt, charge) {
        t += dt;
        if (Math.random() < dt * (6 + charge * 24)) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.6 + Math.random() * (1 + charge * 2.5);
          const pos = tmp.set(p.position.x + Math.cos(a) * r, p.position.y + 0.05, p.position.z + Math.sin(a) * r);
          pos.y = groundPoint(ctx, pos.x, pos.z, pos.y).y + 0.05;
          debris(pos, 1, { spread: 0.25, speed: 2 + charge * 3, size: 0.07 + charge * 0.06, color: tint, life: 0.7 });
          if (Math.random() < 0.5) ctx.vfx.burst('dust', pos, { count: 1, speed: 0.4 });
        }
        rumbleT -= dt;
        if (rumbleT <= 0) {
          rumbleT = 0.4;
          ctx.audio.play('bend_earth_sink', { position: p.position, volume: 0.15 + charge * 0.3, pitch: 0.6 + charge * 0.3 });
          if (charge >= 1) ctx.world.fx.crack(p.position, 1.2);
        }
        if (charge > 0.6 && Math.random() < dt * 4) ctx.events.emit('camera:shake', { intensity: 0.04 * charge, duration: 0.15 });
      },
      end() {},
    };
  },
  'earth_charge',
);
