import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { effect } from '../../../vfx/effects/loop';
import { airPuff, releaseWindTrail, windCone, windRing, WindShell, windTrail } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending, type MoverHandle } from '../bending/runtime';
import { aimFlat, anim, groundY, hitSphere, moveIntent, push, shake, stopAnim } from '../bending/util';
import { openSlipstream } from './common';

const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Air Dash — long, fast wind-propelled dash (also mid-air).
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'air_dash',
  name: 'Air Dash',
  element: 'air',
  kind: 'movement',
  tier: 1,
  starter: true,
  description: 'Ride a burst of wind for a long, fast dash — on the ground or in mid-air — brushing enemies aside.',
  usage: 'Dashes toward your movement input (or aim). Briefly untouchable. Your next air strike right after the dash is a Slipstream blow.',
  icon: 'air',
  chiCost: 10,
  cooldown: 1.1,
  windup: 0.03,
  recovery: 0.15,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 10,
  begin(cast) {
    anim(cast.caster, 'air_dash', { fadeIn: 0.03 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = moveIntent(cast).clone();
    c.yaw = Math.atan2(dir.x, dir.z);
    const speed = 34;
    const dur = 0.3;
    const airborne = !!c.body && !c.body.grounded;
    let t = 0;
    const handle = bending.drive({
      entity: c,
      step: (dt) => {
        t += dt;
        if (t > dur) return null;
        return { x: dir.x * speed, z: dir.z * speed, y: airborne ? 0.4 : undefined };
      },
      done: () => {
        c.body?.external.multiplyScalar(0.35);
        openSlipstream(cast);
      },
    });
    if (c.health) c.health.invulnerable = Math.max(c.health.invulnerable, 0.2);
    openSlipstream(cast);
    const chest = c.castOrigin('chest', new THREE.Vector3());
    windRing(ctx, chest, { r0: 0.3, r1: 1.8, duration: 0.3, height: 0.6, axis: dir });
    windCone(ctx, chest, dir.clone().negate(), { length: 3, radius: 1.2, duration: 0.3, opacity: 0.5 });
    const trailA = windTrail(ctx, 1.1, 0.22);
    const trailB = windTrail(ctx, 0.6, 0.16);
    effect(
      () => {
        if (handle.active) {
          trailA.trail.push(c.castOrigin('chest', tmp), ctx.time.elapsed);
          trailB.trail.push(tmp.copy(c.position).setY(c.position.y + 0.25), ctx.time.elapsed);
          hitSphere(cast, c.castOrigin('chest', tmp), 1.3, 1.2, (_e, away) => ({ damage: 2, knockback: push(away, 9), stagger: 10 }));
          if (Math.random() < 0.6) ctx.vfx.burst('air', c.position.clone().setY(c.position.y + 0.8), { count: 2, dir: dir.clone().negate(), spread: 0.4, speed: 1.6 });
        }
        trailA.trail.update(ctx.time.elapsed, ctx.camera.position);
        trailB.trail.update(ctx.time.elapsed, ctx.camera.position);
        return handle.active;
      },
      () => {
        releaseWindTrail(ctx, trailA);
        releaseWindTrail(ctx, trailB);
      },
    );
    if (!airborne) ctx.vfx.burst('dust', c.position, { count: 8, dir: dir.clone().negate(), spread: 0.6, speed: 2 });
    ctx.world.fx.disturb(c.position, 3, 0.8);
    ctx.audio.play('bend_air_dash', { position: c.position, volume: 0.8 });
    if (c.isPlayer) ctx.events.emit('camera:impulse', { fovKick: 5, duration: 0.3 });
  },
  aiScore: (_c, _t, dist) => (dist < 2.5 ? 0.3 : dist > 12 ? 0.25 : 0),
});

// ---------------------------------------------------------------------------
// Air Jump — passive (Player grants the extra air jump); visuals here.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'air_jump',
  name: 'Air Jump',
  element: 'air',
  kind: 'passive',
  tier: 2,
  description: 'Kick off a burst of compressed air to jump again in mid-air — a second extra jump before you land.',
  usage: 'Passive. As an airbender, press Jump in mid-air for an extra jump (one more once learned).',
  icon: 'air',
  chiCost: 0,
  cooldown: 0,
  windup: 0,
  recovery: 0,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 0,
  release() {
    /* passive: never cast */
  },
});

bending.hook({
  init: (ctx) => {
    ctx.events.on('player:jumped', (e) => {
      const p = ctx.player;
      if (!e.double || !p || p.element !== 'air') return;
      const pos = new THREE.Vector3(e.position.x, e.position.y, e.position.z);
      windRing(ctx, pos.clone().setY(pos.y + 0.05), { r0: 0.3, r1: 2.2, duration: 0.35, flat: true });
      windRing(ctx, pos.clone().setY(pos.y + 0.3), { r0: 0.2, r1: 1.2, duration: 0.3, height: 0.5 });
      ctx.vfx.burst('air', pos, { count: 10, dir: new THREE.Vector3(0, -1, 0), spread: 0.9, speed: 1.6 });
      ctx.audio.play('bend_air_puff', { position: pos, volume: 0.5, pitch: 1.4 });
    });
  },
});

// ---------------------------------------------------------------------------
// Air Scooter — ride a ball of air (toggle).
// ---------------------------------------------------------------------------

interface ScooterData {
  shell: WindShell;
  loop: LoopHandle;
  handle: MoverHandle;
  vel: THREE.Vector3;
  waterTime: number;
  bumps: Map<number, number>;
}

function scooterIntent(cast: Cast, out: THREE.Vector3): number {
  const ctx = cast.ctx;
  if (cast.isPlayer) {
    const mv = ctx.input.move;
    if (Math.hypot(mv.x, mv.y) > 0.2) {
      moveIntent(cast, out);
      return 1;
    }
    return 0;
  }
  // AI: ride toward the target (or straight ahead).
  if (cast.target && cast.target.alive) out.subVectors(cast.target.position, cast.caster.position).setY(0).normalize();
  else aimFlat(cast, out);
  return 1;
}

registerTechnique({
  id: 'air_scooter',
  name: 'Air Scooter',
  element: 'air',
  kind: 'movement',
  tier: 2,
  description: 'Balance on a spinning ball of air and race across the ground — fast enough to skim over water for a few seconds.',
  usage: 'Press to mount; steer with movement (camera-relative). Press again, attack or dodge to hop off — Jump launches you off the ball. Drains chi slowly; the ball breaks up after ~3 s over water.',
  icon: 'air',
  chiCost: 12,
  cooldown: 2,
  windup: 0.12,
  recovery: 0.12,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 30,
  channel: 12,
  begin(cast) {
    bending.channel(cast, 'toggle', { min: 0.3, auto: 3.5, breakOn: ['attack', 'aim', 'jump', 'ability1', 'ability2', 'ability3', 'ability4'] });
    anim(cast.caster, 'air_scooter_ride', { fadeIn: 0.12 });
    cast.ctx.vfx.burst('swirl', cast.caster.position, { count: 10, swirl: 10, radius: 0.5 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const vel = new THREE.Vector3();
    const d: ScooterData = {
      shell: new WindShell(ctx, { rings: 2, opacity: 0.95, speed: 6 }),
      loop: ctx.audio.loop('bend_wind_loop', { position: c.position, volume: 0.6 }),
      vel,
      waterTime: 0,
      bumps: new Map(),
      handle: null as unknown as MoverHandle,
    };
    const want = new THREE.Vector3();
    d.handle = bending.drive({
      entity: c,
      step: (dt) => {
        const has = scooterIntent(cast, want);
        const speed = has ? 15 : 2.5;
        if (!has) want.copy(vel).setY(0).normalize();
        const k = 1 - Math.exp(-(has ? 3.5 : 2) * dt);
        vel.x += (want.x * speed - vel.x) * k;
        vel.z += (want.z * speed - vel.z) * k;
        const w = ctx.world.liquidAt(c.position.x, c.position.z);
        return { x: vel.x, z: vel.z, y: w && c.position.y <= w.level + 0.05 ? 0 : undefined };
      },
    });
    cast.data.scooter = d;
    ctx.audio.play('bend_air_swirl', { position: c.position, volume: 0.7, pitch: 1.3 });
  },
  channelUpdate(cast, dt) {
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.scooter as ScooterData | undefined;
    const b = c.body;
    if (!d || !b) return false;
    const drain = 2.5 * dt;
    if (c.chi < drain) return false;
    c.chi -= drain;
    const pos = c.position;
    // Skim over water briefly.
    const w = ctx.world.liquidAt(pos.x, pos.z);
    const ground = groundY(ctx, pos.x, pos.z, pos.y);
    const speed = Math.hypot(d.vel.x, d.vel.z);
    if (w && w.level > ground + 0.3) {
      d.waterTime += dt;
      if (pos.y < w.level) {
        pos.y = w.level;
        if (b.velocity.y < 0) b.velocity.y = 0;
      }
      if (Math.random() < dt * 30) ctx.vfx.burst('spray', pos, { count: 2, dir: tmp.set(-d.vel.x, 1, -d.vel.z).normalize(), spread: 0.5, speed: 1.5 });
      if (d.waterTime > 3 || speed < 4) return false;
    } else d.waterTime = Math.max(0, d.waterTime - dt * 2);
    if (speed > 1) {
      c.yaw = Math.atan2(d.vel.x, d.vel.z);
      c.root.rotation.y = c.yaw;
    }
    d.shell.update(dt, tmp.copy(pos).setY(pos.y + 0.38), 0.42 + Math.min(0.08, speed * 0.004));
    d.loop.setPosition(pos);
    d.loop.setPitch(0.8 + speed / 20);
    if (!w && b.grounded && Math.random() < dt * (6 + speed * 1.5)) ctx.vfx.burst('dust', pos, { count: 1, dir: tmp.set(-d.vel.x, 0.5, -d.vel.z).normalize(), spread: 0.4, speed: 1 });
    if (Math.random() < dt * 8) ctx.world.fx.disturb(pos, 1.6, 0.5);
    // Bowl over anyone in the way at speed.
    if (speed > 6) {
      const now = ctx.time.elapsed;
      hitSphere(
        cast,
        tmp.copy(pos).setY(pos.y + 0.8),
        1.1,
        1,
        (_e, away) => {
          if ((d.bumps.get(_e.id) ?? 0) > now) return null;
          d.bumps.set(_e.id, now + 0.6);
          return { damage: 4, knockback: push(away.add(d.vel.clone().normalize()), 10), launch: 2, stagger: 20 };
        },
        true,
      );
    }
    return true;
  },
  end(cast) {
    const c = cast.caster;
    const d = cast.data.scooter as ScooterData | undefined;
    if (d) {
      d.handle.stop();
      d.shell.dispose(0.2);
      d.loop.stop(0.2);
      airPuff(cast.ctx, c.position.clone().setY(c.position.y + 0.3), null, 0.9);
      cast.data.scooter = undefined;
      if (cast.data.__brokenBy === 'jump' && c.body) {
        c.body.velocity.y = Math.max(c.body.velocity.y, 9);
        c.body.grounded = false;
      }
    }
    stopAnim(c, 'air_scooter_ride', 0.15);
    shake(cast.ctx, c.position, 0.04, 0.1);
  },
  aiScore: (_c, _t, dist) => (dist > 25 ? 0.2 : 0),
});
