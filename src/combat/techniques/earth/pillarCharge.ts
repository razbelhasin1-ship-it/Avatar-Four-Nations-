import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { dampAngle, wrapAngle } from '../../../core/MathUtil';
import type { Entity } from '../../../entities/Entity';
import { MOVE_STYLES, type Player } from '../../../player/Player';
import { liveConstructs, RockPillar } from '../../../vfx/effects/constructs';
import { registerTechnique } from '../../CombatSystem';
import type { Cast, Combatant } from '../../types';
import { bending } from '../bending/runtime';
import { bendableAt } from './common';

/**
 * Pillar Charge: standing on your own raised Earth Pillar, press Dodge (on touch the DODGE button reads CHARGE
 * there) and the pillar tears along the ground with you riding on top, homes on an enemy and slams into it.
 *
 * The pillar is the one you raised (same stone, same collider), driven kinematically by a motion curve:
 * a short wind-up (it shudders and leans back), an ease in to peak speed, a cruise and a short ease out into
 * the impact. Each frame the driver moves the pillar first, then you with it (you are attached to its top,
 * your feet where they stood), then the camera follows: pillar → rider → camera.
 *
 * After the slam you can chain another charge within the window (up to `chain` per pillar, each costing chi);
 * otherwise the pillar sinks and sets you down on the ground. Jump gets you off at any time.
 */

export const PILLAR_CHARGE_ID = 'earth_pillar_charge';

/** Earth Slam, the earth HEAVY, at full charge: 14 + 18 (earth/basic.ts). */
const EARTH_HEAVY_DAMAGE = 14 + 18;

/**
 * Tuning. Speeds and damage are relative to the game's own values (your Earth sprint speed, MOVE_STYLES.earth,
 * and the Earth heavy above), so a rescale of either carries over.
 */
export const PILLAR_CHARGE = {
  /** Peak speed, × your Earth sprint speed (9 m/s → 27 m/s). */
  speedMul: 3,
  /** Wind-up before it moves (s): the pillar shudders and leans back. */
  windup: 0.1,
  /** Ease in to peak speed (s). */
  rampUp: 0.2,
  /** Ease out into the impact (s): a constant deceleration from peak speed. */
  easeOut: 0.12,
  maxDistance: 30,
  minDistance: 4,
  /** With nothing to aim at, it runs this far along the aim and slams the ground. */
  noTargetDistance: 14,
  /** Targets: within this cone ahead of the camera (full angle, degrees) and maxDistance. */
  coneDeg: 60,
  /** Ram damage × the Earth heavy; slam damage × the Earth heavy at the centre, `slamEdge` of it at the rim. */
  hitDamage: 1.5,
  slamDamage: 2,
  slamEdge: 0.5,
  slamRadius: 5,
  /** Knockback along the travel (m/s) and a small upward pop (m/s). */
  knockback: 8,
  pop: 3,
  /** Stagger from the ram and stun from the slam (s). */
  stagger: 0.4,
  slamStun: 0.6,
  chiCost: 30,
  /** Cooldown after the last charge of a chain (s). */
  cooldown: 5,
  /** Charges per raised pillar, and the window to set off the next one (s). */
  chain: 3,
  chainWindow: 1.5,
  /** Setting you down after the last charge (s). */
  lowerTime: 0.5,
  /** Steering (rad/s): homing on the target, and the most the stick can nudge the heading. */
  homing: 5,
  nudge: 1.1,
  /** Terrain: steps it climbs (m), the steepest slope it rides (degrees), the deepest drop it rides off (m). */
  stepUp: 0.5,
  maxSlopeDeg: 35,
  maxDrop: 1.2,
  /** Wind-up lean back, slam pitch forward (degrees) and its timing (s); rider lean at full speed (degrees). */
  windupTiltDeg: 4,
  slamTiltDeg: 15,
  slamTiltIn: 0.12,
  slamTiltOut: 0.25,
  leanDeg: 15,
  /** Camera at full speed: pull back (m) and widen (degrees). */
  camPull: 1.5,
  camFov: 10,
} as const;

const PC = PILLAR_CHARGE;
const DEG = Math.PI / 180;
/** Simulation sub-step (s): the motion is integrated in steps no longer than this, whatever the frame rate. */
const SUB = 1 / 60;

type Phase = 'windup' | 'charge' | 'brake' | 'slam' | 'chain' | 'lower';
export type SlamReason = 'target' | 'heavy' | 'blocked' | 'ledge' | 'distance';

interface Ride {
  phase: Phase;
  /** Seconds in this phase. */
  t: number;
  cast: Cast | null;
  pillar: RockPillar;
  rider: Player;
  /** The pillar's foot (axis on the ground). */
  x: number;
  z: number;
  /** Ground under the foot: the raw sample, and the smoothed base the pillar stands on (steps are eased out). */
  ground: number;
  base: number;
  heading: number;
  speed: number;
  peak: number;
  travelled: number;
  /** The most it may still run on this charge (m). */
  plan: number;
  target: Entity | null;
  /** Where it is going: the target's last known position or the end of the run. */
  goal: THREE.Vector3;
  /** Your feet relative to the pillar's axis (world-fixed: the stone does not spin). */
  offX: number;
  offZ: number;
  /** Visual pitch of the stone (+ forward, radians) and the shudder on the wind-up. */
  tilt: number;
  jx: number;
  jz: number;
  /** Charges set off from this pillar (1..chain). */
  charges: number;
  hits: Set<number>;
  reason: SlamReason;
}

interface Pick {
  target: Entity | null;
  /** Flat direction to set off in. */
  dir: THREE.Vector3;
  goal: THREE.Vector3;
  distance: number;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const smooth01 = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/**
 * Heavy: it stops the pillar instead of being bowled aside. The game has no weight class, so this reads what
 * it has: training dummies (they never budge), bosses, beasts (non-humanoid bodies), very high poise, big bodies.
 */
export function isHeavy(e: Entity): boolean {
  if (e.kind === 'target') return true;
  const enemy = e as Entity & { rank?: string; arch?: { body?: string } };
  if (enemy.rank === 'boss') return true;
  if (enemy.arch?.body && enemy.arch.body !== 'humanoid') return true;
  if ((e.health?.maxPoise ?? 0) >= 90) return true;
  return e.radius >= 0.75;
}

class PillarChargeDriver {
  private ctx: GameContext | null = null;
  ride: Ride | null = null;
  /** Standing on your own raised pillar with Earth up: Dodge charges. */
  ready = false;
  private pending: Pick | null = null;
  /** Reused query buffer. */
  private readonly found: Entity[] = [];
  /** Rider lean applied to the model (radians), eased back to 0 after a ride. */
  private lean = 0;
  private leanOwner: Player | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  // -------------------------------------------------------------------------------------------- queries

  /** Your own raised pillar under your feet, if you stand on one. */
  pillarUnder(p: Player): RockPillar | null {
    const b = p.body;
    if (!b || !b.grounded || !b.groundColliderId) return null;
    const id = b.groundColliderId;
    for (const c of liveConstructs()) {
      if (!(c instanceof RockPillar) || c.colliderId !== id || c.ownerId !== p.id || !c.alive) continue;
      if (c.isHeld || c.phase === 'stand' || (c.phase === 'rise' && c.level >= 0.98)) return c;
    }
    return null;
  }

  /** Whether Dodge would set off a charge right now (ignoring chi and cooldown). */
  canCharge(ctx: GameContext, p: Player): boolean {
    if (p.element !== 'earth' || p.defeated || !p.alive) return false;
    if (!ctx.progression.knows('earth_pillar')) return false;
    if (ctx.companions.mounted || p.mountAnchor || p.body?.swimming) return false;
    if (this.ride && this.ride.phase !== 'chain') return false;
    const under = this.pillarUnder(p);
    return !!under && (!this.ride || under === this.ride.pillar);
  }

  precheck(caster: Combatant, ctx: GameContext): { reason: 'state'; message: string } | null {
    if (!caster.isPlayer || !this.canCharge(ctx, caster as Player)) return { reason: 'state', message: 'Stand on your own raised Earth Pillar to charge.' };
    return null;
  }

  // -------------------------------------------------------------------------------------------- targeting

  /** Where a charge set off now would go. */
  pick(ctx: GameContext, p: Player): Pick {
    const pillar = this.pillarUnder(p);
    const from = tmpA.copy(pillar ? pillar.group.position : p.position).setY(0);
    // Locked on: that enemy.
    const lock = p.lockTarget;
    if (lock && lock.alive) {
      const d = Math.hypot(lock.position.x - from.x, lock.position.z - from.z);
      if (d <= PC.maxDistance + 2) {
        const dir = new THREE.Vector3(lock.position.x - from.x, 0, lock.position.z - from.z);
        if (dir.lengthSq() < 1e-6) dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        dir.normalize();
        return { target: lock, dir, goal: lock.position.clone(), distance: d };
      }
    }
    // Nothing to aim at: straight along the aim.
    const dir = new THREE.Vector3(p.aimDir.x, 0, p.aimDir.z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    dir.normalize();
    const goal = from.clone().addScaledVector(dir, PC.noTargetDistance);
    return { target: null, dir, goal, distance: PC.noTargetDistance };
  }

  // -------------------------------------------------------------------------------------------- control

  /** Dodge pressed on your pillar: set off a charge (the cast pays chi and checks the cooldown). */
  private tap(ctx: GameContext, p: Player): void {
    const pick = this.pick(ctx, p);
    this.pending = pick;
    ctx.combat.tryCast(p, PILLAR_CHARGE_ID, { force: true, target: pick.target ?? undefined, aimDir: pick.dir.clone() });
    this.pending = null;
  }

  /** The cast began (technique begin): take the pillar and wind up. */
  start(cast: Cast): void {
    const ctx = cast.ctx;
    const p = cast.caster as Player;
    const pillar = this.pillarUnder(p);
    if (!pillar || (!pillar.isHeld && !pillar.takeOver())) {
      cast.finish();
      return;
    }
    const pick = this.pending ?? this.pick(ctx, p);
    // The chain lets you go again at once; the cooldown starts after the last charge.
    ctx.combat.startCooldown(p, PILLAR_CHARGE_ID, 0);
    const prev = this.ride && this.ride.pillar === pillar ? this.ride : null;
    const pos = pillar.group.position;
    const dist = Math.min(PC.maxDistance, Math.max(PC.minDistance, pick.distance));
    const ride: Ride = {
      phase: 'windup',
      t: 0,
      cast,
      pillar,
      rider: p,
      x: pos.x,
      z: pos.z,
      ground: pillar.baseY,
      base: pillar.baseY,
      heading: Math.atan2(pick.dir.x, pick.dir.z),
      speed: 0,
      peak: PC.speedMul * MOVE_STYLES.earth.sprint,
      travelled: 0,
      plan: pick.target ? PC.maxDistance : dist,
      target: pick.target,
      goal: pick.goal.clone(),
      offX: p.position.x - pos.x,
      offZ: p.position.z - pos.z,
      tilt: 0,
      jx: 0,
      jz: 0,
      charges: (prev?.charges ?? 0) + 1,
      hits: new Set(),
      reason: 'distance',
    };
    this.ride = ride;
    this.leanOwner = p;
    this.attach(ride);
    ctx.events.emit('pillarcharge:launched', { targetId: pick.target?.id ?? null, distance: dist, chain: ride.charges });
  }

  /** Channel tick of the cast: it lasts while the pillar winds up, charges and slams. */
  channelKeep(cast: Cast): boolean {
    const r = this.ride;
    return !!r && r.cast === cast && (r.phase === 'windup' || r.phase === 'charge' || r.phase === 'brake' || r.phase === 'slam');
  }

  /** The cast ended; if it was cut short mid-charge (you were knocked out of it), stop safely. */
  castEnded(cast: Cast, interrupted: boolean): void {
    const r = this.ride;
    if (!r || r.cast !== cast) return;
    r.cast = null;
    if (interrupted && (r.phase === 'windup' || r.phase === 'charge')) this.brake(r);
  }

  // -------------------------------------------------------------------------------------------- frame

  /** Runs before the entities: input, then the pillar, then you on it (the camera follows after). */
  pre(dt: number, ctx: GameContext): void {
    const p = ctx.player as Player | null;
    if (!p) return;
    const r = this.ride;
    // Dodge on your pillar is the charge; while the pillar moves it does nothing (no rolling off it).
    const ready = this.canCharge(ctx, p);
    if (ready !== this.ready) {
      this.ready = ready;
      ctx.events.emit('pillarcharge:ready', { ready });
    }
    if (ctx.input.wasPressed('dodge')) {
      if (r && r.phase !== 'chain' && r.rider === p) ctx.input.consume('dodge');
      else if (ready) {
        ctx.input.consume('dodge');
        this.tap(ctx, p);
      }
    }
    if (this.ride) this.step(ctx, this.ride, Math.min(dt, 0.1));
  }

  private attached(r: Ride): boolean {
    return r.phase !== 'chain';
  }

  private step(ctx: GameContext, r: Ride, dt: number): void {
    const p = r.rider;
    const b = p.body!;
    // The stone is gone (shattered, cleared): you drop from where you stand.
    if (!r.pillar.alive) {
      this.end(r, 'cancelled', false);
      return;
    }
    if (p.defeated || !p.alive) {
      this.end(r, 'cancelled', true);
      return;
    }
    // Jump gets you off (the jump itself is yours, from the last frame): keep some of the pillar's momentum.
    if (this.attached(r) && b.velocity.y > 0.5) {
      const keep = r.speed * 0.45;
      this.detach(p, true);
      b.external.set(Math.sin(r.heading) * keep, 0, Math.cos(r.heading) * keep);
      this.end(r, 'jumped', true);
      return;
    }
    // A dialogue or modal over the game: hold the move where it is (you stay on).
    if (ctx.ui.blocksGameplay) {
      if (this.attached(r)) this.attach(r);
      return;
    }
    switch (r.phase) {
      case 'windup':
        this.windup(ctx, r, dt);
        break;
      case 'charge':
        this.charge(ctx, r, dt);
        break;
      case 'brake':
        this.braking(r, dt);
        break;
      case 'slam':
        this.slamming(ctx, r, dt);
        break;
      case 'chain':
        this.chainWait(ctx, r, dt);
        break;
      case 'lower':
        this.lowering(ctx, r, dt);
        break;
    }
    if (this.ride === r) {
      this.placePillar(r);
      if (this.attached(r)) this.attach(r);
    }
  }

  private windup(_ctx: GameContext, r: Ride, dt: number): void {
    r.t += dt;
    const k = Math.min(1, r.t / PC.windup);
    // Lean back a few degrees and shudder (the stone only: you ride the lean, not the shudder).
    r.tilt = -PC.windupTiltDeg * DEG * Math.sin(k * Math.PI * 0.5);
    const s = 0.025 * (1 - k * 0.5);
    r.jx = (Math.random() - 0.5) * s;
    r.jz = (Math.random() - 0.5) * s;
    if (r.t >= PC.windup) {
      r.phase = 'charge';
      r.t = 0;
      r.jx = r.jz = 0;
    }
  }

  /** Distance left to where the pillar should stop (m). */
  private remaining(r: Ride): number {
    const left = Math.max(0, r.plan - r.travelled);
    if (!r.target) return Math.min(left, Math.hypot(r.goal.x - r.x, r.goal.z - r.z));
    const contact = r.pillar.radius + r.target.radius + 0.1;
    return Math.min(left, Math.max(0, Math.hypot(r.goal.x - r.x, r.goal.z - r.z) - contact));
  }

  private charge(ctx: GameContext, r: Ride, dt: number): void {
    // Ease back out of the wind-up lean as it sets off.
    r.tilt *= Math.exp(-dt * 18);
    let left = dt;
    while (left > 1e-6 && r.phase === 'charge' && this.ride === r) {
      const h = Math.min(left, SUB);
      left -= h;
      r.t += h;
      // Follow a moving target.
      if (r.target) {
        if (r.target.alive) r.goal.copy(r.target.position);
        const want = Math.atan2(r.goal.x - r.x, r.goal.z - r.z);
        const d = wrapAngle(want - r.heading);
        const turn = PC.homing * h;
        r.heading = wrapAngle(r.heading + Math.max(-turn, Math.min(turn, d)));
      }
      const R = this.remaining(r);
      const decel = r.peak / PC.easeOut;
      const ramp = r.peak * smooth01(r.t / PC.rampUp);
      const brake = Math.sqrt(2 * decel * R);
      r.speed = Math.max(0, Math.min(r.peak, ramp + 0.5, brake));
      const stepLen = Math.min(r.speed * h, R);
      if (stepLen > 0) {
        const ax = r.x, az = r.z;
        this.advance(ctx, r, stepLen);
        if (this.ride !== r || r.phase !== 'charge') return;
        // Everything the front swept through on this step (swept: nothing tunnels at speed).
        if (this.sweep(ctx, r, ax, az)) return;
      }
      if (this.ride !== r || r.phase !== 'charge') return;
      if (R - stepLen <= 1e-3) {
        this.slam(ctx, r, r.target ? 'target' : 'distance');
        return;
      }
    }
  }

  /** Move the foot `len` metres along the heading, following the ground (steps eased out, slopes exact). */
  private advance(ctx: GameContext, r: Ride, len: number): void {
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const nx = r.x + fx * len, nz = r.z + fz * len;
    const g = this.groundAt(ctx, nx, nz, r.ground);
    const slope = Math.tan(PC.maxSlopeDeg * DEG) * len;
    const dg = g - r.ground;
    // A climb steeper than the slope allows plus a step, or a drop deeper than it rides: stop here.
    if (dg > slope + PC.stepUp || dg < -(slope + PC.maxDrop) || !bendableAt(ctx, nx, nz, g)) {
      this.slam(ctx, r, dg < 0 || !bendableAt(ctx, nx, nz, g) ? 'ledge' : 'blocked');
      return;
    }
    // A step (more than the slope explains) is eased out over a few frames; slopes are followed exactly.
    const stepPart = Math.abs(dg) > slope + 0.02 ? dg - Math.sign(dg) * slope : 0;
    const err = r.base - r.ground - stepPart;
    r.x = nx;
    r.z = nz;
    r.ground = g;
    r.base = g + err;
    r.travelled += len;
  }

  private braking(r: Ride, dt: number): void {
    // A safe stop (stunned, cut short): twice the normal deceleration, no slam.
    r.tilt *= Math.exp(-dt * 12);
    const decel = (2 * r.peak) / PC.easeOut;
    r.speed = Math.max(0, r.speed - decel * dt);
    const len = r.speed * dt;
    if (len > 0 && this.ctx) this.advance(this.ctx, r, len);
    if (this.ride === r && r.phase === 'brake' && r.speed <= 0) this.toLower(r);
  }

  private brake(r: Ride): void {
    if (r.phase === 'charge' || r.phase === 'windup') {
      r.phase = 'brake';
      r.t = 0;
    }
  }

  /**
   * The front of the pillar swept from the foot at (ax, az) to where it is now: a box its width plus a margin
   * and its full height. Each one is met once per charge: enemies take the ram (light ones are bowled aside,
   * a heavy one stops the pillar dead); anyone else is pushed gently out of the way. Returns true if it stopped.
   */
  private sweep(ctx: GameContext, r: Ride, ax: number, az: number): boolean {
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const R = r.pillar.radius;
    // Front points before and after this step, and the box around the segment between them.
    const sx = ax + fx * R, sz = az + fz * R;
    const seg = Math.hypot(r.x - ax, r.z - az);
    const halfW = R + 0.35;
    const reach = 0.25;
    const top = r.base + r.pillar.height * r.pillar.level;
    const list = ctx.entities.queryRadius(tmpA.set(sx + fx * seg * 0.5, r.base + 1, sz + fz * seg * 0.5), seg * 0.5 + halfW + reach + 1.4, { aliveOnly: true }, this.found);
    for (const e of list) {
      if (e === r.rider || r.hits.has(e.id) || e.disposed) continue;
      const rx = e.position.x - sx, rz = e.position.z - sz;
      const along = rx * fx + rz * fz;
      const lat = rx * fz - rz * fx;
      if (along < -e.radius - R || along > seg + e.radius + reach) continue;
      if (Math.abs(lat) > halfW + e.radius) continue;
      if (e.position.y > top + 0.2 || e.position.y + e.height < r.base - 0.4) continue;
      r.hits.add(e.id);
      const side = lat >= 0 ? 1 : -1;
      if (!ctx.combat.canHarm(r.rider, e)) {
        this.nudge(e, fz * side * 0.8 + fx * 0.6, -fx * side * 0.8 + fz * 0.6, 4);
        continue;
      }
      const heavy = isHeavy(e);
      if (r.cast) {
        // Along the travel with a little upward pop; light ones also out to the side they were on. (No block stops a
        // charging pillar.)
        const kb = heavy ? 0 : PC.knockback;
        const knock = new THREE.Vector3(fx * kb + fz * side * kb * 0.45, 0, fz * kb - fx * side * kb * 0.45);
        r.cast.hit(e, { damage: EARTH_HEAVY_DAMAGE * PC.hitDamage, knockback: knock, launch: heavy ? 0 : PC.pop, stun: PC.stagger, stagger: 25, unblockable: true, point: e.aimPoint(new THREE.Vector3()) });
      }
      if (heavy) {
        // It stops dead with its front against them.
        const back = Math.max(0, seg - Math.max(0, along - e.radius - 0.05));
        r.x -= fx * back;
        r.z -= fz * back;
        r.travelled -= back;
        this.slam(ctx, r, 'heavy');
        return true;
      }
    }
    return false;
  }

  /** A gentle shove for someone the pillar must not hurt (allies, townsfolk, animals). */
  private nudge(e: Entity, dx: number, dz: number, strength: number): void {
    const b = e.body;
    if (!b || b.kinematic) return;
    const l = Math.hypot(dx, dz) || 1;
    b.impulse((dx / l) * strength, 1.2, (dz / l) * strength);
  }

  /** The pillar stops and pitches forward into the ground: the shockwave goes off now. */
  private slam(ctx: GameContext, r: Ride, reason: SlamReason): void {
    r.phase = 'slam';
    r.t = 0;
    r.speed = 0;
    r.reason = reason;
    const hits = this.shockwave(ctx, r, reason);
    ctx.events.emit('pillarcharge:slam', { position: { x: this.slamAt.x, y: this.slamAt.y, z: this.slamAt.z }, hits: r.hits.size + hits, reason });
  }

  /** Where the last slam landed (the ground just ahead of the pillar). */
  readonly slamAt = new THREE.Vector3();

  /**
   * The slam's shockwave: around the ground just ahead of the pillar, enemies take the slam (full at the centre,
   * `slamEdge` of it at the rim), are thrown outward and stunned; anyone else is pushed gently. Running into a
   * wall or stopping at a ledge is a smaller slam. Returns how many enemies it hit.
   */
  private shockwave(ctx: GameContext, r: Ride, reason: SlamReason): number {
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const small = reason === 'blocked' || reason === 'ledge';
    const radius = PC.slamRadius * (small ? 0.6 : 1);
    const power = small ? 0.5 : 1;
    const c = this.slamAt.set(r.x + fx * (r.pillar.radius + 0.4), r.base, r.z + fz * (r.pillar.radius + 0.4));
    let n = 0;
    const list = ctx.entities.queryRadius(tmpA.copy(c), radius + 1.5, { aliveOnly: true }, this.found);
    for (const e of list) {
      if (e === r.rider || e.disposed) continue;
      const dx = e.position.x - c.x, dz = e.position.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > radius + e.radius || Math.abs(e.position.y - c.y) > 2.6) continue;
      const ux = d > 0.05 ? dx / d : fx, uz = d > 0.05 ? dz / d : fz;
      const f = 1 - (1 - PC.slamEdge) * Math.min(1, d / radius);
      if (!ctx.combat.canHarm(r.rider, e)) {
        this.nudge(e, ux, uz, 3.5 * f);
        continue;
      }
      if (!r.cast) continue;
      const kb = isHeavy(e) ? PC.knockback * 0.3 : PC.knockback * 1.5 * f;
      const res = r.cast.hit(
        e,
        { damage: EARTH_HEAVY_DAMAGE * PC.slamDamage * f * power, knockback: new THREE.Vector3(ux * kb, 0, uz * kb), launch: PC.pop * (0.6 + 0.4 * f), stun: PC.slamStun, stagger: 40, unblockable: true, point: e.aimPoint(new THREE.Vector3()) },
        true,
      );
      if (res) n++;
    }
    return n;
  }

  private slamming(ctx: GameContext, r: Ride, dt: number): void {
    r.t += dt;
    const max = PC.slamTiltDeg * DEG;
    if (r.t < PC.slamTiltIn) r.tilt = max * (1 - (1 - r.t / PC.slamTiltIn) ** 2);
    else r.tilt = max * (1 - smooth01((r.t - PC.slamTiltIn) / PC.slamTiltOut));
    if (r.t >= PC.slamTiltIn + PC.slamTiltOut) {
      r.tilt = 0;
      this.afterSlam(ctx, r);
    }
  }

  /** Chain another charge if you can, else set you down. */
  private afterSlam(ctx: GameContext, r: Ride): void {
    const p = r.rider;
    const chiCost = PC.chiCost * (ctx.avatar?.boosts?.chiCost ?? 1);
    const anyone = ctx.entities.queryRadius(tmpA.set(r.x, r.base, r.z), PC.maxDistance, { teams: ['hostile'], aliveOnly: true }).length > 0;
    if (r.charges < PC.chain && p.chi >= chiCost && anyone) {
      r.phase = 'chain';
      r.t = 0;
      this.detach(p, false);
    } else this.toLower(r);
  }

  private chainWait(ctx: GameContext, r: Ride, dt: number): void {
    r.t += dt;
    const p = r.rider;
    // Stepped or jumped off: the pillar sinks back where it stands.
    const on = this.pillarUnder(p) === r.pillar;
    if (!on && (p.body!.grounded || p.body!.airTime > 0.25 || p.body!.velocity.y > 0.5)) {
      r.pillar.letGo();
      ctx.combat.startCooldown(p, PILLAR_CHARGE_ID, PC.cooldown);
      this.ride = null;
      ctx.events.emit('pillarcharge:ended', { reason: 'left' });
      return;
    }
    if (r.t >= PC.chainWindow) this.toLower(r);
  }

  private toLower(r: Ride): void {
    r.phase = 'lower';
    r.t = 0;
    r.speed = 0;
    r.tilt = 0;
    // Feet where they are now (after the chain window you may have moved on the top).
    const p = r.rider;
    r.offX = p.position.x - r.x;
    r.offZ = p.position.z - r.z;
    this.ctx?.combat.startCooldown(p, PILLAR_CHARGE_ID, PC.cooldown);
  }

  private lowering(ctx: GameContext, r: Ride, dt: number): void {
    r.t += dt;
    const k = smooth01(r.t / PC.lowerTime);
    r.pillar.level = 1 - k;
    if (k >= 1) {
      this.placePillar(r);
      this.attach(r);
      this.end(r, 'lowered', true);
      void ctx;
    }
  }

  /** The ride is over: let go of the pillar and of you. */
  private end(r: Ride, reason: 'lowered' | 'jumped' | 'left' | 'cancelled', settleRider: boolean): void {
    const ctx = this.ctx;
    const p = r.rider;
    if (r.pillar.alive) {
      if (r.phase === 'lower' && r.pillar.level <= 0.001) r.pillar.vanish();
      else r.pillar.letGo();
    }
    if (p.body?.kinematic) this.detach(p, reason === 'jumped');
    if (settleRider && reason === 'lowered' && p.body) {
      p.body.grounded = true;
      p.body.groundY = p.position.y;
    }
    if (ctx && reason !== 'lowered' && r.phase !== 'lower') ctx.combat.startCooldown(p, PILLAR_CHARGE_ID, PC.cooldown);
    if (r.cast && r.cast.phase !== 'done') r.cast.finish();
    this.ride = null;
    ctx?.events.emit('pillarcharge:ended', { reason });
  }

  /** Drop everything at once (session end, travel): no effects. */
  reset(): void {
    const r = this.ride;
    this.ride = null;
    this.pending = null;
    if (r) {
      if (r.pillar.alive) r.pillar.letGo();
      if (r.rider.body) r.rider.body.kinematic = false;
    }
    if (this.leanOwner?.humanoid) this.leanOwner.humanoid.root.rotation.x = 0;
    this.lean = 0;
    this.leanOwner = null;
    if (this.ready) {
      this.ready = false;
      this.ctx?.events.emit('pillarcharge:ready', { ready: false });
    }
  }

  // -------------------------------------------------------------------------------------------- placing

  private groundAt(ctx: GameContext, x: number, z: number, near: number): number {
    // Below the pillar's own top (it is a walkable collider): terrain and other stone only.
    return ctx.world.groundAt(x, z, near + PC.stepUp + 0.35).y;
  }

  private placePillar(r: Ride): void {
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    // Tilt about the horizontal axis across the heading through the foot (+ pitches the top forward).
    r.pillar.place(r.x, r.base, r.z, r.pillar.level, fz, -fx, r.tilt, r.jx, r.jz);
  }

  /** Put you on the pillar's top where your feet were (riding its tilt), held there for this frame. */
  private attach(r: Ride): void {
    const p = r.rider;
    const b = p.body!;
    const ctx = this.ctx!;
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    // v = (offX, H, offZ) rotated by `tilt` about k = (fz, 0, -fx) (Rodrigues; k·v = offX·fz - offZ·fx).
    const H = r.pillar.height * r.pillar.level;
    const c = Math.cos(r.tilt), s = Math.sin(r.tilt);
    const kx = fz, kz = -fx;
    const vx = r.offX, vy = H, vz = r.offZ;
    const kv = kx * vx + kz * vz;
    // k × v = (ky·vz - kz·vy, kz·vx - kx·vz, kx·vy - ky·vx) with ky = 0.
    const cx = -kz * vy, cy = kz * vx - kx * vz, cz = kx * vy;
    let x = r.x + vx * c + cx * s + kx * kv * (1 - c);
    let y = r.base + vy * c + cy * s;
    let z = r.z + vz * c + cz * s + kz * kv * (1 - c);
    if (r.phase === 'lower') y = Math.max(y, ctx.world.groundAt(x, z, y + 0.4).y);
    if (!Number.isFinite(x + y + z)) {
      x = r.x;
      y = r.base + H;
      z = r.z;
    }
    p.root.position.set(x, y, z);
    b.kinematic = true;
    b.velocity.set(0, 0, 0);
    b.move.set(0, 0, 0);
    b.external.set(0, 0, 0);
    b.grounded = true;
    b.groundY = y;
    b.groundColliderId = r.pillar.colliderId;
    b.airTime = 0;
    b.prevPosition.copy(p.root.position);
  }

  private detach(p: Player, keepVelocity: boolean): void {
    const b = p.body;
    if (!b) return;
    b.kinematic = false;
    if (!keepVelocity) b.velocity.set(0, 0, 0);
  }

  // -------------------------------------------------------------------------------------------- after the entities

  /** Runs after the entities: you face the way you ride and lean into the speed. */
  post(dt: number, _ctx: GameContext): void {
    const r = this.ride;
    const p = r?.rider ?? this.leanOwner;
    let want = 0;
    if (r && this.attached(r)) {
      r.rider.yaw = dampAngle(r.rider.yaw, r.heading, 14, dt);
      r.rider.root.rotation.y = r.rider.yaw;
      want = (r.speed / r.peak) * PC.leanDeg * DEG;
    }
    this.lean += (want - this.lean) * Math.min(1, dt * 10);
    const hum = p?.humanoid?.root;
    if (hum) hum.rotation.x = Math.abs(this.lean) < 1e-4 ? 0 : this.lean;
    if (!r && Math.abs(this.lean) < 1e-4) this.leanOwner = null;
  }

  // -------------------------------------------------------------------------------------------- debug

  state(): Record<string, unknown> {
    const r = this.ride;
    if (!r) return { phase: 'idle', ready: this.ready };
    const p = r.rider.position;
    // Your feet in the stone's own frame (its tilt undone): constant while you ride.
    const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const v = tmpB.set(p.x - r.x, p.y - r.base, p.z - r.z).applyAxisAngle(tmpA.set(fz, 0, -fx), -r.tilt);
    return {
      local: { x: +v.x.toFixed(4), y: +(v.y - r.pillar.height * r.pillar.level).toFixed(4), z: +v.z.toFixed(4) },
      phase: r.phase,
      ready: this.ready,
      t: +r.t.toFixed(3),
      speed: +r.speed.toFixed(2),
      peak: r.peak,
      travelled: +r.travelled.toFixed(2),
      heading: +r.heading.toFixed(3),
      tilt: +(r.tilt / DEG).toFixed(2),
      charges: r.charges,
      target: r.target?.id ?? null,
      reason: r.reason,
      pillar: { x: +r.x.toFixed(3), z: +r.z.toFixed(3), base: +r.base.toFixed(3), top: +r.pillar.top.toFixed(3), level: +r.pillar.level.toFixed(3) },
      rider: { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) },
      offset: { x: +(p.x - r.x).toFixed(4), z: +(p.z - r.z).toFixed(4), y: +(p.y - r.pillar.top).toFixed(4) },
      hits: r.hits.size,
    };
  }
}

export const pillarCharge = new PillarChargeDriver();

bending.hook({
  init: (ctx) => pillarCharge.init(ctx),
  pre: (dt, ctx) => pillarCharge.pre(dt, ctx),
  post: (dt, ctx) => pillarCharge.post(dt, ctx),
  sessionStart: (ctx) => {
    pillarCharge.reset();
    const g = (globalThis as any).__game;
    if (g?.debug) {
      g.debug.pillarCharge = {
        state: () => pillarCharge.state(),
        canCharge: () => (ctx.player ? pillarCharge.canCharge(ctx, ctx.player as Player) : false),
        /** Where a charge set off now would go. */
        pick: () => {
          const p = ctx.player as Player | null;
          if (!p) return null;
          const k = pillarCharge.pick(ctx, p);
          return { target: k.target?.id ?? null, distance: +k.distance.toFixed(2), dir: [+k.dir.x.toFixed(3), +k.dir.z.toFixed(3)] };
        },
      };
    }
  },
  sessionEnd: () => pillarCharge.reset(),
});

registerTechnique({
  id: PILLAR_CHARGE_ID,
  name: 'Pillar Charge',
  element: 'earth',
  kind: 'movement',
  tier: 2,
  innate: 'Comes with Earth Pillar: stand on your own raised pillar and press Dodge (CHARGE)',
  description: 'Ride your own raised pillar across the ground and slam it into your enemies: it homes on its target, bowls over anyone in the way and pitches into the ground with a shockwave.',
  usage: 'Raise an Earth Pillar under yourself, then press Dodge on top of it (the touch DODGE button reads CHARGE). It charges the enemy you are locked on to, else the nearest one ahead of the camera, else straight along your aim. Nudge it with the stick; Jump to leap off. Chain up to three charges per pillar within 1.5 s of each slam.',
  icon: 'earth',
  chiCost: PC.chiCost,
  cooldown: PC.cooldown,
  windup: 0,
  recovery: 0.12,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: PC.maxDistance,
  channel: 6,
  precheck: (caster, ctx) => pillarCharge.precheck(caster, ctx),
  begin(cast) {
    pillarCharge.start(cast);
  },
  release() {},
  channelUpdate(cast) {
    return pillarCharge.channelKeep(cast);
  },
  end(cast, interrupted) {
    pillarCharge.castEnded(cast, interrupted);
  },
  aiScore: () => 0,
});

void tmpB;
void UP;

