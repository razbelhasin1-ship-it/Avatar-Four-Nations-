import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { RockPillar } from '../../../vfx/effects/constructs';
import { shardRing } from '../../../vfx/effects/earth';
import { debris, effect } from '../../../vfx/effects/loop';
import { rockGeometry, stoneMaterial } from '../../../vfx/effects/rocks';
import { registerTechnique } from '../../CombatSystem';
import type { Cast } from '../../types';
import { bending, type MoverHandle } from '../bending/runtime';
import { aimFlat, anim, hitSphere, moveIntent, push, ringSweep, shake, stopAnim } from '../bending/util';
import { bendableAt, earthPrecheck, groundPoint, tintAt } from './common';
import { seismicPulse } from './seismic';

const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Earth Surf — ride a travelling wave of earth (toggle).
// ---------------------------------------------------------------------------

interface SurfData {
  mound: THREE.Group;
  loop: LoopHandle;
  handle: MoverHandle;
  vel: THREE.Vector3;
  last: THREE.Vector3;
  tint: string;
  t: number;
}

function buildMound(tint: string): THREE.Group {
  const g = new THREE.Group();
  const parts: Array<[number, [number, number, number], [number, number, number]]> = [
    [1, [0, 0, 0.1], [1.25, 0.55, 1.45]],
    [4, [0, 0.05, 0.95], [0.85, 0.42, 0.7]],
    [6, [0.55, -0.05, -0.5], [0.7, 0.4, 0.9]],
    [2, [-0.55, -0.05, -0.45], [0.7, 0.38, 0.85]],
  ];
  for (const [v, pos, scale] of parts) {
    const m = new THREE.Mesh(rockGeometry(v, 1), stoneMaterial(tint));
    m.position.set(...pos);
    m.scale.set(...scale);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function surfIntent(cast: Cast, out: THREE.Vector3): boolean {
  if (cast.isPlayer) {
    const mv = cast.ctx.input.move;
    if (Math.hypot(mv.x, mv.y) > 0.2) {
      moveIntent(cast, out);
      return true;
    }
    return false;
  }
  if (cast.target && cast.target.alive) out.subVectors(cast.target.position, cast.caster.position).setY(0).normalize();
  else aimFlat(cast, out);
  return true;
}

registerTechnique({
  id: 'earth_surf',
  name: 'Earth Surf',
  element: 'earth',
  kind: 'movement',
  tier: 2,
  description: 'Ride a rolling wave of earth that churns along beneath your feet — fast travel that bowls over anyone in the way.',
  usage: 'Press to start; steer with movement (camera-relative). Press again, attack or dodge to step off. The wave cannot cross water and drains chi slowly.',
  icon: 'earth',
  chiCost: 14,
  cooldown: 2.5,
  windup: 0.2,
  recovery: 0.2,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 30,
  channel: 10,
  precheck: earthPrecheck,
  begin(cast) {
    bending.channel(cast, 'toggle', { min: 0.35, auto: 3.5, breakOn: ['attack', 'aim', 'jump', 'ability1', 'ability2', 'ability3', 'ability4'] });
    anim(cast.caster, 'earth_surf_ride', { fadeIn: 0.15 });
    cast.ctx.vfx.burst('dust', cast.caster.position, { count: 10, radius: 0.8, speed: 1.2 });
    cast.ctx.audio.play('bend_earth_rise', { position: cast.caster.position, volume: 0.7, pitch: 1.1 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const tint = tintAt(ctx, c.position);
    const mound = buildMound(tint);
    mound.position.copy(c.position).setY(c.position.y - 0.3);
    ctx.vfx.group.add(mound);
    const vel = aimFlat(cast).multiplyScalar(4);
    const want = new THREE.Vector3();
    const d: SurfData = {
      mound,
      loop: ctx.audio.loop('bend_rumble_loop', { position: c.position, volume: 0.8 }),
      vel,
      last: c.position.clone(),
      tint,
      t: 0,
      handle: bending.drive({
        entity: c,
        step: (dt) => {
          const has = surfIntent(cast, want);
          const speed = has ? 13 : 2;
          if (!has) want.copy(vel).setY(0).normalize();
          const k = 1 - Math.exp(-(has ? 3 : 2) * dt);
          vel.x += (want.x * speed - vel.x) * k;
          vel.z += (want.z * speed - vel.z) * k;
          return { x: vel.x, z: vel.z };
        },
      }),
    };
    cast.data.surf = d;
  },
  channelUpdate(cast, dt) {
    if (!bending.channelKeep(cast, dt)) return false;
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.surf as SurfData | undefined;
    if (!d) return false;
    const drain = 3 * dt;
    if (c.chi < drain) return false;
    c.chi -= drain;
    d.t += dt;
    const pos = c.position;
    // Earth only: the wave collapses at water's edge.
    if (!bendableAt(ctx, pos.x, pos.z, pos.y)) {
      ctx.vfx.burst('splash', pos, { count: 10 });
      return false;
    }
    const speed = Math.hypot(d.vel.x, d.vel.z);
    if (speed > 1) {
      c.yaw = Math.atan2(d.vel.x, d.vel.z);
      c.root.rotation.y = c.yaw;
    }
    d.mound.position.set(pos.x, pos.y - 0.32 + Math.sin(d.t * 9) * 0.04, pos.z);
    d.mound.rotation.y = c.yaw;
    d.mound.rotation.x = -0.12 * Math.min(1, speed / 10);
    d.loop.setPosition(pos);
    d.loop.setPitch(0.8 + speed / 26);
    // Churned earth trail.
    if (pos.distanceTo(d.last) > 0.9) {
      const back = tmp.copy(pos).addScaledVector(d.vel.clone().normalize(), -1.1);
      back.y = groundPoint(ctx, back.x, back.z, pos.y).y + 0.1;
      debris(back, ctx.vfx.quality === 'low' ? 2 : 4, { dir: new THREE.Vector3(0, 1, 0), spread: 0.8, speed: 4, size: 0.12, radius: 0.5, color: d.tint, life: 1.2 });
      ctx.vfx.burst('dust', back, { count: 3, radius: 0.6, speed: 1.2 });
      if (Math.random() < 0.5) ctx.world.fx.crack(back, 0.9, c.yaw);
      d.last.copy(pos);
    }
    if (Math.random() < dt * 6) ctx.world.fx.disturb(pos, 2.5, 0.7);
    // Bowl over anyone in the way (each enemy once per ride).
    if (speed > 5) {
      const side = new THREE.Vector3(-d.vel.z, 0, d.vel.x).normalize();
      hitSphere(cast, tmp.copy(pos).setY(pos.y + 0.7), 1.5, 1.1, (e, away) => {
        const s = away.dot(side) >= 0 ? 1 : -1;
        return { damage: 8, knockback: push(side.clone().multiplyScalar(s).add(d.vel.clone().normalize().multiplyScalar(0.5)), 10), launch: 4.5, knockdown: true, stagger: 40 };
      });
    }
    return true;
  },
  end(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const d = cast.data.surf as SurfData | undefined;
    if (d) {
      d.handle.stop();
      d.loop.stop(0.3);
      const m = d.mound;
      debris(m.position.clone().setY(m.position.y + 0.4), 10, { spread: 1.2, speed: 4, size: 0.16, radius: 0.6, color: d.tint, life: 1.4 });
      ctx.vfx.burst('dust', m.position, { count: 10, radius: 0.8, speed: 1.2 });
      let t = 0;
      effect(
        (dt) => {
          t += dt;
          m.position.y -= dt * 2.2;
          return t < 0.4;
        },
        () => m.removeFromParent(),
      );
      cast.data.surf = undefined;
      if (cast.data.__brokenBy === 'jump' && c.body) {
        c.body.velocity.y = Math.max(c.body.velocity.y, 7);
        c.body.grounded = false;
      }
    }
    stopAnim(c, 'earth_surf_ride', 0.15);
  },
  aiScore: (_c, _t, dist) => (dist > 20 ? 0.2 : 0),
});

// ---------------------------------------------------------------------------
// Earth Launch — a pillar catapults you upward; land to send a shockwave.
// ---------------------------------------------------------------------------

registerTechnique({
  id: 'earth_launch',
  name: 'Earth Launch',
  element: 'earth',
  kind: 'movement',
  tier: 3,
  description: 'Crouch and explode upward as a pillar of stone catapults you high into the air. Come down hard to send out a shockwave.',
  usage: 'Launches you about 10 m up, drifting toward your aim. Landing within a few seconds triggers a shockwave. The pillar remains briefly as a platform.',
  icon: 'earth',
  chiCost: 18,
  cooldown: 6,
  windup: 0.2,
  recovery: 0.15,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 12,
  precheck: earthPrecheck,
  begin(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'earth_launch', { fadeIn: 0.04 });
    ctx.vfx.burst('dust', c.position, { count: 10, radius: 0.9, speed: 0.8 });
    ctx.world.fx.crack(c.position, 1.4);
    ctx.audio.play('bend_earth_sink', { position: c.position, volume: 0.6, pitch: 0.6 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const g = groundPoint(ctx, c.position.x, c.position.z, c.position.y);
    const tint = tintAt(ctx, g);
    new RockPillar(ctx, { x: g.x, z: g.z, ground: g.y, radius: 1.1, height: 3.6, ownerId: c.id, tint, timing: { rise: 0.16, stand: 4, sink: 0.8 } });
    const b = c.body;
    if (b) {
      b.velocity.y = 21;
      b.grounded = false;
    }
    const dir = aimFlat(cast);
    let t = 0;
    bending.drive({
      entity: c,
      step: (dt) => {
        t += dt;
        if (t > 0.5) return null;
        return { x: dir.x * 6, z: dir.z * 6 };
      },
    });
    ctx.vfx.burst('dust', g, { count: 16, radius: 1.4, speed: 2.2 });
    shake(ctx, g, 0.25, 0.3);
    if (c.isPlayer) ctx.events.emit('camera:impulse', { pullback: 1.6, fovKick: 4, duration: 0.8 });
    // Landing shockwave.
    let age = 0;
    let wasAir = false;
    effect((dt) => {
      age += dt;
      const body = c.body;
      if (!body || !c.alive) return false;
      if (!body.grounded) wasAir = true;
      if (wasAir && body.grounded && age > 0.3) {
        const at = c.position.clone();
        shardRing(ctx, at, 4.5, tintAt(ctx, at), 0.22);
        ringSweep(cast, {
          center: at.clone().setY(at.y + 0.7),
          r0: 0.5,
          r1: 4.6,
          duration: 0.2,
          height: 1.5,
          hit: (_e, away) => ({ damage: 12, knockback: push(away, 10), launch: 3.5, stagger: 40 }),
        });
        ctx.audio.play('bend_earth_slam', { position: at, volume: 0.9, pitch: 1.1 });
        shake(ctx, at, 0.35, 0.3);
        seismicPulse(ctx, c, at, 30);
        return false;
      }
      return age < 4;
    });
  },
  aiScore: () => 0.05,
});
