import * as THREE from 'three';
import type { Entity } from '../../../entities/Entity';
import { fireballVisual, fireBoltVisual, fireExplosion, fireMuzzle, flameArc, flameBlade, flameTrail } from '../../../vfx/effects/fire';
import { effect } from '../../../vfx/effects/loop';
import { flameMaterial, setOpacity } from '../../../vfx/effects/materials';
import { shared } from '../../../vfx/effects/shapes';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, ProjectileVisual } from '../../types';
import { bending, registerWarmup } from '../bending/runtime';
import { anchorPos, anim, hitSphere, push, shake, sweep } from '../bending/util';
import { aimFrom, fireOnEntity, fireWorldImpact, heat, quenchCheck } from './common';

/**
 * Fire basics: Flame Punch (fire_jab) 4-step chain — right and left punches, a
 * sweeping fire-arc slash, a spinning kick — and the Charged Fireball
 * (fire_blast). Fire rewards aggression: every fire hit builds Heat (up to 5
 * stacks, decays 1.6 s after the last hit) which makes bolts bigger, hotter and
 * eventually igniting.
 */

const tmp = new THREE.Vector3();

/** A flame trail that follows a limb for `time` seconds (the slashing hand), then burns away. */
function limbTrail(cast: Cast, bone: 'handR' | 'footR', time: number, width: number, hot: boolean): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const { trail, mat } = flameTrail(ctx, width, 0.28, { palette: hot ? 'hot' : 'fire' });
  const at = new THREE.Vector3();
  let t = 0;
  effect(
    (dt) => {
      t += dt;
      if (t < time && c.alive) trail.push(anchorPos(c, bone, at), ctx.time.elapsed);
      trail.update(ctx.time.elapsed, ctx.camera.position);
      return t < time + 0.45;
    },
    () => {
      trail.mesh.removeFromParent();
      trail.dispose();
      mat.dispose();
    },
  );
}

function withQuench(cast: Cast, vis: ProjectileVisual): ProjectileVisual {
  const base = vis.update;
  vis.update = (p, dt) => {
    base(p, dt);
    quenchCheck(cast.ctx, p);
  };
  return vis;
}

export interface BlastOptions {
  radius: number;
  damage: number;
  knockback: number;
  launch?: number;
  stagger?: number;
  burn?: number;
  knockdown?: boolean;
  /** Already hit directly — skip in the blast. */
  skip?: Entity | null;
  hot?: boolean;
  column?: boolean;
}

/** Fire detonation: visuals + falloff area damage through the cast + heat pulse. */
export function detonate(cast: Cast, center: THREE.Vector3, o: BlastOptions): Entity[] {
  const ctx = cast.ctx;
  fireExplosion(ctx, center, o.radius, { hot: o.hot, column: o.column });
  const hits = hitSphere(cast, center, o.radius, Math.max(1.5, o.radius * 0.7), (e, away) => {
    if (e === o.skip) return null;
    const d = Math.hypot(e.position.x - center.x, e.position.z - center.z);
    const k = 1 - 0.45 * Math.min(1, d / o.radius);
    return {
      damage: o.damage * k,
      knockback: push(away, o.knockback * k),
      launch: (o.launch ?? 0) * k,
      stagger: (o.stagger ?? 30) * k,
      knockdown: o.knockdown,
      status: o.burn ? [{ type: 'burn', duration: o.burn }] : undefined,
    };
  });
  for (const e of hits) fireOnEntity(ctx, e, e.aimPoint(tmp), 1);
  heat(ctx, center, o.radius, Math.min(2, o.radius / 2), cast.caster.id);
  shake(ctx, center, Math.min(0.7, 0.12 + o.radius * 0.07), 0.3 + o.radius * 0.03);
  ctx.audio.play('bend_explosion', { position: center, volume: Math.min(1, 0.45 + o.radius * 0.12), pitch: 1.25 - Math.min(0.5, o.radius * 0.06) });
  return hits;
}

// ---------------------------------------------------------------------------
// Flame Punch
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'fire_jab',
  name: 'Flame Punch',
  element: 'fire',
  kind: 'basic',
  tier: 1,
  starter: true,
  description: 'Fast alternating punches that hurl bolts of flame, a sweeping slash that throws a wide crescent of fire, then a spinning kick that launches a heavier, igniting blast.',
  usage: 'Primary attack — chain four strikes. The third (fire arc) catches everyone in front of you. Landing fire hits builds Heat: hotter, bigger bolts that start to burn.',
  icon: 'fire',
  chiCost: 3,
  cooldown: 0,
  windup: 0.06,
  recovery: 0.16,
  movement: 'free',
  airborne: true,
  interruptible: false,
  range: 20,
  comboLength: 4,
  begin(cast) {
    const step = cast.comboIndex;
    const kick = step === 3;
    const arc = step === 2;
    anim(cast.caster, kick ? 'fire_jab_kick' : arc ? 'fire_jab_arc' : step % 2 ? 'fire_jab_l' : 'fire_jab_r', { speed: kick ? 1.15 : 1.1, fadeIn: 0.03, fadeOut: 0.12 });
    // The kick chambers a little longer (clear anticipation before the big bolt).
    if (kick) cast.elapsed -= 0.11;
    // The slash cocks across the body first and releases as the hand crosses the centre;
    // flame trails the knife-hand through the whole sweep.
    if (arc) {
      cast.elapsed -= 0.04;
      limbTrail(cast, 'handR', 0.3, 0.55, bending.heat(cast.caster) >= 3);
    }
    const c = cast.caster;
    const hand = kick ? anchorPos(c, 'footR') : c.castOrigin(step % 2 ? 'handL' : 'handR', new THREE.Vector3());
    cast.ctx.vfx.burst('flame', hand, { count: kick ? 6 : 3, speed: 0.4, size: kick ? 1 : 0.6 });
    if (cast.isPlayer) cast.ctx.events.emit('combo:advanced', { element: 'fire', index: step });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const step = cast.comboIndex;
    const kick = step === 3;
    const h = bending.heat(c);
    const hot = h >= 3;
    const hk = 1 + h * 0.07;
    if (step === 2) {
      fireArc(cast, h);
      return;
    }
    const from = kick ? anchorPos(c, 'footR') : c.castOrigin(step % 2 ? 'handL' : 'handR', new THREE.Vector3());
    const dir = aimFrom(cast, from);
    const r = kick ? 0.5 + h * 0.03 : 0.26 + h * 0.025;
    const vis = fireBoltVisual(ctx, r, { length: kick ? 3.6 : 1.9 + h * 0.12, palette: hot ? 'hot' : 'fire', trail: kick ? 0.24 : 0.18 });
    cast.projectile({
      position: from,
      velocity: dir.clone().multiplyScalar(kick ? 32 : 42),
      radius: r,
      life: kick ? 0.85 : 0.6,
      damage: (kick ? 15 : step === 2 ? 7 : 6) * hk,
      knockback: kick ? 10 : 3.5,
      launch: kick ? 2.5 : 0,
      stagger: kick ? 45 : 12,
      status: kick ? [{ type: 'burn', duration: 2.5 }] : hot ? [{ type: 'burn', duration: 1.2 }] : undefined,
      visual: withQuench(cast, vis),
      onHitEntity: (p, e) => {
        ctx.vfx.burst('fire', p.position, { count: kick ? 22 : 10, speed: 1.3 });
        ctx.vfx.burst('sparks', p.position, { count: kick ? 10 : 5 });
        ctx.vfx.flash(p.position, '#ffa040', kick ? 4 : 2, 0.12, 8);
        fireOnEntity(ctx, e, p.position, kick ? 1 : 0.5);
        if (kick) detonate(p.cast, p.position.clone(), { radius: 2.2, damage: 7, knockback: 6, stagger: 20, burn: 2, skip: e });
      },
      onHitWorld: (p, pt) => {
        ctx.vfx.burst('fire', pt, { count: kick ? 18 : 8, speed: 1.1 });
        fireWorldImpact(ctx, p.cast, pt, kick ? 1.2 : 0.6);
        if (kick) detonate(p.cast, pt.clone(), { radius: 2.2, damage: 7, knockback: 6, stagger: 20, burn: 2 });
      },
    });
    fireMuzzle(ctx, from, dir, kick ? 1.5 : 0.85 + h * 0.06);
    ctx.audio.play('bend_fire_puff', { position: from, volume: kick ? 0.9 : 0.6, pitch: kick ? 0.85 : 1.05 + step * 0.06 });
    // Momentum: each strike drives the bender forward a touch.
    const b = c.body;
    if (b && b.grounded) b.impulse(dir.x * (kick ? 3 : 2), 0, dir.z * (kick ? 3 : 2));
    else if (b) b.velocity.y = Math.max(b.velocity.y, 1.2);
  },
  aiScore: (_c, _t, dist) => (dist < 18 ? 0.65 - dist * 0.015 : 0),
});

/**
 * Third strike: the fire arc. The slash throws a crescent of flame that widens as it flies
 * and burns everything in a wide cone in front (a sweep matching the crescent's growth).
 */
function fireArc(cast: Cast, h: number): void {
  const ctx = cast.ctx;
  const c = cast.caster;
  const hot = h >= 3;
  const hk = 1 + h * 0.07;
  const chest = c.castOrigin('chest', new THREE.Vector3());
  const dir = aimFrom(cast, chest).clone();
  dir.y = Math.max(-0.25, Math.min(0.25, dir.y));
  dir.normalize();
  const origin = chest.addScaledVector(dir, 0.45);
  const length = 8.5;
  const widen = 3.4 + h * 0.15;
  flameBlade(ctx, origin, dir, { length, duration: 0.4, r0: 0.9, r1: widen, height: 0.8 + h * 0.06, arc: 2.6, roll: -0.22, palette: hot ? 'hot' : 'fire' });
  // The fan of fire the hand leaves in the air as it sweeps across the front.
  flameArc(ctx, tmp.copy(chest).setY(chest.y - 0.45), dir, { r0: 0.7, r1: 1.9, arc: 2.4, height: 0.75, duration: 0.3, palette: hot ? 'hot' : 'fire' });
  const hand = c.castOrigin('handR', new THREE.Vector3());
  ctx.vfx.burst('flame', hand, { count: 8, speed: 1.2 });
  ctx.vfx.burst('embers', origin, { count: 10, dir, spread: 0.8, speed: 3 });
  ctx.vfx.flash(origin, '#ff9a40', 2.2, 0.12, 8);
  sweep(cast, {
    from: origin,
    dir,
    length,
    duration: 0.26,
    radius: (t) => 1.0 + t * (widen - 0.6),
    height: 1.3,
    hit: (_e, pushDir) => ({ damage: 8 * hk, knockback: push(pushDir, 6), stagger: 22, status: [{ type: 'burn', duration: hot ? 1.6 : 0.8 }] }),
    onHit: (e) => {
      const at = e.aimPoint(new THREE.Vector3());
      ctx.vfx.burst('fire', at, { count: 10, speed: 1.2 });
      fireOnEntity(ctx, e, at, 0.7);
    },
    onStop: (pt) => fireWorldImpact(ctx, cast, pt, 0.7),
  });
  ctx.audio.play('bend_fire_whoosh', { position: hand, volume: 0.8, pitch: 1.25 });
  ctx.audio.play('bend_fire_puff', { position: hand, volume: 0.45, pitch: 0.95 });
  const b = c.body;
  if (b && b.grounded) b.impulse(dir.x * 2.5, 0, dir.z * 2.5);
  else if (b) b.velocity.y = Math.max(b.velocity.y, 1.2);
}

// ---------------------------------------------------------------------------
// Charged Fireball
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'fire_blast',
  name: 'Charged Fireball',
  element: 'fire',
  kind: 'heavy',
  tier: 1,
  starter: true,
  description: 'Compress breath and chi into a roaring fireball that detonates on impact and leaves foes burning.',
  usage: 'Hold Aim to charge (bigger fireball, wider blast), release to throw.',
  icon: 'fire',
  chiCost: 15,
  cooldown: 1.0,
  windup: 0.12,
  recovery: 0.38,
  movement: 'slow',
  airborne: true,
  chargeTime: 1.1,
  interruptible: true,
  range: 30,
  begin(cast) {
    anim(cast.caster, 'fire_push', { speed: 1.15, fadeIn: 0.05 });
    const hands = cast.caster.castOrigin('hands', new THREE.Vector3());
    cast.ctx.vfx.burst('fire', hands, { count: 8 + Math.round(cast.charge * 10), speed: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const k = 0.3 + 0.7 * cast.charge;
    const from = c.castOrigin('hands', new THREE.Vector3());
    const dir = aimFrom(cast, from);
    from.addScaledVector(dir, 0.5);
    const radius = 0.38 + k * 0.5;
    const blast = { radius: 2.2 + k * 2.6, damage: 7 + k * 15, knockback: 7 + k * 11, launch: 1.5 + k * 4.5, stagger: 30 + k * 50, burn: 1.5 + k * 3 };
    cast.projectile({
      position: from,
      velocity: dir.clone().multiplyScalar(25 + k * 7),
      radius,
      gravity: 1.5,
      life: 1.5,
      damage: 12 + 22 * k,
      knockback: 6 + 8 * k,
      stagger: 30 + 40 * k,
      status: [{ type: 'burn', duration: 2 + 3 * k }],
      visual: withQuench(cast, fireballVisual(ctx, radius)),
      onHitEntity: (p, e) => {
        fireOnEntity(ctx, e, p.position, k);
        detonate(p.cast, p.position.clone(), { ...blast, skip: e, hot: k > 0.8 });
      },
      onHitWorld: (p, pt) => {
        fireWorldImpact(ctx, p.cast, pt, 1 + k);
        detonate(p.cast, pt.clone().setY(pt.y + 0.3), { ...blast, hot: k > 0.8 });
      },
      onExpire: (p) => detonate(p.cast, p.position.clone(), { ...blast, radius: blast.radius * 0.7, damage: blast.damage * 0.7 }),
    });
    fireMuzzle(ctx, from, dir, 1.4 + k);
    ctx.vfx.flash(from, '#ff9040', 4 + k * 4, 0.2, 10);
    ctx.audio.play('bend_fire_whoosh', { position: from, volume: 0.7 + k * 0.3, pitch: 1.15 - k * 0.3 });
    // Recoil: the push shoves the bender back (and holds them up in the air).
    const b = c.body;
    if (b) {
      b.impulse(-dir.x * (2 + k * 3), 0, -dir.z * (2 + k * 3));
      if (!b.grounded) b.velocity.y = Math.max(b.velocity.y, 2 + k * 2);
    }
    shake(ctx, from, 0.08 + k * 0.12, 0.18);
  },
  aiScore: (_c, _t, dist) => (dist > 5 && dist < 26 ? 0.55 : 0.05),
});

// ---------------------------------------------------------------------------
// Charging: a fireball swells between the palms, embers spiral in.
// ---------------------------------------------------------------------------

bending.chargeVisual(
  'fire',
  (ctx, p) => {
    const body = flameMaterial({ mode: 'volume', palette: 'fire', intensity: 2, displace: 0.15, scale: [1.6, 1.6], scroll: [0.4, -1.6] });
    const core = flameMaterial({ mode: 'volume', palette: 'hot', intensity: 2.8, heat: 0.5, scale: [2, 2] });
    const geo = shared('fx_sphere_charge', () => new THREE.SphereGeometry(1, 18, 12));
    const mBody = new THREE.Mesh(geo, body);
    const mCore = new THREE.Mesh(geo, core);
    const group = new THREE.Group();
    group.add(mBody, mCore);
    ctx.vfx.group.add(group);
    let t = 0;
    let soundT = 0;
    return {
      update(dt, charge) {
        t += dt;
        p.castOrigin('hands', group.position);
        const fwd = tmp.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        group.position.addScaledVector(fwd, 0.18);
        const r = 0.12 + charge * 0.32 + Math.sin(t * 25) * 0.02;
        mBody.scale.setScalar(r);
        mCore.scale.setScalar(r * 0.55);
        mBody.rotation.y += dt * 5;
        if (Math.random() < dt * (10 + charge * 30)) {
          const a = Math.random() * Math.PI * 2;
          const off = tmp.set(Math.cos(a), Math.random() - 0.3, Math.sin(a)).multiplyScalar(0.9);
          const pos = group.position.clone().add(off);
          ctx.vfx.burst('embers', pos, { count: 1, dir: off.negate(), spread: 0.1, speed: 1.4 });
        }
        if (charge >= 1 && Math.random() < dt * 8) ctx.vfx.burst('flame', group.position, { count: 2, speed: 0.4, size: 0.7 });
        soundT -= dt;
        if (soundT <= 0) {
          soundT = 0.45;
          ctx.audio.play('bend_fire_puff', { position: group.position, volume: 0.15 + charge * 0.2, pitch: 0.6 + charge * 0.4 });
        }
      },
      end() {
        group.removeFromParent();
        body.dispose();
        core.dispose();
      },
    };
  },
  'fire_charge',
);

registerWarmup((g) => {
  const geo = shared('fx_sphere_charge', () => new THREE.SphereGeometry(1, 18, 12));
  g.add(new THREE.Mesh(geo, flameMaterial({ mode: 'volume', displace: 0.1 })));
  g.add(new THREE.Mesh(geo, flameMaterial({ mode: 'volume' })));
  g.add(new THREE.Mesh(geo, flameMaterial({ rimFade: true })));
  g.add(new THREE.Mesh(geo, flameMaterial({ sheet: true })));
  const m = flameMaterial({});
  setOpacity(m, 0.5);
  g.add(new THREE.Mesh(geo, m));
});
