import * as THREE from 'three';
import { airPuff, windBlade, windCone, windRing, WindShell, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending } from '../bending/runtime';
import { anim, groundY, push, shake, sweep } from '../bending/util';
import { deflectProjectiles, takeSlipstream } from './common';

/**
 * Air basics: Air Palm (3-step chain, spinning finisher) and the charged Air
 * Blast. Low damage, big knockback; strikes thrown right after an evasion
 * (dodge / Air Dash) become Slipstream blows — faster and stronger.
 */

const tmp = new THREE.Vector3();

/** Aim direction from a hand, keeping blasts roughly level. */
function airDir(cast: Cast, from: THREE.Vector3, maxPitch = 0.35): THREE.Vector3 {
  const d = new THREE.Vector3().subVectors(cast.aimPoint, from);
  if (d.lengthSq() < 4) d.copy(cast.aimDir);
  d.normalize();
  d.y = Math.max(-maxPitch, Math.min(maxPitch, d.y));
  return d.normalize();
}

registerTechnique({
  id: 'air_palm',
  name: 'Air Palm',
  element: 'air',
  kind: 'basic',
  tier: 1,
  starter: true,
  description: 'Open-palm strikes that throw crescents of wind; the third strike spins into a swirling gust that bowls enemies over.',
  usage: 'Primary attack — chain three strikes. Light damage, strong knockback. Strike right after a dodge or Air Dash for an empowered Slipstream blow.',
  icon: 'air',
  chiCost: 4,
  cooldown: 0,
  windup: 0.08,
  recovery: 0.2,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 9,
  comboLength: 3,
  begin(cast) {
    const step = cast.comboIndex;
    const fin = step === 2;
    const slip = takeSlipstream(cast);
    cast.data.slip = slip;
    anim(cast.caster, fin ? 'air_palm_spin' : step ? 'air_palm_l' : 'air_palm_r', { speed: fin ? 1.3 : 1.15, fadeIn: 0.03, fadeOut: fin ? 0.01 : 0.12 });
    if (fin) cast.elapsed -= 0.15;
    if (slip) cast.elapsed += 0.05;
    const hand = cast.caster.castOrigin(fin ? 'hands' : step ? 'handL' : 'handR', new THREE.Vector3());
    cast.ctx.vfx.burst('swirl', hand, { count: fin ? 8 : 4, swirl: 7, speed: 0.4 });
    if (cast.isPlayer) cast.ctx.events.emit('combo:advanced', { element: 'air', index: step });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const step = cast.comboIndex;
    const fin = step === 2;
    const slip = !!cast.data.slip;
    const mul = slip ? 1.4 : 1;
    const hand = c.castOrigin(fin ? 'hands' : step ? 'handL' : 'handR', new THREE.Vector3());
    const dir = airDir(cast, hand);
    const length = fin ? 9.5 : 7.5;
    const dur = fin ? 0.3 : 0.22;
    windBlade(ctx, hand, dir, { length, duration: dur + 0.08, r0: 0.45, r1: fin ? 3.2 : 2.3, height: fin ? 1.9 : 1.35, roll: step === 0 ? 0.3 : step === 1 ? -0.3 : 0, layers: fin || slip ? 3 : 2, opacity: 1 });
    // A short streaming gust behind each palm so the push reads as moving air, not a flat decal.
    if (!fin) windCone(ctx, hand, dir, { length: 4.5 + step, radius: 1.1, duration: 0.26, opacity: slip ? 0.6 : 0.42 });
    if (fin) {
      windCone(ctx, hand, dir, { length: 8, radius: 2.4, duration: 0.36, opacity: 0.6 });
      windSpiral(ctx, c.position, { height: 2.2, r0: 0.7, r1: 1.4, duration: 0.45, turns: 1.4 });
    }
    if (slip) windRing(ctx, hand, { r0: 0.2, r1: 1.4, duration: 0.25, height: 0.5, axis: dir });
    let n = 0;
    sweep(cast, {
      from: hand,
      dir,
      length,
      duration: dur,
      radius: (t) => 0.9 + t * (fin ? 1.9 : 1.3),
      height: 1.5,
      hit: (_e, pushDir) => ({
        damage: (fin ? 9 : 5 + step) * (slip ? 1.25 : 1),
        knockback: push(pushDir, (fin ? 18 : 9 + step) * mul),
        launch: (fin ? 3.5 : 0.8) * mul,
        stagger: fin ? 38 : 14,
      }),
      onHit: (e) => airPuff(ctx, e.aimPoint(tmp).clone(), dir, fin ? 1.2 : 0.8),
      onStep: (center) => {
        if (n++ % 2 === 0) ctx.world.fx.disturb(center, 2.2, 0.6);
        if (fin) deflectProjectiles(cast, center, 1.6, dir);
      },
    });
    ctx.vfx.burst('air', hand, { count: fin ? 14 : 7, dir, spread: 0.4, speed: 1.6 });
    ctx.audio.play(fin ? 'bend_air_swirl' : 'bend_air_puff', { position: hand, volume: fin ? 0.9 : 0.6, pitch: fin ? 1.1 : 1.05 + step * 0.12 });
    const b = c.body;
    if (b) {
      if (!b.grounded) b.velocity.y = Math.max(b.velocity.y, fin ? 2.5 : 1.6);
      else b.impulse(dir.x * 1.5, 0, dir.z * 1.5);
    }
    if (fin) shake(ctx, hand, 0.1, 0.15);
  },
  aiScore: (_c, _t, dist) => (dist < 8 ? 0.6 : 0),
});

registerTechnique({
  id: 'air_blast',
  name: 'Air Blast',
  element: 'air',
  kind: 'heavy',
  tier: 1,
  starter: true,
  description: 'Gather the wind between your palms and release it in a roaring cone that hurls enemies — and their projectiles — away.',
  usage: 'Hold Aim to charge (longer, wider cone; light enemies are launched), release to blast. Pushes you back; holds you aloft in the air.',
  icon: 'air',
  chiCost: 14,
  cooldown: 1.0,
  windup: 0.1,
  recovery: 0.35,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.0,
  interruptible: true,
  range: 16,
  begin(cast) {
    anim(cast.caster, 'air_push', { speed: 1.2, fadeIn: 0.04 });
    cast.ctx.vfx.burst('swirl', cast.caster.castOrigin('hands', tmp), { count: 10, swirl: 8, speed: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const k = 0.3 + 0.7 * cast.charge;
    const origin = c.castOrigin('hands', new THREE.Vector3());
    const dir = airDir(cast, origin, 0.45);
    origin.addScaledVector(dir, 0.3);
    const length = 7 + 9 * k;
    const radius = 1.4 + 2.4 * k;
    const dur = 0.26 + 0.08 * k;
    windCone(ctx, origin, dir, { length, radius, duration: dur + 0.15 });
    windBlade(ctx, origin, dir, { length: length * 0.9, duration: dur + 0.05, r0: 0.6, r1: radius * 1.1, height: radius * 0.9, layers: 2 });
    windRing(ctx, origin, { r0: 0.2, r1: 1.2 + k, duration: 0.3, height: 0.6, axis: dir });
    let n = 0;
    sweep(cast, {
      from: origin,
      dir,
      length,
      duration: dur,
      radius: (t) => 0.8 + t * radius,
      height: 1.2 + radius * 0.5,
      hit: (_e, pushDir) => ({ damage: 8 + 14 * k, knockback: push(pushDir, 14 + 16 * k), launch: 3 + 7 * k, stagger: 30 + 45 * k }),
      onHit: (e) => airPuff(ctx, e.aimPoint(tmp).clone(), dir, 1.2),
      onStep: (center, t) => {
        deflectProjectiles(cast, center, 0.8 + t * radius, dir);
        if (n++ % 2 === 0) {
          const g = tmp.copy(center);
          g.y = groundY(ctx, g.x, g.z, g.y);
          if (center.y - g.y < 2.5) ctx.vfx.burst('dust', g, { count: 3, dir, spread: 0.6, speed: 1.5 });
          if (Math.random() < 0.4) ctx.vfx.burst('leaves', g, { count: 2, dir, speed: 2 });
          ctx.world.fx.disturb(center, 2 + radius * 0.6, 0.9);
        }
      },
    });
    ctx.vfx.burst('air', origin, { count: 18, dir, spread: 0.35, speed: 2.4 });
    ctx.audio.play('bend_air_blast', { position: origin, volume: 0.6 + 0.4 * k, pitch: 1.15 - 0.3 * k });
    shake(ctx, origin, 0.08 + 0.15 * k, 0.22);
    const b = c.body;
    if (b) {
      b.impulse(-dir.x * (2 + 4 * k), 0, -dir.z * (2 + 4 * k));
      if (!b.grounded) b.velocity.y = Math.max(b.velocity.y, 2 + 2 * k);
    }
  },
  aiScore: (_c, _t, dist) => (dist > 3 && dist < 14 ? 0.5 : 0.1),
});

// Charging: a ball of spinning wind grows between the palms; the ground stirs.
bending.chargeVisual(
  'air',
  (ctx, p) => {
    const shell = new WindShell(ctx, { rings: 2, opacity: 0.9, speed: 4 });
    let t = 0;
    let soundT = 0;
    return {
      update(dt, charge) {
        t += dt;
        const at = p.castOrigin('hands', tmp).addScaledVector(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), 0.15);
        shell.update(dt, at, 0.14 + charge * 0.3, 1);
        if (Math.random() < dt * (8 + charge * 20)) {
          const a = Math.random() * Math.PI * 2;
          const off = new THREE.Vector3(Math.cos(a), (Math.random() - 0.5) * 0.6, Math.sin(a)).multiplyScalar(1.1);
          ctx.vfx.burst('swirl', at.clone().add(off), { count: 1, dir: off.clone().negate(), spread: 0.15, speed: 2.2 });
        }
        if (Math.random() < dt * 6) ctx.world.fx.disturb(p.position, 1.5 + charge * 2, 0.3 + charge * 0.4);
        if (charge > 0.5 && Math.random() < dt * 10) ctx.vfx.burst('dust', p.position, { count: 1, radius: 1.2, speed: 0.6 });
        soundT -= dt;
        if (soundT <= 0) {
          soundT = 0.5;
          ctx.audio.play('bend_air_swirl', { position: at, volume: 0.15 + charge * 0.25, pitch: 0.8 + charge * 0.5 });
        }
      },
      end() {
        shell.dispose(0.12);
      },
    };
  },
  'air_charge',
);
