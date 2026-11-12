import * as THREE from 'three';
import { effect } from '../../../vfx/effects/loop';
import { airPuff, windBlade, windCone, windRing, WindShell, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending } from '../bending/runtime';
import { aimFlat, anim, finisherFreeze, finisherImpact, groundY, push, ringSweep, shake, sweep } from '../bending/util';
import { deflectProjectiles, takeSlipstream } from './common';

/**
 * Air basics: Air Palm (5-step chain: right and left palms, a crescent kick that
 * cuts a blade of air, a spinning strike, and the finisher, Air Bomb — a leaping
 * slam that bursts a dome of air out of the ground) and the charged Air Blast.
 * Low damage, big knockback; strikes thrown right after an evasion (dodge / Air
 * Dash) become Slipstream blows — faster and stronger.
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
  description:
    'Open-palm strikes that throw crescents of wind, a crescent kick that cuts a tall blade of air through everyone in its line, a spinning strike that bowls enemies over — and the finisher, Air Bomb: spring into the air, spin, and slam down to burst a dome of compressed air out of the ground.',
  usage:
    'Primary attack — chain five strikes. Light damage, strong knockback; the third (crescent kick) reaches far and slices through a line of foes; the fifth (Air Bomb) throws everyone within 6.5 m up and away and turns their projectiles back. Strike right after a dodge or Air Dash for an empowered Slipstream blow.',
  icon: 'air',
  chiCost: 4,
  cooldown: 0,
  windup: 0.08,
  recovery: 0.2,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 9,
  comboLength: 5,
  begin(cast) {
    const step = cast.comboIndex;
    const kick = step === 2;
    const fin = step === 3;
    const slip = takeSlipstream(cast);
    cast.data.slip = slip;
    if (step === 4) {
      beginAirBomb(cast);
      if (cast.isPlayer) cast.ctx.events.emit('combo:advanced', { element: 'air', index: step });
      return;
    }
    anim(cast.caster, fin ? 'air_palm_spin' : kick ? 'air_palm_kick' : step ? 'air_palm_l' : 'air_palm_r', { speed: fin ? 1.3 : 1.15, fadeIn: 0.03, fadeOut: fin ? 0.01 : 0.12 });
    if (fin) cast.elapsed -= 0.15;
    // The kick swings up across the body first: the blade leaves at the top of the arc.
    if (kick) cast.elapsed -= 0.08;
    if (slip) cast.elapsed += 0.05;
    const hand = cast.caster.castOrigin(fin ? 'hands' : step % 2 ? 'handL' : 'handR', new THREE.Vector3());
    cast.ctx.vfx.burst('swirl', kick ? cast.caster.position : hand, { count: fin || kick ? 8 : 4, swirl: 7, speed: 0.4 });
    if (cast.isPlayer) cast.ctx.events.emit('combo:advanced', { element: 'air', index: step });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const step = cast.comboIndex;
    if (step === 4) {
      airBomb(cast, !!cast.data.slip);
      return;
    }
    if (step === 2) {
      airSlice(cast, !!cast.data.slip);
      return;
    }
    const fin = step === 3;
    const slip = !!cast.data.slip;
    const mul = slip ? 1.4 : 1;
    const hand = c.castOrigin(fin ? 'hands' : step ? 'handL' : 'handR', new THREE.Vector3());
    const dir = airDir(cast, hand);
    const length = fin ? 9.5 : 7.5;
    const dur = fin ? 0.3 : 0.22;
    windBlade(ctx, hand, dir, { length, duration: dur + 0.2, r0: 0.5, r1: fin ? 3.6 : 2.8, height: fin ? 2.1 : 1.6, roll: fin ? 0 : step === 0 ? 0.3 : -0.3, layers: 3, opacity: 1 });
    // A streaming gust behind each palm so the push reads as moving air, not a flat decal.
    if (!fin) windCone(ctx, hand, dir, { length: 5.5 + step, radius: 1.3, duration: 0.36, opacity: slip ? 0.75 : 0.6 });
    windRing(ctx, hand, { r0: 0.15, r1: fin ? 1.3 : 0.8, duration: 0.24, height: 0.35, axis: dir, opacity: 0.8 });
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
        if (n++ % 2 === 0) {
          ctx.world.fx.disturb(center, 2.2, 0.6);
          // The gust skims the ground: a line of dust lifts beneath it.
          const g = tmp.copy(center);
          g.y = groundY(ctx, g.x, g.z, g.y);
          if (center.y - g.y < 2.4) ctx.vfx.burst('dust', g, { count: fin ? 3 : 2, dir, spread: 0.5, speed: 2 });
        }
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

/**
 * Third strike: the crescent kick cuts a tall, thin blade of air (a vertical crescent) that
 * flies straight and fast and slices through everyone in its line, deflecting projectiles.
 */
function airSlice(cast: Cast, slip: boolean): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const mul = slip ? 1.4 : 1;
  const chest = c.castOrigin('chest', new THREE.Vector3());
  const dir = airDir(cast, chest, 0.25);
  const origin = chest.addScaledVector(dir, 0.7);
  origin.y -= 0.15;
  const length = 13;
  const dur = 0.34;
  // Vertical crescent: rolled a quarter turn about its flight line; a second, fainter one trails.
  windBlade(ctx, origin, dir, { length, duration: dur + 0.1, r0: 0.95, r1: 1.5, height: 0.55, arc: 2.0, roll: Math.PI / 2, layers: 3, opacity: 1 });
  windBlade(ctx, origin, dir, { length: length * 0.7, duration: dur + 0.14, r0: 0.7, r1: 1.25, height: 0.4, arc: 1.8, roll: Math.PI / 2, layers: 1, opacity: 0.55 });
  if (slip) windRing(ctx, origin, { r0: 0.2, r1: 1.4, duration: 0.25, height: 0.5, axis: dir });
  let n = 0;
  sweep(cast, {
    from: origin,
    dir,
    length,
    duration: dur,
    radius: 0.65,
    height: 1.5,
    hit: (_e, pushDir) => ({ damage: 7 * (slip ? 1.25 : 1), knockback: push(pushDir, 8 * mul), launch: 0.6 * mul, stagger: 28 }),
    onHit: (e) => airPuff(ctx, e.aimPoint(tmp).clone(), dir, 1),
    onStep: (center) => {
      deflectProjectiles(cast, center, 0.9, dir);
      // The blade parts the grass and lifts a thin line of dust beneath it.
      if (n++ % 2 === 0) {
        ctx.world.fx.disturb(center, 1.3, 0.8);
        const g = tmp.copy(center);
        g.y = groundY(ctx, g.x, g.z, g.y);
        if (center.y - g.y < 2.2) ctx.vfx.burst('dust', g, { count: 2, dir, spread: 0.3, speed: 1.6 });
      }
    },
  });
  ctx.vfx.burst('air', origin, { count: 10, dir, spread: 0.2, speed: 2.4 });
  ctx.audio.play('bend_air_blast', { position: origin, volume: 0.65, pitch: 1.55 });
  ctx.audio.play('bend_air_puff', { position: origin, volume: 0.5, pitch: 0.85 });
  const b = c.body;
  if (b && !b.grounded) b.velocity.y = Math.max(b.velocity.y, 2);
}

// ---------------------------------------------------------------------------
// Fifth strike: Air Bomb (the finisher)
// ---------------------------------------------------------------------------

/** Radius of the burst (m), how long its front takes to spread (s), longest fall before it goes off anyway (s). */
export const AIR_BOMB = { radius: 6.5, duration: 0.32, maxFall: 1.1 };

/** The finisher winds up: a crouch and a spring forward into the air, spinning, hands (or staff) overhead. */
function beginAirBomb(cast: Cast): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  anim(c, 'air_palm_bomb', { speed: 1, fadeIn: 0.04, fadeOut: 0.01 });
  // Up and round before the dive (0.42 s into the clip).
  cast.elapsed -= 0.34;
  cast.movement = 'root';
  cast.recovery = 0.45;
  const b = c.body;
  const fwd = aimFlat(cast);
  if (b) {
    if (b.grounded) b.launch(6.5);
    else b.velocity.y = Math.max(b.velocity.y, 3);
    b.impulse(fwd.x * 4, 0, fwd.z * 4);
  }
  ctx.vfx.burst('dust', c.position, { count: 8, radius: 0.6, speed: 1.2 });
  ctx.vfx.burst('swirl', c.position, { count: 10, swirl: 8, speed: 0.6 });
  windSpiral(ctx, c.position, { height: 2.8, r0: 0.6, r1: 1.3, duration: 0.5, turns: 2 });
  ctx.audio.play('bend_air_swirl', { position: c.position, volume: 0.8, pitch: 0.8 });
  ctx.audio.play('whoosh', { position: c.position, volume: 0.6, pitch: 1.2 });
}

/**
 * Fifth strike, the finisher: Air Bomb (Aang's leaping slam). From the top of the leap the bender
 * drives straight down; where they land, a dome of compressed air bursts out of the ground and
 * throws everyone within 6.5 m up and away (walls shelter what is behind them), flattens the grass,
 * raises a ring of dust and turns hostile projectiles back outward.
 */
function airBomb(cast: Cast, slip: boolean): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const b = c.body;
  // The dive.
  if (b && !b.grounded) b.velocity.y = Math.min(b.velocity.y, -16);
  airPuff(ctx, c.castOrigin('hands', new THREE.Vector3()), new THREE.Vector3(0, -1, 0), 1.2);
  ctx.audio.play('bend_air_dash', { position: c.position, volume: 0.6, pitch: 0.8 });
  let t = 0;
  effect((dt) => {
    t += dt;
    if (!c.alive) return false;
    if (b && !b.grounded && t < AIR_BOMB.maxFall) return true;
    burstAirBomb(cast, slip);
    return false;
  });
}

function burstAirBomb(cast: Cast, slip: boolean): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const mul = slip ? 1.25 : 1;
  const R = AIR_BOMB.radius * (slip ? 1.1 : 1);
  const low = ctx.vfx.quality === 'low';
  const center = c.position.clone();
  const gy = groundY(ctx, center.x, center.z, center.y);
  if (center.y - gy < 1.5) center.y = gy;
  // The dome: a shell of compressed air swelling out of the ground (its lower half is below it).
  const shell = new WindShell(ctx, { rings: 0, opacity: 0.95, speed: 5 });
  let age = 0;
  effect((dt) => {
    age += dt;
    const k = Math.min(1, age / 0.36);
    shell.update(dt, center, 0.6 + (R * 0.9 - 0.6) * (1 - Math.pow(1 - k, 2.2)), 1 - 0.5 * k);
    if (k < 1) return true;
    shell.dispose(0.22);
    return false;
  });
  windRing(ctx, center.clone().setY(center.y + 0.08), { r0: 0.6, r1: R * 1.3, duration: 0.5, flat: true, opacity: 0.9 });
  windRing(ctx, center.clone().setY(center.y + 0.7), { r0: 0.8, r1: R * 1.1, duration: 0.42, height: 1.5, opacity: 0.85 });
  airPuff(ctx, center.clone().setY(center.y + 0.4), null, 2);
  ctx.vfx.burst('air', center, { count: 24, speed: 3, radius: 1 });
  ctx.vfx.burst('dust', center, { count: 16, radius: 1.5, speed: 2.5 });
  ctx.world.fx.disturb(center, R * 1.5, 1.5);
  let n = 0;
  ringSweep(cast, {
    center: center.clone().setY(center.y + 0.9),
    r0: 0.5,
    r1: R,
    duration: AIR_BOMB.duration,
    height: 2.2,
    hit: (_e, away) => ({ damage: 18 * mul, knockback: push(away, 20 * mul), launch: 8.5 * mul, stagger: 80, knockdown: true }),
    onHit: (e) => {
      const at = e.aimPoint(new THREE.Vector3());
      airPuff(ctx, at, at.clone().sub(center).setY(0.4).normalize(), 1.4);
      finisherFreeze(cast, e, 0.14);
    },
    onStep: (r) => {
      deflectProjectiles(cast, center, r + 1, 'outward');
      // Dust thrown out along the spreading front.
      if (n++ % 2) return;
      const count = low ? 6 : 10;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const p = tmp.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
        p.y = groundY(ctx, p.x, p.z, center.y);
        if (Math.abs(p.y - center.y) > 2) continue;
        ctx.vfx.burst('dust', p, { count: 1, dir: new THREE.Vector3(Math.cos(a), 0.35, Math.sin(a)), spread: 0.3, speed: 3 });
        if (Math.random() < 0.2) ctx.vfx.burst('leaves', p, { count: 1, dir: new THREE.Vector3(Math.cos(a), 0.8, Math.sin(a)), speed: 3 });
      }
    },
  });
  finisherImpact(cast, center, 0.38, 0.4);
  ctx.audio.play('bend_air_blast', { position: center, volume: 1, pitch: 0.55 });
  ctx.audio.play('bend_earth_slam', { position: center, volume: 0.35, pitch: 1.3 });
  ctx.audio.play('bend_air_swirl', { position: center, volume: 0.7, pitch: 0.7 });
}

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
  cooldown: 0.5,
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
    windCone(ctx, origin, dir, { length, radius, duration: dur + 0.3, opacity: 0.9 });
    windBlade(ctx, origin, dir, { length: length * 0.9, duration: dur + 0.2, r0: 0.6, r1: radius * 1.1, height: radius * 0.9, layers: 3 });
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
