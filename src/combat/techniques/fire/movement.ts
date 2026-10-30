import * as THREE from 'three';
import type { Entity } from '../../../entities/Entity';
import { fireMuzzle, flameRing, flameTrail, groundFlame } from '../../../vfx/effects/fire';
import { debris, effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending, type MoverHandle } from '../bending/runtime';
import { aimFlat, anchorPos, anim, groundY, hitSphere, moveIntent, push, shake } from '../bending/util';
import { detonate } from './basic';
import { fireOnEntity } from './common';

const tmp = new THREE.Vector3();

/** Two flame jets trailing from the fists while `alive()`; fades out afterwards. */
function fistJets(cast: Cast, alive: () => boolean, width = 0.45, life = 0.22): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const L = flameTrail(ctx, width, life);
  const R = flameTrail(ctx, width, life);
  const hl = new THREE.Vector3(), hr = new THREE.Vector3();
  let t = 0;
  effect(
    (dt) => {
      t += dt;
      const on = alive() && t < 3;
      if (on) {
        L.trail.push(c.castOrigin('handL', hl), ctx.time.elapsed);
        R.trail.push(c.castOrigin('handR', hr), ctx.time.elapsed);
        if (Math.random() < dt * 30) ctx.vfx.burst('flame', Math.random() < 0.5 ? hl : hr, { count: 1, speed: 0.6, size: 0.7 });
      }
      L.trail.update(ctx.time.elapsed, ctx.camera.position);
      R.trail.update(ctx.time.elapsed, ctx.camera.position);
      return on || L.trail.length > 1 || R.trail.length > 1;
    },
    () => {
      for (const x of [L, R]) {
        x.trail.mesh.removeFromParent();
        x.trail.dispose();
        x.mat.dispose();
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Fire Dash — jet-propelled dash leaving a burning trail.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'fire_dash',
  name: 'Fire Dash',
  element: 'fire',
  kind: 'movement',
  tier: 2,
  description: 'Blast flame from your fists and feet to rocket forward, leaving a trail of fire that scorches anyone who crosses it.',
  usage: 'Dashes toward your movement input (or aim) — also mid-air. Enemies you blow past are burned; the trail keeps burning for a few seconds.',
  icon: 'fire',
  chiCost: 14,
  cooldown: 0.9,
  windup: 0.05,
  recovery: 0.18,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 12,
  begin(cast) {
    anim(cast.caster, 'fire_dash', { fadeIn: 0.03 });
    cast.ctx.vfx.burst('fire', cast.caster.position, { count: 10, speed: 1.6, spread: 1.2 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = moveIntent(cast).clone();
    c.yaw = Math.atan2(dir.x, dir.z);
    const speed = 36;
    const dur = 0.36;
    const airborne = !!c.body && !c.body.grounded;
    let t = 0;
    const handle = bending.drive({
      entity: c,
      step: (dt) => {
        t += dt;
        if (t > dur) return null;
        return { x: dir.x * speed, z: dir.z * speed, y: airborne ? 0.6 : undefined };
      },
      done: () => c.body?.external.multiplyScalar(0.3),
    });
    if (c.health) c.health.invulnerable = Math.max(c.health.invulnerable, 0.16);
    fistJets(cast, () => handle.active, 0.36, 0.1);
    fireMuzzle(ctx, c.castOrigin('chest', tmp).clone(), dir.clone().negate(), 1.6);
    ctx.audio.play('bend_fire_whoosh', { position: c.position, volume: 0.9, pitch: 1.3 });
    shake(ctx, c.position, 0.08, 0.15);
    ctx.events.emit('camera:impulse', { fovKick: c.isPlayer ? 5 : 0, duration: 0.35 });

    // Burning trail: ground flames dropped along the path; standing in them burns.
    const flames: THREE.Vector3[] = [];
    const ticks = new Map<number, number>();
    let last = c.position.clone();
    let age = 0;
    const life = 2.8;
    effect((dt) => {
      age += dt;
      if (handle.active) {
        const p = c.position;
        // Body hits along the dash.
        hitSphere(cast, p.clone().setY(p.y + 0.9), 1.15, 1.2, (_e, away) => ({ damage: 7, knockback: push(away, 7), stagger: 25, status: [{ type: 'burn', duration: 2 }] }));
        const gy = groundY(ctx, p.x, p.z, p.y);
        if (p.distanceTo(last) > 1.05 && p.y - gy < 1.5) {
          const fp = new THREE.Vector3(p.x, gy + 0.02, p.z);
          if (!ctx.world.liquidAt(fp.x, fp.z)) {
            flames.push(fp);
            groundFlame(ctx, fp, life - Math.min(1, age), 0.9);
            ctx.world.fx.scorch(fp, 0.8);
          }
          last = p.clone();
        }
        if (Math.random() < dt * 40) ctx.vfx.burst('fire', anchorPos(c, Math.random() < 0.5 ? 'footL' : 'footR', tmp), { count: 1, dir: dir.clone().negate(), spread: 0.3, speed: 2.5 });
      }
      // Hazard ticks.
      const now = ctx.time.elapsed;
      for (const fp of flames) {
        hitSphere(
          cast,
          tmp.copy(fp).setY(fp.y + 0.6),
          0.85,
          0.9,
          (e) => {
            if ((ticks.get(e.id) ?? 0) > now) return null;
            ticks.set(e.id, now + 0.5);
            return { damage: 3, stagger: 5, status: [{ type: 'burn', duration: 2 }] };
          },
          true,
        );
      }
      return age < life;
    });
  },
  aiScore: (_c, _t, dist) => (dist > 9 && dist < 20 ? 0.35 : dist < 3 ? 0.25 : 0),
});

// ---------------------------------------------------------------------------
// Explosive Finisher — leaping two-fisted slam that detonates on landing.
// ---------------------------------------------------------------------------

interface LeapData {
  t: number;
  handle: MoverHandle | null;
  done: boolean;
  fists: { alive: boolean };
}

function finisherBlast(cast: Cast): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  anim(c, 'fire_slam', { fadeIn: 0.03 });
  const fwd = aimFlat(cast);
  const center = c.position.clone().addScaledVector(fwd, 0.9);
  center.y = groundY(ctx, center.x, center.z, c.position.y + 1) + 0.6;
  const hits = detonate(cast, center, { radius: 6.2, damage: 34, knockback: 20, launch: 8, stagger: 95, burn: 3, knockdown: true, hot: true, column: true });
  for (const e of hits) fireOnEntity(ctx, e, e.aimPoint(tmp), 1);
  const ground = center.clone().setY(center.y - 0.5);
  flameRing(ctx, ground.clone().setY(ground.y + 0.25), { r0: 0.6, r1: 7.5, height: 1.0, duration: 0.6 });
  debris(ground, 22, { spread: 1.1, speed: 10, size: 0.2, radius: 1.2, color: '#5c4a3a', life: 2.2 });
  ctx.vfx.burst('dust', ground, { count: 26, radius: 2.5, speed: 2.2 });
  ctx.world.fx.crack(ground, 4.5);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
    const r = 2 + Math.random() * 3.5;
    const p = ground.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    p.y = groundY(ctx, p.x, p.z, p.y + 1) + 0.02;
    if (!ctx.world.liquidAt(p.x, p.z)) groundFlame(ctx, p, 1.6 + Math.random(), 1.1);
  }
  shake(ctx, center, 0.7, 0.55);
  ctx.events.emit('camera:impulse', { fovKick: 7, pullback: 1.2, duration: 0.5 });
}

registerTechnique({
  id: 'explosive_finisher',
  name: 'Explosive Finisher',
  element: 'fire',
  kind: 'ability',
  tier: 3,
  description: 'Leap high with both fists wreathed in fire and drive them into the ground, detonating a massive explosion.',
  usage: 'Leaps toward your aim (up to 9 m) and detonates on landing: huge damage, burn and knockdown. Long cooldown — finish a combo with it.',
  icon: 'fire',
  chiCost: 34,
  cooldown: 5,
  windup: 0.24,
  recovery: 0.5,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 9,
  channel: 1.6,
  begin(cast) {
    anim(cast.caster, 'fire_leap', { fadeIn: 0.05, hold: true });
    const fists = { alive: true };
    cast.data.leap = { t: 0, handle: null, done: false, fists } as LeapData;
    fistJets(cast, () => fists.alive, 0.42, 0.16);
    cast.ctx.vfx.burst('fire', cast.caster.castOrigin('hands', tmp), { count: 14, speed: 1 });
    cast.ctx.audio.play('bend_fire_whoosh', { position: cast.caster.position, volume: 0.7, pitch: 0.8 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.leap as LeapData;
    const fwd = aimFlat(cast);
    const flat = tmp.subVectors(cast.aimPoint, c.position).setY(0);
    const dist = Math.max(2.5, Math.min(9, flat.dot(fwd) || 6));
    const T = 0.62;
    const vy = ((c.body?.gravity ?? 24) * T) / 2;
    const hs = dist / T;
    let first = true;
    let t = 0;
    d.handle = bending.drive({
      entity: c,
      step: (dt) => {
        t += dt;
        if (t > T + 0.5) return null;
        const v = { x: fwd.x * hs, z: fwd.z * hs, y: first ? vy : undefined };
        first = false;
        return v;
      },
      done: () => c.body?.external.multiplyScalar(0.2),
    });
    ctx.vfx.burst('fire', c.position, { count: 16, speed: 2, spread: 1.2 });
    ctx.vfx.burst('dust', c.position, { count: 10, radius: 0.8 });
    ctx.audio.play('bend_fire_whoosh', { position: c.position, volume: 1, pitch: 0.65 });
  },
  channelUpdate(cast, dt) {
    const c = cast.caster;
    const d = cast.data.leap as LeapData;
    d.t += dt;
    const b = c.body;
    if ((d.t > 0.2 && (!b || b.grounded)) || d.t > 1.4) {
      d.done = true;
      d.handle?.stop();
      d.fists.alive = false;
      c.humanoid?.animator.stop('fire_leap', 0.05);
      finisherBlast(cast);
      return false;
    }
    return true;
  },
  end(cast) {
    const d = cast.data.leap as LeapData | undefined;
    if (!d) return;
    d.fists.alive = false;
    d.handle?.stop();
    cast.caster.humanoid?.animator.stop('fire_leap', 0.1);
  },
  aiScore: (_c, t: Entity, dist) => (dist > 3 && dist < 9 && t.alive ? 0.45 : 0),
});
