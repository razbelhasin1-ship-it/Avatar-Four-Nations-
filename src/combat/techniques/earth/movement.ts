import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { wrapAngle } from '../../../core/MathUtil';
import { RockPillar } from '../../../vfx/effects/constructs';
import { EarthWave, shardRing } from '../../../vfx/effects/earth';
import { debris, effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { bending, type MoverHandle, type MoverVelocity } from '../bending/runtime';
import { aimFlat, anim, hitSphere, moveIntent, push, ringSweep, shake, stopAnim } from '../bending/util';
import { bendableAt, earthPrecheck, groundPoint, tintAt } from './common';
import { seismicPulse } from './seismic';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Earth Surf — raise a wave of earth and ride its crest (toggle).
// ---------------------------------------------------------------------------

const SURF_MAX = 15.5;
const SURF_CRUISE = 5;
const SURF_START = 7;

interface SurfData {
  wave: EarthWave;
  loop: LoopHandle;
  handle: MoverHandle;
  tint: string;
  /** Travel heading (yaw) and speed (m/s) of the wave. */
  heading: number;
  speed: number;
  /** Smoothed turn rate (rad/s) and the rider's bank into it. */
  turn: number;
  lean: number;
  last: THREE.Vector3;
  stuck: number;
  air: number;
  grindT: number;
}

/** Riders on a wave right now (their model stands on the crest). */
const riders = new Set<number>();

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

/** The wave's motion: it carves toward the wanted heading, builds speed while driven and feels the slope. */
function surfStep(cast: Cast, d: SurfData, want: THREE.Vector3, dt: number): MoverVelocity {
  const ctx = cast.ctx;
  const p = cast.caster.position;
  const has = surfIntent(cast, want);
  const diff = has ? wrapAngle(Math.atan2(want.x, want.z) - d.heading) : 0;
  // Carving: the turn rate tightens as the wave gathers speed.
  const maxTurn = 3.2 - 1.4 * Math.min(1, d.speed / SURF_MAX);
  const turn = THREE.MathUtils.clamp(diff * 4, -maxTurn, maxTurn);
  d.heading = wrapAngle(d.heading + turn * dt);
  d.turn += (turn - d.turn) * Math.min(1, dt * 8);
  // Speed builds while driven, brakes hard on a reversal and eases to a cruise when released.
  let accel = !has ? (SURF_CRUISE - d.speed) * 1.2 : Math.abs(diff) > 2 ? -16 : (SURF_MAX - d.speed) * (Math.abs(diff) < 1 ? 1.1 : 0.35);
  // The slope: slower climbing, faster on the way down.
  const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
  const g0 = ctx.world.groundAt(p.x, p.z, p.y + 1).y;
  const g1 = ctx.world.groundAt(p.x + fx * 1.5, p.z + fz * 1.5, p.y + 2.5).y;
  accel -= THREE.MathUtils.clamp((g1 - g0) / 1.5, -0.8, 0.8) * 14;
  d.speed = THREE.MathUtils.clamp(d.speed + accel * dt, 2.5, 19);
  return { x: fx * d.speed, z: fz * d.speed };
}

/** Bring the rider's model back down onto their own feet (unless they caught another wave). */
function easeRider(c: Combatant): void {
  const hum = c.humanoid?.root;
  if (!hum) return;
  effect(
    (dt) => {
      if (riders.has(c.id)) return false;
      const k = Math.min(1, dt * 12);
      hum.position.y -= hum.position.y * k;
      hum.rotation.x -= hum.rotation.x * k;
      hum.rotation.z -= hum.rotation.z * k;
      return Math.abs(hum.position.y) + Math.abs(hum.rotation.x) + Math.abs(hum.rotation.z) > 0.003;
    },
    () => {
      if (riders.has(c.id)) return;
      hum.position.y = 0;
      hum.rotation.x = 0;
      hum.rotation.z = 0;
    },
  );
}

registerTechnique({
  id: 'earth_surf',
  name: 'Earth Surf',
  element: 'earth',
  kind: 'movement',
  tier: 2,
  description: 'Raise a wave of earth under your feet and ride its crest. It builds speed, carves through turns, churns a furrow behind you and bowls over anyone in its path.',
  usage: 'Press to raise the wave; steer with movement — it carves, builds speed while you hold a direction and cruises when you let go. Jump to leap off with its momentum; press again, attack or dodge to step off. It slows uphill, races downhill, breaks against walls and cannot cross water. Drains chi slowly.',
  icon: 'earth',
  chiCost: 14,
  cooldown: 1.2,
  windup: 0.25,
  recovery: 0.2,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 30,
  channel: 10,
  precheck: earthPrecheck,
  begin(cast) {
    bending.channel(cast, 'toggle', { min: 0.35, auto: 3.5, breakOn: ['attack', 'aim', 'jump', 'ability1', 'ability2', 'ability3', 'ability4'] });
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'earth_surf_ride', { fadeIn: 0.2 });
    ctx.vfx.burst('dust', c.position, { count: 12, radius: 0.9, speed: 1.4 });
    ctx.world.fx.crack(c.position, 1.1);
    ctx.audio.play('bend_earth_rise', { position: c.position, volume: 0.8, pitch: 0.95 });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const tint = tintAt(ctx, c.position);
    const wave = new EarthWave(ctx, tint);
    const dir = aimFlat(cast);
    const want = new THREE.Vector3();
    const d: SurfData = {
      wave,
      loop: ctx.audio.loop('bend_rumble_loop', { position: c.position, volume: 0.6 }),
      handle: { stop() {}, active: false },
      tint,
      heading: Math.atan2(dir.x, dir.z),
      speed: SURF_START,
      turn: 0,
      lean: 0,
      last: c.position.clone(),
      stuck: 0,
      air: 0,
      grindT: 0,
    };
    d.handle = bending.drive({ entity: c, step: (dt) => surfStep(cast, d, want, dt) });
    // The wave lives in the effect loop: it outlives the ride while it collapses.
    effect(
      (dt) => {
        wave.update(dt);
        return !wave.done;
      },
      () => wave.dispose(),
    );
    wave.ride(c.position, d.heading, d.speed);
    riders.add(c.id);
    cast.data.surf = d;
    debris(c.position.clone().setY(c.position.y + 0.2), 8, { spread: 1, speed: 4, size: 0.12, radius: 0.6, color: tint, life: 1 });
    shake(ctx, c.position, 0.08, 0.2);
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
    const pos = c.position;
    // Earth only: the wave collapses at water's edge.
    if (!bendableAt(ctx, pos.x, pos.z, pos.y)) {
      ctx.vfx.burst('splash', pos, { count: 10 });
      return false;
    }
    // Jumped off the crest (the jump is the player's own): leap away with the wave's momentum.
    if (cast.isPlayer && c.body && !c.body.grounded && c.body.velocity.y > 1 && ctx.input.isDown('jump')) {
      cast.data.__brokenBy = 'jump';
      return false;
    }
    // Off a ledge: the wave cannot follow into the air.
    d.air = c.body && !c.body.grounded ? d.air + dt : 0;
    if (d.air > 0.3) return false;
    const fwd = tmp2.set(Math.sin(d.heading), 0, Math.cos(d.heading));
    // Broke against something solid: the wave crashes and has to build up again.
    const moved = Math.hypot(pos.x - d.last.x, pos.z - d.last.z);
    const expected = d.speed * dt;
    d.stuck = expected > 0.08 && moved < expected * 0.35 ? d.stuck + dt : 0;
    d.last.copy(pos);
    if (d.stuck > 0.15) {
      d.stuck = 0;
      const front = tmp.copy(pos).addScaledVector(fwd, 1.4).setY(pos.y + 0.6);
      debris(front, 10, { spread: 1.4, speed: 5, size: 0.14, radius: 0.5, color: d.tint, life: 1.2 });
      ctx.vfx.burst('dust', front, { count: 8, radius: 0.8, speed: 1.6 });
      ctx.audio.play('bend_earth_crumble', { position: front, volume: 0.8 });
      shake(ctx, front, 0.14, 0.2);
      d.speed = 3;
    }
    c.yaw = d.heading;
    c.root.rotation.y = d.heading;
    d.wave.ride(pos, d.heading, d.speed);
    // The rider stands on the crest, banks into turns and leans forward with speed.
    const sp = Math.min(1, d.speed / SURF_MAX);
    const hum = c.humanoid?.root;
    if (hum) {
      d.lean += (THREE.MathUtils.clamp(-d.turn * 0.11 * (0.4 + sp), -0.3, 0.3) - d.lean) * Math.min(1, dt * 6);
      hum.position.y = d.wave.lift;
      hum.rotation.z = d.lean;
      hum.rotation.x = 0.07 * sp;
    }
    d.loop.setPosition(pos);
    d.loop.setPitch(0.75 + d.speed / 24);
    d.loop.setVolume(0.45 + 0.4 * sp);
    // Stone grinds as it carves hard.
    d.grindT -= dt;
    if (Math.abs(d.turn) > 1.6 && d.speed > 8 && d.grindT <= 0) {
      d.grindT = 0.5;
      ctx.audio.play('bend_earth_crumble', { position: pos, volume: 0.35, pitch: 1.3 });
    }
    if (Math.random() < dt * 6) ctx.world.fx.disturb(pos, 2.5, 0.7);
    // The crest bowls over anyone in the way (each enemy once per ride).
    if (d.speed > 5) {
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const f = fwd.clone();
      hitSphere(cast, tmp.copy(pos).addScaledVector(f, 0.9).setY(pos.y + 0.7), 1.5, 1.1, (e, away) => {
        const s = away.dot(side) >= 0 ? 1 : -1;
        debris(e.position.clone().setY(e.position.y + 0.4), 6, { spread: 1.2, speed: 5, size: 0.12, color: d.tint, life: 1.1 });
        return { damage: 6 + d.speed * 0.45, knockback: push(side.clone().multiplyScalar(s).addScaledVector(f, 0.6), 9 + d.speed * 0.4), launch: 4.5, knockdown: true, stagger: 45 };
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
      d.wave.collapse();
      ctx.audio.play('bend_earth_crumble', { position: c.position, volume: 0.6 });
      cast.data.surf = undefined;
      riders.delete(c.id);
      easeRider(c);
      if (cast.data.__brokenBy === 'jump' && c.body) {
        // Leap off the crest carrying the wave's momentum.
        c.body.velocity.y = Math.max(c.body.velocity.y, 8);
        c.body.grounded = false;
        c.body.external.set(Math.sin(d.heading) * d.speed * 0.85, 0, Math.cos(d.heading) * d.speed * 0.85);
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
  cooldown: 2.5,
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
