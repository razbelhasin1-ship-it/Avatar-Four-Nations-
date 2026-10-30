import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { Action } from '../../../core/Input';
import type { Player } from '../../../player/Player';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast } from '../../types';
import { bending } from '../bending/runtime';
import { fxOf, refundWater, shake, UP } from './shared';

/**
 * Water Spout (movement): only a large body of water (ocean, river, lake, the swamp) can lift a
 * bender. A spinning column erupts from the surface and carries them up, and they ride it for as
 * long as they like: they glide across the water on it (the column sways and its foot trails
 * behind them), strike from the top (whips and blasts draw on the water below), press the
 * technique again to sink back down, or jump to leap off. The column cannot leave the water: at
 * a shore it leans out over the bank, no further. A stun, a freeze or switching away from water
 * brings it down.
 *
 * The ride is held by the effect, not by a channel, so the bender can attack from the top.
 */

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
export const SPOUT = { height: 7, rise: 0.8, lower: 0.8, lean: 3.2, speed: 8.5, sprint: 12, accel: 6 };
const COL_PTS = 8;
const SPIRAL_PTS = 14;
const RING_PTS = 16;

/** Spouts being ridden, by rider id. */
const riding = new Map<number, SpoutEffect>();

class SpoutEffect implements WaterEffect {
  readonly kind = 'spout';
  castId: number;
  private readonly fx: WaterFX;
  private readonly column: StreamBody;
  private readonly spirals: StreamBody[] = [];
  /** Whirlpool where the column meets the water. */
  private readonly pool: StreamBody;
  /** Water swirling around the rider's feet. */
  private readonly cup: StreamBody;
  /** The water point under the column: follows the rider over open water. */
  readonly base = new THREE.Vector3();
  /** The column's foot trails the base, so the column leans and sways as the rider moves. */
  private readonly foot = new THREE.Vector3();
  readonly top = new THREE.Vector3();
  private readonly ctrl = new THREE.Vector3();
  private readonly rideSpec = { speed: SPOUT.speed, sprint: SPOUT.sprint, accel: SPOUT.accel };
  private t = 0;
  private riding = false;
  private rideT = 0;
  private lowering = -1;
  leapt = false;
  private collapseT = -1;
  height = 0;
  private loop: LoopHandle | null = null;
  private rippleT = 0;
  private bank = 0;
  onCollapse: (() => void) | null = null;

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    this.base.copy(cast.water.from ?? cast.caster.position);
    this.foot.copy(this.base);
    this.fx.logCast(cast, this.base);
    const low = this.fx.quality === 'low';
    // A fat, round, foaming column (extra radial segments so it never reads as a prism).
    this.column = new StreamBody(this.fx, { flow: 9, foam: 1.5, opacity: 0.93 }, low ? 1 : 1.3, COL_PTS, 14);
    this.column.wobble = 0.1;
    // Streams spiralling up around it.
    for (let i = 0; i < (low ? 1 : 2); i++) this.spirals.push(new StreamBody(this.fx, { flow: 12, opacity: 0.85, foam: 1.4 }, low ? 1 : 1.4, SPIRAL_PTS));
    this.pool = new StreamBody(this.fx, { flow: 7, foam: 2, opacity: 0.85 }, 1, RING_PTS);
    this.cup = new StreamBody(this.fx, { flow: 10, foam: 1.6, opacity: 0.9 }, 1, RING_PTS);
  }

  ride(): void {
    this.riding = true;
    this.rideT = 0;
    this.loop = this.cast.ctx.audio.loop('water_swirl', { position: this.base, volume: 0.6 });
    const c = this.cast.caster;
    riding.set(c.id, this);
    if (c.isPlayer) (c as Player).ride = this.rideSpec;
  }

  /** Sink back down to the water (the technique pressed again while riding). */
  lower(): void {
    if (!this.riding || this.lowering >= 0 || this.collapseT >= 0) return;
    this.lowering = 0;
    this.cast.ctx.audio.play('water_gather', { position: this.top, volume: 0.6, pitch: 0.6 });
  }

  collapse(): void {
    if (this.collapseT >= 0) return;
    this.collapseT = 0;
    this.endRide();
    this.onCollapse?.();
    this.loop?.stop(0.3);
    this.fx.splash(this.foot, 1.8, { volume: 0.8 });
  }

  private endRide(): void {
    if (!this.riding) return;
    this.riding = false;
    const c = this.cast.caster;
    if (riding.get(c.id) === this) riding.delete(c.id);
    if (c.isPlayer && (c as Player).ride === this.rideSpec) (c as Player).ride = null;
    const hum = c.humanoid?.root;
    if (hum) {
      hum.rotation.x = 0;
      hum.rotation.z = 0;
    }
  }

  get alive(): boolean {
    return this.collapseT < 0;
  }

  get isRiding(): boolean {
    return this.riding;
  }

  /** Height (0..1 of full) the bender is held at: rises on the ride, sinks when lowered. */
  get lift(): number {
    if (!this.riding) return 0;
    const up = easeOut(this.rideT / SPOUT.rise);
    if (this.lowering < 0) return up;
    const d = clamp01(this.lowering / SPOUT.lower);
    return up * (1 - d * d * (3 - 2 * d));
  }

  update(dt: number): boolean {
    this.t += dt;
    const ctx = this.cast.ctx;
    const c = this.cast.caster;
    if (this.riding) {
      this.rideT += dt;
      if (this.lowering >= 0) this.lowering += dt;
      this.hold(c);
    }
    // The base follows the rider over open water; the foot trails it.
    const w = ctx.world.waterAt(c.position.x, c.position.z);
    if (this.collapseT < 0 && w && !w.frozen) this.base.set(c.position.x, w.level, c.position.z);
    this.foot.lerp(this.base, this.riding ? 1 - Math.exp(-dt * 4.5) : 1);
    this.foot.y = this.base.y;
    let k: number;
    if (this.collapseT >= 0) {
      this.collapseT += dt;
      k = Math.max(0, 1 - this.collapseT / 0.45);
      if (k <= 0) return false;
    } else if (this.riding) k = 1;
    else k = easeOut(this.t / Math.max(0.05, this.cast.def.windup)) * 0.35;
    // From the water up to just under the feet.
    this.top.copy(c.position).setY(Math.max(this.foot.y + 0.5, c.position.y - 0.12));
    if (this.collapseT >= 0) this.top.lerp(this.foot, 1 - k);
    this.height = this.top.y - this.foot.y;
    this.buildColumn(k);
    this.buildSpirals(k);
    this.buildRings(k);
    // Spray and mist at the foot, splashes at the crown, water sheeting off a moving column.
    if (k > 0.2 && Math.random() < dt * 30) ctx.vfx.burst('spray', this.foot, { count: 2, size: 1.3, radius: 1 });
    if (k > 0.2 && Math.random() < dt * 4) ctx.vfx.burst('mist', this.foot, { count: 1, radius: 1.2 });
    if (this.riding && Math.random() < dt * 14) ctx.vfx.burst('splash', this.top, { count: 2, speed: 0.8, radius: 0.5 });
    const b = c.body;
    if (this.riding && b && b.horizontalSpeed > 3 && Math.random() < dt * 24) {
      this.columnAt(0.15 + Math.random() * 0.7, tA);
      this.fx.shed(tA, tB.set(-b.move.x * 0.4, 0.5, -b.move.z * 0.4), 1, 1);
    }
    this.rippleT -= dt;
    if (k > 0.3 && this.rippleT <= 0) {
      this.rippleT = 0.32;
      ctx.vfx.ring(tA.copy(this.foot).setY(this.foot.y + 0.05), '#d8f4ff', 2.6 + 1.2 * k, 0.6, { opacity: 0.55 });
    }
    this.loop?.setPosition(this.foot);
    // A column that was raised but never ridden (the windup was cut short) falls away.
    if (!this.riding && this.collapseT < 0 && this.t > 3) this.collapse();
    return true;
  }

  /** The column's centreline at u (0 = water, 1 = feet): it rises out of the water, then bends to the rider. */
  private columnAt(u: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const cc = u * u;
    out.set(this.foot.x * a + this.ctrl.x * b + this.top.x * cc, this.foot.y * a + this.ctrl.y * b + this.top.y * cc, this.foot.z * a + this.ctrl.z * b + this.top.z * cc);
    // A gentle sway, strongest mid-way.
    const time = this.fx.time;
    const s = Math.sin(Math.PI * u) * 0.18;
    out.x += Math.sin(time * 1.7 + u * 3) * s;
    out.z += Math.cos(time * 1.3 + u * 2.5) * s;
    return out;
  }

  private buildColumn(k: number): void {
    const h = Math.max(0.5, this.top.y - this.foot.y);
    this.ctrl.copy(this.foot).addScaledVector(UP, h * 0.55);
    const p = this.column.pts;
    for (let i = 0; i < COL_PTS; i++) this.columnAt(i / (COL_PTS - 1), p[i]);
    this.column.radius = (0.72 + 0.06 * Math.sin(this.fx.time * 6)) * (0.5 + 0.5 * k);
    // A broad swirling mound at the water, a waist, and a cup opening under the rider's feet.
    this.column.profile = (u) => (1 + 1.1 * Math.pow(Math.max(0, 1 - u / 0.14), 2) - 0.2 * u + 0.35 * Math.max(0, (u - 0.86) / 0.14)) * capTaper(u, 0, 0.05);
    this.column.build(COL_PTS);
  }

  private buildSpirals(k: number): void {
    const time = this.fx.time;
    const n = this.spirals.length;
    for (let s = 0; s < n; s++) {
      const sp = this.spirals[s];
      const phase = (s / n) * Math.PI * 2;
      for (let i = 0; i < SPIRAL_PTS; i++) {
        const u = i / (SPIRAL_PTS - 1);
        this.columnAt(u, tA);
        const a = time * 7.5 + u * 10 + phase;
        const r = this.column.radius * (1.25 - 0.35 * u) * (u < 0.12 ? 1 + (0.12 - u) * 5 : 1);
        sp.pts[i].set(tA.x + Math.cos(a) * r, tA.y, tA.z + Math.sin(a) * r);
      }
      sp.radius = 0.11 * k;
      sp.head = 1;
      sp.profile = (u) => capTaper(u, 0.1, 0.1);
      sp.build(SPIRAL_PTS);
    }
  }

  private buildRings(k: number): void {
    const time = this.fx.time;
    // Whirlpool where the column meets the water.
    const pr = (1.5 + 0.15 * Math.sin(time * 3)) * (0.4 + 0.6 * k);
    for (let i = 0; i < RING_PTS; i++) {
      const a = (i / RING_PTS) * Math.PI * 2 + time * 3.2;
      this.pool.pts[i].set(this.foot.x + Math.cos(a) * pr, this.foot.y + 0.06 + 0.05 * Math.sin(a * 3 + time * 5), this.foot.z + Math.sin(a) * pr);
    }
    this.pool.tail = 0;
    this.pool.head = 1;
    this.pool.radius = 0.26 * k;
    this.pool.profile = (u) => 0.8 + 0.2 * Math.sin(u * 25 - time * 6);
    this.pool.build(RING_PTS, true);
    // An open swirl of water around the rider's feet.
    const ck = this.riding ? k * Math.min(1, this.rideT / 0.4) : 0;
    if (ck < 0.02) {
      this.cup.hide();
      return;
    }
    const cr = 0.5 + 0.05 * Math.sin(time * 4);
    for (let i = 0; i < RING_PTS; i++) {
      const a = (i / RING_PTS) * Math.PI * 2 - time * 5;
      this.cup.pts[i].set(this.top.x + Math.cos(a) * cr, this.top.y + 0.12 + 0.08 * Math.sin(a * 2 + time * 6), this.top.z + Math.sin(a) * cr);
    }
    this.cup.tail = 0;
    this.cup.head = 0.85;
    this.cup.radius = 0.13 * ck;
    this.cup.profile = (u) => capTaper(u, 0.15, 0.2);
    this.cup.build(RING_PTS, true);
  }

  /** Keep the rider on top of the column; leap off with jump; sink when lowered; fall if knocked out of it. */
  private hold(c: Cast['caster']): void {
    const ctx = this.cast.ctx;
    const player = c.isPlayer ? (c as Player) : null;
    if (!c.alive || c.stunned > 0 || c.hasStatus('freeze') || (player && player.element !== 'water')) {
      this.collapse();
      return;
    }
    // Back down at the water: the column lets go.
    if (this.lowering >= SPOUT.lower) {
      this.collapse();
      return;
    }
    if (player && ctx.input.wasPressed('jump') && this.lift > 0.6 && this.lowering < 0) {
      this.leapt = true;
      this.collapse();
      c.body?.launch(11);
      return;
    }
    const body = c.body;
    if (!body) return;
    // Ride height, with a gentle bob.
    const bob = Math.sin(this.rideT * 2.2) * 0.12 * this.lift;
    const targetY = this.base.y + SPOUT.height * this.lift + 0.1 + bob;
    body.velocity.y = Math.max(-8, Math.min(14, (targetY - c.position.y) * 6));
    body.grounded = false;
    // The column cannot leave the water: over a bank it leans out so far, no further.
    const dx = c.position.x - this.base.x;
    const dz = c.position.z - this.base.z;
    const d = Math.hypot(dx, dz);
    if (d > SPOUT.lean) {
      const nx = dx / d;
      const nz = dz / d;
      c.position.x = this.base.x + nx * SPOUT.lean;
      c.position.z = this.base.z + nz * SPOUT.lean;
      const out = body.move.x * nx + body.move.z * nz;
      if (out > 0) {
        body.move.x -= out * nx;
        body.move.z -= out * nz;
      }
      const ext = body.external.x * nx + body.external.z * nz;
      if (ext > 0) {
        body.external.x -= ext * nx;
        body.external.z -= ext * nz;
      }
    }
    // The rider leans into the ride: forward with speed, banked into turns.
    const hum = c.humanoid?.root;
    if (hum) {
      const side = body.move.x * Math.cos(c.yaw) - body.move.z * Math.sin(c.yaw);
      this.bank += (THREE.MathUtils.clamp(-side * 0.05, -0.25, 0.25) - this.bank) * 0.15;
      hum.rotation.z = this.bank;
      hum.rotation.x = 0.12 * Math.min(1, Math.hypot(body.move.x, body.move.z) / SPOUT.sprint);
    }
  }

  trace(): Record<string, unknown> {
    return { base: this.base.toArray(), top: this.top.toArray(), height: this.height, riding: this.riding, lowering: this.lowering >= 0, start: this.base.toArray() };
  }

  dispose(): void {
    this.endRide();
    this.column.dispose();
    for (const s of this.spirals) s.dispose();
    this.pool.dispose();
    this.cup.dispose();
    this.loop?.stop(0.1);
  }
}

// Pressing the technique again while riding sinks the spout back down (instead of a new cast).
bending.hook({
  pre: (_dt, ctx) => {
    const p = ctx.player;
    const sp = p ? riding.get(p.id) : undefined;
    if (!p || !sp) return;
    const i = ctx.progression.slotsFor('water').indexOf('water_spout');
    const action = i >= 0 ? (['ability1', 'ability2', 'ability3', 'ability4'] as Action[])[i] : null;
    if (action && ctx.input.wasPressed(action)) {
      ctx.input.consume(action);
      sp.lower();
    }
  },
  sessionEnd: (ctx) => {
    riding.clear();
    if (ctx.player) ctx.player.ride = null;
  },
});

registerTechnique({
  id: 'water_spout',
  name: 'Water Spout',
  element: 'water',
  kind: 'movement',
  tier: 3,
  description: 'Raise a spinning column of water beneath you and ride it high above the surface for as long as you like. Glide across the water on it, strike from above, sink back down or leap off. Only a large body of water can carry you.',
  usage: 'Movement (toggle). Use in or beside a river, lake, swamp or the sea. Steer across the water (sprint to race); the column leans out over a shore but never leaves the water. Press the technique again to sink back down; jump to leap off. No time limit; once the column falls it takes 3 seconds before you can raise another.',
  icon: 'water',
  chiCost: 10,
  cooldown: 3,
  water: { amount: 20, largeSource: true, maxRange: 9 },
  windup: 0.3,
  recovery: 0.2,
  movement: 'free',
  airborne: true,
  interruptible: true,
  range: 0,
  begin(cast) {
    // Raised again while a spout still stands: the old column falls away under the new one.
    riding.get(cast.caster.id)?.collapse();
    cast.caster.humanoid?.animator.play('water_spout_rise', { fadeIn: 0.05 });
    cast.data.spout = fxOf(cast).add(new SpoutEffect(cast));
    cast.ctx.audio.play('water_gather', { position: cast.water.from ?? cast.caster.position, volume: 0.8, pitch: 0.7 });
  },
  release(cast) {
    cast.data.released = true;
    const ctx = cast.ctx;
    const sp = cast.data.spout as SpoutEffect;
    sp.ride();
    cast.caster.humanoid?.animator.play('water_spout_ride', { fadeIn: 0.2 });
    sp.onCollapse = () => {
      cast.caster.humanoid?.animator.stop('water_spout_ride', 0.3);
      // The cooldown runs from the moment the column falls, not from when it rose.
      ctx.combat.startCooldown(cast.caster, 'water_spout', cast.def.cooldown);
    };
    // The eruption throws back anything around the foot of the column.
    const at = sp.base.clone().setY(sp.base.y + 1);
    cast.areaHit({ center: at, radius: 3.2, height: 2.2, damage: 8, knockback: 10, knockDir: 'radial', launch: 7, stagger: 35, status: [{ type: 'soaked', duration: 8 }] });
    fxOf(cast).splash(sp.base, 2, { volume: 1 });
    ctx.vfx.burst('spray', sp.base, { count: 24, size: 1.6, radius: 1.2 });
    ctx.audio.play('water_spout', { position: sp.base, volume: 1 });
    shake(cast, 0.22, 0.3);
  },
  end(cast, interrupted) {
    // Interrupted during the windup: the column falls back and the water returns.
    if (cast.data.released || !interrupted) return;
    (cast.data.spout as SpoutEffect | undefined)?.collapse();
    refundWater(cast);
  },
  aiScore() {
    return 0;
  },
});
