import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { registerTechnique } from '../../CombatSystem';
import { clamp01, easeOut } from '../../water/Curve';
import { capTaper } from '../../water/FlowTube';
import { StreamBody, type WaterEffect, type WaterFX } from '../../water/WaterFX';
import type { Cast } from '../../types';
import { fxOf, refundWater, shake, UP } from './shared';

/**
 * Water Spout (movement): only a large body of water (ocean, river, lake, the
 * swamp) can lift a bender. A swirling column erupts from the surface and
 * carries the bender ~7.5 m up; they can steer while riding, whip from the
 * spout (the column is a big source right below them), jump off for a boost,
 * or let it collapse. Leaving the water makes the column lean, then fall.
 */

const tA = new THREE.Vector3();
export const SPOUT = { height: 7.5, rise: 0.8, lean: 5.5 };

class SpoutEffect implements WaterEffect {
  readonly kind = 'spout';
  castId: number;
  private readonly fx: WaterFX;
  private readonly column: StreamBody;
  private readonly spiral: StreamBody | null;
  readonly base = new THREE.Vector3();
  readonly top = new THREE.Vector3();
  private t = 0;
  private riding = false;
  private rideT = 0;
  private collapseT = -1;
  height = 0;
  private loop: LoopHandle | null = null;

  constructor(readonly cast: Cast) {
    this.fx = fxOf(cast);
    this.castId = cast.id;
    this.base.copy(cast.water.from ?? cast.caster.position);
    this.fx.logCast(cast, this.base);
    this.column = new StreamBody(this.fx, { flow: 9, foam: 1.3 }, 0.9, 4);
    this.column.wobble = 0.12;
    this.spiral = this.fx.quality === 'low' ? null : new StreamBody(this.fx, { flow: 12, opacity: 0.7 }, 1.4, 12);
  }

  ride(): void {
    this.riding = true;
    this.rideT = 0;
    this.loop = this.cast.ctx.audio.loop('water_swirl', { position: this.base, volume: 0.6 });
  }

  collapse(): void {
    if (this.collapseT >= 0) return;
    this.collapseT = 0;
    this.riding = false;
    this.loop?.stop(0.3);
    this.fx.splash(this.base, 1.8, { volume: 0.8 });
  }

  get alive(): boolean {
    return this.collapseT < 0;
  }

  /** Height (0..1 of full) the bender should be held at. */
  get lift(): number {
    return this.riding ? easeOut(this.rideT / SPOUT.rise) : 0;
  }

  update(dt: number): boolean {
    this.t += dt;
    const ctx = this.cast.ctx;
    const c = this.cast.caster;
    // The column's foot follows the bender over water; on land it stays and leans.
    const w = ctx.world.waterAt(c.position.x, c.position.z);
    if (w && !w.frozen) this.base.lerp(tA.set(c.position.x, w.level, c.position.z), Math.min(1, dt * 8));
    const lean = Math.hypot(c.position.x - this.base.x, c.position.z - this.base.z);
    if (this.riding && lean > SPOUT.lean) this.collapse();
    if (this.riding) this.rideT += dt;
    let k: number;
    if (this.collapseT >= 0) {
      this.collapseT += dt;
      k = Math.max(0, 1 - this.collapseT / 0.45);
      if (k <= 0) return false;
    } else if (this.riding) k = 1;
    else k = easeOut(this.t / Math.max(0.05, this.cast.def.windup)) * 0.35;
    // Column from the surface to just under the feet.
    this.top.copy(c.position).setY(Math.max(this.base.y + 0.5, c.position.y - 0.15));
    if (this.collapseT >= 0) this.top.lerp(this.base, 1 - k);
    this.height = this.top.y - this.base.y;
    const p = this.column.pts;
    p[0].copy(this.base);
    p[1].lerpVectors(this.base, this.top, 0.35).addScaledVector(UP, 0.0);
    p[2].lerpVectors(this.base, this.top, 0.7);
    p[3].copy(this.top);
    this.column.radius = (0.85 + 0.1 * Math.sin(this.fx.time * 6)) * (0.5 + 0.5 * k);
    this.column.profile = (u) => (1.15 - 0.45 * u + 0.35 * Math.max(0, (u - 0.85) / 0.15)) * capTaper(u, 0.0, 0.06);
    this.column.build(4);
    if (this.spiral) {
      const sp = this.spiral.pts;
      const time = this.fx.time;
      for (let i = 0; i < 12; i++) {
        const u = i / 11;
        const a = time * 7 + u * 9;
        const r = this.column.radius * (1.2 - 0.4 * u);
        sp[i].lerpVectors(this.base, this.top, u);
        sp[i].x += Math.cos(a) * r;
        sp[i].z += Math.sin(a) * r;
      }
      this.spiral.radius = 0.12 * k;
      this.spiral.head = 1;
      this.spiral.profile = (u) => capTaper(u, 0.1, 0.1);
      this.spiral.build(12);
    }
    // Spray at the foot and the crown.
    if (k > 0.2 && Math.random() < dt * 30) ctx.vfx.burst('spray', this.base, { count: 2, size: 1.2, radius: 0.8 });
    if (this.riding && Math.random() < dt * 20) ctx.vfx.burst('splash', this.top, { count: 2, speed: 0.6, radius: 0.5 });
    this.loop?.setPosition(this.base);
    return this.t < 10;
  }

  trace(): Record<string, unknown> {
    return { base: this.base.toArray(), top: this.top.toArray(), height: this.height, riding: this.riding, start: this.base.toArray() };
  }

  dispose(): void {
    this.column.dispose();
    this.spiral?.dispose();
    this.loop?.stop(0.1);
  }
}

registerTechnique({
  id: 'water_spout',
  name: 'Water Spout',
  element: 'water',
  kind: 'movement',
  tier: 3,
  description: 'Raise a swirling column of water beneath you and ride it high above the surface. Steer while you ride, strike from above, or leap off. Only a large body of water can carry you.',
  usage: 'Movement. Use while in or beside a river, lake, swamp or the sea. Jump to leap off.',
  icon: 'water',
  chiCost: 20,
  cooldown: 10,
  water: { amount: 20, largeSource: true, maxRange: 9 },
  windup: 0.3,
  recovery: 0.2,
  movement: 'free',
  airborne: true,
  channel: 4.5,
  interruptible: true,
  range: 0,
  begin(cast) {
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
    // The eruption throws back anything around the foot of the column.
    const at = sp.base.clone().setY(sp.base.y + 1);
    cast.areaHit({ center: at, radius: 3.2, height: 2.2, damage: 8, knockback: 10, knockDir: 'radial', launch: 7, stagger: 35, status: [{ type: 'soaked', duration: 8 }] });
    fxOf(cast).splash(sp.base, 2, { volume: 1 });
    ctx.vfx.burst('spray', sp.base, { count: 24, size: 1.6, radius: 1.2 });
    ctx.audio.play('water_spout', { position: sp.base, volume: 1 });
    shake(cast, 0.22, 0.3);
  },
  channelUpdate(cast) {
    const c = cast.caster;
    const sp = cast.data.spout as SpoutEffect;
    if (!c.alive || !sp.alive) return false;
    const body = c.body;
    if (body) {
      const targetY = sp.base.y + SPOUT.height * sp.lift + 0.1;
      const vy = (targetY - c.position.y) * 6;
      body.velocity.y = Math.max(-6, Math.min(14, vy));
      body.grounded = false;
    }
    // Leap off the spout.
    if (c.isPlayer && cast.ctx.input.wasPressed('jump') && sp.lift > 0.7) {
      c.body?.launch(11);
      cast.data.leapt = true;
      return false;
    }
    return true;
  },
  end(cast, interrupted) {
    const sp = cast.data.spout as SpoutEffect | undefined;
    cast.caster.humanoid?.animator.stop('water_spout_ride', 0.3);
    sp?.collapse();
    if (!cast.data.released && interrupted) refundWater(cast);
    else if (cast.data.released && !cast.data.leapt) cast.caster.body?.launch(3);
  },
  aiScore() {
    return 0;
  },
});
