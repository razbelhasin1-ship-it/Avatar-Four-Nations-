import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { effect } from '../../../vfx/effects/loop';
import { airPuff, Tornado, windRing, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import { aimFlat, anim, enemiesNear, hitSphere, push, shake } from '../bending/util';
import { beginUltimate, spiritPrecheck, surfaceY } from './common';

/**
 * Hurricane — a towering storm column rises at the aim point. Everything
 * hostile within PULL_R is dragged in and spun, anything near the eye is
 * lifted and ground every half second, and when the storm breaks they are
 * flung outward. Strictly bounded radius: nothing beyond PULL_R is touched.
 */

const PULL_R = 10;
const LIFT_R = 3.4;
const LIFE = 5.2;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

registerTechnique({
  id: 'ult_hurricane',
  name: 'Hurricane',
  element: 'avatar',
  kind: 'ultimate',
  tier: 4,
  requires: 'elementsSphere',
  description: 'Wheel the sky itself into a towering hurricane where you aim. It drags every enemy nearby into its eye, lifts and batters them, then hurls them out when it breaks.',
  usage: 'Elements Sphere only. Aim where the storm should rise (6–18 m). Enemies within 10 m are pulled in and spun, those near the eye lifted; it breaks after ~5 s and flings them. Costs 15 spirit.',
  icon: 'air',
  chiCost: 30,
  cooldown: 16,
  windup: 0.55,
  recovery: 0.45,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 16,
  precheck: spiritPrecheck('ult_hurricane'),
  begin(cast) {
    beginUltimate(cast);
    const ctx = cast.ctx;
    const c = cast.caster.position;
    anim(cast.caster, 'ult_hurricane_cast', { fadeIn: 0.05 });
    windSpiral(ctx, c.clone(), { height: 3.6, r0: 0.6, r1: 1.9, duration: 0.6, turns: 2.6, count: 2 });
    ctx.vfx.burst('swirl', tmp.copy(c).setY(c.y + 1), { count: 18, swirl: 10, radius: 1.5, speed: 1 });
    ctx.audio.play('ult.hurricane', { position: c, volume: 1 });
    ctx.events.emit('camera:impulse', { pullback: 3, fovKick: 4, duration: 1.4 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const to = tmp.copy(cast.aimPoint).sub(c.position);
    to.y = 0;
    let d = to.length();
    if (!(d > 0.5) || !Number.isFinite(d)) d = 10;
    d = Math.min(18, Math.max(6, d));
    const center = c.position.clone().addScaledVector(dir, d);
    center.y = surfaceY(ctx, center.x, center.z, c.position.y);
    const low = ctx.vfx.quality === 'low';
    const storm = new Tornado(ctx, 15, 4.6);
    const skirt = low ? null : new Tornado(ctx, 4.5, 8.5);
    const loop: LoopHandle = ctx.audio.loop('bend_wind_loop', { position: center, volume: 1.3, pitch: 0.7 });
    const ticks = new Map<number, number>();
    let age = 0;
    let disturbT = 0;
    let flung = false;
    const fling = () => {
      if (flung) return;
      flung = true;
      const mid = tmp2.copy(center).setY(center.y + 2);
      hitSphere(cast, mid, PULL_R * 0.85, 7, (_e, away) => ({ damage: 28, knockback: push(away, 20), launch: 8, stagger: 70, knockdown: true }), true);
      windRing(ctx, mid.clone(), { r0: 1, r1: PULL_R + 2, duration: 0.55, height: 3, spin: 2.5 });
      windRing(ctx, center.clone().setY(center.y + 0.2), { r0: 1, r1: PULL_R + 4, duration: 0.6, flat: true, opacity: 0.7 });
      airPuff(ctx, mid.clone(), null, 2.2);
      ctx.vfx.burst('dust', center, { count: 26, radius: 4, speed: 3 });
      ctx.vfx.burst('leaves', mid, { count: 12, radius: 3, speed: 4 });
      ctx.world.fx.disturb(center, 16, 1.5);
      ctx.audio.play('bend_air_blast', { position: mid, volume: 1, pitch: 0.7 });
      shake(ctx, center, 0.3, 0.4);
    };
    effect(
      (dt) => {
        age += dt;
        const grow = Math.min(1, age / 0.6) * (age > LIFE - 0.5 ? Math.max(0, (LIFE - age) / 0.5) : 1);
        storm.opacity = grow;
        storm.update(dt, center, 0.25 + 0.75 * grow);
        if (skirt) {
          skirt.opacity = 0.55 * grow;
          skirt.update(dt, center, 0.4 + 0.6 * grow);
        }
        loop.setPosition(center);
        const now = ctx.time.elapsed;
        // Pull, spin, lift and grind — only inside the storm's reach.
        for (const e of enemiesNear(cast, center, PULL_R + 1)) {
          const toC = tmp.set(center.x - e.position.x, 0, center.z - e.position.z);
          const dist = toC.length();
          if (dist > PULL_R) continue;
          if (dist > 0.05) toC.divideScalar(dist);
          const k = 1 - dist / PULL_R;
          const b = e.body;
          if (b) {
            b.external.addScaledVector(toC, (10 + 34 * k) * dt * grow);
            b.external.add(tmp2.set(-toC.z, 0, toC.x).multiplyScalar(14 * k * dt * grow));
            if (dist < LIFT_R && e.position.y < center.y + 7) {
              b.velocity.y = Math.max(b.velocity.y, 4 + 3 * k);
              b.grounded = false;
              e.addStatus('lifted', 0.4);
            }
          }
          e.addStatus('pulled', 0.3);
          if (dist < 4.6 && (ticks.get(e.id) ?? 0) <= now) {
            ticks.set(e.id, now + 0.5);
            cast.hit(e, { damage: 6, stagger: 16, point: e.aimPoint(tmp2).clone() }, true);
          }
        }
        // The storm tears at the ground: dust / snow / leaves spiral up its wall.
        if (Math.random() < dt * (low ? 14 : 30)) {
          const a = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 4;
          const p = tmp.set(center.x + Math.cos(a) * r, center.y + 0.3, center.z + Math.sin(a) * r);
          ctx.vfx.burst('dust', p, { count: 2, swirl: 7, radius: 0.8, speed: 1.6, dir: tmp2.set(0, 1, 0), spread: 0.6 });
        }
        if (Math.random() < dt * 10) ctx.vfx.burst('swirl', tmp.copy(center).setY(center.y + 2 + Math.random() * 8), { count: 3, swirl: 9, radius: 3, speed: 1.2 });
        if (Math.random() < dt * 5) ctx.vfx.burst('leaves', tmp.copy(center).setY(center.y + 1.5), { count: 2, swirl: 8, radius: 3.5, speed: 2 });
        disturbT -= dt;
        if (disturbT <= 0) {
          disturbT = 0.25;
          ctx.world.fx.disturb(center, 12, 1.4 * grow + 0.1);
          shake(ctx, center, 0.06, 0.25);
        }
        if (age >= LIFE) {
          fling();
          return false;
        }
        return true;
      },
      () => {
        // (fling only from update: a dispose from clearEffects at session end deals no damage)
        storm.dispose();
        skirt?.dispose();
        loop.stop(0.5);
      },
    );
    ctx.vfx.burst('air', tmp.copy(center).setY(center.y + 1), { count: 20, spread: 2, speed: 2 });
    shake(ctx, center, 0.2, 0.35);
  },
});
