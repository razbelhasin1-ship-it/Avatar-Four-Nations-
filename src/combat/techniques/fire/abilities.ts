import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { Entity } from '../../../entities/Entity';
import type { Player } from '../../../player/Player';
import { flameArc, flameRing, flameTrail, FlameStream } from '../../../vfx/effects/fire';
import { effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending } from '../bending/runtime';
import { aimFlat, anchorPos, anim, forwardOf, groundY, hitSphere, push, ringSweep, shake, stopAnim } from '../bending/util';
import { fireOnEntity, heat } from './common';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Flame Sweep — low spinning kick; a crescent of flame races along the ground.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'flame_sweep',
  name: 'Flame Sweep',
  element: 'fire',
  kind: 'ability',
  tier: 1,
  starter: true,
  description: 'Drop low and sweep a leg through a full circle, throwing a wide crescent of flame along the ground that scorches everything in front of you.',
  usage: 'Close-range crowd control: hits several enemies in a wide arc, sets them burning and staggers them.',
  icon: 'fire',
  chiCost: 14,
  cooldown: 1.6,
  windup: 0.2,
  recovery: 0.36,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 6,
  begin(cast) {
    anim(cast.caster, 'fire_sweep', { speed: 1.05, fadeIn: 0.05, fadeOut: 0.01 });
    const f = anchorPos(cast.caster, 'footL');
    cast.ctx.vfx.burst('flame', f, { count: 6, speed: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const base = c.position.clone();
    base.y = groundY(ctx, base.x, base.z, base.y) + 0.02;
    flameArc(ctx, base, dir, { r0: 0.7, r1: 6.4, arc: 3.7, height: 1.45, duration: 0.5 });
    ringSweep(cast, {
      center: base.clone().setY(base.y + 0.6),
      dir,
      arc: 3.7,
      r0: 0.7,
      r1: 6.4,
      duration: 0.32,
      height: 1.2,
      hit: (e, away) => ({ damage: 13, knockback: push(away, 7), launch: 2.5, stagger: 40, status: [{ type: 'burn', duration: 2.5 }] }),
      onHit: (e) => {
        const p = e.aimPoint(tmp);
        ctx.vfx.burst('fire', p, { count: 10, speed: 1.2 });
        fireOnEntity(ctx, e, p, 0.6);
      },
      onStep: (r, t) => {
        if (Math.random() < 0.7) {
          const a = (Math.random() - 0.5) * 3.4;
          const ca = Math.cos(a), sa = Math.sin(a);
          const d = tmp.set(dir.x * ca - dir.z * sa, 0, dir.x * sa + dir.z * ca);
          const p = base.clone().addScaledVector(d, r);
          p.y = groundY(ctx, p.x, p.z, p.y) + 0.2;
          ctx.vfx.burst('flame', p, { count: 2, speed: 0.8, size: 1.1 });
          if (t > 0.3 && Math.random() < 0.4) ctx.world.fx.scorch(p, 0.7);
        }
      },
    });
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.6;
      const d = tmp.set(dir.x * Math.cos(a) - dir.z * Math.sin(a), 0, dir.x * Math.sin(a) + dir.z * Math.cos(a));
      heat(ctx, base.clone().addScaledVector(d, 3.5), 2, 0.6, c.id);
    }
    ctx.vfx.burst('embers', base.clone().addScaledVector(dir, 2).setY(base.y + 0.5), { count: 16, speed: 2.5, spread: 1.4 });
    ctx.world.fx.disturb(base.clone().addScaledVector(dir, 3), 6, 0.8);
    ctx.audio.play('bend_fire_whoosh', { position: base, volume: 0.9, pitch: 1.1 });
    shake(ctx, base, 0.14, 0.2);
  },
  aiScore: (_c, _t, dist) => (dist < 5.5 ? 0.75 : 0),
});

// ---------------------------------------------------------------------------
// Spinning Flame Kick — hop, spin, ring of fire.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'spinning_flame_kick',
  name: 'Spinning Flame Kick',
  element: 'fire',
  kind: 'ability',
  tier: 2,
  description: 'Leap and whip a full spinning kick that throws an expanding ring of fire around you.',
  usage: 'Use when surrounded, or mid-air after a jump or Fire Dash — the ring hits in every direction.',
  icon: 'fire',
  chiCost: 20,
  cooldown: 2.4,
  windup: 0.16,
  recovery: 0.3,
  movement: 'root',
  airborne: true,
  interruptible: false,
  range: 6.5,
  begin(cast) {
    const c = cast.caster;
    anim(c, 'fire_spin_kick', { speed: 1.0, fadeIn: 0.04, fadeOut: 0.01 });
    const b = c.body;
    if (b) {
      if (b.grounded) b.launch(7);
      else b.velocity.y = Math.max(b.velocity.y, 3.5);
    }
    // Leg trail follows the kicking foot through the spin.
    const ctx = cast.ctx;
    const { trail, mat } = flameTrail(ctx, 0.55, 0.22, { palette: 'fire' });
    const foot = new THREE.Vector3();
    const fx = { alive: true };
    cast.data.trailFx = fx;
    let t = 0;
    effect(
      (dt) => {
        t += dt;
        if (fx.alive && t < 0.75) trail.push(anchorPos(c, 'footR', foot), ctx.time.elapsed);
        trail.update(ctx.time.elapsed, ctx.camera.position);
        return t < 1.2;
      },
      () => {
        trail.mesh.removeFromParent();
        trail.dispose();
        mat.dispose();
      },
    );
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const center = c.position.clone().setY(c.position.y + 0.95);
    flameRing(ctx, center, { r0: 0.6, r1: 7.2, height: 1.1, duration: 0.5 });
    ringSweep(cast, {
      center,
      r0: 0.6,
      r1: 7.2,
      duration: 0.34,
      height: 1.6,
      hit: (_e, away) => ({ damage: 17, knockback: push(away, 13), launch: 3.5, stagger: 45, status: [{ type: 'burn', duration: 2 }] }),
      onHit: (e) => {
        const p = e.aimPoint(tmp);
        ctx.vfx.burst('fire', p, { count: 12, speed: 1.3 });
        fireOnEntity(ctx, e, p, 0.8);
      },
    });
    ctx.vfx.burst('embers', center, { count: 24, speed: 3, spread: 2 });
    ctx.vfx.flash(center, '#ff9040', 5, 0.25, 12);
    heat(ctx, center, 5, 0.8, c.id);
    ctx.world.fx.disturb(center, 7, 1);
    ctx.audio.play('bend_fire_whoosh', { position: center, volume: 1, pitch: 0.95 });
    shake(ctx, center, 0.18, 0.22);
    const b = c.body;
    if (b && !b.grounded) b.velocity.y = Math.max(b.velocity.y, 2);
  },
  end(cast) {
    if (cast.data.trailFx) cast.data.trailFx.alive = false;
  },
  aiScore: (_c, _t, dist) => (dist < 6 ? 0.6 : 0),
});

// ---------------------------------------------------------------------------
// Fire Stream — channeled flamethrower (hold the key).
// ---------------------------------------------------------------------------

interface StreamData {
  stream: FlameStream;
  loop: LoopHandle;
  dir: THREE.Vector3;
  tick: Map<number, number>;
  envT: number;
  flashT: number;
}

function streamOrigin(c: Cast['caster'], dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return c.castOrigin('hands', out).addScaledVector(dir, 0.25);
}

/** Current stream reach (stops at walls / terrain). */
function streamLength(cast: Cast, origin: THREE.Vector3, dir: THREE.Vector3, max: number): number {
  const hit = cast.ctx.world.raycast(origin, dir, max);
  return hit ? Math.max(0.8, hit.distance) : max;
}

/** Cone-shaped damage ticks along a stream (per-entity tick timers; repeat damage is intended). */
function streamHits(cast: Cast, origin: THREE.Vector3, dir: THREE.Vector3, len: number, width: number, d: StreamData, o: { damage: number; burn: number; push: number; interval: number }): void {
  const now = cast.ctx.time.elapsed;
  const samples = 4;
  const seen = new Set<Entity>();
  for (let i = 1; i <= samples; i++) {
    const k = i / samples;
    const center = tmp.copy(origin).addScaledVector(dir, len * k * 0.95);
    const r = 0.4 + width * k;
    hitSphere(
      cast,
      center,
      r,
      r,
      (e) => {
        if (seen.has(e)) return null;
        seen.add(e);
        const next = d.tick.get(e.id) ?? 0;
        if (now < next) return null;
        d.tick.set(e.id, now + o.interval);
        return { damage: o.damage, knockback: push(dir, o.push), stagger: 7, status: [{ type: 'burn', duration: o.burn }] };
      },
      true,
    );
  }
  for (const e of seen) {
    if ((d.tick.get(e.id) ?? 0) > now + o.interval - 0.01) fireOnEntity(cast.ctx, e, e.aimPoint(tmp2), 0.4);
  }
}

registerTechnique({
  id: 'fire_stream',
  name: 'Fire Stream',
  element: 'fire',
  kind: 'ability',
  tier: 2,
  description: 'Drive a continuous roaring jet of flame from both palms. Sweep it across foes to keep them burning.',
  usage: 'Hold the technique key to keep the stream going (aim with the camera). Drains chi while held.',
  icon: 'fire',
  chiCost: 14,
  cooldown: 2.2,
  windup: 0.18,
  recovery: 0.3,
  movement: 'slow',
  airborne: false,
  interruptible: true,
  range: 10,
  channel: 3.2,
  begin(cast) {
    bending.channel(cast, 'hold', { min: 0.5, auto: 1.8 });
    anim(cast.caster, 'fire_stream', { fadeIn: 0.08 });
    const hands = cast.caster.castOrigin('hands', new THREE.Vector3());
    cast.ctx.vfx.burst('flame', hands, { count: 6, speed: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const stream = new FlameStream(ctx, 1.05);
    const loop = ctx.audio.loop('bend_flame_loop', { position: cast.caster.position, volume: 0.85 });
    const d: StreamData = { stream, loop, dir: cast.aimDir.clone(), tick: new Map(), envT: 0, flashT: 0 };
    cast.data.stream = d;
    ctx.audio.play('bend_fire_whoosh', { position: cast.caster.position, volume: 0.8 });
  },
  channelUpdate(cast, dt) {
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.stream as StreamData | undefined;
    if (!d) return false;
    const drain = 7 * dt;
    if (c.chi < drain) return false;
    c.chi -= drain;
    // Aim follows the camera (player) or the target (AI).
    const want = tmp2;
    if (c.isPlayer) want.copy((c as unknown as Player).aimDir);
    else if (cast.target) cast.target.aimPoint(want).sub(c.castOrigin('chest', tmp)).normalize();
    else want.copy(d.dir);
    want.y = Math.max(-0.5, Math.min(0.5, want.y));
    d.dir.lerp(want.normalize(), Math.min(1, dt * 9)).normalize();
    c.yaw = Math.atan2(d.dir.x, d.dir.z);
    const origin = streamOrigin(c, d.dir, new THREE.Vector3());
    const len = streamLength(cast, origin, d.dir, 9.5);
    d.stream.update(dt, origin, d.dir, len);
    d.loop.setPosition(origin);
    streamHits(cast, origin, d.dir, len, 1.0, d, { damage: 4, burn: 2, push: 1.6, interval: 0.15 });
    d.envT -= dt;
    if (d.envT <= 0) {
      d.envT = 0.22;
      const end = origin.clone().addScaledVector(d.dir, len);
      if (!heat(ctx, end, 1.6, 0.8, c.id)) {
        const g = groundY(ctx, end.x, end.z, end.y);
        if (end.y - g < 1.2) ctx.world.fx.scorch(end.setY(g), 0.9);
      }
      ctx.world.fx.disturb(end, 2.5, 0.5);
    }
    d.flashT -= dt;
    if (d.flashT <= 0) {
      d.flashT = 0.12;
      ctx.vfx.flash(origin.clone().addScaledVector(d.dir, len * 0.4), '#ff8a30', 3, 0.14, 9);
    }
    return true;
  },
  end(cast) {
    const d = cast.data.stream as StreamData | undefined;
    if (d) {
      d.stream.dispose();
      d.loop.stop(0.2);
      cast.data.stream = undefined;
    }
    stopAnim(cast.caster, 'fire_stream', 0.2);
  },
  aiScore: (_c, _t, dist) => (dist < 8 ? 0.55 : 0),
});

// ---------------------------------------------------------------------------
// Breath of Fire — inhale, then exhale a wide cone of fire. Melts ice.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'breath_of_fire',
  name: 'Breath of Fire',
  element: 'fire',
  kind: 'ability',
  tier: 2,
  description: 'Draw a deep breath and exhale a wide, billowing cone of fire from within — the oldest firebending form. Melts ice and boils water.',
  usage: 'Short-range cone. Clears ice walls and frozen foes; burns everything in front of you.',
  icon: 'fire',
  chiCost: 22,
  cooldown: 3.0,
  windup: 0.44,
  recovery: 0.4,
  movement: 'root',
  airborne: false,
  interruptible: true,
  range: 7,
  channel: 1.4,
  begin(cast) {
    bending.channel(cast, 'hold', { min: 0.9, auto: 1.0 });
    anim(cast.caster, 'fire_breath', { fadeIn: 0.08 });
    // Inhale: embers drawn into the mouth.
    const ctx = cast.ctx;
    const mouth = anchorPos(cast.caster, 'eyes');
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const off = tmp.set(Math.cos(a), Math.random() - 0.2, Math.sin(a)).multiplyScalar(1.6);
      ctx.vfx.burst('embers', mouth.clone().add(off), { count: 1, dir: off.clone().negate(), spread: 0.05, speed: 3 });
    }
    ctx.audio.play('bend_air_swirl', { position: mouth, volume: 0.35, pitch: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const stream = new FlameStream(ctx, 1.9, { palette: 'fire' });
    const loop = ctx.audio.loop('bend_flame_loop', { position: cast.caster.position, volume: 1 });
    cast.data.stream = { stream, loop, dir: aimFlat(cast).clone().setY(-0.08).normalize(), tick: new Map(), envT: 0, flashT: 0 } as StreamData;
    ctx.audio.play('bend_fire_whoosh', { position: cast.caster.position, volume: 1, pitch: 0.75 });
    shake(ctx, cast.caster.position, 0.12, 0.3);
  },
  channelUpdate(cast, dt) {
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.stream as StreamData | undefined;
    if (!d) return false;
    const fwd = forwardOf(c, tmp2);
    d.dir.set(fwd.x, -0.08, fwd.z).normalize();
    const mouth = anchorPos(c, 'eyes', new THREE.Vector3()).addScaledVector(fwd, 0.15);
    mouth.y -= 0.06;
    const len = streamLength(cast, mouth, d.dir, 7.5);
    d.stream.update(dt, mouth, d.dir, len, 1);
    d.loop.setPosition(mouth);
    streamHits(cast, mouth, d.dir, len, 1.9, d, { damage: 3.5, burn: 3, push: 2.2, interval: 0.15 });
    d.envT -= dt;
    if (d.envT <= 0) {
      d.envT = 0.18;
      for (const k of [0.45, 0.85]) heat(ctx, mouth.clone().addScaledVector(d.dir, len * k), 2.2 * k + 0.8, 1.2, c.id);
      const end = mouth.clone().addScaledVector(d.dir, len);
      end.y = groundY(ctx, end.x, end.z, end.y);
      ctx.world.fx.scorch(end, 1.4);
      ctx.world.fx.disturb(end, 4, 0.7);
    }
    d.flashT -= dt;
    if (d.flashT <= 0) {
      d.flashT = 0.1;
      ctx.vfx.flash(mouth.clone().addScaledVector(d.dir, len * 0.4), '#ff7a20', 4, 0.12, 10);
    }
    return true;
  },
  end(cast) {
    const d = cast.data.stream as StreamData | undefined;
    if (d) {
      d.stream.dispose(0.3);
      d.loop.stop(0.3);
      cast.data.stream = undefined;
    }
  },
  aiScore: (_c, _t, dist) => (dist < 6 ? 0.5 : 0),
});
