import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { solidAt } from '../../../vfx/effects/constructs';
import { effect } from '../../../vfx/effects/loop';
import { airPuff, Tornado, windArc, windRing, windSpiral } from '../../../vfx/effects/wind';
import { registerTechnique } from '../../CombatSystem';
import { aimFlat, anim, enemiesNear, groundY, hitSphere, push, ringSweep, shake } from '../bending/util';
import { deflectProjectiles } from './common';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Air Sweep — low kick, a crescent of wind skims the ground and trips foes.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'air_sweep',
  name: 'Air Sweep',
  element: 'air',
  kind: 'ability',
  tier: 1,
  starter: true,
  description: 'Drop into a low spinning kick that sends a wide crescent of wind skimming along the ground, sweeping enemies off their feet.',
  usage: 'Trips everything in a wide arc in front of you (knockdown). Open up a crowd, then follow with Air Palm.',
  icon: 'air',
  chiCost: 14,
  cooldown: 1.6,
  windup: 0.14,
  recovery: 0.3,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 9,
  begin(cast) {
    anim(cast.caster, 'air_sweep_kick', { speed: 1.05, fadeIn: 0.04 });
    cast.ctx.vfx.burst('dust', cast.caster.position, { count: 5, radius: 0.5, speed: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const base = c.position.clone();
    base.y = groundY(ctx, base.x, base.z, base.y) + 0.05;
    windArc(ctx, base, dir, { r0: 0.8, r1: 9.5, arc: 2.6, height: 1.15, duration: 0.6, opacity: 1 });
    windArc(ctx, base.clone().setY(base.y + 0.25), dir, { r0: 0.6, r1: 7, arc: 2.2, height: 0.7, duration: 0.5, opacity: 0.7 });
    let n = 0;
    ringSweep(cast, {
      center: base.clone().setY(base.y + 0.45),
      dir,
      arc: 2.6,
      r0: 0.8,
      r1: 9.5,
      duration: 0.32,
      height: 1.0,
      hit: (_e, away) => ({ damage: 8, knockback: push(away, 7), launch: 2.6, knockdown: true, stagger: 35 }),
      onHit: (e) => {
        airPuff(ctx, e.position.clone().setY(e.position.y + 0.3), null, 0.8);
        ctx.vfx.burst('dust', e.position, { count: 6, radius: 0.4, speed: 1.2 });
      },
      onStep: (r) => {
        if (n++ % 2) return;
        for (const s of [-1, 0, 1]) {
          const a = s * 0.9 + (Math.random() - 0.5) * 0.4;
          const d = tmp.set(dir.x * Math.cos(a) - dir.z * Math.sin(a), 0, dir.x * Math.sin(a) + dir.z * Math.cos(a));
          const p = tmp2.copy(base).addScaledVector(d, r);
          p.y = groundY(ctx, p.x, p.z, p.y + 1) + 0.1;
          ctx.vfx.burst('dust', p, { count: 2, dir: d, spread: 0.5, speed: 1.4 });
          if (Math.random() < 0.3) ctx.vfx.burst('leaves', p, { count: 1, dir: d, speed: 2 });
        }
        ctx.world.fx.disturb(base.clone().addScaledVector(dir, r * 0.8), r * 0.7, 0.8);
      },
    });
    ctx.audio.play('bend_air_swirl', { position: base, volume: 0.8, pitch: 0.9 });
    shake(ctx, base, 0.08, 0.15);
  },
  aiScore: (_c, _t, dist) => (dist < 8 ? 0.55 : 0),
});

// ---------------------------------------------------------------------------
// Spinning Air Strike — 360° vortex burst.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'air_spin_strike',
  name: 'Spinning Air Strike',
  element: 'air',
  kind: 'ability',
  tier: 2,
  description: 'Spin on the spot and unleash a ring of whirling wind that throws everything around you outward — projectiles included.',
  usage: 'Use when surrounded or mid-air. Hits in every direction, launches and pushes enemies away, and blows incoming projectiles aside.',
  icon: 'air',
  chiCost: 18,
  cooldown: 2.0,
  windup: 0.14,
  recovery: 0.3,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 6,
  begin(cast) {
    anim(cast.caster, 'air_spin', { speed: 1.1, fadeIn: 0.03, fadeOut: 0.01 });
    const b = cast.caster.body;
    if (b && !b.grounded) b.velocity.y = Math.max(b.velocity.y, 3);
    cast.ctx.vfx.burst('swirl', cast.caster.position, { count: 8, swirl: 9, speed: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const center = c.position.clone().setY(c.position.y + 1.0);
    windRing(ctx, center, { r0: 0.6, r1: 6.5, duration: 0.42, height: 1.8, spin: 2.2 });
    windRing(ctx, c.position.clone().setY(c.position.y + 0.1), { r0: 0.5, r1: 7, duration: 0.5, flat: true, opacity: 0.7 });
    windSpiral(ctx, c.position, { height: 3.2, r0: 0.8, r1: 2.4, duration: 0.5, turns: 1.6 });
    ringSweep(cast, {
      center,
      r0: 0.6,
      r1: 6.3,
      duration: 0.3,
      height: 1.8,
      hit: (_e, away) => ({ damage: 12, knockback: push(away, 17), launch: 4.5, stagger: 42 }),
      onHit: (e) => airPuff(ctx, e.aimPoint(tmp).clone(), null, 1),
    });
    deflectProjectiles(cast, center, 6.5, 'outward');
    ctx.vfx.burst('dust', c.position, { count: 14, radius: 2, speed: 2.4 });
    ctx.vfx.burst('swirl', center, { count: 14, swirl: 10, speed: 1.4, radius: 1 });
    ctx.world.fx.disturb(c.position, 7.5, 1);
    ctx.audio.play('bend_air_swirl', { position: center, volume: 1, pitch: 1.1 });
    ctx.audio.play('bend_air_blast', { position: center, volume: 0.45, pitch: 1.3 });
    shake(ctx, center, 0.12, 0.2);
  },
  aiScore: (_c, _t, dist) => (dist < 5 ? 0.55 : 0),
});

// ---------------------------------------------------------------------------
// Vortex — a travelling tornado that pulls, lifts, then flings.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'air_vortex',
  name: 'Vortex',
  element: 'air',
  kind: 'ability',
  tier: 3,
  description: 'Roll the air between your arms into a small tornado and send it forward. It drags enemies in, lifts them off the ground, then hurls them away.',
  usage: 'The tornado travels about 20 m. Enemies near it are pulled toward the centre and lifted; when it breaks apart they are flung outward.',
  icon: 'air',
  chiCost: 26,
  cooldown: 4.0,
  windup: 0.42,
  recovery: 0.35,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 14,
  begin(cast) {
    anim(cast.caster, 'air_vortex_cast', { fadeIn: 0.05 });
    const hands = cast.caster.castOrigin('hands', new THREE.Vector3());
    windSpiral(cast.ctx, hands.setY(hands.y - 0.6), { height: 1.2, r0: 0.3, r1: 0.7, duration: 0.45, turns: 2, count: 1 });
    cast.ctx.audio.play('bend_air_swirl', { position: hands, volume: 0.6, pitch: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const base = c.position.clone().addScaledVector(dir, 2);
    base.y = groundY(ctx, base.x, base.z, base.y + 1);
    const tornado = new Tornado(ctx, 6.8, 2.3);
    const loop: LoopHandle = ctx.audio.loop('bend_wind_loop', { position: base, volume: 0.9 });
    const life = 2.8;
    const speed = 7.5;
    const ticks = new Map<number, number>();
    let age = 0;
    let ended = false;
    const fling = () => {
      if (ended) return;
      ended = true;
      const center = base.clone().setY(base.y + 1.4);
      hitSphere(cast, center, 4.2, 3.5, (_e, away) => ({ damage: 12, knockback: push(away, 16), launch: 6, stagger: 50 }), true);
      windRing(ctx, center, { r0: 1, r1: 6, duration: 0.4, height: 2, spin: 2 });
      airPuff(ctx, center, null, 1.6);
      ctx.vfx.burst('dust', base, { count: 16, radius: 1.5, speed: 2.5 });
      ctx.audio.play('bend_air_blast', { position: center, volume: 0.8, pitch: 0.9 });
      shake(ctx, center, 0.15, 0.25);
    };
    effect(
      (dt) => {
        age += dt;
        const step = speed * dt;
        const nx = base.x + dir.x * step, nz = base.z + dir.z * step;
        const liquid = ctx.world.liquidAt(nx, nz);
        const gy = Math.max(groundY(ctx, nx, nz, base.y + 1.5), liquid ? liquid.level : -Infinity);
        const blocked = gy - base.y > 1.6 || solidAt(ctx, tmp.set(nx, gy + 1.2, nz), 0.7, [], 0.8) !== null;
        if (!blocked) base.set(nx, gy, nz);
        const grow = Math.min(1, age / 0.3) * (age > life - 0.3 ? Math.max(0, (life - age) / 0.3) : 1);
        tornado.opacity = grow;
        tornado.update(dt, base, 0.4 + 0.6 * grow);
        // Dust and grit churn round its foot.
        if (Math.random() < dt * 16) ctx.vfx.burst('dust', base, { count: 2, radius: 1.4, swirl: 7, speed: 2.2 });
        loop.setPosition(base);
        // Pull, lift, grind.
        const now = ctx.time.elapsed;
        for (const e of enemiesNear(cast, base, 5.5)) {
          const b = e.body;
          const to = tmp.set(base.x - e.position.x, 0, base.z - e.position.z);
          const d = to.length();
          if (d > 5.5 || !b) continue;
          if (d > 0.05) to.divideScalar(d);
          const k = 1 - d / 5.5;
          b.external.addScaledVector(to, (14 + 30 * k) * dt);
          b.external.add(tmp2.set(-to.z, 0, to.x).multiplyScalar(10 * k * dt));
          if (d < 1.9 && e.position.y < base.y + 3.4) {
            b.velocity.y = Math.max(b.velocity.y, 5.2);
            b.grounded = false;
            e.addStatus('lifted', 0.5);
          }
          if (d < 2.6 && (ticks.get(e.id) ?? 0) <= now) {
            ticks.set(e.id, now + 0.45);
            cast.hit(e, { damage: 3, stagger: 12, point: e.aimPoint(tmp2).clone() }, true);
          }
        }
        if (Math.random() < dt * 30) ctx.vfx.burst('swirl', base.clone().setY(base.y + 0.3), { count: 2, swirl: 9, radius: 1.2, speed: 1 });
        if (Math.random() < dt * 18) ctx.vfx.burst(liquid ? 'spray' : 'dust', base, { count: 2, radius: 1.4, speed: 1.4 });
        if (Math.random() < dt * 6) ctx.vfx.burst('leaves', base.clone().setY(base.y + 1.5), { count: 1, swirl: 8, radius: 1 });
        if (Math.random() < dt * 5) ctx.world.fx.disturb(base, 4, 1);
        if (blocked || age >= life) {
          fling();
          return false;
        }
        return true;
      },
      () => {
        fling();
        tornado.dispose();
        loop.stop(0.3);
      },
    );
    ctx.audio.play('bend_air_blast', { position: base, volume: 0.7, pitch: 0.75 });
    ctx.vfx.burst('air', base, { count: 14, spread: 1.6, speed: 1.4 });
  },
  aiScore: (_c, _t, dist) => (dist > 4 && dist < 16 ? 0.4 : 0),
});
